/**
 * ODCZYT LISTY KATALOGU (U8a) — jedno miejsce, w którym powstaje zbiór
 * wierszy ekranu `/[locale]/katalog`.
 *
 * DLACZEGO NIE W `page.tsx` (jak przy klientach): sonda izolacji musi wołać
 * DOKŁADNIE TAK, JAK WOŁA PRODUKCJA. Kopia zapytania w teście broniłaby
 * kopii, nie ekranu — a zawężenie po tenancie jest tu rzeczą, której test ma
 * pilnować (patrz `test/catalog-list-isolation.test.ts`, gdzie ta funkcja
 * dostaje klienta service-role: RLS wtedy NIE zasłania błędu i widać, czy
 * zawężenie robi je samo zapytanie).
 *
 * WYSZUKIWARKA I SORT DZIAŁAJĄ NAD TĄ STRONĄ, w pamięci (wzorzec listy
 * klientów) — dlatego fraza operatora NIE JEST tu argumentem: `q` nie ma
 * czym wpłynąć na kształt zapytania ani na zawężenie po tenancie.
 *
 * Trzy odczyty jednocześnie, agregacja w pamięci, ZERO migracji (decyzja PM
 * dla U8a). Gdyby „dziś w terenie" miało stać się KPI — patrz komentarz
 * zamiany w `lib/catalog/deployed-today.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { countDeployedToday, DEPLOYED_ORDER_STATUSES, type DeployedItemRow } from "./deployed-today";
import { pickProductThumbnails, type ProductImageRow, type ProductThumbnail } from "./product-thumbnail";

/**
 * Twardy limit odczytu strony (wzorzec `CUSTOMERS_PAGE_LIMIT`). Czytamy
 * o jeden wiersz WIĘCEJ niż pokazujemy, żeby wiedzieć, czy zbiór został
 * przycięty, i powiedzieć to wprost belką „pokazujemy pierwszych N", zamiast
 * po cichu gubić produkty.
 */
export const CATALOG_PAGE_LIMIT = 100;

interface ProductQueryRow {
  id: string;
  name: string;
  base_price_day_grosze: number;
  deposit_grosze: number;
  active: boolean;
  product_units: { count: number }[];
}

export interface CatalogListRow {
  id: string;
  name: string;
  basePriceDayGrosze: number;
  depositGrosze: number;
  /** Flaga PUBLIKACJI (kolumna „Status") — oś `availability`. */
  active: boolean;
  unitCount: number;
  /** „Dziś w terenie" — oś `deployment`, patrz `deployed-today.ts`. */
  deployedToday: number;
  /** Miniatura pierwszego zdjęcia albo `null` (produkt bez zdjęcia). */
  thumbnail: ProductThumbnail | null;
}

export interface CatalogListResult {
  rows: CatalogListRow[];
  /** Czy zbiór został przycięty limitem odczytu (belka „cap"). */
  capped: boolean;
  /** Czy tenant ma W OGÓLE jakikolwiek produkt — rozstrzyga, który pusty stan. */
  hasAnyProducts: boolean;
}

export interface CatalogListOptions {
  /** „Dziś" jako `YYYY-MM-DD` w Europe/Warsaw (`lib/orders/order-dates.ts`). */
  today: string;
  /** Baza publicznych URL-i Storage (`NEXT_PUBLIC_SUPABASE_URL`). */
  supabaseUrl: string;
}

export async function fetchCatalogList(
  supabase: SupabaseClient,
  tenantId: string,
  options: CatalogListOptions,
): Promise<CatalogListResult> {
  const [{ data: productData }, { data: imageData }, { data: itemData }] = await Promise.all([
    // Kolumny i porządek jak przed U8a; doszedł wyłącznie limit strony.
    supabase
      .from("products")
      .select("id, name, base_price_day_grosze, deposit_grosze, active, product_units(count)")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .limit(CATALOG_PAGE_LIMIT + 1),
    // Zdjęcia CAŁEGO tenanta w kolejności prezentacji — miniaturą jest
    // PIERWSZY wiersz produktu. Odczyt idzie po indeksie
    // product_images_tenant_product_idx (0018); przy skali jednego najemcy
    // (setki wierszy) jest tańszy niż zapytanie zależne od listy produktów,
    // które trzeba by wykonać PO niej, tracąc równoległość.
    supabase
      .from("product_images")
      .select("product_id, storage_path, alt_text")
      .eq("tenant_id", tenantId)
      .order("product_id", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    // Pozycje zamówień, których sprzęt fizycznie wyjechał. Po statusie
    // filtruje BAZA (wąski zbiór), po dacie — predykat z `deployed-today.ts`,
    // żeby definicja „dziś w terenie" miała JEDNO miejsce, a nie połowę
    // w zapytaniu i połowę w agregacie.
    supabase
      .from("order_items")
      .select("product_id, unit_id, orders!inner(start_date, end_date, order_status)")
      .eq("tenant_id", tenantId)
      .in("orders.order_status", [...DEPLOYED_ORDER_STATUSES]),
  ]);

  const allProducts = (productData ?? []) as unknown as ProductQueryRow[];
  const capped = allProducts.length > CATALOG_PAGE_LIMIT;
  const products = capped ? allProducts.slice(0, CATALOG_PAGE_LIMIT) : allProducts;

  const thumbnails = pickProductThumbnails(
    (imageData ?? []) as unknown as ProductImageRow[],
    options.supabaseUrl,
  );
  const deployed = countDeployedToday(
    (itemData ?? []) as unknown as DeployedItemRow[],
    options.today,
  );

  return {
    rows: products.map((product) => ({
      id: product.id,
      name: product.name,
      basePriceDayGrosze: product.base_price_day_grosze,
      depositGrosze: product.deposit_grosze,
      active: product.active,
      unitCount: product.product_units[0]?.count ?? 0,
      deployedToday: deployed.get(product.id) ?? 0,
      thumbnail: thumbnails.get(product.id) ?? null,
    })),
    capped,
    hasAnyProducts: allProducts.length > 0,
  };
}
