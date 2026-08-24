import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Akcja edycji produktu (katalog) — kontrakt na TREŚĆ ŻĄDANIA, bez Supabase.
 *
 * Sedno tej suity (C6-A3 delta, znalezisko #5): kolumna `custom_fields` idzie
 * do bazy W CAŁOŚCI, więc akcja MUSI wczytać stan sprzed edycji. Gdyby odczyt
 * padł, a UPDATE się udał, mapa spoza wiersza (`{}`) wyzerowałaby wartości pól
 * niewidocznych w panelu (zarchiwizowane oraz serwowane publicznie przez
 * get_public_catalog) — cicho, z „zapisano". Bramka `if (error || !current)`
 * zamyka tę ścieżkę.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";

interface BuilderCalls {
  update: Record<string, unknown> | null;
  eqs: [string, unknown][];
}

/**
 * Szpieg query-buildera świadomy tabeli: odczyt produktu kończy się
 * `.maybeSingle()`, odczyt definicji i zapis — `.then()`.
 */
function makeSupabase(
  updateResult: { data: unknown; error: unknown },
  options: {
    readError?: unknown;
    existing?: Record<string, unknown> | null;
    definitions?: unknown[];
    /** Wiersze `product_categories` widziane przez akcję (ADR-155). */
    assignedCategories?: { category_id: string }[];
  } = {},
) {
  const calls: BuilderCalls = { update: null, eqs: [] };

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
      is() {
        return builder;
      },
      order() {
        return builder;
      },
      select() {
        return builder;
      },
      // Przypisania kategorii (ADR-155): akcja po udanym UPDATE doprowadza je
      // różnicą. Ta suita pyta o TREŚĆ ŻĄDANIA edycji produktu, więc tabela
      // łącząca dostaje najprostszą prawdę — „brak przypisań, zapis przechodzi"
      // — a jej własny kontrakt (co dokłada, co zdejmuje, kiedy milczy) ma
      // osobne dowody w test/catalog-categories.test.ts.
      delete() {
        return builder;
      },
      insert() {
        return Promise.resolve({ error: null });
      },
      maybeSingle() {
        if (options.readError) return Promise.resolve({ data: null, error: options.readError });
        return Promise.resolve({ data: { custom_fields: options.existing ?? null }, error: null });
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        let value: unknown = updateResult;
        if (table === "custom_field_definitions") {
          value = { data: options.definitions ?? [], error: null };
        } else if (table === "product_categories") {
          value = { data: options.assignedCategories ?? [], error: null };
        }
        return Promise.resolve(value).then(resolve, reject);
      },
    };
    return builder;
  }

  const supabase = {
    from(table: string) {
      return builderFor(table);
    },
  };
  return { supabase, calls };
}

const requireMember = vi.fn();
vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/navigation", () => ({ localePath: async (p: string) => p }));
// Odmowy pól własnych: poza żądaniem oddajemy sam klucz — pytamy o TREŚĆ
// żądania do bazy, nie o brzmienie komunikatu.
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));

const { updateProductAction } = await import("@/app/[locale]/(panel)/katalog/actions");

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const VALID = {
  name: "Wiertarka",
  description: "",
  basePriceDayGrosze: "120,00",
  depositGrosze: "300,00",
  autoIncrementMultiplier: "1,5",
  bufferBeforeDays: "0",
  bufferAfterDays: "0",
  minRentalDays: "2",
  active: "on",
};

beforeEach(() => {
  requireMember.mockReset();
});

describe("updateProductAction", () => {
  it("błąd odczytu custom_fields ZAMYKA ścieżkę — nie zapisuje mapy spoza wiersza (#5)", async () => {
    const { supabase, calls } = makeSupabase(
      { data: [{ id: PRODUCT }], error: null },
      { readError: { code: "57014", message: "canceling statement due to statement timeout" } },
    );
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await updateProductAction(PRODUCT, {}, form(VALID));

    expect(state.success).toBeUndefined();
    expect(state.formError).toBeTruthy();
    // DOWÓD: UPDATE nie ruszył — bez bramki błąd odczytu prowadził do zapisu
    // mapy `{}`, który kasował wartości pól niewidocznych w panelu.
    expect(calls.update, "UPDATE ruszył mimo błędu odczytu").toBeNull();
  });

  it("udany odczyt → zwykła edycja przechodzi (bramka nie blokuje happy-path)", async () => {
    const { supabase, calls } = makeSupabase(
      { data: [{ id: PRODUCT }], error: null },
      { existing: {} },
    );
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await updateProductAction(PRODUCT, {}, form(VALID));

    expect(state.success).toBe("saved");
    expect(calls.update).not.toBeNull();
    expect(calls.eqs).toContainEqual(["tenant_id", TENANT]);
    expect(calls.eqs).toContainEqual(["id", PRODUCT]);
    // Minimum najmu (0089, ADR-202) jedzie do bazy jako LICZBA z pola
    // formularza — bez tej pary klucz-wartość zapis panelu po cichu
    // zostawiałby default kolumny i pole w UI byłoby dekoracją.
    expect((calls.update as Record<string, unknown>).min_rental_days).toBe(2);
  });
});
