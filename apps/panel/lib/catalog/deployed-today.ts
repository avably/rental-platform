/**
 * „DZIŚ W TERENIE" — JEDYNE miejsce, które definiuje tę liczbę (U8a, ADR-145).
 *
 * Pytanie operatora do katalogu brzmi „czego fizycznie NIE MA w magazynie",
 * więc definicja jest wąska i celowo NIE jest dostępnością:
 *
 *   liczba POZYCJI ZAMÓWIEŃ tego produktu, których zamówienie ma status
 *   `picked_up` i których zakres dat OBEJMUJE dzisiejszy dzień.
 *
 * Mianownikiem jest liczba egzemplarzy produktu — czytamy „3 z 6".
 *
 * Konsekwencje, które ta definicja świadomie przyjmuje:
 *
 *   * REZERWACJA NIE LICZY SIĘ. Rower zarezerwowany na jutro (`reserved`,
 *     `ready_for_pickup`) fizycznie STOI w magazynie, mimo że blokuje
 *     dostępność. Dlatego ta liczba NIE jest zamiennikiem
 *     `AVAILABILITY_BLOCKING_ORDER_STATUSES` z rdzenia — tamta lista
 *     odpowiada na pytanie „czy mogę to wynająć w terminie X", ta na
 *     pytanie „czy mam to teraz na półce". Dwie różne osie, dwie listy.
 *   * POZYCJA BEZ EGZEMPLARZA LICZY SIĘ. `order_items.unit_id` jest
 *     NULLABLE (0007: konkretną sztukę wskazuje magazyn przy wydaniu), a
 *     zamówienie w `picked_up` oznacza, że sprzęt WYJECHAŁ. Pominięcie
 *     takich pozycji zaniżałoby liczbę dokładnie w wypożyczalniach, które
 *     nie prowadzą ewidencji sztuk.
 *   * Jedna pozycja = jedna sztuka. `order_items` nie ma kolumny `quantity`
 *     (0007) — wielosztukowy najem to wiele pozycji.
 *   * Zakres dat jest INCLUSIVE z obu stron (lustro `orders_dates_ordered`
 *     i arytmetyki dób w rdzeniu): najem kończący się dziś jeszcze jest
 *     w terenie, bo zwrot zdarza się dziś.
 *
 * DLACZEGO W PAMIĘCI, A NIE W BAZIE. Reguła „liczby liczy baza"
 * (`lib/dashboard/queries.ts`, ADR-140) obowiązuje dla KPI pulpitu. Ta
 * liczba jest kolumną pomocniczą listy roboczej i nie ma migracji w tej
 * paczce (świadoma decyzja PM). Gdyby stała się KPI — miejscem zamiany
 * jest funkcja SQL w schemacie `app` (wzorem `app.dashboard_day`),
 * wołana z `lib/catalog/list-query.ts` zamiast pary „odczyt + agregat";
 * predykat niżej jest wtedy dosłownym wzorcem klauzuli WHERE.
 */
import type { OrderStatus } from "@avably/core";

/**
 * Statusy, w których sprzęt jest FIZYCZNIE poza magazynem. Osobna lista od
 * `AVAILABILITY_BLOCKING_ORDER_STATUSES` — patrz uzasadnienie w nagłówku.
 */
export const DEPLOYED_ORDER_STATUSES: readonly OrderStatus[] = ["picked_up"];

/** Kształt pozycji zamówienia potrzebny do policzenia „dziś w terenie". */
export interface DeployedItemRow {
  product_id: string;
  /** NULL = pozycja bez przypisanego egzemplarza; LICZY SIĘ (patrz nagłówek). */
  unit_id: string | null;
  orders: { start_date: string; end_date: string; order_status: string } | null;
}

/**
 * Czy ta pozycja jest dziś w terenie. `today` i daty zamówienia to łańcuchy
 * `YYYY-MM-DD` (kolumny `date`), więc porównanie leksykograficzne JEST
 * porównaniem kalendarzowym — bez konstruowania `Date` i bez strefy.
 */
export function isDeployedToday(item: DeployedItemRow, today: string): boolean {
  const order = item.orders;
  if (order === null) return false;
  if (!DEPLOYED_ORDER_STATUSES.includes(order.order_status as OrderStatus)) return false;
  return order.start_date <= today && today <= order.end_date;
}

/**
 * Agregat „dziś w terenie" per produkt. Produkt bez ani jednej pozycji w
 * terenie NIE trafia do mapy — warstwa widoku czyta go jako 0 (`?? 0`),
 * spójnie z agregatem zamówień na liście klientów.
 */
export function countDeployedToday(
  items: readonly DeployedItemRow[],
  today: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!isDeployedToday(item, today)) continue;
    counts.set(item.product_id, (counts.get(item.product_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Stan komórki „dziś w terenie" — OSOBNA oś od `availability`.
 *
 * `lib/catalog/availability-chip.ts` opisuje flagę PUBLIKACJI produktu
 * (kolumna „Status"): czy pozycja jest w sprzedaży. Ta oś mówi co innego —
 * czy sprzęt jest FIZYCZNIE poza magazynem. Zmieszanie ich dałoby w produkcie
 * dwie różne liczby pod jedną nazwą, czyli dokładnie tę pułapkę, którą dla
 * kafli pulpitu zamykał ADR-140. Stąd własna wartość `data-catalog-axis`,
 * przypięta kontraktem renderu.
 *
 *   `none`    — nic nie wyjechało (albo produkt nie ma jeszcze egzemplarzy),
 *   `partial` — część sprzętu w terenie, coś zostało na półce,
 *   `all`     — na półce NIE MA NIC (liczba w terenie ≥ liczba egzemplarzy).
 *
 * `all` obejmuje też przypadek `deployed > unitCount`: pozycje bez
 * przypisanego egzemplarza potrafią przewyższyć ewidencję sztuk i takiej
 * liczby świadomie NIE przycinamy — „5 z 3" jest sygnałem dla operatora, że
 * ewidencja egzemplarzy nie nadąża za wydaniami, a przycięcie do „3 z 3"
 * ukryłoby to.
 */
export function deploymentCellProps(
  deployedToday: number,
  unitCount: number,
): {
  "data-catalog-axis": "deployment";
  "data-catalog-value": "none" | "partial" | "all";
} {
  const value =
    deployedToday === 0 ? "none" : deployedToday >= unitCount ? "all" : "partial";
  return { "data-catalog-axis": "deployment", "data-catalog-value": value };
}
