/**
 * DOWÓD ZADANIA Z2: karta płatności mówi to, co SERWER ODCZYTAŁ u dostawcy —
 * nigdy tego, co dostawca odpowiedział na zapis, i nigdy tego, co sugeruje
 * powrót przeglądarki.
 *
 * Ten plik pilnuje trzech rzeczy, których nie widać w typach:
 *
 *   (a) POWRÓT NA `return_url` NIE USTAWIA GOTOWOŚCI. Nagranie odpowiedzi na
 *       `POST /v1/accounts` KŁAMIE (niesie `charges_enabled: true` dla konta
 *       bez KYC), a odczyt mówi prawdę. Do bazy ma wejść prawda. To jest
 *       kształt awarii 2.6b przeniesiony na oś pieniędzy.
 *   (b) BRAK KONFIGURACJI = JAWNA ODMOWA, bez jednego żądania sieciowego.
 *   (c) AWARIA ODCZYTU NIE ZERUJE KOLUMN — zapisuje powód i zostawia
 *       poprzednią migawkę.
 *
 * Testujemy PRAWDZIWY port z podłożonym `fetch` (nagrania, zero sieci).
 * Podmiana portu atrapą sprawdzałaby atrapę, nie zabezpieczenie.
 */
import { STRIPE_PUBLISHABLE_KEY_ENV, STRIPE_SECRET_KEY_ENV } from "@avably/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_A = "00000000-0000-4000-8000-0000000000aa";
const TENANT_B = "00000000-0000-4000-8000-0000000000bb";
const SECRET_KEY = "sk_test_klucz_wlasciciela_atrapa";
const PUBLISHABLE_KEY = "pk_test_klucz_publiczny_atrapa";

interface PaymentAccountRecord extends Record<string, unknown> {
  tenant_id: string;
  provider: string;
  provider_account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_due: string[];
  last_error: string | null;
  last_synced_at: string | null;
}

let accounts: PaymentAccountRecord[] = [];
let sessionTenantId: string | null = TENANT_A;

type Row = Record<string, unknown>;

/**
 * Minimalny klient PostgREST honorujący `.eq(...)`. Świadomie NIE symuluje
 * RLS: filtry, które akcja nakłada sama, są tu jedyną barierą — dzięki temu
 * zdjęcie `.eq("tenant_id", ...)` natychmiast widać w wyniku, zamiast być
 * schowanym za atrapą polityki (wzorzec z `domains-retry.test.ts`).
 */
class Query {
  private filters: [string, unknown][] = [];

  constructor(
    private readonly op: "select" | "update" | "insert" | "delete",
    private readonly payload?: Row,
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  private rows(): PaymentAccountRecord[] {
    return accounts.filter((row) => this.filters.every(([col, val]) => row[col] === val));
  }

  private run(): { data: Row[] | null; error: { code?: string; message: string } | null } {
    if (this.op === "select") return { data: this.rows(), error: null };

    if (this.op === "update") {
      const matched = this.rows();
      for (const row of matched) Object.assign(row, this.payload);
      return { data: matched, error: null };
    }

    if (this.op === "delete") {
      const matched = this.rows();
      accounts = accounts.filter((row) => !matched.includes(row));
      return { data: matched, error: null };
    }

    const inserted = this.payload as Partial<PaymentAccountRecord>;
    if (accounts.some((row) => row.tenant_id === inserted.tenant_id)) {
      return { data: null, error: { code: "23505", message: "duplicate key" } };
    }
    const row: PaymentAccountRecord = {
      tenant_id: String(inserted.tenant_id),
      provider: String(inserted.provider ?? "stripe"),
      provider_account_id: String(inserted.provider_account_id),
      // Defaulty migracji 0028: świeże konto jest NIEGOTOWE.
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements_due: [],
      last_error: null,
      last_synced_at: null,
    };
    accounts.push(row);
    return { data: [row], error: null };
  }

  maybeSingle() {
    const result = this.run();
    return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
  }

  then<T>(resolve: (value: ReturnType<Query["run"]>) => T) {
    return Promise.resolve(this.run()).then(resolve);
  }
}

const supabase = {
  from(_table: string) {
    return {
      select: () => new Query("select"),
      update: (payload: Row) => new Query("update", payload),
      insert: (payload: Row) => new Query("insert", payload),
      delete: () => new Query("delete"),
    };
  },
};

class FakeAuthError extends Error {}
class Redirected extends Error {
  constructor(public readonly url: string) {
    super(`redirect: ${url}`);
  }
}

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["host", "127.0.0.1:3052"]])),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirected(url);
  },
}));
vi.mock("@/lib/navigation", () => ({
  localePath: async (path: string) => `/pl${path}`,
}));
vi.mock("@/lib/auth", () => ({ AuthError: FakeAuthError }));
vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => {
    if (!sessionTenantId) throw new FakeAuthError("Wymagane zalogowanie.");
    return {
      supabase,
      tenantId: sessionTenantId,
      role: "owner",
      user: { id: "user-1", email: "wlasciciel@example.invalid" },
    };
  },
}));

/**
 * Nagrania dostawcy. `POST /v1/accounts` ODPOWIADA KŁAMSTWEM — kompletem flag
 * gotowości dla konta, które dopiero powstało. Gdyby którakolwiek ścieżka
 * budowała stan z odpowiedzi na zapis, te wartości wjechałyby do bazy.
 */
const CREATE_RESPONSE_WITH_LIE = {
  id: "acct_z2test",
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  requirements: { currently_due: [], past_due: [] },
};

/** Prawda o tym samym koncie: KYC przerwane w połowie. */
const READ_RESPONSE_PENDING = {
  id: "acct_z2test",
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
  requirements: {
    currently_due: ["individual.id_number", "external_account"],
    past_due: [],
    disabled_reason: "requirements.past_due",
  },
};

const LINK_RESPONSE = {
  url: "https://connect.example.invalid/setup/abc",
  expires_at: 1_800_000_000,
};

function stubProvider(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(async (input: unknown, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Domyślny dostawca: zapis kłamie, odczyt mówi prawdę o przerwanym KYC. */
function stubHonestProvider(readBody: unknown = READ_RESPONSE_PENDING) {
  return stubProvider(async (url, init) => {
    if (url.endsWith("/v1/accounts") && init?.method === "POST") {
      return json(CREATE_RESPONSE_WITH_LIE);
    }
    if (url.includes("/v1/accounts/")) return json(readBody);
    if (url.endsWith("/v1/account_links")) return json(LINK_RESPONSE);
    throw new Error(`Nieoczekiwane żądanie: ${url}`);
  });
}

async function startOnboarding() {
  const { startPaymentOnboardingAction } = await import(
    "@/app/[locale]/(panel)/ustawienia-platnosci/payments-actions"
  );
  return startPaymentOnboardingAction({}, new FormData());
}

async function refresh() {
  const { refreshPaymentAccountAction } = await import(
    "@/app/[locale]/(panel)/ustawienia-platnosci/payments-actions"
  );
  return refreshPaymentAccountAction({}, new FormData());
}

async function returnFromOnboarding() {
  const { GET } = await import("@/app/[locale]/(panel)/ustawienia-platnosci/powrot/route");
  return GET();
}

/** Uruchamia akcję, która kończy się przekierowaniem, i zwraca jego adres. */
async function expectRedirect(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Redirected) return error.url;
    throw error;
  }
  throw new Error("Oczekiwano przekierowania, którego nie było");
}

function accountOf(tenantId: string): PaymentAccountRecord | undefined {
  return accounts.find((row) => row.tenant_id === tenantId);
}

describe("konto płatności najemcy (Z2, ADR-065)", () => {
  beforeEach(() => {
    // TENANT_B PIERWSZY: gdyby akcja przestała filtrować po tenancie z sesji,
    // odczyt bez filtra trafi na CUDZY wiersz i test to pokaże.
    accounts = [
      {
        tenant_id: TENANT_B,
        provider: "stripe",
        provider_account_id: "acct_obcego_najemcy",
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements_due: [],
        last_error: null,
        last_synced_at: "2026-07-01T10:00:00.000Z",
      },
    ];
    sessionTenantId = TENANT_A;
    process.env[STRIPE_SECRET_KEY_ENV] = SECRET_KEY;
    process.env[STRIPE_PUBLISHABLE_KEY_ENV] = PUBLISHABLE_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env[STRIPE_SECRET_KEY_ENV];
    delete process.env[STRIPE_PUBLISHABLE_KEY_ENV];
  });

  // -------------------------------------------------------------------
  // (a) Powrót z onboardingu nie ustawia gotowości bez odczytu
  // -------------------------------------------------------------------

  describe("powrót z onboardingu nie ustawia gotowości bez odczytu", () => {
    it("konto z details_submitted:false NIE wychodzi jako gotowe", async () => {
      stubHonestProvider();

      await expectRedirect(startOnboarding);
      // Sam zapis nie ma prawa niczego ustawić — świeży wiersz jest niegotowy,
      // mimo że dostawca odpowiedział kompletem flag na `true`.
      expect(accountOf(TENANT_A)).toMatchObject({
        provider_account_id: "acct_z2test",
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        last_synced_at: null,
      });

      await expectRedirect(returnFromOnboarding);

      const row = accountOf(TENANT_A)!;
      expect(row.charges_enabled, "powrót z onboardingu ustawił gotowość bez odczytu").toBe(false);
      expect(row.payouts_enabled).toBe(false);
      expect(row.details_submitted).toBe(false);
      expect(row.requirements_due).toEqual(["individual.id_number", "external_account"]);
      expect(row.last_synced_at, "stan zapisany bez znacznika odczytu").not.toBeNull();
    });

    it("powrót WYKONUJE odczyt konta (a nie tylko przekierowuje)", async () => {
      const fetchSpy = stubHonestProvider();
      await expectRedirect(startOnboarding);
      const beforeReturn = fetchSpy.mock.calls.length;

      await expectRedirect(returnFromOnboarding);

      const reads = fetchSpy.mock.calls
        .slice(beforeReturn)
        .filter(([url, init]) => String(url).includes("/v1/accounts/") && (init as RequestInit | undefined)?.method === "GET");
      expect(reads, "powrót nie odpytał dostawcy o stan konta").toHaveLength(1);
    });

    it("gotowość wchodzi do bazy dopiero, gdy ODCZYT ją potwierdzi", async () => {
      // Druga strona kryterium: bramka nie jest „zawsze false".
      stubHonestProvider({
        id: "acct_z2test",
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements: { currently_due: [], past_due: [] },
      });

      await expectRedirect(startOnboarding);
      await expectRedirect(returnFromOnboarding);

      expect(accountOf(TENANT_A)).toMatchObject({
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements_due: [],
      });
    });

    it("konto restricted zapisuje się jako wpłaty TAK, wypłaty NIE", async () => {
      stubHonestProvider({
        id: "acct_z2test",
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
        requirements: { currently_due: ["external_account"], past_due: [] },
      });

      await expectRedirect(startOnboarding);
      await expectRedirect(returnFromOnboarding);

      const row = accountOf(TENANT_A)!;
      expect(row.charges_enabled).toBe(true);
      expect(row.payouts_enabled, "wypłaty zwinięte do jednego „gotowe”").toBe(false);
    });

    it("powrót nie dotyka wiersza cudzego najemcy", async () => {
      stubHonestProvider();
      await expectRedirect(startOnboarding);
      await expectRedirect(returnFromOnboarding);

      expect(accountOf(TENANT_B)).toMatchObject({
        provider_account_id: "acct_obcego_najemcy",
        charges_enabled: true,
        last_synced_at: "2026-07-01T10:00:00.000Z",
      });
    });
  });

  // -------------------------------------------------------------------
  // (b) Brak konfiguracji = jawna odmowa
  // -------------------------------------------------------------------

  describe("brak konfiguracji AVABLY_STRIPE_* = jawna niedostępność", () => {
    it("akcja odmawia z powodem i NIE dotyka sieci", async () => {
      delete process.env[STRIPE_SECRET_KEY_ENV];
      const fetchSpy = stubHonestProvider();

      const state = await startOnboarding();

      expect(state.formError).toContain(STRIPE_SECRET_KEY_ENV);
      expect(fetchSpy, "próba wywołania dostawcy bez konfiguracji").not.toHaveBeenCalled();
      expect(accountOf(TENANT_A), "powstał wiersz konta bez konfiguracji").toBeUndefined();
    });

    it("powód nie niesie wartości klucza", async () => {
      delete process.env[STRIPE_SECRET_KEY_ENV];
      stubHonestProvider();

      const state = await startOnboarding();
      expect(state.formError).not.toContain(PUBLISHABLE_KEY);
    });
  });

  // -------------------------------------------------------------------
  // (c) Awaria odczytu nie zeruje kolumn
  // -------------------------------------------------------------------

  describe("awaria dostawcy jest powodem, nie zerem", () => {
    it("nieudany odczyt zapisuje last_error i ZOSTAWIA poprzednią migawkę", async () => {
      // Konto już gotowe — dopiero potem dostawca przestaje odpowiadać.
      stubHonestProvider({
        id: "acct_z2test",
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements: { currently_due: [], past_due: [] },
      });
      await expectRedirect(startOnboarding);
      await expectRedirect(returnFromOnboarding);

      stubProvider(async () => json({ error: { message: "Service unavailable" } }, 503));
      const state = await refresh();

      const row = accountOf(TENANT_A)!;
      expect(state.formError).toBeTruthy();
      expect(row.last_error).toContain("Service unavailable");
      // To jest sedno: awaria PO NASZEJ stronie nie ma prawa wyglądać jak
      // „konto przestało przyjmować płatności" — w Z3 ukryłaby płatność online.
      expect(row.charges_enabled).toBe(true);
      expect(row.payouts_enabled).toBe(true);
    });

    it("udany odczyt CZYŚCI zaległy powód", async () => {
      stubHonestProvider();
      await expectRedirect(startOnboarding);
      accountOf(TENANT_A)!.last_error = "stary powód";

      await refresh();
      expect(accountOf(TENANT_A)!.last_error).toBeNull();
    });

    it("komunikat błędu nie niesie klucza API", async () => {
      stubHonestProvider();
      await expectRedirect(startOnboarding);

      stubProvider(async () =>
        json({ error: { message: `Invalid API Key provided: ${SECRET_KEY}` } }, 401),
      );
      const state = await refresh();

      expect(state.formError).not.toContain(SECRET_KEY);
      expect(accountOf(TENANT_A)!.last_error).not.toContain(SECRET_KEY);
    });
  });

  // -------------------------------------------------------------------
  // Onboarding: adresy powrotu i idempotencja
  // -------------------------------------------------------------------

  describe("link onboardingowy", () => {
    it("baza adresu powrotu bierze host pętli zwrotnej, nie NODE_ENV", async () => {
      // Regresja znaleziona weryfikacją na żywo: `next start` ustawia
      // NODE_ENV=production także lokalnie, więc powrót z prawdziwego
      // onboardingu poszedł na produkcyjny host i skończył się 404.
      const previous = process.env.NODE_ENV;
      vi.stubEnv("NODE_ENV", "production");
      const fetchSpy = stubHonestProvider();
      try {
        expect(process.env.NODE_ENV, "podmiana NODE_ENV nie zadziałała").toBe("production");
        await expectRedirect(startOnboarding);
      } finally {
        vi.stubEnv("NODE_ENV", previous ?? "test");
      }

      const linkCall = fetchSpy.mock.calls.find(([callUrl]) =>
        String(callUrl).endsWith("/v1/account_links"),
      );
      const body = String((linkCall?.[1] as RequestInit | undefined)?.body);
      expect(body).toContain(encodeURIComponent("http://127.0.0.1:3052"));
    });

    it("host spoza pętli zwrotnej NIE decyduje o adresie powrotu", async () => {
      // Nagłówek Host przychodzi od klienta. Gdyby decydował, dałoby się
      // wysłać najemcę po onboardingu pod cudzy adres.
      const { headers } = await import("next/headers");
      const spy = vi.mocked(headers as unknown as () => Promise<Map<string, string>>);
      spy.mockResolvedValueOnce(new Map([["host", "zlosliwy.example.invalid"]]));
      const fetchSpy = stubHonestProvider();

      await expectRedirect(startOnboarding);

      const linkCall = fetchSpy.mock.calls.find(([callUrl]) =>
        String(callUrl).endsWith("/v1/account_links"),
      );
      const body = String((linkCall?.[1] as RequestInit | undefined)?.body);
      expect(body).not.toContain("zlosliwy.example.invalid");
      expect(body).toContain(encodeURIComponent("https://"));
    });

    it("wraca na NASZ handler powrotu, nie na goły ekran", async () => {
      const fetchSpy = stubHonestProvider();
      const url = await expectRedirect(startOnboarding);

      expect(url).toBe(LINK_RESPONSE.url);
      const linkCall = fetchSpy.mock.calls.find(([callUrl]) =>
        String(callUrl).endsWith("/v1/account_links"),
      );
      const body = String((linkCall?.[1] as RequestInit | undefined)?.body);
      expect(body).toContain(encodeURIComponent("/ustawienia-platnosci/powrot"));
    });

    it("drugie kliknięcie NIE zakłada drugiego konta", async () => {
      const fetchSpy = stubHonestProvider();
      await expectRedirect(startOnboarding);
      await expectRedirect(startOnboarding);

      const creations = fetchSpy.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/v1/accounts") && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(creations, "drugi onboarding założył kolejne konto u dostawcy").toHaveLength(1);
      expect(accounts.filter((row) => row.tenant_id === TENANT_A)).toHaveLength(1);
    });

    it("pierwsze żądanie niesie klucz idempotencji per najemca", async () => {
      const fetchSpy = stubHonestProvider();
      await expectRedirect(startOnboarding);

      const create = fetchSpy.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/v1/accounts") && (init as RequestInit | undefined)?.method === "POST",
      );
      const headers = (create?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toContain(TENANT_A);
    });
  });

  describe("odświeżenie stanu bez konta", () => {
    it("mówi, że konta nie ma, zamiast odpytywać dostawcę", async () => {
      const fetchSpy = stubHonestProvider();
      const state = await refresh();

      expect(state.formError).toContain("konta płatności");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
