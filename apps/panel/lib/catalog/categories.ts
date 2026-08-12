/**
 * Odczyt i zapis taksonomii katalogu (ADR-155) — JEDYNE miejsce z zapytaniami
 * o `catalog_categories` i `product_categories` (wzorzec `lib/catalog/list-query.ts`).
 *
 * Sonda izolacji woła te same funkcje, które woła ekran — dzięki temu broni
 * produkcji, a nie własnej kopii zapytania. Bramką pozostaje RLS (0072):
 * filtr `tenant_id` jest tu drugą warstwą, nie jedyną.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  /** Liczba produktów przypiętych do kategorii — kolumna „Produkty" na liście. */
  productCount: number;
}

/**
 * Kategorie najemcy w kolejności prezentacji, z licznikiem produktów.
 *
 * Licznik idzie OSOBNYM odczytem przypisań, a nie agregatem PostgREST: `count`
 * w zagnieżdżonym zasobie wymaga relacji, którą PostgREST wykrywa po kluczu
 * obcym — a nasz jest ZŁOŻONY (tenant_id, category_id) i nie da się go wskazać
 * jednoznacznie. Dwa zapytania są tu tańsze niż widok pod jedną kolumnę.
 */
export async function fetchCategories(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<CategoryRow[]> {
  const { data: categories, error } = await supabase
    .from("catalog_categories")
    .select("id, name, slug, description, position")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`Odczyt kategorii nie powiódł się (${error.code ?? error.message}).`);

  const { data: links, error: linksError } = await supabase
    .from("product_categories")
    .select("category_id")
    .eq("tenant_id", tenantId);
  // BŁĄD ODCZYTU ≠ ZERO PRODUKTÓW. Cicha zamiana awarii na „0" kazałaby
  // właścicielowi skasować kategorię, która wygląda na pustą, a pusta nie jest.
  if (linksError) {
    throw new Error(`Odczyt przypisań kategorii nie powiódł się (${linksError.code ?? linksError.message}).`);
  }

  const counts = new Map<string, number>();
  for (const link of links ?? []) {
    const id = link.category_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (categories ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    description: (row.description as string | null) ?? null,
    position: row.position as number,
    productCount: counts.get(row.id as string) ?? 0,
  }));
}

/** Identyfikatory kategorii przypiętych do produktu (zaznaczenia formularza). */
export async function fetchProductCategoryIds(
  supabase: SupabaseClient,
  tenantId: string,
  productId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("product_categories")
    .select("category_id")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId);
  if (error) {
    throw new Error(`Odczyt kategorii produktu nie powiódł się (${error.code ?? error.message}).`);
  }
  return (data ?? []).map((row) => row.category_id as string);
}

/**
 * Doprowadza przypisania produktu do stanu z formularza: dokłada brakujące,
 * zdejmuje zdjęte, NIE RUSZA niezmienionych.
 *
 * DLACZEGO RÓŻNICA, A NIE „skasuj wszystko i wstaw od nowa": pełna wymiana
 * przy zapisie, który niczego w kategoriach nie zmienił, i tak przepisywałaby
 * wiersze — a każdy taki zapis to okno, w którym równoległa strona kategorii
 * widzi produkt zniknięty z oferty. Różnica nie ma tego okna.
 *
 * Zwraca komunikat błędu albo `null`. Sygnatura zamiast wyjątku, bo wołający
 * (akcja formularza) i tak musi zamienić odmowę na `FormState`.
 */
export async function syncProductCategories(
  supabase: SupabaseClient,
  tenantId: string,
  productId: string,
  categoryIds: readonly string[],
): Promise<string | null> {
  let current: string[];
  try {
    current = await fetchProductCategoryIds(supabase, tenantId, productId);
  } catch (err) {
    return err instanceof Error ? err.message : "Odczyt kategorii produktu nie powiódł się.";
  }

  const wanted = new Set(categoryIds);
  const existing = new Set(current);

  const toAdd = [...wanted].filter((id) => !existing.has(id));
  const toRemove = current.filter((id) => !wanted.has(id));

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("product_categories")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .in("category_id", toRemove);
    if (error) return error.message;
  }

  if (toAdd.length > 0) {
    const { error } = await supabase.from("product_categories").insert(
      toAdd.map((categoryId) => ({
        tenant_id: tenantId,
        product_id: productId,
        category_id: categoryId,
      })),
    );
    // Kategoria spoza katalogu najemcy odbija się tu kluczem obcym (23503),
    // a nie cichym pominięciem — podmieniona wartość pola formularza NIE
    // przechodzi, mimo że przeszła walidację UUID.
    if (error) return error.message;
  }

  return null;
}
