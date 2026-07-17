/**
 * Klient API GlobKurier — port semantyki 1:1 z jednonajemcowego pierwowzoru
 * (dokumentacja: https://developer.globkurier.pl/), z czterema świadomymi
 * zmianami pod system wielotenantowy (ADR-031):
 *
 *   1. Token cache jest polem INSTANCJI, nie modułu. Cache modułowy,
 *      współdzielony przez wszystkie instancje procesu, serwowałby token
 *      zalogowany credentialami tenanta A instancji tenanta B — czyli
 *      podszywanie się między najemcami jednym polem statycznym.
 *   2. `fetch` jest wstrzykiwany (opcja fetchImpl) — testy kontraktowe biegną
 *      na nagranych fixtures, CI nie dotyka sieci.
 *   3. Odpowiedzi binarne (etykiety PDF) jako Uint8Array — bez zależności od
 *      node:Buffer, klient działa w każdym runtime z fetch.
 *   4. Bez logowania na konsolę — szum debugowy pierwowzoru; diagnostykę
 *      niesie GlobKurierAPIError (status, kod, szczegóły pól).
 */
import { getApiUrl } from "./config";
import type {
  CourierCredentials,
  GlobKurierAuth,
  GlobKurierBestPriceRequest,
  GlobKurierCreateOrderRequest,
  GlobKurierErrorResponse,
  GlobKurierLabelResponse,
  GlobKurierOrderResponse,
  GlobKurierProduct,
  GlobKurierSearchProductsRequest,
} from "./types";

export class GlobKurierAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string,
    public details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "GlobKurierAPIError";
  }
}

/** Bufor ważności tokenu: odśwież, gdy zostało mniej niż 5 minut. */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
/** API nie zwraca TTL — pierwowzór przyjmuje godzinę ważności tokenu. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

export class GlobKurierAPI {
  private readonly apiUrl: string;
  private readonly credentials: CourierCredentials;
  private readonly fetchImpl: typeof fetch;
  private tokenCache: GlobKurierAuth | null = null;

  constructor(credentials: CourierCredentials, options: { fetchImpl?: typeof fetch } = {}) {
    this.apiUrl = getApiUrl(credentials.environment);
    this.credentials = credentials;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
      return this.tokenCache.token;
    }

    const response = await this.fetchImpl(`${this.apiUrl}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": "pl",
      },
      body: JSON.stringify({
        email: this.credentials.email,
        password: this.credentials.password,
      }),
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as Partial<GlobKurierErrorResponse>;
      throw new GlobKurierAPIError(
        error.message || "Logowanie do GlobKurier nie powiodło się",
        response.status,
        error.code,
      );
    }

    const data = (await response.json()) as { token: string };
    this.tokenCache = { token: data.token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return data.token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit & { binary?: boolean } = {},
  ): Promise<T> {
    const token = await this.getToken();
    const url = `${this.apiUrl}${endpoint}`;
    const { binary, ...fetchOptions } = options;

    const headers = {
      "Content-Type": "application/json",
      Accept: binary ? "application/pdf" : "application/json",
      "Accept-Language": "pl",
      "X-Auth-Token": token,
      ...fetchOptions.headers,
    };

    try {
      const response = await this.fetchImpl(url, { ...fetchOptions, headers });

      if (binary) {
        if (!response.ok) {
          throw new GlobKurierAPIError(
            `Pobranie PDF nie powiodło się: ${response.statusText}`,
            response.status,
          );
        }
        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer) as unknown as T;
      }

      const contentType = response.headers.get("content-type");
      const isJson = contentType?.includes("application/json");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      if (isJson) {
        data = await response.json();
      } else {
        // Nie-JSON (np. HTML strony serwisowej) — treść staje się komunikatem
        // błędu niżej, zamiast po cichu udawać poprawną odpowiedź.
        data = { error: (await response.text()).slice(0, 200) };
      }

      if (!response.ok) {
        const errorData = data as GlobKurierErrorResponse & {
          errors?: unknown;
          violations?: unknown;
          error?: string;
        };

        let detailMessage =
          errorData.message ||
          errorData.error ||
          `Żądanie API odrzucone ze statusem ${response.status}`;

        // Szczegóły walidacyjne z dowolnego pola, w którym API je zwraca.
        const validation =
          errorData.errors || errorData.violations || errorData.details || errorData.fields;
        if (validation) {
          detailMessage += ` | Szczegóły: ${JSON.stringify(validation)}`;
        }

        throw new GlobKurierAPIError(
          detailMessage,
          response.status,
          errorData.code,
          errorData.details,
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof GlobKurierAPIError) throw error;
      throw new GlobKurierAPIError(
        `Błąd sieci: ${error instanceof Error ? error.message : "nieznany błąd"}`,
      );
    }
  }

  /**
   * Wyszukiwanie produktów przewoźników.
   * GET /v1/products
   */
  async searchProducts(params: GlobKurierSearchProductsRequest): Promise<GlobKurierProduct[]> {
    const queryParams = new URLSearchParams({
      senderPostCode: params.senderPostCode,
      senderCountryId: String(params.senderCountryId),
      receiverPostCode: params.receiverPostCode,
      receiverCountryId: String(params.receiverCountryId),
      length: String(params.length),
      width: String(params.width),
      height: String(params.height),
      weight: String(params.weight),
      quantity: "1",
      packageType: "PARCEL",
      transportType: "ROAD",
      flatList: "true",
    });

    // Typy odbioru/doręczenia są w API tablicami (collectionTypes[]=...).
    const collectionType = params.collectionType || "POINT";
    queryParams.append("collectionTypes[]", collectionType);
    queryParams.append("deliveryTypes[]", collectionType);

    // senderPointId/receiverPointId NIE są wspierane przez /products —
    // punkty podaje się dopiero przy /order i /order/bestPrice.

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await this.request<any>(`/products?${queryParams.toString()}`);

    // flatList=true grupuje produkty pod kluczem prędkości (standard/fast/...).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = Array.isArray(response)
      ? response
      : response.standard || response.items || response.products || response.data || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return items.map((item: any) => ({
      id: item.id,
      name: item.name || item.packageName || "",
      carrierName: item.carrierName || item.carrier?.name || "Unknown",
      carrierLogo: item.carrierLogoLink || item.carrierLogo || item.carrier?.logo,
      priceGross: item.grossPrice ?? item.priceGross ?? item.pricing?.priceGross ?? 0,
      priceNet: item.netPrice ?? item.priceNet ?? item.pricing?.priceNet ?? 0,
      currency:
        typeof item.currency === "string" ? item.currency : item.currency?.code || "PLN",
      deliveryTime: item.deliveryTime,
      deliveryDays: item.averageDelivery ?? item.deliveryDays,
      collectionType: item.collectionType || collectionType,
      additionalInfo: item.serviceCode || item.additionalInfo,
      serviceCode: item.serviceCode,
      addons: item.addons,
      addonsCategories: item.addonsCategories,
    }));
  }

  /**
   * Utworzenie zamówienia (konkretny produkt przewoźnika).
   * POST /v1/order
   */
  async createOrder(orderData: GlobKurierCreateOrderRequest): Promise<GlobKurierOrderResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await this.request<any>("/order", {
      method: "POST",
      body: JSON.stringify(orderData),
    });

    return {
      number: response.number,
      hash: response.hash || response.orderHash,
      status: response.status || "NEW_SHIPMENT",
      creationDate: response.creationDate,
      pricing: {
        priceGross: response.pricing?.priceGross || 0,
        priceNet: response.pricing?.priceNet || 0,
        vatPercent: response.pricing?.vatPercent || 23,
        currency: response.pricing?.currency || "PLN",
      },
      trackingNumber: response.trackingNumber,
      trackingUrl: response.trackingUrl,
    };
  }

  /**
   * Utworzenie zamówienia uproszczonym endpointem bestPrice — API samo
   * dobiera najtańszy pasujący produkt/przewoźnika.
   * POST /v1/order/bestPrice?createFully=...&onlyPricing=...
   */
  async createOrderBestPrice(
    orderData: GlobKurierBestPriceRequest,
    options: { onlyPricing?: boolean } = {},
  ): Promise<GlobKurierOrderResponse> {
    const onlyPricing = options.onlyPricing ?? false;
    const createFully = !onlyPricing;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await this.request<any>(
      `/order/bestPrice?createFully=${createFully}&onlyPricing=${onlyPricing}`,
      {
        method: "POST",
        body: JSON.stringify(orderData),
      },
    );

    // Odpowiedź może nieść dane zamówienia (createFully) i/lub samą wycenę —
    // pola numeru/hasha/trackingu bywają w różnych miejscach zależnie od trybu.
    const priceGross = response.totalGrossPrice ?? response.pricing?.priceGross ?? 0;
    const priceNet = response.totalNetPrice ?? response.pricing?.priceNet ?? 0;
    const currency = response.currency ?? response.pricing?.currency ?? "PLN";
    const vatPercent = response.vatPercent ?? response.pricing?.vatPercent ?? 23;

    const orderNumber =
      response.number ||
      response.orderNumber ||
      response.order?.number ||
      (Array.isArray(response.orders) ? response.orders[0]?.number : undefined) ||
      "";

    const trackingNumber =
      response.trackingNumber ||
      response.order?.trackingNumber ||
      (Array.isArray(response.orders) ? response.orders[0]?.trackingNumber : undefined);

    const hash =
      response.hash ||
      response.orderHash ||
      response.order?.hash ||
      (Array.isArray(response.orders) ? response.orders[0]?.hash : undefined);

    return {
      number: orderNumber,
      hash,
      status: response.status || response.order?.status || "NEW_SHIPMENT",
      creationDate: response.creationDate || new Date().toISOString(),
      pricing: { priceGross, priceNet, vatPercent, currency },
      trackingNumber,
      trackingUrl: response.trackingUrl,
    };
  }

  /**
   * Szczegóły zamówienia.
   * GET /v1/order?number={orderNumber}
   */
  async getOrder(orderNumber: string): Promise<GlobKurierOrderResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await this.request<any>(
      `/order?number=${encodeURIComponent(orderNumber)}`,
    );

    return {
      number: response.number,
      hash: response.hash || response.orderHash,
      status: response.status || "NEW_SHIPMENT",
      creationDate: response.creationDate,
      pricing: {
        priceGross: response.pricing?.priceGross || 0,
        priceNet: response.pricing?.priceNet || 0,
        vatPercent: response.pricing?.vatPercent || 23,
        currency: response.pricing?.currency || "PLN",
      },
      trackingNumber: response.trackingNumber,
      trackingUrl: response.trackingUrl,
    };
  }

  /**
   * Etykiety zamówienia (list przewozowy) jako base64.
   * GET /v1/order/{orderNumber}/labels
   */
  async getLabels(orderNumber: string): Promise<GlobKurierLabelResponse[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await this.request<{ items: any[] }>(`/order/${orderNumber}/labels`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (response.items || []).map((item: any) => ({
      type: item.type || "WAYBILL",
      format: item.format || "PDF",
      content: item.content,
    }));
  }

  /**
   * Etykiety po hashach zamówień (pobranie zbiorcze) — binarny PDF.
   * GET /v1/order/labels?orderHashes[]=...&format=A4
   */
  async getLabelsByHashes(orderHashes: string[], format: "A4" | "A6" = "A4"): Promise<Uint8Array> {
    const queryParams = new URLSearchParams();
    orderHashes.forEach((hash) => queryParams.append("orderHashes[]", hash));
    queryParams.append("format", format);

    return this.request<Uint8Array>(`/order/labels?${queryParams.toString()}`, {
      method: "GET",
      binary: true,
    });
  }

  /**
   * Anulowanie zamówienia.
   * DELETE /v1/order/{orderNumber}
   */
  async cancelOrder(orderNumber: string): Promise<void> {
    await this.request<void>(`/order/${orderNumber}`, { method: "DELETE" });
  }

  /** Próba logowania — sprawdzenie poprawności credentiali. */
  async testConnection(): Promise<boolean> {
    try {
      await this.getToken();
      return true;
    } catch {
      return false;
    }
  }

  /** Czyści cache tokenu tej instancji (wymuszenie ponownego logowania). */
  clearTokenCache(): void {
    this.tokenCache = null;
  }
}
