/**
 * Port Stripe Billing (ADR-136) — konfiguracja, granica toru platformy
 * i kontrakty odczytów na nagranych kształtach odpowiedzi.
 *
 * Osie:
 *   1. KONFIGURACJA WĘŻSZA NIŻ CONNECT: billing wymaga WYŁĄCZNIE klucza
 *      sekretnego (D3 z krytyki spike'u — wymaganie klucza publicznego
 *      gasiłoby webhook w środowisku bez niego); sekret webhooka billingu
 *      czytany OSOBNO, poza resolveStripeConfig.
 *   2. TWARDA GRANICA OD CONNECT: żadne żądanie klienta billingu nie niesie
 *      nagłówka Stripe-Account — pomyłka nie ma składni (metoda `request`
 *      nie przyjmuje konta), a test przypina to na KAŻDYM wywołaniu.
 *   3. KONTRAKT WERSJI API (W8): odczyt subskrypcji bez current_period_end
 *      RZUCA zamiast pisać NULL-e — cichy bump wersji u dostawcy ma być
 *      głośną awarią, nie wyzerowaną projekcją.
 *   4. Parametry sesji Checkoutu: mode=subscription, metadata tenanta na
 *      SUBSKRYPCJI (subscription_data), Idempotency-Key z zamiaru.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STRIPE_BILLING_API_VERSION,
  STRIPE_BILLING_CHECKOUT_API_VERSION,
  STRIPE_BILLING_WEBHOOK_SECRET_ENV,
  StripeBillingClient,
  requireStripeBillingWebhookSecret,
  resolveStripeBillingConfig,
  stripeBillingAvailability,
} from "./billing";
import { STRIPE_API_VERSION } from "./api";
import { STRIPE_SECRET_KEY_ENV, StripeConfigError } from "./config";

const SECRET_KEY = "sk_test_klucz_billingu_123";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** Transport nagrywający — odpowiada kolejno zadanymi ciałami. */
function recordingFetch(responses: { status: number; body: unknown }[]) {
  const requests: RecordedRequest[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const next = responses[requests.length] ?? { status: 200, body: {} };
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      ),
      body: typeof init?.body === "string" ? init.body : null,
    });
    return new Response(JSON.stringify(next.body), { status: next.status });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, requests };
}

function client(responses: { status: number; body: unknown }[]) {
  const { fetchFn, requests } = recordingFetch(responses);
  return {
    billing: new StripeBillingClient({ config: { secretKey: SECRET_KEY }, fetchFn }),
    requests,
  };
}

/** Kształt odczytu subskrypcji wg wersji 2024-06-20 (nagrany, przycięty). */
function subscriptionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub_test_1",
    object: "subscription",
    customer: "cus_test_1",
    status: "active",
    metadata: { tenant_id: "11111111-2222-3333-4444-555555555555" },
    current_period_start: 1_754_900_000,
    current_period_end: 1_757_578_400,
    cancel_at_period_end: false,
    items: { data: [{ id: "si_test_1", price: { id: "price_1", lookup_key: "saas_standard_monthly" } }] },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveStripeBillingConfig — wyłącznie klucz sekretny", () => {
  it("brak klucza → StripeConfigError z nazwą zmiennej", () => {
    expect(() => resolveStripeBillingConfig({ config: {} })).toThrowError(StripeConfigError);
    expect(() => resolveStripeBillingConfig({ config: {} })).toThrowError(
      new RegExp(STRIPE_SECRET_KEY_ENV),
    );
  });

  it("klucz publiczny w miejscu sekretnego → odmowa (prefiks pk_)", () => {
    expect(() =>
      resolveStripeBillingConfig({ config: { secretKey: "pk_test_zamiana" } }),
    ).toThrowError(/pk_/);
  });

  it("NIE wymaga klucza publicznego (D3) — sam sekretny wystarcza", () => {
    expect(resolveStripeBillingConfig({ config: { secretKey: SECRET_KEY } })).toEqual({
      secretKey: SECRET_KEY,
    });
  });

  it("availability: brak konfiguracji = powód, nigdy wyjątek", () => {
    expect(stripeBillingAvailability({ config: {} }).available).toBe(false);
    expect(
      stripeBillingAvailability({ config: { secretKey: SECRET_KEY } }).available,
    ).toBe(true);
  });
});

describe("requireStripeBillingWebhookSecret — bramka OSOBNA od resolveStripeConfig", () => {
  it("jawny undefined to decyzja wołającego — nie spada na env procesu", () => {
    vi.stubEnv(STRIPE_BILLING_WEBHOOK_SECRET_ENV, "whsec_z_env");
    expect(() => requireStripeBillingWebhookSecret({ secret: undefined })).toThrowError(
      new RegExp(STRIPE_BILLING_WEBHOOK_SECRET_ENV),
    );
  });

  it("czyta własną zmienną i zwraca sekret", () => {
    vi.stubEnv(STRIPE_BILLING_WEBHOOK_SECRET_ENV, "whsec_z_env");
    expect(requireStripeBillingWebhookSecret()).toBe("whsec_z_env");
  });

  it("pusty string w env = brak konfiguracji", () => {
    vi.stubEnv(STRIPE_BILLING_WEBHOOK_SECRET_ENV, "");
    expect(() => requireStripeBillingWebhookSecret()).toThrowError(StripeConfigError);
  });

  it("działa BEZ klucza publicznego i sekretnego w env (D3 — kontrast z Connect)", () => {
    vi.stubEnv(STRIPE_BILLING_WEBHOOK_SECRET_ENV, "whsec_solo");
    vi.stubEnv(STRIPE_SECRET_KEY_ENV, "");
    expect(requireStripeBillingWebhookSecret()).toBe("whsec_solo");
  });
});

describe("StripeBillingClient — tor PLATFORMY", () => {
  it("ŻADNE żądanie nie niesie nagłówka Stripe-Account (granica od Connect)", async () => {
    const { billing, requests } = client([
      { status: 200, body: { data: [] } },
      { status: 200, body: { id: "cus_1" } },
      { status: 200, body: { data: [] } },
      { status: 200, body: { data: [] } },
      { status: 200, body: { data: [{ id: "price_1" }] } },
      { status: 200, body: { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" } },
      { status: 200, body: subscriptionBody() },
    ]);

    await billing.findCustomerByTenant("t-1");
    await billing.createCustomer({ tenantId: "t-1", idempotencyKey: "saas-customer-t-1" });
    await billing.listSubscriptions("cus_1");
    await billing.listOpenCheckoutSessionIds("cus_1");
    await billing.findPriceIdByLookupKey("saas_standard_monthly");
    await billing.createSubscriptionCheckoutSession({
      customerId: "cus_1",
      priceId: "price_1",
      tenantId: "t-1",
      successUrl: "https://panel.test/organizacja?checkout=sukces",
      cancelUrl: "https://panel.test/organizacja?checkout=anulowano",
      idempotencyKey: "saas-checkout-t-1-standard-monthly",
    });
    await billing.readSaasSubscription("sub_test_1");

    expect(requests.length).toBe(7);
    for (const request of requests) {
      expect(Object.keys(request.headers).map((h) => h.toLowerCase())).not.toContain(
        "stripe-account",
      );
      // Rozdzielone, nie poluzowane: TWORZENIE SESJI Checkoutu (POST na dokładnie
      // /v1/checkout/sessions — nie listowanie z query) niesie basil, bo bramkuje
      // je Managed Payments; wszystkie pozostałe żądania (odczyty, tworzenie
      // klienta, listy) zostają na bazowej 2024-06-20.
      const isCheckoutCreate =
        request.method === "POST" &&
        request.url === "https://api.stripe.com/v1/checkout/sessions";
      expect(request.headers["Stripe-Version"]).toBe(
        isCheckoutCreate ? STRIPE_BILLING_CHECKOUT_API_VERSION : STRIPE_BILLING_API_VERSION,
      );
    }
  });

  it("własna stała wersji API — dziś równa Connect, ale rozmyślnie osobna (W8)", () => {
    // Gdy Connect bumpnie wersję, ta asercja przestanie wiązać wartości —
    // i WŁAŚNIE wtedy ma się zapalić, żeby decyzja o wersji billingu była
    // podjęta świadomie, nie odziedziczona.
    expect(STRIPE_BILLING_API_VERSION).toBe(STRIPE_API_VERSION);
  });

  it("createSubscriptionCheckoutSession: mode=subscription, metadata tenanta NA SUBSKRYPCJI, Idempotency-Key z zamiaru", async () => {
    const { billing, requests } = client([
      { status: 200, body: { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" } },
    ]);
    const result = await billing.createSubscriptionCheckoutSession({
      customerId: "cus_1",
      priceId: "price_1",
      tenantId: "t-1",
      successUrl: "https://panel.test/pl/organizacja?checkout=sukces",
      cancelUrl: "https://panel.test/pl/organizacja?checkout=anulowano",
      locale: "pl",
      idempotencyKey: "saas-checkout-t-1-standard-monthly",
    });

    expect(result).toEqual({ sessionId: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    const request = requests[0]!;
    expect(request.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(request.headers["Idempotency-Key"]).toBe("saas-checkout-t-1-standard-monthly");
    const body = request.body ?? "";
    expect(body).toContain("mode=subscription");
    expect(body).toContain("customer=cus_1");
    expect(body).toContain(encodeURIComponent("line_items[0][price]") + "=price_1");
    expect(body).toContain(
      encodeURIComponent("subscription_data[metadata][tenant_id]") + "=t-1",
    );
    expect(body).toContain("client_reference_id=t-1");
    expect(body).toContain("locale=pl");
  });

  it("readSaasSubscription: komplet pól z odczytu (metadata, lookup_key, okres)", async () => {
    const { billing } = client([{ status: 200, body: subscriptionBody() }]);
    const read = await billing.readSaasSubscription("sub_test_1");
    expect(read).toEqual({
      subscriptionId: "sub_test_1",
      customerId: "cus_test_1",
      status: "active",
      tenantIdFromMetadata: "11111111-2222-3333-4444-555555555555",
      priceLookupKey: "saas_standard_monthly",
      itemId: "si_test_1",
      currentPeriodStart: new Date(1_754_900_000 * 1000).toISOString(),
      currentPeriodEnd: new Date(1_757_578_400 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    });
  });

  it("KONTRAKT W8: brak current_period_end w odpowiedzi 2xx → GŁOŚNY błąd, nie NULL w projekcji", async () => {
    const body = subscriptionBody();
    delete body["current_period_end"];
    const { billing } = client([{ status: 200, body }]);
    await expect(billing.readSaasSubscription("sub_test_1")).rejects.toThrowError(
      /current_period/,
    );
  });

  it("brak metadata.tenant_id → null (rozstrzyga handler, nie zgadywanie)", async () => {
    const { billing } = client([{ status: 200, body: subscriptionBody({ metadata: {} }) }]);
    const read = await billing.readSaasSubscription("sub_test_1");
    expect(read.tenantIdFromMetadata).toBeNull();
  });

  it("dwustopniowy odczyt cs_/in_ → sub_ bierze identyfikator Z ODCZYTU (W9)", async () => {
    const { billing, requests } = client([
      { status: 200, body: { id: "cs_1", subscription: "sub_z_odczytu" } },
      { status: 200, body: { id: "in_1", subscription: { id: "sub_z_faktury" } } },
      { status: 200, body: { id: "cs_2", subscription: null } },
    ]);
    expect(await billing.readCheckoutSessionSubscriptionId("cs_1")).toBe("sub_z_odczytu");
    expect(await billing.readInvoiceSubscriptionId("in_1")).toBe("sub_z_faktury");
    expect(await billing.readCheckoutSessionSubscriptionId("cs_2")).toBeNull();
    expect(requests[0]!.url).toContain("/v1/checkout/sessions/cs_1");
    expect(requests[1]!.url).toContain("/v1/invoices/in_1");
  });

  it("findCustomerByTenant: search po metadata i zwrot pierwszego trafienia", async () => {
    const { billing, requests } = client([{ status: 200, body: { data: [{ id: "cus_9" }] } }]);
    expect(await billing.findCustomerByTenant("t-9")).toBe("cus_9");
    expect(requests[0]!.url).toContain("/v1/customers/search?query=");
    expect(decodeURIComponent(requests[0]!.url)).toContain("metadata['tenant_id']:'t-9'");
  });

  it("findPriceIdByLookupKey: brak ceny = głośny błąd o braku bootstrapu", async () => {
    const { billing } = client([{ status: 200, body: { data: [] } }]);
    await expect(billing.findPriceIdByLookupKey("saas_standard_monthly")).rejects.toThrowError(
      /bootstrap/,
    );
  });

  it("błąd dostawcy: komunikat bez klucza sekretnego (redakcja)", async () => {
    const { billing } = client([
      { status: 400, body: { error: { message: `Invalid key ${SECRET_KEY} used` } } },
    ]);
    await expect(billing.findCustomerByTenant("t-1")).rejects.toThrowError(/\[usunięto\]/);
  });
});

/**
 * ADR-219 — wersja `2025-03-31.basil` WYŁĄCZNIE na tworzeniu sesji (Managed
 * Payments), odczyty na `2024-06-20`. Asercje patrzą na nagłówek `Stripe-Version`
 * per żądanie: to on decyduje o reprezentacji odpowiedzi u dostawcy.
 */
describe("StripeBillingClient — wersja basil tylko na tworzeniu sesji (ADR-219)", () => {
  it("stała checkoutu to STABILNA basil, OSOBNA od bazowej (nie preview, nie bump bazowej)", () => {
    expect(STRIPE_BILLING_CHECKOUT_API_VERSION).toBe("2025-03-31.basil");
    // Osobność jest sednem: bazowa zostaje na 2024-06-20 (kontrakt W8 z korzenia).
    expect(STRIPE_BILLING_CHECKOUT_API_VERSION).not.toBe(STRIPE_BILLING_API_VERSION);
  });

  it("createSubscriptionCheckoutSession NIESIE basil — odtwarza wymóg Managed Payments", async () => {
    const { billing, requests } = client([
      { status: 200, body: { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" } },
    ]);
    await billing.createSubscriptionCheckoutSession({
      customerId: "cus_1",
      priceId: "price_1",
      tenantId: "t-1",
      successUrl: "https://panel.test/organizacja?checkout=sukces",
      cancelUrl: "https://panel.test/organizacja?checkout=anulowano",
      idempotencyKey: "saas-checkout-t-1-standard-monthly",
    });
    // DOWÓD MUTACYJNY: usuń `apiVersion: STRIPE_BILLING_CHECKOUT_API_VERSION` z
    // createSubscriptionCheckoutSession → nagłówek spada na 2024-06-20 i ten test
    // RED (dokładnie żądanie, które Managed Payments odrzuca na produkcji).
    expect(requests[0]!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(requests[0]!.headers["Stripe-Version"]).toBe(STRIPE_BILLING_CHECKOUT_API_VERSION);
  });

  it("createBillingPortalSession NIESIE basil — spójnie z checkoutem (parsujemy tylko url)", async () => {
    const { billing, requests } = client([
      { status: 200, body: { id: "bps_1", url: "https://billing.stripe.com/p/session/x" } },
    ]);
    await billing.createBillingPortalSession({
      customerId: "cus_1",
      returnUrl: "https://panel.test/pl/organizacja?portal=powrot",
    });
    // DOWÓD MUTACYJNY: usuń override z createBillingPortalSession → 2024-06-20 → RED.
    expect(requests[0]!.url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect(requests[0]!.headers["Stripe-Version"]).toBe(STRIPE_BILLING_CHECKOUT_API_VERSION);
  });

  it("ODCZYTY subskrypcji/faktury/sesji ZOSTAJĄ na 2024-06-20 (kontrakt current_period z korzenia)", async () => {
    const { billing, requests } = client([
      { status: 200, body: subscriptionBody() },
      { status: 200, body: { id: "in_1", subscription: "sub_z_faktury" } },
      { status: 200, body: { id: "cs_9", subscription: "sub_z_sesji" } },
    ]);
    await billing.readSaasSubscription("sub_test_1");
    await billing.readInvoiceSubscriptionId("in_1");
    await billing.readCheckoutSessionSubscriptionId("cs_9");
    // DOWÓD MUTACYJNY: nałóż `apiVersion: STRIPE_BILLING_CHECKOUT_API_VERSION` na
    // KTÓRYKOLWIEK z tych odczytów → basil zdejmuje current_period_* z korzenia,
    // a nagłówek ≠ 2024-06-20 → test RED. Odczyt MUSI zostać na bazowej.
    for (const request of requests) {
      expect(request.headers["Stripe-Version"]).toBe(STRIPE_BILLING_API_VERSION);
    }
  });

  it("ZAPISY STANU (zmiana planu, reaktywacja) zostają na 2024-06-20 — nie są tworzeniem sesji", async () => {
    const { billing, requests } = client([
      { status: 200, body: { id: "sub_test_1" } },
      { status: 200, body: { id: "sub_test_1" } },
    ]);
    await billing.updateSubscriptionPrice({
      subscriptionId: "sub_test_1",
      itemId: "si_test_1",
      priceId: "price_2",
    });
    await billing.resumeSubscription({ subscriptionId: "sub_test_1" });
    for (const request of requests) {
      expect(request.headers["Stripe-Version"]).toBe(STRIPE_BILLING_API_VERSION);
    }
  });
});

/**
 * J2 faza 3 (ADR-152) — Portal klienta, zmiana planu, reaktywacja.
 *
 * Testy patrzą na CIAŁO ŻĄDANIA, nie na to, co metoda zwraca: sednem obu
 * ścieżek subskrypcyjnych jest to, czego w żądaniu NIE MA (pola trialu,
 * klucza idempotencji z zamiaru), a tego nie widać po wyniku.
 */
describe("StripeBillingClient — zarządzanie abonamentem (ADR-152)", () => {
  it("Portal: sesja dla podanego klienta, z adresem powrotu i językiem", async () => {
    const { billing, requests } = client([
      { status: 200, body: { id: "bps_1", url: "https://billing.stripe.com/p/session/x" } },
    ]);
    const session = await billing.createBillingPortalSession({
      customerId: "cus_1",
      returnUrl: "https://panel.test/pl/organizacja?portal=powrot",
      locale: "pl",
    });
    expect(session.url).toBe("https://billing.stripe.com/p/session/x");
    expect(requests[0]!.url).toContain("/v1/billing_portal/sessions");
    expect(requests[0]!.method).toBe("POST");
    const body = decodeURIComponent(requests[0]!.body!.replace(/\+/g, "%20"));
    expect(body).toContain("customer=cus_1");
    expect(body).toContain("return_url=https://panel.test/pl/organizacja?portal=powrot");
    expect(body).toContain("locale=pl");
  });

  it("Portal: odpowiedź bez adresu = głośny błąd, nie pusty redirect", async () => {
    const { billing } = client([{ status: 200, body: { id: "bps_2" } }]);
    await expect(
      billing.createBillingPortalSession({ customerId: "cus_1", returnUrl: "https://panel.test" }),
    ).rejects.toThrowError(/adresu sesji Portalu/);
  });

  it("readCustomerTenantId: metadata z ODCZYTU; klient usunięty i brak metadanych → null", async () => {
    const { billing, requests } = client([
      { status: 200, body: { id: "cus_1", metadata: { tenant_id: "t-1" } } },
      { status: 200, body: { id: "cus_2", deleted: true, metadata: { tenant_id: "t-2" } } },
      { status: 200, body: { id: "cus_3", metadata: {} } },
    ]);
    expect(await billing.readCustomerTenantId("cus_1")).toBe("t-1");
    // Klient usunięty w dashboardzie nie „należy" już do nikogo — nawet gdy
    // dostawca odda w odpowiedzi resztki metadanych.
    expect(await billing.readCustomerTenantId("cus_2")).toBeNull();
    expect(await billing.readCustomerTenantId("cus_3")).toBeNull();
    expect(requests[0]!.url).toContain("/v1/customers/cus_1");
    expect(requests[0]!.method).toBe("GET");
  });

  it("odczyt subskrypcji niesie identyfikator POZYCJI (adres podmiany ceny)", async () => {
    const { billing } = client([{ status: 200, body: subscriptionBody() }]);
    const read = await billing.readSaasSubscription("sub_test_1");
    expect(read.itemId).toBe("si_test_1");
  });

  it("odczyt bez pozycji: itemId null, a reszta projekcji BEZ USZCZERBKU", async () => {
    const { billing } = client([{ status: 200, body: subscriptionBody({ items: { data: [] } }) }]);
    const read = await billing.readSaasSubscription("sub_test_1");
    expect(read.itemId).toBeNull();
    expect(read.status).toBe("active");
    expect(read.priceLookupKey).toBeNull();
  });

  it("zmiana planu: POST na subskrypcję z pozycją, ceną i proratą — ZERO pól trialu", async () => {
    const { billing, requests } = client([{ status: 200, body: { id: "sub_test_1" } }]);
    await billing.updateSubscriptionPrice({
      subscriptionId: "sub_test_1",
      itemId: "si_test_1",
      priceId: "price_2",
    });
    const request = requests[0]!;
    expect(request.url).toContain("/v1/subscriptions/sub_test_1");
    expect(request.method).toBe("POST");
    const body = decodeURIComponent(request.body!);
    // Kontrola po pustym zbiorze: najpierw dowód, że żądanie NIESIE podmianę,
    // dopiero potem asercja o tym, czego w nim nie ma.
    expect(body).toContain("items[0][id]=si_test_1");
    expect(body).toContain("items[0][price]=price_2");
    expect(body).toContain("proration_behavior=create_prorations");
    // SONDA: pole trialu w tym żądaniu przesuwałoby zegar okresu próbnego —
    // zmiana planu w dół i z powrotem byłaby fabryką darmowych czternastek.
    expect(body).not.toMatch(/trial/i);
    // Klucz z zamiaru cofnąłby powrót na poprzedni plan w tej samej dobie.
    expect(request.headers["Idempotency-Key"]).toBeUndefined();
  });

  it("reaktywacja: POST zdejmujący cancel_at_period_end i NIC WIĘCEJ", async () => {
    const { billing, requests } = client([{ status: 200, body: { id: "sub_test_1" } }]);
    await billing.resumeSubscription({ subscriptionId: "sub_test_1" });
    const request = requests[0]!;
    expect(request.url).toContain("/v1/subscriptions/sub_test_1");
    expect(request.method).toBe("POST");
    expect(request.body).toBe("cancel_at_period_end=false");
    expect(request.headers["Idempotency-Key"]).toBeUndefined();
  });

  it("zmiana planu bez potwierdzenia identyfikatora = błąd, nie cichy sukces", async () => {
    const { billing } = client([{ status: 200, body: {} }]);
    await expect(
      billing.updateSubscriptionPrice({
        subscriptionId: "sub_test_1",
        itemId: "si_test_1",
        priceId: "price_2",
      }),
    ).rejects.toThrowError(/nie potwierdziło zmiany planu/);
  });

  it("Portal i zmiana planu idą na konto PLATFORMY — bez nagłówka konta połączonego", async () => {
    const { billing, requests } = client([
      { status: 200, body: { id: "bps_1", url: "https://billing.stripe.com/p/s/x" } },
      { status: 200, body: { id: "sub_test_1" } },
    ]);
    await billing.createBillingPortalSession({ customerId: "cus_1", returnUrl: "https://p.test" });
    await billing.resumeSubscription({ subscriptionId: "sub_test_1" });
    for (const request of requests) {
      expect(Object.keys(request.headers)).not.toContain("Stripe-Account");
      // TWORZENIE SESJI Portalu niesie basil (spójnie z Checkoutem); reaktywacja
      // to ZAPIS STANU DOCELOWEGO subskrypcji — zostaje na 2024-06-20, bo jej pola
      // wchodzą do kontraktu odczytu.
      const isPortalCreate = request.url === "https://api.stripe.com/v1/billing_portal/sessions";
      expect(request.headers["Stripe-Version"]).toBe(
        isPortalCreate ? STRIPE_BILLING_CHECKOUT_API_VERSION : STRIPE_BILLING_API_VERSION,
      );
    }
  });
});
