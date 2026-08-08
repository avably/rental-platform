/**
 * Publiczne API v1 (M1, ADR-108) — testy rdzeni tras (lib/api/handlers.ts)
 * z portami-atrapami. Dowody liczone LICZNIKAMI wywołań portów, nie kodami
 * odpowiedzi (§6.2: „zero pracy" ma być zmierzone, nie zadeklarowane).
 *
 * DOWODY MUTACYJNE pokrywane tutaj:
 *   * M1 — weryfikacja porównująca prefiksem (hash z prefiksu klucza):
 *     test „klucz-fałszywka o wspólnym prefiksie → 401" pali się, bo atrapa
 *     verify jest kluczowana NIEZALEŻNIE policzonym sha256 PEŁNEGO klucza,
 *   * M3 — tenant do rdzenia z żądania zamiast z klucza: testy izolacji
 *     (x-tenant-id nagłówka i tenant_id w body są ignorowane) palą się na
 *     asercji `p_tenant_id === TENANT_A`.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { CheckoutRpcArgs, CheckoutRpcResult } from "../lib/checkout/core";
import {
  handleAvailabilityRequest,
  handleCatalogRequest,
  handleReservationRequest,
  type AvailabilityDeps,
  type CatalogDeps,
  type ReservationDeps,
} from "../lib/api/handlers";
import type { VerifiedApiKey } from "../lib/api/auth";
import type { PublicCatalog } from "../lib/checkout/contract";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY_ID_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_A = "aaaa1111-1111-4111-8111-111111111111";
const PRODUCT_B = "bbbb2222-2222-4222-8222-222222222222";

/** Surowy klucz tenanta A — 64 hex po prefiksie produktowym. */
const RAW_KEY_A = `avbl_${"ab".repeat(32)}`;
/** Fałszywka o WSPÓLNYM PREFIKSIE z kluczem A (pierwsze 13 znaków), innej reszcie. */
const FORGED_SAME_PREFIX = `${RAW_KEY_A.slice(0, 13)}${"cd".repeat(28)}${"ef".repeat(4)}`;

/**
 * sha256 policzony W TEŚCIE, niezależnie od hashApiKey — mutacja hashująca
 * w produkcie tylko prefiks nie może przestawić także atrapy.
 */
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

interface Counters {
  verify: number;
  rateLimit: string[];
  work: number;
}

/** Atrapa weryfikacji: zna WYŁĄCZNIE hash pełnego klucza A. */
function makeVerify(counters: Counters, status = "active") {
  return async (keyHash: string): Promise<VerifiedApiKey | null> => {
    counters.verify += 1;
    if (keyHash === sha256(RAW_KEY_A)) {
      return { tenantId: TENANT_A, keyId: KEY_ID_A, tenantStatus: status };
    }
    return null;
  };
}

const CATALOG_A: PublicCatalog = {
  tenant: { name: "Wypożyczalnia A", locale: "pl", currency: "PLN" },
  products: [],
  pickup_locations: [],
  delivery_methods: [],
};

function makeCatalogDeps(
  counters: Counters,
  overrides: Partial<CatalogDeps> = {},
): CatalogDeps {
  return {
    verifyKeyHash: makeVerify(counters),
    checkRateLimit: async (key) => {
      counters.rateLimit.push(key);
      return { success: true };
    },
    ip: "203.0.113.7",
    getCatalog: async (tenantId) => {
      counters.work += 1;
      return tenantId === TENANT_A ? CATALOG_A : null;
    },
    ...overrides,
  };
}

const counters = (): Counters => ({ verify: 0, rateLimit: [], work: 0 });

function reqGet(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

const AUTH_A = { authorization: `Bearer ${RAW_KEY_A}` };

// ---------------------------------------------------------------------
// Autoryzacja — jednolite 401 i zero pracy (§6.2, M1)
// ---------------------------------------------------------------------

describe("api v1 — autoryzacja kluczem", () => {
  it("bez nagłówka / zły schemat / śmieć / klucz obcięty / klucz-prefiks → 401 BEZ dotykania bazy", async () => {
    const badHeaders: Record<string, string>[] = [
      {},
      { authorization: "Basic abc" },
      { authorization: "Bearer nie-klucz" },
      { authorization: `Bearer ${RAW_KEY_A.slice(0, 40)}` },
      // Dokładnie to, co widzi ekran panelu (prefiks identyfikacyjny).
      { authorization: `Bearer ${RAW_KEY_A.slice(0, 13)}` },
      { authorization: `Bearer ${RAW_KEY_A}extra` },
    ];
    for (const headers of badHeaders) {
      const c = counters();
      const response = await handleCatalogRequest(
        reqGet("https://acme.avably.io/api/v1/catalog", headers),
        makeCatalogDeps(c),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: { code: "unauthorized" } });
      // ZERO pracy: format odpada przed hashem — verify NIE jest wołane,
      // katalog NIE jest czytany, limiter nie zapala okien.
      expect(c.verify, JSON.stringify(headers)).toBe(0);
      expect(c.work).toBe(0);
      expect(c.rateLimit).toEqual([]);
    }
  });

  it("klucz poprawny formatem, ale nieznany → 401 nierozróżnialne od powyższych; rdzeń nie ruszył", async () => {
    const c = counters();
    const unknown = `avbl_${"99".repeat(32)}`;
    const response = await handleCatalogRequest(
      reqGet("https://acme.avably.io/api/v1/catalog", { authorization: `Bearer ${unknown}` }),
      makeCatalogDeps(c),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized" } });
    expect(c.verify).toBe(1); // format przeszedł, baza odmówiła
    expect(c.work).toBe(0);
    expect(c.rateLimit).toEqual([]);
  });

  it("fałszywka o wspólnym prefiksie z kluczem A → 401 (dowód mutacyjny M1)", async () => {
    const c = counters();
    const response = await handleCatalogRequest(
      reqGet("https://acme.avably.io/api/v1/catalog", {
        authorization: `Bearer ${FORGED_SAME_PREFIX}`,
      }),
      makeCatalogDeps(c),
    );
    // Gdyby weryfikacja hashowała tylko prefiks (mutant M1), fałszywka
    // dostałaby hash klucza A i test spadłby na 200.
    expect(response.status).toBe(401);
    expect(c.work).toBe(0);
  });

  it("status tenanta poza {trialing,active} → 403 store_unavailable, zero odczytu", async () => {
    const c = counters();
    const deps = makeCatalogDeps(c, { verifyKeyHash: makeVerify(c, "suspended") });
    const response = await handleCatalogRequest(
      reqGet("https://acme.avably.io/api/v1/catalog", AUTH_A),
      deps,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "store_unavailable" } });
    expect(c.work).toBe(0);
  });
});

// ---------------------------------------------------------------------
// Rate-limit — dwa niezależne wymiary (§6.5)
// ---------------------------------------------------------------------

describe("api v1 — rate-limit", () => {
  it("odczyty liczą się w oknach per klucz ORAZ per IP z prefiksem api:read", async () => {
    const c = counters();
    const response = await handleCatalogRequest(
      reqGet("https://acme.avably.io/api/v1/catalog", AUTH_A),
      makeCatalogDeps(c),
    );
    expect(response.status).toBe(200);
    expect(c.rateLimit).toEqual([
      `api:read:key:${KEY_ID_A}`,
      `api:read:ip:203.0.113.7`,
    ]);
  });

  it("wyczerpany wymiar KLUCZA dławi mimo świeżego IP — i nie zdradza treści", async () => {
    const c = counters();
    const deps = makeCatalogDeps(c, {
      checkRateLimit: async (key) => ({ success: !key.includes(":key:") }),
    });
    const response = await handleCatalogRequest(
      reqGet("https://acme.avably.io/api/v1/catalog", AUTH_A),
      deps,
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { code: "rate_limited" } });
    expect(c.work).toBe(0); // odmowa limitu nie wykonuje odczytu (§6.5)
  });

  it("wyczerpany wymiar IP dławi mimo świeżego klucza", async () => {
    const c = counters();
    const deps = makeCatalogDeps(c, {
      checkRateLimit: async (key) => ({ success: !key.includes(":ip:") }),
    });
    const response = await handleCatalogRequest(
      reqGet("https://acme.avably.io/api/v1/catalog", AUTH_A),
      deps,
    );
    expect(response.status).toBe(429);
    expect(c.work).toBe(0);
  });
});

// ---------------------------------------------------------------------
// Katalog i dostępność — tenant z klucza, izolacja odczytów (§6.1, §6.3)
// ---------------------------------------------------------------------

describe("api v1 — katalog", () => {
  it("zwraca katalog TENANTA KLUCZA — x-tenant-id w żądaniu jest ignorowany", async () => {
    const c = counters();
    let seenTenant: string | null = null;
    const deps = makeCatalogDeps(c, {
      getCatalog: async (tenantId) => {
        seenTenant = tenantId;
        return CATALOG_A;
      },
    });
    const response = await handleCatalogRequest(
      reqGet("https://acme.avably.io/api/v1/catalog", {
        ...AUTH_A,
        // Spoofing: proxy to zdejmuje, ale warstwa route'a nie ufa NAWET
        // gdyby przeszło (§6.3).
        "x-tenant-id": TENANT_B,
      }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(seenTenant).toBe(TENANT_A);
    expect(await response.json()).toEqual(CATALOG_A);
  });

  it("NULL z warstwy odczytu (fail-closed) → uczciwe 500, nie pusty katalog", async () => {
    const c = counters();
    const deps = makeCatalogDeps(c, { getCatalog: async () => null });
    const response = await handleCatalogRequest(
      reqGet("https://acme.avably.io/api/v1/catalog", AUTH_A),
      deps,
    );
    expect(response.status).toBe(500);
  });
});

function makeAvailabilityDeps(
  c: Counters,
  overrides: Partial<AvailabilityDeps> = {},
): AvailabilityDeps {
  return {
    verifyKeyHash: makeVerify(c),
    checkRateLimit: async (key) => {
      c.rateLimit.push(key);
      return { success: true };
    },
    ip: "203.0.113.7",
    getAvailability: async (tenantId, productId) => {
      c.work += 1;
      // Dostępność istnieje wyłącznie dla pary (tenant A, produkt A) — jak
      // app.get_public_availability, która cudzych produktów nie widzi.
      if (tenantId === TENANT_A && productId === PRODUCT_A) {
        return { available_units: 2, total_units: 3 };
      }
      return null;
    },
    ...overrides,
  };
}

describe("api v1 — dostępność", () => {
  const url = (productId: string) =>
    `https://acme.avably.io/api/v1/availability?product_id=${productId}&start_date=2026-08-10&end_date=2026-08-12`;

  it("poprawne zapytanie → 200 z liczbami (bez numerów seryjnych, bez zamówień)", async () => {
    const c = counters();
    const response = await handleAvailabilityRequest(reqGet(url(PRODUCT_A), AUTH_A), makeAvailabilityDeps(c));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ available_units: 2, total_units: 3 });
    expect(Object.keys(body).sort()).toEqual(["available_units", "total_units"]);
  });

  it("złe parametry (uuid/daty/zakres odwrócony) → 400 przed dotknięciem odczytu", async () => {
    const c = counters();
    const badUrls = [
      "https://acme.avably.io/api/v1/availability", // brak wszystkiego
      url("nie-uuid"),
      `https://acme.avably.io/api/v1/availability?product_id=${PRODUCT_A}&start_date=10.08.2026&end_date=2026-08-12`,
      `https://acme.avably.io/api/v1/availability?product_id=${PRODUCT_A}&start_date=2026-08-12&end_date=2026-08-10`,
    ];
    for (const bad of badUrls) {
      const response = await handleAvailabilityRequest(
        reqGet(bad, AUTH_A),
        makeAvailabilityDeps(c),
      );
      expect(response.status, bad).toBe(400);
    }
    expect(c.work).toBe(0);
  });

  it("klucz A + produkt tenanta B → 404 nierozróżnialne od produktu nieistniejącego (§6.1)", async () => {
    const c = counters();
    const cross = await handleAvailabilityRequest(
      reqGet(url(PRODUCT_B), AUTH_A),
      makeAvailabilityDeps(c),
    );
    const missing = await handleAvailabilityRequest(
      reqGet(url("dddd3333-3333-4333-8333-333333333333"), AUTH_A),
      makeAvailabilityDeps(c),
    );
    expect(cross.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await cross.json()).toEqual(await missing.json());
  });
});

// ---------------------------------------------------------------------
// Rezerwacje — jeden rdzeń checkoutu, tenant z klucza (M3, §6.3, §6.6)
// ---------------------------------------------------------------------

const RPC_RESULT: CheckoutRpcResult = {
  order_id: "ord-uuid-serwerowy",
  order_number: "A-0001",
  order_status: "pending",
  payment_status: "unpaid",
  payment_method: "transfer",
  payment_provider: "manual",
  start_date: "2026-08-10",
  end_date: "2026-08-12",
  delivery_method: "courier",
  total_rental_grosze: 30_000,
  total_deposit_grosze: 10_000,
  delivery_grosze: 2_000,
  currency: "PLN",
  items: [
    { product_id: PRODUCT_A, quantity: 1, unit_rental_grosze: 15_000, unit_deposit_grosze: 5_000 },
  ],
  customer: { email: "klient@example.com", full_name: "Jan Klient", locale: "pl" },
  tenant: { name: "Wypożyczalnia A", locale: "pl" },
  email_sender: { name: "Wypożyczalnia A", reply_to: null },
  notify_email: "wlasciciel@example.com",
  log_token: "token-serwerowy",
};

const VALID_BODY = {
  email: "klient@example.com",
  fullName: "Jan Klient",
  startDate: "2026-08-10",
  endDate: "2026-08-12",
  deliveryMethod: "courier",
  paymentMethod: "transfer",
  items: [{ productId: PRODUCT_A, quantity: 1 }],
  termsAccepted: true,
  termsVersion: "v1",
};

interface ReservationCounters extends Counters {
  rpcArgs: CheckoutRpcArgs[];
  emails: { tenantId: string }[];
}

function makeReservationDeps(
  c: ReservationCounters,
  overrides: Partial<ReservationDeps> = {},
): ReservationDeps {
  return {
    verifyKeyHash: makeVerify(c),
    checkRateLimit: async (key) => {
      c.rateLimit.push(key);
      return { success: true };
    },
    ip: "203.0.113.7",
    callRpc: async (args) => {
      c.rpcArgs.push(args);
      return RPC_RESULT;
    },
    sendEmails: async (tenantId) => {
      c.emails.push({ tenantId });
      return ["poczta nie skonfigurowana"]; // powód niewysłania — NIE dla v1
    },
    readOnlineAvailability: async () => ({ stripeConfigured: false, chargesEnabled: false }),
    ...overrides,
  };
}

const reservationCounters = (): ReservationCounters => ({
  verify: 0,
  rateLimit: [],
  work: 0,
  rpcArgs: [],
  emails: [],
});

function reqPost(body: unknown, headers: Record<string, string> = AUTH_A): Request {
  return new Request("https://acme.avably.io/api/v1/reservations", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("api v1 — rezerwacje", () => {
  it("bez klucza → 401 i ZERO pracy rdzenia (licznik RPC/maili/limitera)", async () => {
    const c = reservationCounters();
    const response = await handleReservationRequest(reqPost(VALID_BODY, {}), makeReservationDeps(c));
    expect(response.status).toBe(401);
    expect(c.rpcArgs).toEqual([]);
    expect(c.emails).toEqual([]);
    expect(c.rateLimit).toEqual([]);
  });

  it("poprawna rezerwacja → 201; odpowiedź MA dokładnie kontrakt storefrontu i NIC więcej (§6.6)", async () => {
    const c = reservationCounters();
    const response = await handleReservationRequest(reqPost(VALID_BODY), makeReservationDeps(c));
    expect(response.status).toBe(201);

    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["nextStep", "order", "status"]);
    expect(body.status).toBe("success");
    expect(body.nextStep).toBe("confirmation");

    const order = body.order as Record<string, unknown>;
    expect(Object.keys(order).sort()).toEqual([
      "currency",
      "deliveryGrosze",
      "deliveryMethod",
      "endDate",
      "items",
      "orderNumber",
      "orderStatus",
      "paymentMethod",
      "paymentStatus",
      "startDate",
      "totalDepositGrosze",
      "totalRentalGrosze",
    ]);
    // Dane SERWEROWE z RPC nie przechodzą granicy (ADR-042/045): ani kontekst
    // wysyłki, ani identyfikatory idempotencji, ani powody niewysłania maili.
    const dump = JSON.stringify(body);
    expect(dump).not.toContain("ord-uuid-serwerowy");
    expect(dump).not.toContain("token-serwerowy");
    expect(dump).not.toContain("wlasciciel@example.com");
    expect(dump).not.toContain("email_sender");
    expect(dump).not.toContain("emailIssues");

    // Poczta poszła z tenantem KLUCZA.
    expect(c.emails).toEqual([{ tenantId: TENANT_A }]);
  });

  it("tenant do RPC pochodzi WYŁĄCZNIE z klucza — x-tenant-id i tenant_id w body ignorowane (M3, §6.3)", async () => {
    const c = reservationCounters();
    const response = await handleReservationRequest(
      reqPost(
        // Napastnik dokleja pola tenanta — schemat je WYCINA (zod strip),
        // a rdzeń dostaje tenanta z klucza.
        { ...VALID_BODY, tenantId: TENANT_B, tenant_id: TENANT_B, p_tenant_id: TENANT_B },
        { ...AUTH_A, "x-tenant-id": TENANT_B },
      ),
      makeReservationDeps(c),
    );
    expect(response.status).toBe(201);
    expect(c.rpcArgs).toHaveLength(1);
    expect(c.rpcArgs[0]!.p_tenant_id).toBe(TENANT_A);
    const rpcDump = JSON.stringify(c.rpcArgs[0]);
    expect(rpcDump).not.toContain(TENANT_B);
  });

  it("wyczerpany limit rezerwacji (wymiar klucza) → 429, RPC nie ruszyło", async () => {
    const c = reservationCounters();
    const deps = makeReservationDeps(c, {
      checkRateLimit: async (key) => ({ success: !key.startsWith("api:reservation:key:") }),
    });
    const response = await handleReservationRequest(reqPost(VALID_BODY), deps);
    expect(response.status).toBe(429);
    expect(c.rpcArgs).toEqual([]);
  });

  it("błędy rdzenia mapują się na kontrakt v1: 23P01→409, 22023→422, walidacja→422+fields", async () => {
    const raise = (code: string) => async () => {
      const error = new Error("odmowa bazy") as Error & { code?: string };
      error.code = code;
      throw error;
    };

    const conflict = await handleReservationRequest(
      reqPost(VALID_BODY),
      makeReservationDeps(reservationCounters(), { callRpc: raise("23P01") }),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: { code: "conflict" } });

    const rejected = await handleReservationRequest(
      reqPost(VALID_BODY),
      makeReservationDeps(reservationCounters(), { callRpc: raise("22023") }),
    );
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toEqual({ error: { code: "rejected" } });

    const c = reservationCounters();
    const invalid = await handleReservationRequest(
      reqPost({ ...VALID_BODY, email: "", items: [] }),
      makeReservationDeps(c),
    );
    expect(invalid.status).toBe(422);
    const body = (await invalid.json()) as { error: { code: string; fields: Record<string, string> } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.fields.email).toBeDefined();
    expect(body.error.fields.items).toBeDefined();
    expect(c.rpcArgs).toEqual([]); // walidacja zatrzymała przed zapisem
  });

  it("body niebędące JSON-em → 400; honeypot rdzenia dalej czuwa → 422 rejected", async () => {
    const notJson = await handleReservationRequest(
      new Request("https://acme.avably.io/api/v1/reservations", {
        method: "POST",
        headers: AUTH_A,
        body: "to nie json",
      }),
      makeReservationDeps(reservationCounters()),
    );
    expect(notJson.status).toBe(400);

    const c = reservationCounters();
    const bot = await handleReservationRequest(
      reqPost({ ...VALID_BODY, honeypot: "bot był tu" }),
      makeReservationDeps(c),
    );
    expect(bot.status).toBe(422);
    expect(c.rpcArgs).toEqual([]);
  });
});
