/**
 * PRZYCHÓD ZREALIZOWANY PRODUKTU (U8b, ADR-146).
 *
 * Kontrakt jest PRZEPISANY CO DO LITERY z nagłówka migracji
 * `0054_dashboard_aggregates.sql` — dashboard i karta produktu MUSZĄ liczyć
 * przychód tak samo, inaczej operator dostaje dwie różne kwoty pod jedną
 * nazwą (pułapka, którą dla kafli pulpitu zamykał ADR-140):
 *
 *     payment_status IN ('paid','manual','completed','deposit_refunded')
 *     AND order_status <> 'cancelled'
 *
 *   * `paid` — potwierdzona wpłata online; `manual`/`completed` — ręczne
 *     oznaczenia operatora (obieg offline); `deposit_refunded` — najem
 *     rozliczony, kaucja oddana (przychód z najmu pozostał).
 *   * Wykluczone: `unpaid`/`pending`/`payment_failed` (brak wpłaty),
 *     `refunded` (pieniądze oddane), `cancelled` na OBU osiach.
 *
 * KAUCJA NIE JEST PRZYCHODEM. `order_items.deposit_grosze` nie występuje
 * w żadnej sumie tego modułu — depozyt to cudze pieniądze w depozycie, nie
 * nasz obrót. Sumujemy wyłącznie `rental_grosze` POZYCJI, a nie
 * `orders.total_rental_grosze`: karta mówi o JEDNYM produkcie, a zamówienie
 * potrafi nieść kilka różnych.
 *
 * SUMA GROSZY RÓŻNYCH WALUT NIE ISTNIEJE (ADR-103). Waluta jest własnością
 * WIERSZA zamówienia (`orders.currency`, 0049), bo ustawienie najemcy wolno
 * zmienić, a znaczenie kwot już wystawionych — nie. Dlatego wynikiem jest
 * LISTA kubełków per waluta, nigdy jedna liczba: najemca, który przeszedł
 * z PLN na EUR, zobaczy dwa wiersze, a nie zlepek bez znaczenia.
 *
 * DLACZEGO W PAMIĘCI, A NIE W BAZIE. Ta paczka jest BEZ MIGRACJI (decyzja
 * PM), więc liczby powstają w panelu z odczytu, wzorem `deployed-today.ts`.
 * Gdyby przychód produktu miał stać się KPI, miejscem zamiany jest funkcja
 * SQL w schemacie `app` (wzorem `app.dashboard_revenue` z 0054) wołana
 * z `lib/catalog/card-query.ts`; predykat niżej jest wtedy dosłownym
 * wzorcem klauzuli WHERE.
 */
import type { CurrencyCode } from "@avably/core";

import { orderCurrencyCode } from "@/lib/tenant-currency";

/**
 * Statusy płatności, w których pieniądze najemcy SĄ. Lustro listy z nagłówka
 * 0054 — zmiana tu bez zmiany tam rozjeżdża kartę z pulpitem.
 */
export const REALIZED_PAYMENT_STATUSES = [
  "paid",
  "manual",
  "completed",
  "deposit_refunded",
] as const;

/** Status zamówienia, który wyklucza przychód niezależnie od płatności. */
export const REVENUE_EXCLUDED_ORDER_STATUS = "cancelled";

/** Zamówienie w kształcie, w jakim czyta je karta (osadzone w pozycji). */
export interface RevenueOrderRow {
  payment_status: string;
  order_status: string;
  currency: string | null;
}

/** Pozycja zamówienia z dołączonym zamówieniem. */
export interface RevenueItemRow {
  rental_grosze: number;
  orders: RevenueOrderRow | null;
}

/** Przychód zrealizowany w JEDNEJ walucie — kubełek wyniku. */
export interface ProductRevenueBucket {
  currency: CurrencyCode;
  rentalGrosze: number;
  /** Ile POZYCJI złożyło się na tę kwotę (nie: ile zamówień). */
  itemCount: number;
}

/**
 * Czy pozycja tego zamówienia liczy się do przychodu zrealizowanego.
 *
 * Warunek jest KONIUNKCJĄ i obie połowy są istotne: zamówienie anulowane po
 * pobraniu wpłaty ma `payment_status` z listy wyżej, a mimo to przychodem nie
 * jest (0015 dopuszcza anulowanie z rozliczoną płatnością).
 */
export function isRealizedRevenue(order: RevenueOrderRow | null): boolean {
  if (order === null) return false;
  if (order.order_status === REVENUE_EXCLUDED_ORDER_STATUS) return false;
  return (REALIZED_PAYMENT_STATUSES as readonly string[]).includes(order.payment_status);
}

/**
 * Przychód zrealizowany produktu, GRUPOWANY PER WALUTA.
 *
 * Kolejność wyniku jest deterministyczna (malejąco po kwocie, przy remisie
 * alfabetycznie po kodzie waluty), żeby render nie zależał od kolejności
 * wierszy zwróconych przez bazę. Waluta bez ani jednej pozycji NIE tworzy
 * kubełka — produkt bez przychodu oddaje pustą listę, a nie „0 zł" w walucie,
 * której najemca nigdy nie używał.
 */
export function sumRevenueByCurrency(
  items: readonly RevenueItemRow[],
): ProductRevenueBucket[] {
  const buckets = new Map<CurrencyCode, ProductRevenueBucket>();

  for (const item of items) {
    if (!isRealizedRevenue(item.orders)) continue;
    const currency = orderCurrencyCode(item.orders!.currency);
    const bucket = buckets.get(currency) ?? { currency, rentalGrosze: 0, itemCount: 0 };
    bucket.rentalGrosze += item.rental_grosze;
    bucket.itemCount += 1;
    buckets.set(currency, bucket);
  }

  return [...buckets.values()].sort(
    (a, b) => b.rentalGrosze - a.rentalGrosze || a.currency.localeCompare(b.currency),
  );
}
