/**
 * Port Stripe Billing — abonament SaaS Avably na koncie PLATFORMY
 * (J2 faza 2a, ADR-136). Wzorzec portu 1:1 z `api.ts` (ADR-065):
 * wstrzykiwany `fetch`, konfiguracja per instancja, zero logowania,
 * redakcja klucza w komunikatach, brak konfiguracji = twardy błąd.
 *
 * ================== TWARDA GRANICA: TO NIE JEST CONNECT ==================
 *
 * Abonament SaaS to pieniądze płynące OD najemcy DO NAS — przeciwny kierunek
 * niż tor Connect (klient końcowy → konto najemcy). Dlatego ten klient:
 *
 *   1. NIGDY nie wysyła nagłówka `Stripe-Account` — każde żądanie idzie na
 *      konto platformy. Metoda `request` w ogóle nie przyjmuje takiego
 *      parametru, żeby pomyłka nie miała składni, w której mogłaby powstać.
 *   2. Ma WŁASNĄ stałą wersji API (`STRIPE_BILLING_API_VERSION`). Dziś równa
 *      wersji Connect, ale rozmyślnie osobna (W8 ze spike'u): bump wersji dla
 *      potrzeb Connect (nowa metoda płatności) nie może po cichu przesunąć
 *      pól `current_period_end`/`trial_end`, na których stoi projekcja —
 *      czytnik subskrypcji dodatkowo RZUCA przy braku pola, zamiast pisać
 *      NULL-e (cicha awaria, której test na nagranym fixturze nie widzi).
 *   3. Ma własną, węższą konfigurację: wymaga WYŁĄCZNIE klucza sekretnego.
 *      `resolveStripeConfig` żąda też klucza publicznego (Connect renderuje
 *      Payment Element w przeglądarce), a hostowany Checkout go nie używa —
 *      wymaganie go tutaj gasiłoby billing w środowisku, które go nie ma
 *      (D3 z krytyki spike'u).
 *
 * ================== SEKRET WEBHOOKA BILLINGU ==================
 *
 * Osobna trasa webhooka = osobny sekret (`AVABLY_STRIPE_BILLING_WEBHOOK_SECRET`).
 * Prefiks AVABLY_ jak cała rodzina (lekcja kolizji z namespace dostawcy,
 * ADR-049); bramka `requireStripeBillingWebhookSecret` jest lustrem
 * `requireStripeWebhookSecret`, ale NIE przechodzi przez `resolveStripeConfig`
 * — sekret podpisu jest potrzebny trasie webhooka niezależnie od tego, czy
 * środowisko ma komplet kluczy Connect.
 */
import { encodeStripeForm, redactSecretKey, StripeApiError } from "./api";
import { STRIPE_SECRET_KEY_ENV, StripeConfigError } from "./config";
import type { StripeAvailability } from "./types";

export const STRIPE_BILLING_API_BASE = "https://api.stripe.com";

/**
 * Wersja API przypięta dla toru billingu — OSOBNO od `STRIPE_API_VERSION`
 * (Connect). Projekcja czyta `current_period_end` z korzenia subskrypcji;
 * w nowszych wersjach dostawcy pole wędruje do `items.data[]` — wspólna
 * stała oznaczałaby, że bump dla Connect cicho zeruje daty billingu.
 */
export const STRIPE_BILLING_API_VERSION = "2024-06-20";

export const STRIPE_BILLING_WEBHOOK_SECRET_ENV = "AVABLY_STRIPE_BILLING_WEBHOOK_SECRET";

export interface StripeBillingConfig {
  secretKey: string;
}

export interface StripeBillingConfigOptions {
  /** Jawne wartości (test); domyślnie env procesu. Wzorzec `readConfig` z config.ts. */
  config?: Partial<StripeBillingConfig> | undefined;
}

function readBillingConfig(options: StripeBillingConfigOptions): Partial<StripeBillingConfig> {
  if ("config" in options) return options.config ?? {};
  return { secretKey: process.env[STRIPE_SECRET_KEY_ENV] };
}

/** Pusty string w env to BRAK konfiguracji, nie wartość (wzorzec config.ts). */
function present(value: string | null | undefined): string | undefined {
  return value ? value : undefined;
}

/**
 * Konfiguracja toru billingu: wyłącznie klucz sekretny platformy.
 * Klucz publiczny NIE jest wymagany — hostowany Checkout nie renderuje
 * niczego w naszej przeglądarce (D3 z krytyki spike'u J2).
 */
export function resolveStripeBillingConfig(
  options: StripeBillingConfigOptions = {},
): StripeBillingConfig {
  const secretKey = present(readBillingConfig(options).secretKey);
  if (!secretKey) throw new StripeConfigError([`brak ${STRIPE_SECRET_KEY_ENV}`]);
  if (/^pk_/.test(secretKey)) {
    throw new StripeConfigError([
      `${STRIPE_SECRET_KEY_ENV} zawiera klucz publiczny (prefiks pk_)`,
    ]);
  }
  return { secretKey };
}

/** Czy checkout abonamentu ma z czym działać — liczone na SERWERZE. */
export function stripeBillingAvailability(
  options: StripeBillingConfigOptions = {},
): StripeAvailability {
  try {
    resolveStripeBillingConfig(options);
    return { available: true, reason: null };
  } catch (error) {
    if (error instanceof StripeConfigError) return { available: false, reason: error.message };
    throw error;
  }
}

export interface BillingWebhookSecretOptions {
  /** Jawna wartość (test); domyślnie env procesu. */
  secret?: string | undefined;
}

/**
 * BRAMKA WEBHOOKA BILLINGU. Trasa bez sekretu przyjmowałaby dowolne ciało
 * jako pochodzące od dostawcy — dlatego dostęp do sekretu idzie wyłącznie
 * tędy, a bramka RZUCA (lustro `requireStripeWebhookSecret`).
 */
export function requireStripeBillingWebhookSecret(
  options: BillingWebhookSecretOptions = {},
): string {
  const secret = present(
    "secret" in options ? options.secret : process.env[STRIPE_BILLING_WEBHOOK_SECRET_ENV],
  );
  if (!secret) throw new StripeConfigError([`brak ${STRIPE_BILLING_WEBHOOK_SECRET_ENV}`]);
  return secret;
}

/** Odpowiedź błędu dostawcy: `{ error: { type, code, message } }`. */
interface StripeErrorBody {
  error?: { type?: string; code?: string; message?: string };
}

/**
 * Odczyt subskrypcji SaaS — komplet pól, na których stoi projekcja 0067.
 * Wszystko pochodzi z ODCZYTU u dostawcy (`GET /v1/subscriptions/{id}`),
 * nigdy z payloadu zdarzenia (reguła naczelna webhook.ts / ADR-049/067).
 */
export interface SaasSubscriptionRead {
  subscriptionId: string;
  customerId: string;
  /** Surowy status dostawcy — słownik pilnowany CHECK-iem 0067 przy zapisie. */
  status: string;
  /**
   * `metadata.tenant_id` z ODCZYTU subskrypcji. Ustawiane przez NASZ server
   * action przy tworzeniu sesji Checkoutu (`subscription_data[metadata]`),
   * więc jest jedynym nieprzekłamywalnym mapowaniem subskrypcja→tenant:
   * payload zdarzenia mógłby nieść cokolwiek, odczyt — tylko to, co dostawca
   * ma zapisane u siebie.
   */
  tenantIdFromMetadata: string | null;
  /** lookup_key ceny pierwszej pozycji — z niego wynika plan (billing-state). */
  priceLookupKey: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

interface StripeSubscriptionBody {
  id?: string;
  customer?: string | { id?: string };
  status?: string;
  metadata?: Record<string, string> | null;
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  items?: { data?: { price?: { lookup_key?: string | null } }[] } | null;
}

interface StripeCheckoutSessionBody {
  id?: string;
  url?: string;
  status?: string;
  subscription?: string | { id?: string } | null;
}

interface StripeInvoiceBody {
  id?: string;
  subscription?: string | { id?: string } | null;
}

interface StripeListBody<T> {
  data?: T[];
}

function idOf(value: string | { id?: string } | null | undefined): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value.id === "string") return value.id;
  return null;
}

function epochToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export interface StripeBillingClientOptions extends StripeBillingConfigOptions {
  /** Transport do testów; domyślnie globalny fetch. */
  fetchFn?: typeof fetch;
}

export interface CreateSaasCustomerInput {
  tenantId: string;
  email?: string | undefined;
  name?: string | undefined;
  /**
   * Klucz idempotencji DETERMINISTYCZNY (`saas-customer-<tenant_id>`):
   * dwuklik/retry w oknie ~24 h dostaje TEN SAM Customer zamiast sieroty,
   * o której nikt nie wie (K2 z krytyki spike'u).
   */
  idempotencyKey: string;
}

export interface CreateSaasCheckoutSessionInput {
  customerId: string;
  priceId: string;
  tenantId: string;
  successUrl: string;
  cancelUrl: string;
  /** Locale panelu — Checkout mówi językiem operatora ('pl' | 'en'). */
  locale?: string | undefined;
  /**
   * Klucz idempotencji z ZAMIARU, nie z losowości per request (W6):
   * `tenant + plan + interwał` — dwie szybkie próby tego samego zamiaru
   * dostają tę samą sesję; inny zamiar = inny klucz.
   */
  idempotencyKey: string;
}

export class StripeBillingClient {
  private readonly config: StripeBillingConfig;
  private readonly fetchFn: typeof fetch;

  /** Rzuca `StripeConfigError` przy braku klucza — nigdy atrapa. */
  constructor(options: StripeBillingClientOptions = {}) {
    this.config = resolveStripeBillingConfig(options);
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  /**
   * Jedyny transport klienta. ŚWIADOMIE bez parametru `stripeAccount` —
   * patrz nagłówek pliku: brak składni na cudze konto jest tu bramką.
   */
  private async request(
    path: string,
    init: RequestInit & { idempotencyKey?: string } = {},
  ): Promise<{ status: number; body: unknown }> {
    const { idempotencyKey, ...rest } = init;
    let response: Response;
    try {
      response = await this.fetchFn(`${STRIPE_BILLING_API_BASE}${path}`, {
        ...rest,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": STRIPE_BILLING_API_VERSION,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          ...rest.headers,
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new StripeApiError(
        redactSecretKey(
          `Połączenie z API rozliczeń nie powiodło się: ${detail}`,
          this.config.secretKey,
        ),
      );
    }

    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: { message: text.slice(0, 200) } };
      }
    }
    return { status: response.status, body };
  }

  private fail(status: number, body: unknown): StripeApiError {
    const error = (body as StripeErrorBody | null)?.error;
    const message = error?.message ?? `API rozliczeń odpowiedziało ${status}`;
    return new StripeApiError(
      redactSecretKey(message, this.config.secretKey),
      status,
      error?.code,
      error?.type,
    );
  }

  /**
   * Customer platformy po `metadata.tenant_id` — search, nie pamięć lokalna:
   * projekcja może jeszcze nie istnieć (checkout przed pierwszym webhookiem),
   * a tworzenie „bo nie znam" robiłoby duplikaty (K2).
   */
  async findCustomerByTenant(tenantId: string): Promise<string | null> {
    const query = encodeURIComponent(`metadata['tenant_id']:'${tenantId}'`);
    const { status, body } = await this.request(`/v1/customers/search?query=${query}&limit=1`, {
      method: "GET",
    });
    if (status < 200 || status >= 300) throw this.fail(status, body);
    const first = (body as StripeListBody<{ id?: string }> | null)?.data?.[0];
    return typeof first?.id === "string" ? first.id : null;
  }

  async createCustomer(input: CreateSaasCustomerInput): Promise<string> {
    const { status, body } = await this.request("/v1/customers", {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: encodeStripeForm({
        metadata: { tenant_id: input.tenantId },
        ...(input.email ? { email: input.email } : {}),
        ...(input.name ? { name: input.name } : {}),
      }),
    });
    if (status < 200 || status >= 300) throw this.fail(status, body);
    const id = (body as { id?: string } | null)?.id;
    if (!id) throw new StripeApiError("API rozliczeń nie zwróciło identyfikatora klienta.");
    return id;
  }

  /**
   * Subskrypcje klienta u DOSTAWCY (status=all) — bramka W6 pyta prawdę,
   * nie projekcję: po powrocie z Checkoutu projekcja bywa jeszcze pusta,
   * a druga sesja = drugie comiesięczne obciążenie.
   */
  async listSubscriptions(customerId: string): Promise<{ id: string; status: string }[]> {
    const { status, body } = await this.request(
      `/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100`,
      { method: "GET" },
    );
    if (status < 200 || status >= 300) throw this.fail(status, body);
    const rows = (body as StripeListBody<{ id?: string; status?: string }> | null)?.data ?? [];
    return rows
      .filter((row): row is { id: string; status: string } =>
        typeof row.id === "string" && typeof row.status === "string",
      )
      .map((row) => ({ id: row.id, status: row.status }));
  }

  /** Otwarte sesje Checkoutu klienta — do wygaszenia przed nową (W6: dwie karty). */
  async listOpenCheckoutSessionIds(customerId: string): Promise<string[]> {
    const { status, body } = await this.request(
      `/v1/checkout/sessions?customer=${encodeURIComponent(customerId)}&status=open&limit=100`,
      { method: "GET" },
    );
    if (status < 200 || status >= 300) throw this.fail(status, body);
    const rows = (body as StripeListBody<{ id?: string }> | null)?.data ?? [];
    return rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
  }

  async expireCheckoutSession(sessionId: string): Promise<void> {
    const { status, body } = await this.request(
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
      { method: "POST", body: "" },
    );
    // Sesja mogła wygasnąć/domknąć się w międzyczasie — wyścig z zegarem
    // dostawcy nie jest awarią naszej ścieżki.
    if (status < 200 || status >= 300) {
      const error = (body as StripeErrorBody | null)?.error;
      if (status === 400 && error?.message?.includes("expire")) return;
      throw this.fail(status, body);
    }
  }

  /** Cena po lookup_key (konwencja `saas_<plan>_<interwał>`) — zero price-id w env. */
  async findPriceIdByLookupKey(lookupKey: string): Promise<string> {
    const { status, body } = await this.request(
      `/v1/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&limit=1`,
      { method: "GET" },
    );
    if (status < 200 || status >= 300) throw this.fail(status, body);
    const first = (body as StripeListBody<{ id?: string }> | null)?.data?.[0];
    if (typeof first?.id !== "string") {
      throw new StripeApiError(
        `Cennik u dostawcy nie zna klucza ${lookupKey} — bootstrap produktów nie został wykonany.`,
      );
    }
    return first.id;
  }

  /**
   * Sesja Checkoutu w trybie subskrypcji. `subscription_data[metadata][tenant_id]`
   * jest sednem bezpieczeństwa toru: trafia na SUBSKRYPCJĘ u dostawcy i wraca
   * w każdym odczycie — webhook mapuje customer→tenant wyłącznie z tego
   * odczytu, nigdy z payloadu (K2 z krytyki spike'u).
   */
  async createSubscriptionCheckoutSession(
    input: CreateSaasCheckoutSessionInput,
  ): Promise<{ sessionId: string; url: string }> {
    const { status, body } = await this.request("/v1/checkout/sessions", {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: encodeStripeForm({
        mode: "subscription",
        customer: input.customerId,
        client_reference_id: input.tenantId,
        // Klucze numeryczne zamiast tablicy: encodeStripeForm serializuje
        // elementy tablic przez String(), co obiekt zamienia w
        // "[object Object]" — zagnieżdżony obiekt daje line_items[0][price].
        line_items: { "0": { price: input.priceId, quantity: 1 } },
        subscription_data: { metadata: { tenant_id: input.tenantId } },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        ...(input.locale ? { locale: input.locale } : {}),
      }),
    });
    if (status < 200 || status >= 300) throw this.fail(status, body);
    const parsed = body as StripeCheckoutSessionBody | null;
    if (typeof parsed?.id !== "string" || typeof parsed.url !== "string") {
      throw new StripeApiError("API rozliczeń nie zwróciło adresu sesji Checkoutu.");
    }
    return { sessionId: parsed.id, url: parsed.url };
  }

  /**
   * JEDYNE źródło stanu subskrypcji (ADR-049/067). Brak pól okresu przy
   * odpowiedzi 2xx to nie „null w projekcji", tylko GŁOŚNY błąd: ciche
   * wyzerowanie dat po bumpie wersji API u dostawcy było dokładnie awarią,
   * przed którą ostrzegała krytyka W8 — baner triala, `cancel_at_period_end`
   * i rekoncyliacja stanęłyby bez śladu w testach na nagranych fixture'ach.
   */
  async readSaasSubscription(subscriptionId: string): Promise<SaasSubscriptionRead> {
    const { status, body } = await this.request(
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: "GET" },
    );
    if (status < 200 || status >= 300) throw this.fail(status, body);
    const parsed = (body ?? {}) as StripeSubscriptionBody;

    const id = typeof parsed.id === "string" ? parsed.id : null;
    const customerId = idOf(parsed.customer);
    const subStatus = typeof parsed.status === "string" ? parsed.status : null;
    if (!id || !customerId || !subStatus) {
      throw new StripeApiError(
        "Odczyt subskrypcji nie zawiera kompletu identyfikatorów (id/customer/status).",
      );
    }
    if (
      typeof parsed.current_period_start !== "number" ||
      typeof parsed.current_period_end !== "number"
    ) {
      throw new StripeApiError(
        `Odczyt subskrypcji ${id} nie niesie current_period_start/current_period_end — ` +
          `kontrakt wersji ${STRIPE_BILLING_API_VERSION} złamany (bump wersji API?).`,
      );
    }

    const metadataTenant = parsed.metadata?.["tenant_id"];
    const lookupKey = parsed.items?.data?.[0]?.price?.lookup_key;

    return {
      subscriptionId: id,
      customerId,
      status: subStatus,
      tenantIdFromMetadata: typeof metadataTenant === "string" && metadataTenant ? metadataTenant : null,
      priceLookupKey: typeof lookupKey === "string" && lookupKey ? lookupKey : null,
      currentPeriodStart: epochToIso(parsed.current_period_start),
      currentPeriodEnd: epochToIso(parsed.current_period_end),
      cancelAtPeriodEnd: parsed.cancel_at_period_end === true,
    };
  }

  /**
   * Dwustopniowy odczyt `cs_…` → `sub_…` (W9 z krytyki wariantu A): zdarzenie
   * `checkout.session.completed` niesie identyfikator SESJI, a projekcja
   * potrzebuje subskrypcji — identyfikator bierzemy z ODCZYTU sesji, nie
   * z pola `data.object.subscription` payloadu.
   */
  async readCheckoutSessionSubscriptionId(sessionId: string): Promise<string | null> {
    const { status, body } = await this.request(
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      { method: "GET" },
    );
    if (status < 200 || status >= 300) throw this.fail(status, body);
    return idOf((body as StripeCheckoutSessionBody | null)?.subscription);
  }

  /** Dwustopniowy odczyt `in_…` → `sub_…` — lustro odczytu sesji. */
  async readInvoiceSubscriptionId(invoiceId: string): Promise<string | null> {
    const { status, body } = await this.request(`/v1/invoices/${encodeURIComponent(invoiceId)}`, {
      method: "GET",
    });
    if (status < 200 || status >= 300) throw this.fail(status, body);
    return idOf((body as StripeInvoiceBody | null)?.subscription);
  }
}
