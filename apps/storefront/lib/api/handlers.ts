/**
 * Rdzenie tras publicznego API v1 (M1, ADR-108) — bez `next/headers` i bez
 * tworzenia klienta Supabase, testowalne wprost (wzorzec lib/checkout/core.ts).
 * Owijki route'ów (app/api/v1/**) dostarczają porty produkcyjne.
 *
 * KOLEJNOŚĆ BRAMEK (każda trasa tak samo): klucz API → status tenanta →
 * rate-limit (klucz ∧ IP) → praca. Klucz pierwszy, bo bez niego nie istnieje
 * wymiar limitu per klucz; status przed limitem, bo sklep zamknięty nie ma
 * po co palić okien licznika.
 *
 * TENANT WYŁĄCZNIE Z KLUCZA. Handlery nie czytają nagłówków tenanta ani pól
 * tenant_id z żądania — jedynym źródłem jest wynik weryfikacji klucza.
 * Nagłówek `x-tenant-id` i tak ginie w proxy (anty-spoofing, ADR-039), ale
 * ta warstwa nie ufa mu NAWET GDYBY przeszedł (test na warstwie handlera).
 *
 * REZERWACJA = TEN SAM RDZEŃ co storefront (submitCheckoutCore przez porty):
 *   * bramkę captchy zastępuje klucz API — wstrzykiwany weryfikator zawsze
 *     przepuszcza, bo server-to-server nie ma czego rysować w widgecie;
 *     tożsamość wołającego dowodzi klucz, nie łamigłówka,
 *   * port checkRateLimit rdzenia dostaje NASZ podwójny limit (klucz ∧ IP)
 *     zamiast progu 10/h per IP — klucz rdzenia (`checkout:ip:<ip>`) jest
 *     świadomie ignorowany, bo wymiarem API jest para (klucz, IP), a progi
 *     są per-integracja (patrz lib/api/rate-limit.ts). Bramka pozostaje
 *     WEWNĄTRZ rdzenia — jedna kolejność bramek, jedno miejsce zmiany,
 *   * rememberCheckout jest no-opem: maszynowy konsument nie ma ciasteczek
 *     ani kroku płatności w przeglądarce; uchwytu nie wydajemy w ogóle
 *     (order_id/log_token zostają po stronie serwera, jak w kontrakcie
 *     CheckoutResult).
 */
import type { CustomFieldDefinition } from "@avably/core";

import {
  submitCheckoutCore,
  type CheckoutRpcArgs,
  type CheckoutRpcResult,
} from "@/lib/checkout/core";
import type { CheckoutTicket } from "@/lib/checkout/ticket";
import type { OnlinePaymentAvailability } from "@/lib/checkout/payment-options";
import type { PublicAvailability, PublicCatalog } from "@/lib/checkout/contract";

import {
  API_ACTIVE_TENANT_STATUSES,
  authenticateApiRequest,
  type VerifiedApiKey,
  type VerifyApiKeyHash,
} from "./auth";
import { apiV1Error, type ApiV1ReservationResponse } from "./contract";
import { checkApiRateLimits, type CheckRateLimitFn } from "./rate-limit";

/** Porty wspólne wszystkich tras v1. */
export interface ApiV1Deps {
  /** Weryfikacja hasha klucza (produkcyjnie RPC app.verify_api_key). */
  verifyKeyHash: VerifyApiKeyHash;
  /** Licznik okien (produkcyjnie @avably/security/rate-limit, prefiks API). */
  checkRateLimit: CheckRateLimitFn;
  /** IP żądania (produkcyjnie clientIpFromHeaders — model zaufania ADR-106). */
  ip: string;
}

export interface CatalogDeps extends ApiV1Deps {
  getCatalog: (tenantId: string) => Promise<PublicCatalog | null>;
}

export interface AvailabilityDeps extends ApiV1Deps {
  getAvailability: (
    tenantId: string,
    productId: string,
    startDate: string,
    endDate: string,
  ) => Promise<PublicAvailability | null>;
}

export interface ReservationDeps extends ApiV1Deps {
  callRpc: (args: CheckoutRpcArgs) => Promise<CheckoutRpcResult>;
  /**
   * Bilet zaufanej granicy (0059, ADR-125) — port, nie import, jak w rdzeniu.
   * Tenant przychodzi z ZWERYFIKOWANEGO klucza, nie z żądania (patrz nagłówek
   * modułu): bilet wiąże tenanta, więc wzięcie go z ciała żądania oddałoby
   * wołającemu prawo wskazania, dla czyjego sklepu bilet ma być ważny.
   */
  issueTicket: (tenantId: string) => CheckoutTicket;
  /** Definicje pól własnych zamawiania (0058) — patrz lib/checkout/custom-fields.ts. */
  readCustomFields: (tenantId: string) => Promise<CustomFieldDefinition[]>;
  sendEmails: (tenantId: string, ctx: CheckoutRpcResult) => Promise<string[]>;
  readOnlineAvailability: (tenantId: string) => Promise<OnlinePaymentAvailability>;
}

/**
 * Wspólny przedsionek tras v1: klucz → status → rate-limit. Zwraca Response
 * przy odmowie albo zweryfikowany klucz do dalszej pracy.
 */
async function admitRequest(
  authorizationHeader: string | null,
  kind: "read" | "reservation",
  deps: ApiV1Deps,
): Promise<VerifiedApiKey | Response> {
  const verified = await authenticateApiRequest(authorizationHeader, deps.verifyKeyHash);
  // Jednolite 401: brak nagłówka, zły format, klucz nieznany i odwołany są
  // NIEROZRÓŻNIALNE (zakaz enumeracji, §6.2).
  if (!verified) return apiV1Error(401, "unauthorized");

  // Posiadacz poprawnego klucza zna swojego tenanta — 403 o statusie sklepu
  // niczego mu nie ujawnia, a mówi wprost „to nie wina twojego wywołania".
  if (!API_ACTIVE_TENANT_STATUSES.includes(verified.tenantStatus)) {
    return apiV1Error(403, "store_unavailable");
  }

  const limit = await checkApiRateLimits(kind, verified.keyId, deps.ip, deps.checkRateLimit);
  if (!limit.success) return apiV1Error(429, "rate_limited");

  return verified;
}

/** GET /api/v1/catalog — katalog najemcy 1:1 z app.get_public_catalog. */
export async function handleCatalogRequest(
  request: Request,
  deps: CatalogDeps,
): Promise<Response> {
  const admitted = await admitRequest(request.headers.get("authorization"), "read", deps);
  if (admitted instanceof Response) return admitted;

  const catalog = await deps.getCatalog(admitted.tenantId);
  // Status przeszedł bramkę wyżej, więc NULL to fail-closed warstwy odczytu
  // (transport/RPC) — uczciwe 500, nie pusty katalog udający treść.
  if (catalog === null) return apiV1Error(500, "server_error");
  return Response.json(catalog);
}

/** Parametry zapytania /api/v1/availability — walidacja bez Zoda (3 pola). */
function parseAvailabilityQuery(url: URL): {
  productId: string;
  startDate: string;
  endDate: string;
} | null {
  const productId = url.searchParams.get("product_id") ?? "";
  const startDate = url.searchParams.get("start_date") ?? "";
  const endDate = url.searchParams.get("end_date") ?? "";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (!UUID.test(productId)) return null;
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) return null;
  // Zakres INCLUSIVE jak w checkoucie — odwrócony jest błędem wejścia.
  if (endDate < startDate) return null;
  return { productId, startDate, endDate };
}

/** GET /api/v1/availability?product_id&start_date&end_date */
export async function handleAvailabilityRequest(
  request: Request,
  deps: AvailabilityDeps,
): Promise<Response> {
  const admitted = await admitRequest(request.headers.get("authorization"), "read", deps);
  if (admitted instanceof Response) return admitted;

  const query = parseAvailabilityQuery(new URL(request.url));
  if (!query) return apiV1Error(400, "validation_failed");

  const availability = await deps.getAvailability(
    admitted.tenantId,
    query.productId,
    query.startDate,
    query.endDate,
  );
  // NULL = produkt nieznany, cudzy albo nieosiągalny — JEDNO 404 bez
  // rozróżnienia (klucz A pytający o produkt B nie dowiaduje się, że B
  // istnieje; §6.1).
  if (availability === null) return apiV1Error(404, "not_found");
  return Response.json(availability);
}

/** POST /api/v1/reservations — złożenie rezerwacji przez rdzeń checkoutu. */
export async function handleReservationRequest(
  request: Request,
  deps: ReservationDeps,
): Promise<Response> {
  const admitted = await admitRequest(request.headers.get("authorization"), "reservation", deps);
  if (admitted instanceof Response) return admitted;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiV1Error(400, "validation_failed");
  }

  const result = await submitCheckoutCore(body, {
    // TENANT WYŁĄCZNIE Z KLUCZA — patrz nagłówek modułu (dowód mutacyjny M3).
    tenantId: admitted.tenantId,
    ip: deps.ip,
    // Podwójny limit API zamiast progu storefrontu — patrz nagłówek modułu.
    // Rdzeń już PRZESZEDŁ przedsionek (admitRequest), więc to wywołanie jest
    // drugim zliczeniem tego samego żądania w tych samych oknach — świadomie:
    // progi w rate-limit.ts są dobrane na parę zliczeń per żądanie rezerwacji,
    // a bramka w rdzeniu zostaje jedynym miejscem, które NAPRAWDĘ zatrzymuje
    // pracę (spójnie ze storefrontem).
    checkRateLimit: () =>
      checkApiRateLimits("reservation", admitted.keyId, deps.ip, deps.checkRateLimit),
    // Bramkę captchy zastąpił klucz API (server-to-server) — patrz nagłówek.
    verifyCaptcha: async () => ({ ok: true }),
    // Bilet wiąże tenanta Z KLUCZA — tego samego, którym przedsionek wpuścił
    // to żądanie. Rdzeń wystawia go zaraz za `verifyCaptcha`, więc tutaj
    // „zaliczoną bramką" jest weryfikacja klucza, nie łamigłówka.
    issueTicket: () => deps.issueTicket(admitted.tenantId),
    rememberCheckout: async () => {},
    callRpc: deps.callRpc,
    sendEmails: (ctx) => deps.sendEmails(admitted.tenantId, ctx),
    readOnlineAvailability: () => deps.readOnlineAvailability(admitted.tenantId),
    readCustomFields: () => deps.readCustomFields(admitted.tenantId),
  });

  switch (result.status) {
    case "success": {
      // emailIssues ŚWIADOMIE nie przechodzi do v1 (patrz lib/api/contract.ts).
      const response: ApiV1ReservationResponse = {
        status: "success",
        nextStep: result.nextStep,
        order: result.order,
      };
      return Response.json(response, { status: 201 });
    }
    case "validation_error":
      return apiV1Error(422, "validation_failed", result.fields);
    case "unavailable":
      return apiV1Error(409, "conflict");
    case "rejected":
      return apiV1Error(422, "rejected");
    case "rate_limited":
      return apiV1Error(429, "rate_limited");
    case "payment_unavailable":
      return apiV1Error(409, "payment_unavailable");
    // captcha_failed jest w tym torze niereprezentowalne (weryfikator zawsze
    // przepuszcza) — gdyby jednak wróciło, to błąd naszej konstrukcji.
    case "captcha_failed":
    case "server_error":
      return apiV1Error(500, "server_error");
  }
}
