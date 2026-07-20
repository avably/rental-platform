/**
 * DOWÓD ZADANIA 2.6b: najemca sam odzyskuje adres sklepu po awarii dostawcy.
 *
 * ADR-046 celowo nie blokuje zakładania organizacji, gdy rejestracja hosta
 * padnie — ale bez ponowienia z panelu ta decyzja zostawiała najemcę ze
 * sklepem bez adresu i telefonem do supportu. Ten plik pilnuje trzech rzeczy,
 * których nie widać w typach:
 *
 *   (a) HOST POWSTAJE ZE SLUGU ORGANIZACJI, nigdy z formularza. Wiersz
 *       subdomeny dostaje `verified = true` bez dowodu DNS, więc host z
 *       wejścia byłby przejęciem cudzego adresu jednym POST-em.
 *   (b) AWARIA DOSTAWCY ZWRACA POWÓD, nie wyjątek — akcja dochodzi do końca,
 *       `last_error` zostaje zapisany.
 *   (c) CZŁONEK TENANTA A NIE RUSZY TENANTA B, nawet gdy poda jego id.
 *
 * Testujemy PRAWDZIWY `registerDomainSafely` i prawdziwy port z podłożonym
 * `fetch` (fixtures, zero sieci). Podmiana opakowania atrapą sprawdzałaby
 * atrapę, nie zabezpieczenie.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";
const HOST_A = "acme.avably.io";
const HOST_B = "obcy.avably.io";

interface DomainRecord extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  domain: string;
  kind: string;
  verified: boolean;
  verified_at: string | null;
  provider_domain_id: string | null;
  last_error: string | null;
}

interface TenantRecord extends Record<string, unknown> {
  id: string;
  slug: string;
}

/** Stan „bazy" na czas testu. Kolejność ma znaczenie — patrz niżej. */
let tenants: TenantRecord[] = [];
let domains: DomainRecord[] = [];
let sessionTenantId: string | null = TENANT_A;

type Row = Record<string, unknown>;

/**
 * Minimalny klient PostgREST honorujący `.eq(...)`. Świadomie NIE symuluje
 * RLS: filtry, które akcja nakłada sama, są tu jedyną barierą — dzięki temu
 * zdjęcie `.eq("tenant_id", ...)` albo wzięcie id z formularza natychmiast
 * widać w wyniku, zamiast być schowanym za atrapą polityki.
 */
class Query {
  private filters: [string, unknown][] = [];

  constructor(
    private readonly table: "tenants" | "domains",
    private readonly op: "select" | "update" | "insert",
    private readonly payload?: Row,
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  private rows(): Row[] {
    const source: Row[] = this.table === "tenants" ? tenants : domains;
    return source.filter((row) => this.filters.every(([col, val]) => row[col] === val));
  }

  private run(): { data: Row[] | null; error: { code?: string; message: string } | null } {
    if (this.op === "select") return { data: this.rows(), error: null };

    if (this.op === "update") {
      const matched = this.rows();
      for (const row of matched) Object.assign(row, this.payload);
      return { data: matched, error: null };
    }

    const inserted = this.payload as Partial<DomainRecord>;
    // UNIQUE na `domain` jest GLOBALNY (0019) — kolizja niezależna od tenanta.
    if (domains.some((row) => row.domain === inserted.domain)) {
      return { data: null, error: { code: "23505", message: "duplicate key" } };
    }
    const row: DomainRecord = {
      id: `dom-${domains.length + 1}`,
      tenant_id: String(inserted.tenant_id),
      domain: String(inserted.domain),
      kind: String(inserted.kind),
      verified: inserted.verified === true,
      verified_at: inserted.verified_at ?? null,
      provider_domain_id: inserted.provider_domain_id ?? null,
      last_error: inserted.last_error ?? null,
    };
    domains.push(row);
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
  from(table: "tenants" | "domains") {
    return {
      select: () => new Query(table, "select"),
      update: (payload: Row) => new Query(table, "update", payload),
      insert: (payload: Row) => new Query(table, "insert", payload),
    };
  },
};

class FakeAuthError extends Error {}

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/auth", () => ({ AuthError: FakeAuthError }));

vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => {
    if (!sessionTenantId) throw new FakeAuthError("Wymagane zalogowanie.");
    return { supabase, tenantId: sessionTenantId };
  },
}));

function subdomainRow(tenantId: string, host: string, overrides: Partial<DomainRecord> = {}) {
  return {
    id: `dom-${host}`,
    tenant_id: tenantId,
    domain: host,
    kind: "subdomain",
    verified: true,
    verified_at: "2026-07-01T00:00:00.000Z",
    provider_domain_id: null,
    last_error: null,
    ...overrides,
  } satisfies DomainRecord;
}

/**
 * Formularz niosący CUDZE dane. Akcja nie ma prawa użyć żadnego z tych pól —
 * są tu wyłącznie po to, żeby regresja („weźmy host z formularza") miała czym
 * się objawić.
 */
function hostileFormData(): FormData {
  const fd = new FormData();
  fd.set("domain", "przejete.example.com");
  fd.set("tenant_id", TENANT_B);
  fd.set("id", TENANT_B);
  fd.set("slug", "obcy");
  return fd;
}

async function retry(formData: FormData = new FormData()) {
  const { retrySubdomainAction } = await import("@/app/[locale]/ustawienia-domen/domains-actions");
  return retrySubdomainAction({}, formData);
}

function stubProvider(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(async (input: unknown, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function okResponse(name: string) {
  return new Response(JSON.stringify({ name, verified: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ponowienie rejestracji subdomeny (2.6b)", () => {
  beforeEach(() => {
    // TENANT_B PIERWSZY: gdyby akcja przestała filtrować po tenancie z sesji,
    // odczyt bez filtra trafi na CUDZY wiersz i test to pokaże. Kolejność jest
    // częścią dowodu, nie kosmetyką.
    tenants = [
      { id: TENANT_B, slug: "obcy" },
      { id: TENANT_A, slug: "acme" },
    ];
    domains = [subdomainRow(TENANT_B, HOST_B), subdomainRow(TENANT_A, HOST_A)];
    sessionTenantId = TENANT_A;
    vi.stubEnv("VERCEL_API_TOKEN", "tok-testowy");
    vi.stubEnv("VERCEL_PROJECT_ID", "prj-testowy");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("nie da się zarejestrować dowolnego hosta jako subdomeny tenanta", async () => {
    const fetchSpy = stubProvider(async () => okResponse(HOST_A));

    const state = await retry(hostileFormData());

    // Host poszedł ze slugu organizacji z sesji, a nie z żadnego pola formularza.
    const body = String(fetchSpy.mock.calls[0]?.[1]?.body ?? "");
    expect(JSON.parse(body)).toEqual({ name: HOST_A });
    expect(state.success).toBe(HOST_A);
    expect(domains.some((row) => row.domain === "przejete.example.com")).toBe(false);
  });

  it("członek tenanta A nie ponowi rejestracji tenanta B", async () => {
    stubProvider(async () => okResponse(HOST_A));

    await retry(hostileFormData());

    const foreign = domains.find((row) => row.domain === HOST_B);
    expect(foreign?.provider_domain_id, "cudzy wiersz został ruszony").toBeNull();
    expect(domains.find((row) => row.domain === HOST_A)?.provider_domain_id).toBe(HOST_A);
  });

  it("awaria dostawcy zwraca powód, nie wywraca akcji", async () => {
    stubProvider(async () => {
      throw new Error("ECONNRESET");
    });

    const state = await retry();

    expect(String(state.formError)).toContain("ECONNRESET");
    const row = domains.find((entry) => entry.domain === HOST_A);
    expect(String(row?.last_error)).toContain("ECONNRESET");
    expect(row?.provider_domain_id).toBeNull();
  });

  it("BRAK konfiguracji dostawcy też nie wywraca akcji (jawny powód)", async () => {
    vi.stubEnv("VERCEL_API_TOKEN", "");
    vi.stubEnv("VERCEL_PROJECT_ID", "");

    const state = await retry();

    expect(String(state.formError)).toContain("VERCEL_API_TOKEN");
    expect(String(domains.find((row) => row.domain === HOST_A)?.last_error)).toContain(
      "VERCEL_API_TOKEN",
    );
  });

  it("sukces zapisuje provider_domain_id i CZYŚCI zaległy last_error", async () => {
    domains = [subdomainRow(TENANT_A, HOST_A, { last_error: "stara awaria" })];
    stubProvider(async () => okResponse(HOST_A));

    const state = await retry();

    expect(state.success).toBe(HOST_A);
    expect(domains[0]?.provider_domain_id).toBe(HOST_A);
    expect(domains[0]?.last_error).toBeNull();
  });

  it("IDEMPOTENCJA: ponowienie dla już zarejestrowanego hosta jest sukcesem", async () => {
    // Dostawca na powtórne dodanie oddaje 409; port dopytuje o stan (api.ts).
    const fetchSpy = stubProvider(async (_url, init) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ error: { code: "domain_taken" } }), { status: 409 })
        : okResponse(HOST_A),
    );

    const state = await retry();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(state.formError, "409 dla NASZEGO hosta zamienił się w błąd").toBeUndefined();
    expect(state.success).toBe(HOST_A);
    expect(domains.find((row) => row.domain === HOST_A)?.last_error).toBeNull();
  });

  it("brak wiersza subdomeny (kolizja 0022) — akcja go tworzy i rejestruje", async () => {
    domains = [subdomainRow(TENANT_B, HOST_B)];
    stubProvider(async () => okResponse(HOST_A));

    const state = await retry();

    const created = domains.find((row) => row.domain === HOST_A);
    expect(created, "wiersz subdomeny nie powstał").toBeDefined();
    expect(created?.tenant_id).toBe(TENANT_A);
    expect(created?.kind).toBe("subdomain");
    expect(created?.verified).toBe(true);
    expect(created?.provider_domain_id).toBe(HOST_A);
    expect(state.success).toBe(HOST_A);
  });

  it("host trzymany przez CUDZY wiersz — komunikat, zero przejęcia", async () => {
    // Slug odtworzony po skasowanym tenancie: host globalnie zajęty.
    domains = [subdomainRow(TENANT_B, HOST_A)];
    const fetchSpy = stubProvider(async () => okResponse(HOST_A));

    const state = await retry();

    expect(state.formError).toContain("zajęty");
    expect(fetchSpy, "akcja poszła do dostawcy po cudzy host").not.toHaveBeenCalled();
    expect(domains[0]?.tenant_id).toBe(TENANT_B);
  });

  it("anonim nie ponowi niczego", async () => {
    sessionTenantId = null;
    const fetchSpy = stubProvider(async () => okResponse(HOST_A));

    const state = await retry();

    expect(state.formError).toBe("Wymagane zalogowanie.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
