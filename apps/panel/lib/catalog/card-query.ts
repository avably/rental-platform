/**
 * ODCZYT KARTY PRODUKTU (U8b, ADR-146) — jedno miejsce, w którym powstaje
 * stan rzeczy pokazywany na `/[locale]/katalog/[id]` i na jego zakładce
 * „Egzemplarze".
 *
 * DLACZEGO NIE W `page.tsx` (jak przy klientach): sonda izolacji musi wołać
 * DOKŁADNIE TAK, JAK WOŁA PRODUKCJA. Kopia zapytania w teście broniłaby
 * kopii, nie ekranu — a zawężenie po tenancie jest tu rzeczą, której test ma
 * pilnować (`test/catalog-card-isolation.test.ts` podaje tym funkcjom klienta
 * SERVICE-ROLE: RLS wtedy NIE zasłania błędu i widać, czy zawężenie robi je
 * samo zapytanie). Ten sam wzorzec, co `lib/catalog/list-query.ts` w U8a.
 *
 * JEDEN ODCZYT POZYCJI NA CZTERY POTRZEBY. `order_items` produktu czytamy
 * RAZ i z tego samego zbioru powstają: dostępność („X z N w terenie"), stan
 * każdego egzemplarza (na którym zamówieniu wisi i kiedy wraca), historia
 * najmów oraz przychód. Drugi odczyt pod którąkolwiek z tych liczb byłby
 * drugą definicją — dokładnie tym, czego zabrania ADR-140.
 *
 * DEFINICJE SĄ CUDZE, NIE NASZE. „Dziś w terenie" liczy `deployed-today.ts`
 * (U8a), miniaturę składa `product-thumbnail.ts` (U8a), przychód —
 * `product-revenue.ts` (lustro 0054). Ten moduł wyłącznie ZBIERA dane
 * i podaje je tym helperom.
 *
 * BEZ MIGRACJI (decyzja PM dla U8): wszystko liczone w panelu.
 */
import type { OrderStatus } from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import { orderCurrencyCode } from "@/lib/tenant-currency";
import type { CurrencyCode } from "@avably/core";

import { countDeployedToday, isDeployedToday, type DeployedItemRow } from "./deployed-today";
import {
  pickProductThumbnails,
  type ProductImageRow,
  type ProductThumbnail,
} from "./product-thumbnail";
import { sumRevenueByCurrency, type ProductRevenueBucket } from "./product-revenue";

/**
 * Skrócona historia: tyle najświeższych najmów pokazuje karta. Wzorzec
 * `HISTORY_LIMIT` z karty klienta (`klienci/[id]/page.tsx`).
 */
export const PRODUCT_HISTORY_LIMIT = 50;

/**
 * Twardy limit ODCZYTU pozycji zamówień produktu.
 *
 * Historia pokazuje 50 wierszy, ale przychód i „dziś w terenie" liczą się
 * z CAŁEGO odczytanego zbioru — dlatego czytamy znacznie więcej, niż
 * wyświetlamy. Limit i tak musi istnieć (bez niego karta produktu z tysiącami
 * najmów ciągnęłaby całą tabelę), a jego przekroczenie NIE JEST ciche:
 * `capped` zapala na karcie zdanie mówiące, że liczby obejmują ostatnie N
 * najmów. Milcząca suma po przyciętym zbiorze byłaby kwotą nieprawdziwą,
 * a nie „w przybliżeniu prawdziwą".
 */
export const PRODUCT_ITEMS_LIMIT = 500;

/** Pozycja zamówienia w kształcie, w jakim czyta ją karta. */
interface CardItemQueryRow {
  product_id: string;
  unit_id: string | null;
  rental_grosze: number;
  orders: {
    id: string;
    order_number: string;
    start_date: string;
    end_date: string;
    order_status: string;
    payment_status: string;
    currency: string | null;
  } | null;
}

interface UnitQueryRow {
  id: string;
  serial_number: string | null;
  unavailable_from: string | null;
  unavailable_to: string | null;
  unavailable_reason: string | null;
}

/** Zamówienie, na którym egzemplarz jest DZIŚ w terenie. */
export interface UnitDeployment {
  orderId: string;
  orderNumber: string;
  /** Data zwrotu = koniec najmu (zakres inclusive). */
  endDate: string;
}

export interface ProductUnitRow {
  id: string;
  serialNumber: string;
  unavailableFrom: string;
  unavailableTo: string;
  unavailableReason: string;
  /** `null` = egzemplarz jest na półce (albo wydany bez wskazania sztuki). */
  deployment: UnitDeployment | null;
}

export interface ProductHistoryRow {
  /** Klucz wiersza: POZYCJA, nie zamówienie — jedno zamówienie może mieć kilka. */
  itemKey: string;
  orderId: string;
  orderNumber: string;
  startDate: string;
  endDate: string;
  rentalGrosze: number;
  /** Waluta ZAMÓWIENIA (0049/ADR-103), nie ustawienia najemcy. */
  currency: CurrencyCode;
  orderStatus: OrderStatus;
}

export interface ProductUnitsResult {
  units: ProductUnitRow[];
  unitCount: number;
  deployedToday: number;
  /** Odczyt pozycji dosięgnął limitu — patrz `PRODUCT_ITEMS_LIMIT`. */
  capped: boolean;
}

export interface ProductCardResult extends ProductUnitsResult {
  thumbnail: ProductThumbnail | null;
  history: ProductHistoryRow[];
  /** Ile najmów W ODCZYTANYM ZBIORZE (historia pokazuje pierwsze 50). */
  historyCount: number;
  revenue: ProductRevenueBucket[];
}

export interface ProductCardOptions {
  /** „Dziś" jako `YYYY-MM-DD` w Europe/Warsaw (`lib/orders/order-dates.ts`). */
  today: string;
  /** Baza publicznych URL-i Storage (`NEXT_PUBLIC_SUPABASE_URL`). */
  supabaseUrl: string;
}

/**
 * Pozycje zamówień JEDNEGO produktu, najświeższe pierwsze.
 *
 * ZAWĘŻENIE PO TENANCIE JEST W ZAPYTANIU, nie tylko w RLS. `orders!inner`
 * dokłada zamówienie jako warunek istnienia (pozycja bez zamówienia nie
 * istnieje w schemacie, ale `!inner` czyni to jawnym dla PostgREST i pozwala
 * czytać kolumny zamówienia bez drugiego zapytania).
 */
async function fetchProductItems(
  supabase: SupabaseClient,
  tenantId: string,
  productId: string,
): Promise<{ items: CardItemQueryRow[]; capped: boolean }> {
  const { data } = await supabase
    .from("order_items")
    .select(
      "product_id, unit_id, rental_grosze, orders!inner(id, order_number, start_date, end_date, order_status, payment_status, currency)",
    )
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(PRODUCT_ITEMS_LIMIT + 1);

  const all = (data ?? []) as unknown as CardItemQueryRow[];
  const capped = all.length > PRODUCT_ITEMS_LIMIT;
  return { items: capped ? all.slice(0, PRODUCT_ITEMS_LIMIT) : all, capped };
}

/**
 * Egzemplarze + ich stan, złożone z odczytanych pozycji.
 *
 * Egzemplarz uznajemy za „w terenie" tym samym predykatem, którym liczy się
 * kolumna listy katalogu (`isDeployedToday`) — kolumna stanu i liczba
 * „X z N" nie mogą się rozjechać, bo stoją obok siebie na jednym ekranie.
 */
function buildUnitRows(
  units: readonly UnitQueryRow[],
  items: readonly CardItemQueryRow[],
  today: string,
): ProductUnitRow[] {
  const deployments = new Map<string, UnitDeployment>();
  for (const item of items) {
    if (item.unit_id === null) continue;
    if (!isDeployedToday(item as DeployedItemRow, today)) continue;
    // Pierwszy napotkany wygrywa — pozycje przychodzą najświeższe pierwsze.
    if (deployments.has(item.unit_id)) continue;
    deployments.set(item.unit_id, {
      orderId: item.orders!.id,
      orderNumber: item.orders!.order_number,
      endDate: item.orders!.end_date,
    });
  }

  return units.map((unit) => ({
    id: unit.id,
    serialNumber: unit.serial_number ?? "",
    unavailableFrom: unit.unavailable_from ?? "",
    unavailableTo: unit.unavailable_to ?? "",
    unavailableReason: unit.unavailable_reason ?? "",
    deployment: deployments.get(unit.id) ?? null,
  }));
}

/**
 * Egzemplarze produktu ze stanem — zakładka „Egzemplarze".
 *
 * Zakładka nie potrzebuje ani miniatury, ani przychodu, więc ich nie czyta;
 * DEFINICJE dzieli z kartą co do funkcji (`buildUnitRows`, `countDeployedToday`),
 * a nie co do kopii.
 */
export async function fetchProductUnits(
  supabase: SupabaseClient,
  tenantId: string,
  productId: string,
  options: Pick<ProductCardOptions, "today">,
): Promise<ProductUnitsResult> {
  const [{ data: unitData }, { items, capped }] = await Promise.all([
    supabase
      .from("product_units")
      .select("id, serial_number, unavailable_from, unavailable_to, unavailable_reason")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .order("created_at", { ascending: true }),
    fetchProductItems(supabase, tenantId, productId),
  ]);

  const units = (unitData ?? []) as unknown as UnitQueryRow[];

  return {
    units: buildUnitRows(units, items, options.today),
    unitCount: units.length,
    deployedToday: countDeployedToday(items as unknown as DeployedItemRow[], options.today).get(
      productId,
    ) ?? 0,
    capped,
  };
}

/**
 * Pełny stan karty produktu: zdjęcie, dostępność, egzemplarze, historia,
 * przychód. Trzy odczyty równolegle, agregacja w pamięci.
 */
export async function fetchProductCard(
  supabase: SupabaseClient,
  tenantId: string,
  productId: string,
  options: ProductCardOptions,
): Promise<ProductCardResult> {
  const [{ data: imageData }, { data: unitData }, { items, capped }] = await Promise.all([
    // Miniatura = PIERWSZE zdjęcie w kolejności prezentacji (sort_order,
    // potem created_at) — ta sama kolejność, co na liście katalogu i w
    // sklepie. `limit(1)` wystarcza, bo `pickProductThumbnails` bierze
    // pierwszy wiersz produktu.
    supabase
      .from("product_images")
      .select("product_id, storage_path, alt_text")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1),
    supabase
      .from("product_units")
      .select("id, serial_number, unavailable_from, unavailable_to, unavailable_reason")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .order("created_at", { ascending: true }),
    fetchProductItems(supabase, tenantId, productId),
  ]);

  const units = (unitData ?? []) as unknown as UnitQueryRow[];

  const history: ProductHistoryRow[] = items
    .slice(0, PRODUCT_HISTORY_LIMIT)
    .map((item, index) => ({
      itemKey: `${item.orders!.id}:${index}`,
      orderId: item.orders!.id,
      orderNumber: item.orders!.order_number,
      startDate: item.orders!.start_date,
      endDate: item.orders!.end_date,
      rentalGrosze: item.rental_grosze,
      currency: orderCurrencyCode(item.orders!.currency),
      orderStatus: item.orders!.order_status as OrderStatus,
    }));

  return {
    thumbnail:
      pickProductThumbnails(
        (imageData ?? []) as unknown as ProductImageRow[],
        options.supabaseUrl,
      ).get(productId) ?? null,
    units: buildUnitRows(units, items, options.today),
    unitCount: units.length,
    deployedToday: countDeployedToday(items as unknown as DeployedItemRow[], options.today).get(
      productId,
    ) ?? 0,
    history,
    historyCount: items.length,
    revenue: sumRevenueByCurrency(items),
    capped,
  };
}
