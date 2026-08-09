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

/**
 * Szpieg query-buildera. Od C6-A2 akcja robi TRZY rundy do bazy — odczyt
 * zapisanych pól własnych, odczyt definicji najemcy i dopiero zapis — więc
 * atrapa jest ŚWIADOMA TABELI i „thenable": ta sama ścieżka `.eq().eq()`
 * kończy się raz `.maybeSingle()`, a raz `.select("id")`.
 */
function makeSupabase(
  result: { data: unknown; error: unknown },
  options: {
    definitions?: unknown[];
    existing?: Record<string, unknown> | null;
    /** Symuluje błąd transportu przy ODCZYCIE wiersza (maybeSingle). */
    readError?: unknown;
  } = {},
) {
  const calls: BuilderCalls = { from: null, update: null, eqs: [], select: null };

  function builderFor(table: string) {
    const builder: Record<string, unknown> = {
      update(payload: Record<string, unknown>) {
        calls.update = payload;
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.eqs.push([column, value]);
        return builder;
      },
      order() {
        return builder;
      },
      select(columns: string) {
        calls.select = columns;
        return builder;
      },
      maybeSingle() {
        if (options.readError) return Promise.resolve({ data: null, error: options.readError });
        return Promise.resolve({ data: { custom_fields: options.existing ?? null }, error: null });
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        const value =
          table === "custom_field_definitions"
            ? { data: options.definitions ?? [], error: null }
            : result;
        return Promise.resolve(value).then(resolve, reject);
      },
    };
    return builder;
  }

  const supabase = {
    from(table: string) {
      calls.from = table;
      return builderFor(table);
    },
  };
  return { supabase, calls };
}

const requireMember = vi.fn();
vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
// Akcja odświeża RSC po zapisie — poza kontekstem żądania to no-op w teście.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Tłumaczenia odmów pól własnych: poza żądaniem oddajemy sam klucz — testy
// pytają o TREŚĆ ŻĄDANIA do bazy, nie o brzmienie komunikatu.
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));

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
      // Pola własne idą TĄ SAMĄ mutacją: najemca bez definicji zapisuje pustą
      // mapę, a nie `null` (kolumna jest `not null default '{}'`).
      custom_fields: {},
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

  it("zapis karty NIE kasuje wartości pod polem, którego karta nie pokazuje", async () => {
    // Kolumna `custom_fields` idzie do bazy W CAŁOŚCI, więc akcja MUSI wczytać
    // stan sprzed edycji. Bez tego pierwsza zmiana telefonu kasowałaby to, co
    // klient wpisał w sklepie — cicho, bez błędu i bez śladu w dzienniku.
    const PANEL_FIELD = "33333333-3333-4333-8333-333333333333";
    const CHECKOUT_ONLY = "44444444-4444-4444-8444-444444444444";
    const row = (id: string, overrides: Record<string, unknown>) => ({
      id,
      entity: "customer",
      field_type: "text",
      label: "Pole",
      help_text: null,
      required: false,
      options: [],
      position: 0,
      show_in_panel: true,
      show_in_checkout: false,
      show_in_contract: false,
      archived_at: null,
      created_at: "2026-01-01T00:00:00Z",
      ...overrides,
    });

    const { supabase, calls } = makeSupabase(
      { data: [{ id: CUSTOMER }], error: null },
      {
        definitions: [
          row(PANEL_FIELD, { label: "Numer uprawnień" }),
          row(CHECKOUT_ONLY, { label: "Skąd o nas wiesz", show_in_panel: false, show_in_checkout: true }),
        ],
        existing: { [CHECKOUT_ONLY]: "z plakatu" },
      },
    );
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await updateCustomerAction(
      CUSTOMER,
      {},
      form({ ...VALID, [`cf_${PANEL_FIELD}`]: "UP/2026/1" }),
    );

    expect(state.success).toBe("saved");
    expect(calls.update).toMatchObject({
      custom_fields: { [PANEL_FIELD]: "UP/2026/1", [CHECKOUT_ONLY]: "z plakatu" },
    });
  });

  it("błąd odczytu custom_fields ZAMYKA ścieżkę — nie zapisuje mapy spoza wiersza (#4)", async () => {
    // Chwilowy błąd odczytu + udany UPDATE dałby `existing={}` i wyzerował
    // wartości checkoutowe/zarchiwizowane — cicho, z „zapisano". Bramka
    // `if (error || !current)` musi zamknąć ścieżkę PRZED zapisem.
    const { supabase, calls } = makeSupabase(
      { data: [{ id: CUSTOMER }], error: null },
      { readError: { code: "57014", message: "canceling statement due to statement timeout" } },
    );
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await updateCustomerAction(CUSTOMER, {}, form(VALID));

    expect(state.success).toBeUndefined();
    expect(state.formError).toBeTruthy();
    expect(calls.update, "UPDATE ruszył mimo błędu odczytu — ryzyko wyzerowania").toBeNull();
  });

  it("niepoprawny identyfikator klienta jest odrzucony przed autoryzacją", async () => {
    const state = await updateCustomerAction("nie-uuid", {}, form(VALID));
    expect(state.formError).toBeTruthy();
    expect(requireMember).not.toHaveBeenCalled();
  });
});
