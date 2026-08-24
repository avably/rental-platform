import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sondy izolacji i autoryzacji dla akcji dołożonych uwagami właściciela
 * (ADR-237): zmiana kolejności zdjęć oraz szybkie tworzenie kategorii.
 *
 * Pytamy o DWIE rzeczy, których wymaga sekcja bezpieczeństwa briefu:
 *   • AUTH-ONLY — anonim (AuthError z requireMember) nie dotyka bazy;
 *   • IZOLACJA NAJEMCY — każde żądanie do bazy niesie `tenant_id` z sesji, a
 *     zapis, który nie dosięgnął wiersza (RLS/cudzy produkt), jest ODMOWĄ, nie
 *     cichym „zapisano".
 *
 * Bazę zastępuje atrapa builderów: przedmiotem testu jest TREŚĆ żądania i
 * bramki akcji, nie RLS (ta ma własną macierz w pakiecie db).
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const IMG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IMG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const requireMember = vi.fn();
const invalidate = vi.fn();

vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/navigation", () => ({ localePath: async (p: string) => p }));
vi.mock("@/lib/catalog-cache", () => ({ invalidateStorefrontCatalog: (id: string) => invalidate(id) }));

const { AuthError } = await import("@/lib/auth");
const { reorderProductImagesAction } = await import(
  "@/app/[locale]/(panel)/katalog/[id]/zdjecia/actions"
);
const { createCategoryInlineAction } = await import(
  "@/app/[locale]/(panel)/katalog/kategorie/actions"
);

// ---------------------------------------------------------------------
// Atrapa Supabase dla zmiany kolejności zdjęć
// ---------------------------------------------------------------------

interface ImageWrite {
  sortOrder: number;
  eqs: [string, unknown][];
}

/**
 * `current` to wiersze zwrócone przez ODCZYT (id + sort_order). Każdy UPDATE
 * jest zapisywany razem ze swoimi `.eq(...)`, żeby dało się dowieść zawężenia
 * najemcą i produktem. `updateRows` decyduje, ile wierszy „dosięgnął" UPDATE —
 * pusta tablica udaje odfiltrowanie przez RLS.
 */
function imagesSupabase(
  current: { id: string; sort_order: number }[],
  options: { updateRows?: (id: string) => { id: string }[] } = {},
) {
  const writes: ImageWrite[] = [];

  function builder() {
    const state = { mode: "select" as "select" | "update", sortOrder: 0, eqs: [] as [string, unknown][] };
    const b: Record<string, unknown> = {
      select() {
        return b;
      },
      update(payload: { sort_order: number }) {
        state.mode = "update";
        state.sortOrder = payload.sort_order;
        return b;
      },
      eq(column: string, value: unknown) {
        state.eqs.push([column, value]);
        return b;
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        if (state.mode === "select") {
          return Promise.resolve({ data: current, error: null }).then(resolve, reject);
        }
        const id = state.eqs.find(([col]) => col === "id")?.[1] as string;
        writes.push({ sortOrder: state.sortOrder, eqs: state.eqs });
        const rows = options.updateRows ? options.updateRows(id) : [{ id }];
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return b;
  }

  return { supabase: { from: () => builder() }, writes };
}

beforeEach(() => {
  requireMember.mockReset();
  invalidate.mockReset();
});

describe("reorderProductImagesAction (uwaga #2, ADR-237)", () => {
  it("AUTH-ONLY: anonim dostaje odmowę i baza nie jest ruszana", async () => {
    requireMember.mockRejectedValue(new AuthError(401, "Zaloguj się."));
    const { supabase, writes } = imagesSupabase([
      { id: IMG_A, sort_order: 0 },
      { id: IMG_B, sort_order: 1 },
    ]);
    // Podmieniamy `from`, żeby udowodnić, że po odmowie nie doszło do zapytania.
    const fromSpy = vi.spyOn(supabase, "from");
    requireMember.mockRejectedValue(new AuthError(401, "Zaloguj się."));

    const state = await reorderProductImagesAction(PRODUCT, [IMG_B, IMG_A]);

    expect(state.formError).toBe("Zaloguj się.");
    expect(fromSpy).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("zapisuje TYLKO zmienione wiersze, każdy zawężony najemcą i produktem", async () => {
    const { supabase, writes } = imagesSupabase([
      { id: IMG_A, sort_order: 0 },
      { id: IMG_B, sort_order: 1 },
    ]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await reorderProductImagesAction(PRODUCT, [IMG_B, IMG_A]);

    expect(state.success).toBe("reordered");
    // B: 1→0, A: 0→1 — oba się zmieniły, więc dwa zapisy (nie cała lista).
    expect(writes).toHaveLength(2);
    for (const write of writes) {
      expect(write.eqs).toContainEqual(["tenant_id", TENANT]);
      expect(write.eqs).toContainEqual(["product_id", PRODUCT]);
    }
    expect(invalidate).toHaveBeenCalledWith(TENANT);
  });

  it("gest bez zmiany kolejności nie zapisuje ani jednego wiersza", async () => {
    const { supabase, writes } = imagesSupabase([
      { id: IMG_A, sort_order: 0 },
      { id: IMG_B, sort_order: 1 },
    ]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await reorderProductImagesAction(PRODUCT, [IMG_A, IMG_B]);

    expect(state.success).toBe("reordered");
    expect(writes).toEqual([]);
  });

  it("UPDATE, który nie dosięgnął wiersza (RLS/cudzy produkt), jest ODMOWĄ", async () => {
    const { supabase } = imagesSupabase(
      [
        { id: IMG_A, sort_order: 0 },
        { id: IMG_B, sort_order: 1 },
      ],
      { updateRows: () => [] },
    );
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await reorderProductImagesAction(PRODUCT, [IMG_B, IMG_A]);

    expect(state.success).toBeUndefined();
    expect(state.formError).toBeTruthy();
  });

  it("lista niezgodna ze zbiorem zdjęć produktu jest odrzucona przed zapisem", async () => {
    const { supabase, writes } = imagesSupabase([
      { id: IMG_A, sort_order: 0 },
      { id: IMG_B, sort_order: 1 },
    ]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    // Brakuje IMG_B — klient przysłał niepełną albo obcą listę.
    const state = await reorderProductImagesAction(PRODUCT, [IMG_A]);

    expect(state.formError).toBeTruthy();
    expect(writes).toEqual([]);
  });

  it("powtórzony identyfikator jest odrzucony", async () => {
    const { supabase } = imagesSupabase([
      { id: IMG_A, sort_order: 0 },
      { id: IMG_B, sort_order: 1 },
    ]);
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await reorderProductImagesAction(PRODUCT, [IMG_A, IMG_A]);
    expect(state.formError).toBeTruthy();
  });
});

// ---------------------------------------------------------------------
// Atrapa Supabase dla szybkiego tworzenia kategorii
// ---------------------------------------------------------------------

/**
 * Odczyt rodzeństwa kończy się awaitem po `.eq(...)`; wstawienie —
 * `.select(...).single()`. Payload insertu zapisujemy, żeby dowieść, że niesie
 * `tenant_id` z sesji i slug wyprowadzony z nazwy.
 */
function categorySupabase() {
  const inserts: Record<string, unknown>[] = [];

  function builder() {
    const state = { mode: "select" as "select" | "insert", payload: null as Record<string, unknown> | null };
    const b: Record<string, unknown> = {
      select() {
        return b;
      },
      eq() {
        return b;
      },
      insert(payload: Record<string, unknown>) {
        state.mode = "insert";
        state.payload = payload;
        inserts.push(payload);
        return b;
      },
      single() {
        return Promise.resolve({
          data: { id: "cat-new", name: state.payload?.name },
          error: null,
        });
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        // Odczyt rodzeństwa: pusta lista => pozycja 0.
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      },
    };
    return b;
  }

  return { supabase: { from: () => builder() }, inserts };
}

describe("createCategoryInlineAction (uwaga #5, ADR-237)", () => {
  it("AUTH-ONLY: anonim dostaje ok:false i baza nie jest ruszana", async () => {
    requireMember.mockRejectedValue(new AuthError(401, "Zaloguj się."));

    const result = await createCategoryInlineAction("Kajaki");

    expect(result.ok).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("tworzy kategorię z NAZWY, z tenant_id z sesji i slugiem z nazwy", async () => {
    const { supabase, inserts } = categorySupabase();
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const result = await createCategoryInlineAction("Łódki i kajaki");

    expect(result.ok).toBe(true);
    expect(result.ok && result.category).toEqual({ id: "cat-new", name: "Łódki i kajaki" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.tenant_id).toBe(TENANT);
    // Slug wyprowadzony przez categorySchema (suggestCategorySlug), bez ogonków.
    expect(inserts[0]!.slug).toBe("lodki-i-kajaki");
    expect(invalidate).toHaveBeenCalledWith(TENANT);
  });

  it("pusta nazwa jest odrzucona przed dotknięciem bazy", async () => {
    const { supabase, inserts } = categorySupabase();
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const result = await createCategoryInlineAction("   ");

    expect(result.ok).toBe(false);
    expect(inserts).toEqual([]);
  });
});
