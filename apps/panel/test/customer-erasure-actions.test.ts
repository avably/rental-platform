import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Akcja usunięcia danych klienta (C2b, ADR-116) — kontrakt na TREŚĆ ŻĄDANIA,
 * bez Supabase. Sama funkcja SQL (izolacja, zasięg, ślad) jest badana na żywej
 * bazie w packages/db/test/customer-erasure.test.ts; tu pilnujemy warstwy,
 * która tę funkcję woła, bo to ona decyduje, CO do niej trafia.
 *
 * Cztery rzeczy, których nie widać w SQL-u:
 *  1. SESJA I ROLA PRZED DANYMI — akcja pyta o `owner` zanim dotknie klienta;
 *  2. POTWIERDZENIE JEST POROWNYWANE Z BAZĄ, nie z formularza — inaczej
 *     „świadome potwierdzenie" potwierdzałoby to, co przysłał klient
 *     przeglądarki;
 *  3. DO BAZY IDZIE WYŁĄCZNIE IDENTYFIKATOR KLIENTA — najemca nigdy nie jedzie
 *     z formularza (dowód mutacyjny: dołożenie `p_tenant_id` z FormData pali
 *     asercję na kształcie argumentów);
 *  4. PLIKI KASUJEMY PO BAZIE i dokładnie te, które wskazała funkcja.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const EMAIL = "anna@example.com";

const removeContractDocuments = vi.hoisted(() => vi.fn());
vi.mock("@/src/jobs/erase-customer-documents", () => ({
  removeContractDocuments: (paths: readonly string[]) => removeContractDocuments(paths),
}));

const requireMember = vi.fn();
vi.mock("@/lib/supabase-server", () => ({ requireMember: (role?: string) => requireMember(role) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/navigation", () => ({ localePath: async (path: string) => `/pl${path}` }));

const { eraseCustomerAction } = await import("@/app/[locale]/(panel)/klienci/[id]/actions");

interface Recorded {
  rpcName: string | null;
  rpcArgs: Record<string, unknown> | null;
  schema: string | null;
  selectEqs: [string, unknown][];
}

function makeSupabase(options: {
  customer?: { email: string } | null;
  rpc?: { data: unknown; error: unknown };
}) {
  const recorded: Recorded = { rpcName: null, rpcArgs: null, schema: null, selectEqs: [] };
  const customer = options.customer === undefined ? { email: EMAIL } : options.customer;

  const readBuilder: Record<string, unknown> = {
    select() {
      return readBuilder;
    },
    eq(column: string, value: unknown) {
      recorded.selectEqs.push([column, value]);
      return readBuilder;
    },
    maybeSingle() {
      return Promise.resolve({ data: customer, error: null });
    },
  };

  const supabase = {
    from() {
      return readBuilder;
    },
    schema(name: string) {
      recorded.schema = name;
      return {
        rpc(fn: string, args: Record<string, unknown>) {
          recorded.rpcName = fn;
          recorded.rpcArgs = args;
          return Promise.resolve(options.rpc ?? { data: { mode: "anonymized", contract_paths: [] }, error: null });
        },
      };
    },
  };

  return { supabase, recorded };
}

function form(confirmation: string): FormData {
  const fd = new FormData();
  fd.set("confirmation", confirmation);
  return fd;
}

beforeEach(() => {
  requireMember.mockReset();
  removeContractDocuments.mockReset();
  removeContractDocuments.mockResolvedValue({ requested: 0, removed: 0 });
  redirect.mockReset();
});

describe("eraseCustomerAction", () => {
  it("pyta o rolę WŁAŚCICIELA, nie o zwykłe członkostwo", async () => {
    const { supabase } = makeSupabase({});
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    await eraseCustomerAction(CUSTOMER, {}, form(EMAIL));

    expect(requireMember).toHaveBeenCalledWith("owner");
  });

  it("odrzuca niepoprawny identyfikator PRZED pytaniem o sesję", async () => {
    const state = await eraseCustomerAction("nie-uuid", {}, form(EMAIL));

    expect(state.formError).toBeTruthy();
    expect(requireMember, "sesja nie powinna być w ogóle pytana").not.toHaveBeenCalled();
  });

  it("bez potwierdzenia ZGODNEGO Z BAZĄ nie woła funkcji usuwającej", async () => {
    const { supabase, recorded } = makeSupabase({ customer: { email: EMAIL } });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await eraseCustomerAction(CUSTOMER, {}, form("inny@example.com"));

    expect(state.fieldErrors?.confirmation).toBeTruthy();
    expect(recorded.rpcName, "funkcja usuwająca nie ma prawa ruszyć").toBeNull();
    expect(removeContractDocuments).not.toHaveBeenCalled();
  });

  it("potwierdzenie porównuje bez względu na wielkość liter i białe znaki", async () => {
    const { supabase, recorded } = makeSupabase({ customer: { email: EMAIL } });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await eraseCustomerAction(CUSTOMER, {}, form(`  ${EMAIL.toUpperCase()}  `));

    expect(state.fieldErrors?.confirmation).toBeUndefined();
    expect(recorded.rpcName).toBe("erase_customer");
  });

  it("do bazy idzie WYŁĄCZNIE identyfikator klienta — najemca nigdy z formularza", async () => {
    const { supabase, recorded } = makeSupabase({ customer: { email: EMAIL } });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const fd = form(EMAIL);
    // Napastnik dokłada własnego najemcę do formularza — nie ma prawa dojechać.
    fd.set("tenant_id", "99999999-9999-4999-8999-999999999999");
    fd.set("p_tenant_id", "99999999-9999-4999-8999-999999999999");

    await eraseCustomerAction(CUSTOMER, {}, fd);

    expect(recorded.schema).toBe("app");
    expect(recorded.rpcName).toBe("erase_customer");
    expect(recorded.rpcArgs).toEqual({ p_customer_id: CUSTOMER });
  });

  it("odczyt klienta jest zawężony do najemca+wiersz (druga warstwa obok RLS)", async () => {
    const { supabase, recorded } = makeSupabase({ customer: { email: EMAIL } });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    await eraseCustomerAction(CUSTOMER, {}, form(EMAIL));

    expect(recorded.selectEqs).toContainEqual(["tenant_id", TENANT]);
    expect(recorded.selectEqs).toContainEqual(["id", CUSTOMER]);
  });

  it("nieznany klient kończy się odmową bez wywołania funkcji", async () => {
    const { supabase, recorded } = makeSupabase({ customer: null });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await eraseCustomerAction(CUSTOMER, {}, form(EMAIL));

    expect(state.formError).toBeTruthy();
    expect(recorded.rpcName).toBeNull();
  });

  it("kasuje DOKŁADNIE te pliki, które wskazała funkcja — i dopiero po zapisie", async () => {
    const paths = ["t/o/d1.pdf", "t/o/d2.pdf"];
    const { supabase } = makeSupabase({
      customer: { email: EMAIL },
      rpc: { data: { mode: "anonymized", contract_paths: paths }, error: null },
    });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await eraseCustomerAction(CUSTOMER, {}, form(EMAIL));

    expect(removeContractDocuments).toHaveBeenCalledWith(paths);
    expect(state.success).toBe("erased");
  });

  it("gdy pliki się nie skasują, mówi to WPROST zamiast udawać sukces", async () => {
    const { supabase } = makeSupabase({
      customer: { email: EMAIL },
      rpc: { data: { mode: "anonymized", contract_paths: ["t/o/d1.pdf"] }, error: null },
    });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });
    removeContractDocuments.mockRejectedValue(new Error("storage padł"));

    const state = await eraseCustomerAction(CUSTOMER, {}, form(EMAIL));

    expect(state.success).toBeUndefined();
    expect(state.formError).toBeTruthy();
  });

  it("odmowa roli z bazy (42501) wraca jako zdanie o właścicielu, nie surowy błąd", async () => {
    const { supabase } = makeSupabase({
      customer: { email: EMAIL },
      rpc: { data: null, error: { code: "42501", message: "permission denied" } },
    });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await eraseCustomerAction(CUSTOMER, {}, form(EMAIL));

    expect(state.formError).toMatch(/właściciel/i);
    expect(removeContractDocuments).not.toHaveBeenCalled();
  });

  it("cudzy albo nieistniejący klient (22023) nie zdradza, czy istnieje u sąsiada", async () => {
    const { supabase } = makeSupabase({
      customer: { email: EMAIL },
      rpc: { data: null, error: { code: "22023", message: "Klient nie istnieje…" } },
    });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await eraseCustomerAction(CUSTOMER, {}, form(EMAIL));

    expect(state.formError).toBe("Klient nie istnieje albo nie masz do niego dostępu.");
  });

  it("klient bez zamówień znika w całości — akcja wraca na listę", async () => {
    const { supabase } = makeSupabase({
      customer: { email: EMAIL },
      rpc: { data: { mode: "deleted", contract_paths: [] }, error: null },
    });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    await eraseCustomerAction(CUSTOMER, {}, form(EMAIL));

    expect(redirect).toHaveBeenCalledWith("/pl/klienci");
  });
});
