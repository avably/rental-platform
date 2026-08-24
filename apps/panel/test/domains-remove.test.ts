/**
 * DOWÓD ADR-100: usunięcie domeny wymaga WŁASNOŚCI, zanim ruszymy dostawcę.
 *
 * Audyt E2E 2026-08-07 pokazał, że `removeCustomDomainAction` wołała
 * `removeDomain(host)` z hostem prosto z formularza, a przynależność do
 * najemcy sprawdzał dopiero DB-delete PO wywołaniu dostawcy. Wszystkie hosty
 * siedzą w jednym, wspólnym projekcie u dostawcy, więc członek najemcy A mógł
 * wypiąć host najemcy B (informacja publiczna) i zgasić cudzy storefront —
 * a wiersz ofiary zostawał `verified = true`, więc jej panel dalej meldował
 * „działa". Ten plik pilnuje trzech rzeczy:
 *
 *   (a) CUDZY HOST NIE DOTYKA DOSTAWCY — bramka własności (tenant-scoped
 *       odczyt wiersza `custom`) odrzuca go ZANIM powstanie wywołanie sieciowe,
 *       komunikatem celowo tożsamym z checkDomainAction („Nie znaleziono tej
 *       domeny."), żeby akcja nie była sondą ujawniającą cudze domeny.
 *   (b) SUBDOMENA PLATFORMY jest nieusuwalna także U DOSTAWCY, nie tylko
 *       w bazie: to jedyny gwarantowany adres sklepu najemcy, a filtr
 *       `kind = 'custom'` w samym DB-delete nie chronił wywołania sieciowego.
 *   (c) WŁASNA domena `custom` przechodzi bez zmiany zachowania: dostawca
 *       raz, potem wiersz (kolejność z docblocku akcji), sukces.
 *
 * `VercelDomainsClient` jest tu atrapą Z ROZMYSŁEM (inaczej niż w
 * domains-retry.test.ts): dowodem nie jest treść rozmowy z dostawcą, tylko
 * to, CZY w ogóle do niej doszło.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";
const CUSTOM_A = "wypozyczalnia-a.example.com";
const CUSTOM_B = "wypozyczalnia-b.example.com";
const SUB_A = "acme.avably.io";

const { removeDomainSpy } = vi.hoisted(() => ({
  removeDomainSpy: vi.fn(async (_host: string) => undefined),
}));

/**
 * Atrapa podmienia WYŁĄCZNIE klienta domen; reszta eksportów @avably/core
 * zostaje prawdziwa, żeby moduł akcji importował się jak na produkcji.
 */
vi.mock("@avably/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@avably/core")>()),
  VercelDomainsClient: class {
    removeDomain = removeDomainSpy;
  },
}));

interface DomainRecord extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  domain: string;
  kind: string;
  verified: boolean;
}

/** Stan „bazy" na czas testu. */
let domains: DomainRecord[] = [];
let sessionTenantId: string | null = TENANT_A;

type Row = Record<string, unknown>;

/**
 * Minimalny klient PostgREST honorujący `.eq(...)` — jak w domains-retry:
 * świadomie BEZ symulacji RLS, żeby zdjęcie któregokolwiek filtra akcji
 * (tenant_id / domain / kind) natychmiast było widoczne w wyniku.
 */
class Query {
  private filters: [string, unknown][] = [];

  constructor(
    private readonly op: "select" | "delete",
  ) {}

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  private rows(): Row[] {
    return domains.filter((row) => this.filters.every(([col, val]) => row[col] === val));
  }

  private run(): { data: Row[] | null; error: { message: string } | null } {
    const matched = this.rows();
    if (this.op === "delete") {
      domains = domains.filter((row) => !matched.includes(row));
    }
    return { data: matched, error: null };
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
  from(_table: "domains") {
    return {
      select: () => new Query("select"),
      delete: () => new Query("delete"),
    };
  },
};

class FakeAuthError extends Error {}

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

vi.mock("@/lib/auth", () => ({ AuthError: FakeAuthError }));

vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => {
    if (!sessionTenantId) throw new FakeAuthError("Wymagane zalogowanie.");
    return { supabase, tenantId: sessionTenantId };
  },
}));

function domainRow(tenantId: string, host: string, kind: string): DomainRecord {
  return { id: `dom-${host}`, tenant_id: tenantId, domain: host, kind, verified: true };
}

async function remove(host: string) {
  const fd = new FormData();
  fd.set("domain", host);
  const { removeCustomDomainAction } = await import(
    "@/app/[locale]/(panel)/ustawienia-domen/domains-actions"
  );
  return removeCustomDomainAction({}, fd);
}

describe("usunięcie domeny wymaga własności (ADR-100)", () => {
  beforeEach(() => {
    // Wiersze OFIARY pierwsze — jak w domains-retry: gdyby bramka przestała
    // filtrować po tenancie z sesji, odczyt bez filtra trafi na cudzy wiersz
    // i testy to pokażą. Kolejność jest częścią dowodu.
    domains = [
      domainRow(TENANT_B, CUSTOM_B, "custom"),
      domainRow(TENANT_A, CUSTOM_A, "custom"),
      domainRow(TENANT_A, SUB_A, "subdomain"),
    ];
    sessionTenantId = TENANT_A;
    removeDomainSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cudzy host: dostawca NIETKNIĘTY, komunikat neutralny, cudzy wiersz zostaje", async () => {
    const state = await remove(CUSTOM_B);

    expect(removeDomainSpy, "host ofiary poszedł do dostawcy").not.toHaveBeenCalled();
    expect(state.formError).toBe("Nie znaleziono tej domeny.");
    expect(state.success).toBeUndefined();
    expect(domains.some((row) => row.domain === CUSTOM_B)).toBe(true);
  });

  it("subdomena platformy: nieusuwalna także u dostawcy, nie tylko w bazie", async () => {
    const state = await remove(SUB_A);

    expect(removeDomainSpy, "gwarantowany adres sklepu poszedł do wypięcia").not.toHaveBeenCalled();
    expect(state.formError).toBe("Nie znaleziono tej domeny.");
    expect(domains.some((row) => row.domain === SUB_A)).toBe(true);
  });

  it("własna domena custom: dostawca raz, wiersz skasowany, sukces", async () => {
    const state = await remove(CUSTOM_A);

    expect(removeDomainSpy).toHaveBeenCalledTimes(1);
    expect(removeDomainSpy).toHaveBeenCalledWith(CUSTOM_A);
    expect(domains.some((row) => row.domain === CUSTOM_A)).toBe(false);
    expect(state.success).toBe(CUSTOM_A);
  });

  it("awaria dostawcy przy WŁASNEJ domenie nie blokuje usunięcia wiersza", async () => {
    removeDomainSpy.mockRejectedValueOnce(new Error("ECONNRESET"));

    const state = await remove(CUSTOM_A);

    expect(domains.some((row) => row.domain === CUSTOM_A)).toBe(false);
    expect(state.success).toBe(CUSTOM_A);
  });

  it("anonim niczego nie usunie", async () => {
    sessionTenantId = null;

    const state = await remove(CUSTOM_A);

    expect(removeDomainSpy).not.toHaveBeenCalled();
    expect(state.formError).toBe("Wymagane zalogowanie.");
    expect(domains.some((row) => row.domain === CUSTOM_A)).toBe(true);
  });
});
