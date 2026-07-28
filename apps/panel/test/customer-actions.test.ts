import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Akcja edycji klienta (R6a) — kontrakt na TREŚĆ ŻĄDANIA, bez Supabase.
 *
 * Mockujemy `requireMember` i podstawiamy szpiega query-buildera, żeby
 * sprawdzić DWIE rzeczy naraz:
 *  1. walidacja Zod odrzuca złe wejście PRZED dotknięciem bazy;
 *  2. zapis jest ZAWĘŻONY do tenanta i wiersza — `.eq("tenant_id", …)`
 *     i `.eq("id", …)` — a payload mapuje pola formularza na kolumny.
 *
 * Punkt 2 jest dowodem mutacyjnym izolacji: zdjęcie `.eq("tenant_id", …)`
 * z akcji pali asercję niżej (bramką w produkcji jest RLS, ale ta akcja NIE
 * ma prawa polegać wyłącznie na niej — filtr tenanta to druga warstwa).
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";

interface BuilderCalls {
  from: string | null;
  update: Record<string, unknown> | null;
  eqs: [string, unknown][];
  select: string | null;
}

function makeSupabase(result: { data: unknown; error: unknown }) {
  const calls: BuilderCalls = { from: null, update: null, eqs: [], select: null };
  const builder: Record<string, unknown> = {
    update(payload: Record<string, unknown>) {
      calls.update = payload;
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.eqs.push([column, value]);
      return builder;
    },
    select(columns: string) {
      calls.select = columns;
      return Promise.resolve(result);
    },
  };
  const supabase = {
    from(table: string) {
      calls.from = table;
      return builder;
    },
  };
  return { supabase, calls };
}

const requireMember = vi.fn();
vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
// Akcja odświeża RSC po zapisie — poza kontekstem żądania to no-op w teście.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateCustomerAction } = await import(
  "@/app/[locale]/(panel)/klienci/[id]/actions"
);

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const VALID = {
  email: "anna@example.com",
  fullName: "Anna Kowalska",
  phone: "+48 600 100 200",
  companyName: "Studio Plan B",
  nip: "5250000000",
  addressStreet: "Polna 4",
  addressZip: "00-001",
  addressCity: "Warszawa",
};

beforeEach(() => {
  requireMember.mockReset();
});

describe("updateCustomerAction", () => {
  it("odrzuca niepoprawny e-mail PRZED dotknięciem bazy", async () => {
    const { supabase, calls } = makeSupabase({ data: [{ id: CUSTOMER }], error: null });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await updateCustomerAction(CUSTOMER, {}, form({ ...VALID, email: "nie-mail" }));

    expect(state.fieldErrors?.email).toBeTruthy();
    expect(calls.update, "baza nie powinna być dotknięta przy błędzie walidacji").toBeNull();
  });

  it("zapisuje payload ZAWĘŻONY do tenanta i wiersza, mapując pola na kolumny", async () => {
    const { supabase, calls } = makeSupabase({ data: [{ id: CUSTOMER }], error: null });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await updateCustomerAction(CUSTOMER, {}, form(VALID));

    expect(state.success).toBe("saved");
    expect(calls.from).toBe("customers");
    expect(calls.update).toEqual({
      email: "anna@example.com",
      full_name: "Anna Kowalska",
      phone: "+48 600 100 200",
      company_name: "Studio Plan B",
      nip: "5250000000",
      address_street: "Polna 4",
      address_zip: "00-001",
      address_city: "Warszawa",
    });
    // DOWÓD IZOLACJI: zapis jest zawężony i tenantem, i identyfikatorem wiersza.
    expect(calls.eqs).toContainEqual(["tenant_id", TENANT]);
    expect(calls.eqs).toContainEqual(["id", CUSTOMER]);
  });

  it("puste pola opcjonalne zapisują NULL (a nie pusty string)", async () => {
    const { supabase, calls } = makeSupabase({ data: [{ id: CUSTOMER }], error: null });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    await updateCustomerAction(CUSTOMER, {}, form({ email: "jan@example.com" }));

    expect(calls.update).toMatchObject({
      email: "jan@example.com",
      full_name: null,
      phone: null,
      company_name: null,
      nip: null,
      address_street: null,
      address_zip: null,
      address_city: null,
    });
  });

  it("UPDATE, który nie trafił w żaden wiersz, jest błędem — nie cichym sukcesem", async () => {
    const { supabase } = makeSupabase({ data: [], error: null });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await updateCustomerAction(CUSTOMER, {}, form(VALID));

    expect(state.success).toBeUndefined();
    expect(state.formError).toBeTruthy();
  });

  it("kolizja e-maila (23505) daje komunikat przy polu email", async () => {
    const { supabase } = makeSupabase({ data: null, error: { code: "23505", message: "duplicate" } });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await updateCustomerAction(CUSTOMER, {}, form(VALID));

    expect(state.fieldErrors?.email).toBeTruthy();
  });

  it("niepoprawny identyfikator klienta jest odrzucony przed autoryzacją", async () => {
    const state = await updateCustomerAction("nie-uuid", {}, form(VALID));
    expect(state.formError).toBeTruthy();
    expect(requireMember).not.toHaveBeenCalled();
  });
});
