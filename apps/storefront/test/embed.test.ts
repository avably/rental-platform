/**
 * Bramki bezpieczeństwa i koszt embedu rezerwacji (M3, ADR-120).
 *
 * Wzorzec z api-v1.test.ts: rdzenie chodzą na PORTACH, więc nic tu nie jest
 * mockowane przez vi.mock i nic nie rusza sieci. Dowody „zero pracy" idą
 * LICZNIKAMI, nie kodem odpowiedzi — kod można trafić przypadkiem, licznika
 * wywołań bazy już nie.
 */
import { describe, expect, it, beforeEach } from "vitest";

import {
  handleEmbedMonthRequest,
  handleEmbedReservationRequest,
  type EmbedMonthDeps,
  type EmbedReservationDeps,
} from "@/lib/embed/handlers";
import { decideEmbedOrigin } from "@/lib/embed/origin";
import { monthCallCeiling, monthDays, resolveMonthDays, MONTH_SPLIT_SLACK } from "@/lib/embed/month";
import { __resetEmbedCacheForTests } from "@/lib/embed/cache";
import { embedLoaderSource } from "@/lib/embed/loader";
import type { CheckoutRpcResult } from "@/lib/checkout/core";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";

const HOST = "acme.avably.pl";
const SAME_ORIGIN = `https://${HOST}`;
const FOREIGN_ORIGIN = "https://zloczyncy.example";

interface Counters {
  /** Ile razy sięgnięto do bazy o dostępność. To jest MIARA amplifikacji. */
  probe: number;
  /** Klucze, po których dławiono — kolejność i treść są częścią kontraktu. */
  rateLimit: string[];
  /** Ile razy wywołano RPC checkoutu (czyli ile razy mogło powstać zamówienie). */
  rpc: number;
}

function counters(): Counters {
  return { probe: 0, rateLimit: [], rpc: 0 };
}

/**
 * Sonda ZAKRESOWA — lustro app.get_public_availability: zwraca liczbę sztuk
 * wolnych przez CAŁY zakres, czyli 0, gdy w zakresie jest choć jeden dzień
 * zajęty. Arity (start, end) jest tu istotna: `resolveMonthDays` woła sondę
 * DWOMA argumentami, a wersja dla portu handlera ma z przodu jeszcze produkt.
 */
function makeRangeProbe(c: Counters, busyDays: string[], units = 2) {
  const busy = new Set(busyDays);
  return async (startDate: string, endDate: string): Promise<number | null> => {
    c.probe += 1;
    for (const day of busy) {
      if (day >= startDate && day <= endDate) return 0;
    }
    return units;
  };
}

/** Ta sama sonda w kształcie portu handlera (produkt z przodu). */
function makeProbe(c: Counters, busyDays: string[], units = 2) {
  const probe = makeRangeProbe(c, busyDays, units);
  return async (_productId: string, startDate: string, endDate: string): Promise<number | null> =>
    probe(startDate, endDate);
}

function monthDeps(c: Counters, overrides: Partial<EmbedMonthDeps> = {}): EmbedMonthDeps {
  return {
    tenantId: TENANT_A,
    ip: "203.0.113.7",
    now: () => 1_000_000,
    checkRateLimit: async (key) => {
      c.rateLimit.push(key);
      return { success: true };
    },
    probeAvailability: makeProbe(c, []),
    ...overrides,
  };
}

const ORDER: CheckoutRpcResult = {
  order_id: "99999999-9999-4999-8999-999999999999",
  order_number: "ZAM-2026-0001",
  order_status: "pending",
  payment_status: "unpaid",
  payment_method: "transfer",
  payment_provider: "manual",
  start_date: "2026-09-10",
  end_date: "2026-09-12",
  delivery_method: "pickup",
  total_rental_grosze: 30000,
  total_deposit_grosze: 10000,
  delivery_grosze: 0,
  currency: "PLN",
  items: [
    { product_id: PRODUCT_A, quantity: 1, unit_rental_grosze: 10000, unit_deposit_grosze: 10000 },
  ],
  customer: { email: "klient@example.com", full_name: "Jan Kowalski", locale: "pl" },
  tenant: { name: "Acme", locale: "pl" },
  email_sender: null,
  notify_email: "biuro@example.com",
  log_token: "TAJNY-TOKEN-DZIENNIKA",
};

function reservationDeps(c: Counters, overrides: Partial<EmbedReservationDeps> = {}): EmbedReservationDeps {
  return {
    tenantId: TENANT_A,
    ip: "203.0.113.7",
    now: () => 1_000_000,
    checkRateLimit: async (key) => {
      c.rateLimit.push(key);
      return { success: true };
    },
    callRpc: async () => {
      c.rpc += 1;
      return ORDER;
    },
    sendEmails: async () => [],
    readOnlineAvailability: async () => ({ available: false }) as never,
    ...overrides,
  };
}

function monthReq(query: string, headers: Record<string, string> = {}): Request {
  return new Request(`${SAME_ORIGIN}/embed/api/month?${query}`, {
    headers: { host: HOST, ...headers },
  });
}

const VALID_RESERVATION = {
  email: "klient@example.com",
  fullName: "Jan Kowalski",
  startDate: "2026-09-10",
  endDate: "2026-09-12",
  deliveryMethod: "pickup",
  pickupLocationId: "33333333-3333-4333-8333-333333333333",
  paymentMethod: "transfer",
  items: [{ productId: PRODUCT_A, quantity: 1 }],
  termsAccepted: true,
  termsVersion: "1.0",
};

function reservationReq(headers: Record<string, string> = {}, body: unknown = VALID_RESERVATION): Request {
  return new Request(`${SAME_ORIGIN}/embed/api/reservations`, {
    method: "POST",
    headers: { host: HOST, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  __resetEmbedCacheForTests();
});

/* ------------------------------------------------------------------ */
/* BRAMKA ORIGIN — kontrakt „kto może nas wołać"                       */
/* ------------------------------------------------------------------ */

describe("embed — bramka origin (CORS jako kontrakt)", () => {
  it("rozstrzygnięcie: swój origin przechodzi, obcy nie, brak nagłówka to ODMOWA", () => {
    expect(decideEmbedOrigin(SAME_ORIGIN, HOST)).toEqual({ allowed: true });
    expect(decideEmbedOrigin(FOREIGN_ORIGIN, HOST)).toEqual({ allowed: false, reason: "foreign" });
    expect(decideEmbedOrigin(null, HOST)).toEqual({ allowed: false, reason: "missing" });
    expect(decideEmbedOrigin("null", HOST)).toEqual({ allowed: false, reason: "malformed" });
    expect(decideEmbedOrigin("nie-jest-adresem", HOST)).toEqual({ allowed: false, reason: "malformed" });
  });

  it("origin z DOKLEJONĄ ścieżką nie udaje swojego (Origin nigdy nie ma ścieżki)", () => {
    expect(decideEmbedOrigin(`https://zly.example/${HOST}`, HOST).allowed).toBe(false);
    expect(decideEmbedOrigin(`${SAME_ORIGIN}/cokolwiek`, HOST).allowed).toBe(false);
  });

  it("podobny, ale inny host nie przechodzi (sufiks nie jest dopasowaniem)", () => {
    expect(decideEmbedOrigin(`https://zly-${HOST}`, HOST).allowed).toBe(false);
    expect(decideEmbedOrigin(`https://${HOST}.zly.example`, HOST).allowed).toBe(false);
  });

  it("ODCZYT z niedozwolonej domeny → 403 i ZERO pracy (dowód licznikami)", async () => {
    const c = counters();
    const response = await handleEmbedMonthRequest(
      monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: FOREIGN_ORIGIN }),
      monthDeps(c),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "forbidden_origin" } });
    expect(c.probe).toBe(0);
    expect(c.rateLimit).toEqual([]);
  });

  it("ODCZYT z dozwolonej domeny (nasza ramka) → przepuszczony", async () => {
    const c = counters();
    const response = await handleEmbedMonthRequest(
      monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: SAME_ORIGIN }),
      monthDeps(c),
    );

    expect(response.status).toBe(200);
    expect(c.probe).toBeGreaterThan(0);
  });

  it("ZAPIS z niedozwolonej domeny → 403 i ZERO zapisu do bazy", async () => {
    const c = counters();
    const response = await handleEmbedReservationRequest(
      reservationReq({ origin: FOREIGN_ORIGIN }),
      reservationDeps(c),
    );

    expect(response.status).toBe(403);
    expect(c.rpc).toBe(0);
    expect(c.rateLimit).toEqual([]);
  });

  it("ZAPIS bez nagłówka Origin → 403 (deny-by-default, nie przepustka)", async () => {
    const c = counters();
    const response = await handleEmbedReservationRequest(reservationReq(), reservationDeps(c));

    expect(response.status).toBe(403);
    expect(c.rpc).toBe(0);
  });

  it("ZAPIS z naszej ramki → przechodzi do rdzenia checkoutu", async () => {
    const c = counters();
    const response = await handleEmbedReservationRequest(
      reservationReq({ origin: SAME_ORIGIN }),
      reservationDeps(c),
    );

    expect(response.status).toBe(201);
    expect(c.rpc).toBe(1);
  });

  it("ŻADNA trasa embedu nie wysyła Access-Control-Allow-Origin — ani '*', ani listy", async () => {
    const c = counters();
    const responses = [
      await handleEmbedMonthRequest(
        monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: SAME_ORIGIN }),
        monthDeps(c),
      ),
      await handleEmbedMonthRequest(
        monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: FOREIGN_ORIGIN }),
        monthDeps(c),
      ),
      await handleEmbedReservationRequest(reservationReq({ origin: SAME_ORIGIN }), reservationDeps(c)),
      await handleEmbedReservationRequest(reservationReq({ origin: FOREIGN_ORIGIN }), reservationDeps(c)),
    ];

    for (const response of responses) {
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
      expect(response.headers.get("access-control-allow-methods")).toBeNull();
      // Odpowiedź zależy od Origin — pośrednik nie ma prawa jej współdzielić.
      expect(response.headers.get("vary")).toBe("Origin");
    }
  });
});

/* ------------------------------------------------------------------ */
/* IZOLACJA NAJEMCÓW                                                    */
/* ------------------------------------------------------------------ */

describe("embed — izolacja najemców", () => {
  it("produkt CUDZEGO najemcy → 404 bez ujawnienia, czym jest ten produkt", async () => {
    const c = counters();
    const response = await handleEmbedMonthRequest(
      monthReq(`product=${PRODUCT_B}&month=2026-09`, { origin: SAME_ORIGIN }),
      monthDeps(c, {
        // Baza odpowiada `null` dla produktu spoza tenanta — tak działa
        // app.get_public_availability i to jest właściwa bramka.
        probeAvailability: async () => {
          c.probe += 1;
          return null;
        },
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found" } });
  });

  it("tenant bierze się WYŁĄCZNIE z deps (nagłówek proxy) — parametr w URL go nie zmienia", async () => {
    const c = counters();
    const seen: string[] = [];
    const request = new Request(
      // Strona gospodarza dokleja własne parametry — nie mogą nic zmienić.
      `${SAME_ORIGIN}/embed/api/month?product=${PRODUCT_A}&month=2026-09&tenant=${TENANT_B}&tenant_id=${TENANT_B}`,
      { headers: { host: HOST, origin: SAME_ORIGIN } },
    );

    await handleEmbedMonthRequest(
      request,
      monthDeps(c, {
        probeAvailability: async (productId) => {
          seen.push(productId);
          c.probe += 1;
          return 3;
        },
      }),
    );

    // Klucz dławienia niesie tenanta z deps, nie z zapytania.
    expect(c.rateLimit).toContain(`embed:month:tenant:${TENANT_A}`);
    expect(c.rateLimit.join("|")).not.toContain(TENANT_B);
    expect(seen).toEqual([PRODUCT_A]);
  });

  it("host spoza sklepu (brak nagłówka tenanta) → 403, zero pracy", async () => {
    const c = counters();
    const response = await handleEmbedMonthRequest(
      monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: SAME_ORIGIN }),
      monthDeps(c, { tenantId: null }),
    );

    expect(response.status).toBe(403);
    expect(c.probe).toBe(0);
    expect(c.rateLimit).toEqual([]);
  });

  it("cache miesiąca jest kluczowany tenantem — sąsiad nie dostaje cudzej mapy", async () => {
    const c = counters();
    const a = await handleEmbedMonthRequest(
      monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: SAME_ORIGIN }),
      monthDeps(c, { probeAvailability: makeProbe(c, [], 5) }),
    );
    const b = await handleEmbedMonthRequest(
      monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: SAME_ORIGIN }),
      monthDeps(c, { tenantId: TENANT_B, probeAvailability: makeProbe(c, [], 9) }),
    );

    expect((await a.json()).days["2026-09-01"]).toBe(5);
    expect((await b.json()).days["2026-09-01"]).toBe(9);
  });
});

/* ------------------------------------------------------------------ */
/* BRAK SEKRETU W PRZEGLĄDARCE                                          */
/* ------------------------------------------------------------------ */

describe("embed — w przeglądarce nie ma sekretu", () => {
  const source = embedLoaderSource();

  it("skrypt osadzający nie niesie klucza API ani śladu po nim", () => {
    expect(source).not.toMatch(/avbl_/);
    expect(source.toLowerCase()).not.toContain("authorization");
    expect(source.toLowerCase()).not.toContain("bearer");
    expect(source).not.toContain("apiKey");
    expect(source).not.toContain("api_key");
  });

  it("skrypt osadzający NIE dotyka publicznego API maszynowego /api/v1", () => {
    // /api/v1 jest za kluczem najemcy. Gdyby embed tam chodził, klucz musiałby
    // istnieć po stronie przeglądarki — a wtedy pierwsze „pokaż źródło" go oddaje.
    expect(source).not.toContain("/api/v1");
  });

  it("adres ramki składa się z origin SKRYPTU, a nie z atrybutu na stronie gospodarza", () => {
    expect(source).toContain("document.currentScript");
    expect(source).toContain("new URL(script.src).origin");
    // Atrybuty wolno czytać wyłącznie dla parametrów prezentacji.
    expect(source).toContain("data-avably-product");
    expect(source).not.toContain("data-avably-tenant");
  });

  it("nasłuch postMessage sprawdza ORAZ origin, ORAZ źródłową ramkę", () => {
    expect(source).toContain("event.origin !== origin");
    expect(source).toContain("event.source !== frame.contentWindow");
  });

  it("odpowiedzi tras embedu nie niosą pól diagnostycznych ani identyfikatorów wewnętrznych", async () => {
    const c = counters();
    const response = await handleEmbedReservationRequest(
      reservationReq({ origin: SAME_ORIGIN }),
      reservationDeps(c),
    );
    const text = await response.text();

    expect(text).not.toContain("log_token");
    expect(text).not.toContain("order_id");
    expect(text).not.toContain("emailIssues");
  });
});

/* ------------------------------------------------------------------ */
/* AMPLIFIKACJA — POMIAR, NIE DEKLARACJA                                */
/* ------------------------------------------------------------------ */

describe("embed — amplifikacja (lekcja R11/ADR-114)", () => {
  it("miesiąc W PEŁNI WOLNY kosztuje DOKŁADNIE 1 wywołanie bazy", async () => {
    const c = counters();
    const resolved = await resolveMonthDays("2026-09", makeRangeProbe(c, []), { now: () => 0 });

    expect(resolved.calls).toBe(1);
    expect(Object.keys(resolved.days)).toHaveLength(30);
    expect(resolved.partial).toBe(false);
  });

  it("JEDNO wyświetlenie miesiąca = JEDNO żądanie HTTP z przeglądarki", async () => {
    const c = counters();
    const response = await handleEmbedMonthRequest(
      monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: SAME_ORIGIN }),
      monthDeps(c, { probeAvailability: makeProbe(c, ["2026-09-10", "2026-09-20"]) }),
    );
    const payload = await response.json();

    // Kalendarz dostaje KOMPLET dni z jednej odpowiedzi — front nie ma powodu
    // dopytywać o pojedyncze dni, a więc nie ma jak wygenerować fali.
    expect(Object.keys(payload.days).length + payload.unresolved.length).toBe(30);
    expect(payload.partial).toBe(false);
  });

  it("KAŻDY rozkład rezerwacji mieści się pod sufitem n+6 i nie kłamie o dniach", async () => {
    const month = "2026-08"; // 31 dni — najgorszy przypadek
    const all = monthDays(month);
    const ceiling = monthCallCeiling(all.length);

    const scenarios: string[][] = [
      [],
      [all[0]!],
      [all[15]!],
      [all[30]!],
      [all[3]!, all[17]!],
      [all[2]!, all[12]!, all[26]!],
      all.filter((_, index) => index % 2 === 0), // co drugi dzień
      all.filter((iso) => [5, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay())), // weekendy
      all, // cały miesiąc zajęty
    ];

    for (const busy of scenarios) {
      const c = counters();
      const resolved = await resolveMonthDays(month, makeRangeProbe(c, busy), { now: () => 0 });

      expect(resolved.calls).toBeLessThanOrEqual(ceiling);
      expect(resolved.partial).toBe(false);

      // Sedno: ani jeden wolny dzień nie wyjeżdża jako zajęty, ani jeden
      // zajęty jako wolny. To jest bramka, którą paliła regresja z ADR-114.
      for (const day of all) {
        const reported = resolved.days[day];
        expect(reported).toBeDefined();
        if (busy.includes(day)) expect(reported).toBe(0);
        else expect(reported).toBeGreaterThan(0);
      }
    }
  });

  it("sufit jest WYPROWADZONY z liczby dni, nie zaklepany liczbą", () => {
    expect(monthCallCeiling(28)).toBe(28 + MONTH_SPLIT_SLACK);
    expect(monthCallCeiling(31)).toBe(31 + MONTH_SPLIT_SLACK);
    expect(monthCallCeiling(31)).toBeGreaterThan(monthCallCeiling(30));
    // Nie wolno mu zejść poniżej liczby dni (miesiąc gęsty wymaga n sond)...
    expect(monthCallCeiling(31)).toBeGreaterThanOrEqual(31);
    // ...ani urosnąć w stronę kosztu gołych podziałów (~2n).
    expect(monthCallCeiling(31)).toBeLessThan(2 * 31);
  });

  it("FALA 10 równoległych wyświetleń TEGO SAMEGO miesiąca = koszt jednego", async () => {
    const c = counters();
    const deps = monthDeps(c, {
      probeAvailability: makeProbe(c, ["2026-09-05", "2026-09-06"]),
    });

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        handleEmbedMonthRequest(
          monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: SAME_ORIGIN }),
          deps,
        ),
      ),
    );

    for (const response of responses) expect(response.status).toBe(200);

    // Sedno R11: dziesięć żądań w locie widzi SIEBIE NAWZAJEM, więc płaci
    // cenę jednego rozstrzygania. Bez sklejania byłoby to 10 × ~11 wywołań.
    const singlePass = counters();
    await resolveMonthDays("2026-09", makeRangeProbe(singlePass, ["2026-09-05", "2026-09-06"]), {
      now: () => 0,
    });
    expect(c.probe).toBe(singlePass.probe);
    expect(c.probe).toBeLessThanOrEqual(monthCallCeiling(30));
  });

  it("drugie wyświetlenie tego samego miesiąca nie kosztuje NIC (cache)", async () => {
    const c = counters();
    const deps = monthDeps(c, { probeAvailability: makeProbe(c, []) });

    await handleEmbedMonthRequest(
      monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: SAME_ORIGIN }),
      deps,
    );
    const afterFirst = c.probe;
    await handleEmbedMonthRequest(
      monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: SAME_ORIGIN }),
      deps,
    );

    expect(c.probe).toBe(afterFirst);
  });

  it("budżet czasu ucina rozstrzyganie — dni bez odpowiedzi są NIEROZSTRZYGNIĘTE, nie zajęte", async () => {
    const c = counters();
    let clock = 0;
    const resolved = await resolveMonthDays(
      "2026-09",
      async (start, end) => {
        c.probe += 1;
        clock += 4000; // wolne API: każde wywołanie zjada 4 s
        for (const day of monthDays("2026-09")) {
          if (day >= start && day <= end && day !== "2026-09-01") return 0;
        }
        return 1;
      },
      { now: () => clock, timeBudgetMs: 10_000 },
    );

    expect(resolved.partial).toBe(true);
    expect(resolved.unresolved.length).toBeGreaterThan(0);
    // Kluczowe: nierozstrzygnięty dzień NIE MA wpisu w mapie. Gdyby dostawał
    // zachowawcze 0, kalendarz malowałby wolne dni jako zajęte — cicha strata.
    for (const day of resolved.unresolved) {
      expect(day in resolved.days).toBe(false);
    }
  });

  it("dławienie stoi na DWÓCH wymiarach: odwiedzający (IP) i najemca", async () => {
    const c = counters();
    await handleEmbedMonthRequest(
      monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: SAME_ORIGIN }),
      monthDeps(c),
    );

    expect(c.rateLimit).toEqual([
      "embed:month:ip:203.0.113.7",
      `embed:month:tenant:${TENANT_A}`,
    ]);
  });

  it("wyczerpany limit IP dławi ZANIM dotkniemy bazy", async () => {
    const c = counters();
    const response = await handleEmbedMonthRequest(
      monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: SAME_ORIGIN }),
      monthDeps(c, {
        checkRateLimit: async (key) => {
          c.rateLimit.push(key);
          return { success: !key.startsWith("embed:month:ip:") };
        },
      }),
    );

    expect(response.status).toBe(429);
    expect(c.probe).toBe(0);
  });

  it("wyczerpany limit NAJEMCY dławi niezależnie od świeżości IP", async () => {
    const c = counters();
    const response = await handleEmbedMonthRequest(
      monthReq(`product=${PRODUCT_A}&month=2026-09`, { origin: SAME_ORIGIN }),
      monthDeps(c, {
        checkRateLimit: async (key) => {
          c.rateLimit.push(key);
          return { success: !key.startsWith("embed:month:tenant:") };
        },
      }),
    );

    expect(response.status).toBe(429);
    expect(c.probe).toBe(0);
  });

  it("zapis ma WŁASNY kubełek, nie zjada budżetu formularza storefrontu", async () => {
    const c = counters();
    await handleEmbedReservationRequest(reservationReq({ origin: SAME_ORIGIN }), reservationDeps(c));

    expect(c.rateLimit[0]).toBe("embed:reserve:ip:203.0.113.7");
  });
});

/* ------------------------------------------------------------------ */
/* WALIDACJA WEJŚCIA ZE STRONY GOSPODARZA                               */
/* ------------------------------------------------------------------ */

describe("embed — nie ufamy stronie gospodarza", () => {
  it("śmieciowy produkt/miesiąc odbijamy PRZED bazą i PRZED licznikiem", async () => {
    const c = counters();
    const cases = [
      "product=nie-uuid&month=2026-09",
      `product=${PRODUCT_A}&month=2026-13`,
      `product=${PRODUCT_A}&month=wrzesien`,
      `product=${PRODUCT_A}`,
      `month=2026-09`,
      `product=${PRODUCT_A}&month=1899-01`,
    ];

    for (const query of cases) {
      const response = await handleEmbedMonthRequest(
        monthReq(query, { origin: SAME_ORIGIN }),
        monthDeps(c),
      );
      expect(response.status).toBe(400);
    }

    expect(c.probe).toBe(0);
    expect(c.rateLimit).toEqual([]);
  });

  it("ciało zapisu nie jest JSON-em → 400, zero zapisu", async () => {
    const c = counters();
    const request = new Request(`${SAME_ORIGIN}/embed/api/reservations`, {
      method: "POST",
      headers: { host: HOST, origin: SAME_ORIGIN, "content-type": "application/json" },
      body: "{nie-json",
    });

    const response = await handleEmbedReservationRequest(request, reservationDeps(c));

    expect(response.status).toBe(400);
    expect(c.rpc).toBe(0);
  });

  it("pole tenanta doklejone do ciała jest NIEREPREZENTOWALNE (wycina je schemat)", async () => {
    const c = counters();
    let seenTenant: string | null = null;

    await handleEmbedReservationRequest(
      reservationReq({ origin: SAME_ORIGIN }, {
        ...VALID_RESERVATION,
        tenantId: TENANT_B,
        tenant_id: TENANT_B,
        p_tenant_id: TENANT_B,
      }),
      reservationDeps(c, {
        callRpc: async (args) => {
          c.rpc += 1;
          seenTenant = args.p_tenant_id;
          return ORDER;
        },
      }),
    );

    expect(seenTenant).toBe(TENANT_A);
  });
});
