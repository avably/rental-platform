/**
 * Kontrakt klienta Connect (Z2, ADR-065) — na nagranych odpowiedziach,
 * bez sieci i bez konta dostawcy.
 *
 * Najważniejszy test w tym pliku to ten, w którym odpowiedź na `POST
 * /v1/accounts` KŁAMIE: niesie `charges_enabled: true` dla świeżo założonego
 * konta. Metoda i tak nie ma jak tego przepuścić, bo zwraca sam identyfikator.
 * To jest ADR-049 zapisany w kształcie typu, a nie w komentarzu.
 */
import { describe, expect, it } from "vitest";

import {
  STRIPE_API_BASE,
  STRIPE_API_VERSION,
  StripeApiError,
  StripeConnectClient,
  encodeStripeForm,
  redactSecretKey,
} from "./api";
import { StripeConfigError } from "./config";

const SECRET_A = "sk_test_klucz_najemcy_a";
const SECRET_B = "sk_test_klucz_najemcy_b";
const PUBLISHABLE = "pk_test_klucz_publiczny";

interface Recorded {
  url: string;
  init: RequestInit;
}

/** Nagrany transport: oddaje kolejne odpowiedzi i zapamiętuje żądania. */
function transport(responses: { status: number; body: unknown }[]) {
  const calls: Recorded[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("Brak nagranej odpowiedzi na kolejne żądanie");
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

function client(fetchFn: typeof fetch, secretKey = SECRET_A) {
  return new StripeConnectClient({
    config: { secretKey, publishableKey: PUBLISHABLE },
    fetchFn,
  });
}

function header(call: Recorded, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

describe("konstruktor", () => {
  it("bez konfiguracji rzuca, zamiast zbudować atrapę", () => {
    expect(() => new StripeConnectClient({ config: {} })).toThrow(StripeConfigError);
  });

  it("dwie instancje = dwie konfiguracje (zero stanu na poziomie modułu)", async () => {
    // Lekcja ADR-031: cache klucza/klienta w module w procesie obsługującym
    // wielu najemców to podszywanie się między nimi. Instancje muszą być
    // od siebie niezależne także wtedy, gdy powstają jedna po drugiej.
    const first = transport([{ status: 200, body: { id: "acct_a" } }]);
    const second = transport([{ status: 200, body: { id: "acct_b" } }]);

    await client(first.fetchFn, SECRET_A).createAccount({ country: "PL" });
    await client(second.fetchFn, SECRET_B).createAccount({ country: "PL" });

    expect(header(first.calls[0]!, "Authorization")).toBe(`Bearer ${SECRET_A}`);
    expect(header(second.calls[0]!, "Authorization")).toBe(`Bearer ${SECRET_B}`);
  });

  it("naprzemienne wywołania dwóch instancji nie mieszają kluczy", () => {
    // Wariant „przeplot": cache modułowy przepuściłby test sekwencyjny wyżej,
    // gdyby zapisywał się przy PIERWSZYM wywołaniu i był czytany później.
    const a = transport([
      { status: 200, body: { id: "acct_a" } },
      { status: 200, body: { id: "acct_a2" } },
    ]);
    const b = transport([{ status: 200, body: { id: "acct_b" } }]);
    const clientA = client(a.fetchFn, SECRET_A);
    const clientB = client(b.fetchFn, SECRET_B);

    return Promise.all([
      clientA.createAccount({ country: "PL" }),
      clientB.createAccount({ country: "PL" }),
      clientA.createAccount({ country: "PL" }),
    ]).then(() => {
      expect(a.calls.map((call) => header(call, "Authorization"))).toEqual([
        `Bearer ${SECRET_A}`,
        `Bearer ${SECRET_A}`,
      ]);
      expect(header(b.calls[0]!, "Authorization")).toBe(`Bearer ${SECRET_B}`);
    });
  });
});

describe("createAccount — odpowiedź na POST nie jest dowodem gotowości", () => {
  it("zwraca WYŁĄCZNIE identyfikator, choć odpowiedź niesie flagi gotowości", async () => {
    const { calls, fetchFn } = transport([
      {
        status: 200,
        body: {
          id: "acct_utworzone",
          // Nagranie KŁAMIE celowo: gdyby metoda przepuszczała stan
          // z odpowiedzi na zapis, te trzy pola weszłyby do bazy jako
          // „konto gotowe" bez jednego odczytu.
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
        },
      },
    ]);

    const result = await client(fetchFn).createAccount({ country: "PL", email: "x@example.invalid" });

    expect(result).toBe("acct_utworzone");
    expect(typeof result).toBe("string");
    expect(calls[0]!.url).toBe(`${STRIPE_API_BASE}/v1/accounts`);
  });

  it("prosi o zdolności płatnicze i wypłatowe od razu", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: { id: "acct_1" } }]);
    await client(fetchFn).createAccount({ country: "PL" });

    const body = String(calls[0]!.init.body);
    expect(body).toContain("type=express");
    expect(body).toContain("country=PL");
    expect(body).toContain(encodeURIComponent("capabilities[card_payments][requested]"));
    expect(body).toContain(encodeURIComponent("capabilities[transfers][requested]"));
  });

  it("konto polskie zamawia BLIK i P24 przy zakładaniu (F1/ADR-137)", async () => {
    // Doproszenie zdolności PO fakcie na koncie Express to dla najemcy druga
    // runda onboardingu (P24 wymaga business_profile.url + company.vat_id,
    // których platforma nie może uzupełnić przez API) — dlatego wniosek
    // stoi w ciele ŻĄDANIA ZAŁOŻENIA, a ten test pilnuje jego bajtów.
    const { calls, fetchFn } = transport([{ status: 200, body: { id: "acct_1" } }]);
    await client(fetchFn).createAccount({ country: "PL" });

    const body = String(calls[0]!.init.body);
    expect(body).toContain(encodeURIComponent("capabilities[blik_payments][requested]"));
    expect(body).toContain(encodeURIComponent("capabilities[p24_payments][requested]"));
  });

  it("mała litera kraju nie gubi zdolności krajowych", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: { id: "acct_1" } }]);
    await client(fetchFn).createAccount({ country: "pl" });

    const body = String(calls[0]!.init.body);
    expect(body).toContain(encodeURIComponent("capabilities[blik_payments][requested]"));
    expect(body).toContain(encodeURIComponent("capabilities[p24_payments][requested]"));
  });

  it("konto spoza PL NIE zamawia zdolności krajowych — dostawca odrzuciłby całe konto", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: { id: "acct_1" } }]);
    await client(fetchFn).createAccount({ country: "DE" });

    const body = String(calls[0]!.init.body);
    // Komplet bazowy zostaje…
    expect(body).toContain(encodeURIComponent("capabilities[card_payments][requested]"));
    expect(body).toContain(encodeURIComponent("capabilities[transfers][requested]"));
    // …a krajowych metod PL nie ma w żądaniu ani razu.
    expect(body).not.toContain("blik_payments");
    expect(body).not.toContain("p24_payments");
  });

  it("przypina wersję API i klucz idempotencji", async () => {
    const { calls, fetchFn } = transport([{ status: 200, body: { id: "acct_1" } }]);
    await client(fetchFn).createAccount({ country: "PL", idempotencyKey: "tenant-1" });

    expect(header(calls[0]!, "Stripe-Version")).toBe(STRIPE_API_VERSION);
    expect(header(calls[0]!, "Idempotency-Key")).toBe("tenant-1");
  });

  it("2xx bez identyfikatora to PORAŻKA, nie sukces bez id", async () => {
    const { fetchFn } = transport([{ status: 200, body: { object: "account" } }]);
    await expect(client(fetchFn).createAccount({ country: "PL" })).rejects.toThrow(StripeApiError);
  });

  it("błąd dostawcy niesie status, kod i typ", async () => {
    const { fetchFn } = transport([
      {
        status: 400,
        body: { error: { message: "Nieprawidłowy kraj", code: "parameter_invalid", type: "invalid_request_error" } },
      },
    ]);

    await expect(client(fetchFn).createAccount({ country: "XX" })).rejects.toMatchObject({
      name: "StripeApiError",
      statusCode: 400,
      code: "parameter_invalid",
      type: "invalid_request_error",
    });
  });
});

describe("readAccount — jedyne źródło stanu", () => {
  it("mapuje obie osi gotowości ROZDZIELNIE", async () => {
    const { calls, fetchFn } = transport([
      {
        status: 200,
        body: {
          id: "acct_1",
          charges_enabled: true,
          // Konto `restricted`: przyjmuje płatności, blokuje wypłatę.
          payouts_enabled: false,
          details_submitted: true,
          requirements: { currently_due: [], past_due: [], disabled_reason: "requirements.pending_verification" },
        },
      },
    ]);

    const state = await client(fetchFn).readAccount("acct_1");

    expect(state).toEqual({
      providerAccountId: "acct_1",
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
      requirementsDue: [],
      disabledReason: "requirements.pending_verification",
    });
    expect(calls[0]!.url).toBe(`${STRIPE_API_BASE}/v1/accounts/acct_1`);
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("łączy currently_due z past_due bez duplikatów i bez eventually_due", async () => {
    const { fetchFn } = transport([
      {
        status: 200,
        body: {
          id: "acct_1",
          requirements: {
            currently_due: ["individual.id_number", "external_account"],
            past_due: ["external_account"],
            // `eventually_due` to zapowiedź przyszłych progów — nie powód,
            // dla którego konto dziś nie działa.
            eventually_due: ["individual.verification.document"],
          },
        },
      },
    ]);

    const state = await client(fetchFn).readAccount("acct_1");
    expect(state.requirementsDue).toEqual(["individual.id_number", "external_account"]);
  });

  it("brak pól gotowości w odpowiedzi znaczy NIEGOTOWE", async () => {
    // Dryf kształtu odpowiedzi ma domyślać się na NIE. Domyślna gotowość przy
    // nieznanym kształcie to definicja cichego sukcesu.
    const { fetchFn } = transport([{ status: 200, body: { id: "acct_1" } }]);
    const state = await client(fetchFn).readAccount("acct_1");

    expect(state.chargesEnabled).toBe(false);
    expect(state.payoutsEnabled).toBe(false);
    expect(state.detailsSubmitted).toBe(false);
    expect(state.requirementsDue).toEqual([]);
    expect(state.disabledReason).toBeNull();
  });

  it("wartości nie-boolowskie nie przechodzą jako gotowość", async () => {
    const { fetchFn } = transport([
      { status: 200, body: { id: "acct_1", charges_enabled: "true", payouts_enabled: 1 } },
    ]);
    const state = await client(fetchFn).readAccount("acct_1");

    expect(state.chargesEnabled).toBe(false);
    expect(state.payoutsEnabled).toBe(false);
  });

  it("404 dostawcy jest błędem, nie pustym stanem", async () => {
    const { fetchFn } = transport([
      { status: 404, body: { error: { message: "No such account", code: "resource_missing" } } },
    ]);

    await expect(client(fetchFn).readAccount("acct_nieznane")).rejects.toMatchObject({
      statusCode: 404,
      code: "resource_missing",
    });
  });
});

describe("createOnboardingLink", () => {
  it("przekazuje oba adresy powrotu i zwraca link z terminem ważności", async () => {
    const { calls, fetchFn } = transport([
      { status: 200, body: { url: "https://connect.example.invalid/setup/xyz", expires_at: 1_800_000_000 } },
    ]);

    const link = await client(fetchFn).createOnboardingLink("acct_1", {
      refreshUrl: "https://panel.example.invalid/odswiez",
      returnUrl: "https://panel.example.invalid/powrot",
    });

    expect(link).toEqual({ url: "https://connect.example.invalid/setup/xyz", expiresAt: 1_800_000_000 });
    const body = String(calls[0]!.init.body);
    expect(body).toContain("account=acct_1");
    expect(body).toContain("type=account_onboarding");
    expect(body).toContain(encodeURIComponent("https://panel.example.invalid/powrot"));
  });

  it("2xx bez adresu to porażka", async () => {
    const { fetchFn } = transport([{ status: 200, body: { object: "account_link" } }]);
    await expect(
      client(fetchFn).createOnboardingLink("acct_1", { refreshUrl: "a", returnUrl: "b" }),
    ).rejects.toThrow(StripeApiError);
  });
});

describe("createDashboardLoginLink — link do Express Dashboardu", () => {
  it("woła login_links konta i zwraca SAM adres", async () => {
    const { calls, fetchFn } = transport([
      {
        status: 200,
        body: { object: "login_link", created: 1_800_000_000, url: "https://connect.example.invalid/express/xyz" },
      },
    ]);

    const link = await client(fetchFn).createDashboardLoginLink("acct_1");

    // Zwraca WYŁĄCZNIE url — `created` świadomie odrzucone, poświadczenie nie
    // ma być przechowywane (lustro createAccount oddającego sam identyfikator).
    expect(link).toEqual({ url: "https://connect.example.invalid/express/xyz" });
    expect(calls[0]!.url).toBe(`${STRIPE_API_BASE}/v1/accounts/acct_1/login_links`);
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("jedzie na kluczu PLATFORMY, BEZ nagłówka Stripe-Account", async () => {
    // login_links to operacja platformy nad kontem POŁĄCZONYM (konto wskazuje
    // ścieżka). Nagłówek Stripe-Account skierowałby żądanie tak, jakby konto
    // prosiło o link do samego siebie — to inny, błędny tryb wywołania.
    const { calls, fetchFn } = transport([
      { status: 200, body: { url: "https://connect.example.invalid/express/xyz" } },
    ]);
    await client(fetchFn).createDashboardLoginLink("acct_1");

    expect(header(calls[0]!, "Authorization")).toBe(`Bearer ${SECRET_A}`);
    expect(header(calls[0]!, "Stripe-Account")).toBeUndefined();
    expect(header(calls[0]!, "Stripe-Version")).toBe(STRIPE_API_VERSION);
  });

  it("identyfikator konta jest URL-enkodowany w ścieżce", async () => {
    const { calls, fetchFn } = transport([
      { status: 200, body: { url: "https://connect.example.invalid/express/xyz" } },
    ]);
    await client(fetchFn).createDashboardLoginLink("acct/../inny");
    expect(calls[0]!.url).toContain(encodeURIComponent("acct/../inny"));
    expect(calls[0]!.url).not.toContain("acct/../inny/login_links");
  });

  it("2xx bez adresu to porażka, nie sukces bez url", async () => {
    const { fetchFn } = transport([{ status: 200, body: { object: "login_link" } }]);
    await expect(client(fetchFn).createDashboardLoginLink("acct_1")).rejects.toThrow(StripeApiError);
  });

  it("odmowa dostawcy (konto niekwalifikujące się) niesie status i kod, sekret wycięty", async () => {
    const { fetchFn } = transport([
      {
        status: 400,
        body: {
          error: {
            type: "invalid_request_error",
            code: "account_invalid",
            message: `Cannot create a login link, key ${SECRET_A}`,
          },
        },
      },
    ]);

    const error = await client(fetchFn)
      .createDashboardLoginLink("acct_1")
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StripeApiError);
    expect((error as StripeApiError).statusCode).toBe(400);
    expect((error as StripeApiError).code).toBe("account_invalid");
    expect(String((error as Error).message)).not.toContain(SECRET_A);
    expect(String((error as Error).message)).toContain("[usunięto]");
  });
});

describe("sekret nie ma ścieżki na zewnątrz", () => {
  it("komunikat błędu dostawcy przechodzi przez redakcję", async () => {
    const { fetchFn } = transport([
      { status: 401, body: { error: { message: `Invalid API Key provided: ${SECRET_A}` } } },
    ]);

    const error = await client(fetchFn).readAccount("acct_1").catch((err: unknown) => err);
    expect(String((error as Error).message)).not.toContain(SECRET_A);
    expect(String((error as Error).message)).toContain("[usunięto]");
  });

  it("awaria transportu też jest zredagowana", async () => {
    const fetchFn = (async () => {
      throw new Error(`connect ECONNREFUSED (klucz ${SECRET_A})`);
    }) as unknown as typeof fetch;

    const error = await client(fetchFn).readAccount("acct_1").catch((err: unknown) => err);
    expect(String((error as Error).message)).not.toContain(SECRET_A);
  });

  it("redakcja nie psuje komunikatu bez klucza", () => {
    expect(redactSecretKey("zwykły komunikat", SECRET_A)).toBe("zwykły komunikat");
    expect(redactSecretKey("komunikat", "")).toBe("komunikat");
  });

  it("odpowiedź nie-JSON staje się błędem, a nie udaną odpowiedzią", async () => {
    const fetchFn = (async () =>
      new Response("<html>503 Service Unavailable</html>", { status: 503 })) as unknown as typeof fetch;

    await expect(client(fetchFn).readAccount("acct_1")).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("encodeStripeForm", () => {
  it("koduje zagnieżdżenie notacją nawiasową dostawcy", () => {
    expect(encodeStripeForm({ a: 1, b: { c: true } })).toBe("a=1&b%5Bc%5D=true");
  });

  it("pomija wartości puste i koduje tablice pozycjami", () => {
    expect(encodeStripeForm({ a: undefined, b: null, c: ["x", "y"] })).toBe(
      "c%5B0%5D=x&c%5B1%5D=y",
    );
  });

  it("ucieka znaki specjalne w wartościach", () => {
    expect(encodeStripeForm({ url: "https://a.invalid/b?c=d&e=f" })).toBe(
      "url=https%3A%2F%2Fa.invalid%2Fb%3Fc%3Dd%26e%3Df",
    );
  });
});
