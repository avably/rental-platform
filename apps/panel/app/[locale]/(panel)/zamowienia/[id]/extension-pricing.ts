/**
 * Dopłata przedłużenia dla CAŁEGO zamówienia. Silnik (quoteExtension)
 * wycenia jeden produkt — sumowanie pozycji to praca panelu, w jednym,
 * testowanym miejscu (wzorzec zamowienia/pricing.ts: jedynym legalnym
 * działaniem na wynikach silnika jest dodawanie pozycji do siebie).
 *
 * Moduł jest czysty (zero I/O) — używa go i akcja serwerowa (autorytatywny
 * re-odczyt cennika), i formularz kliencki (podgląd na żywo z tych samych
 * parametrów), więc podgląd i zapis nie mają jak się rozjechać.
 */
import {
  AVAILABILITY_BLOCKING_ORDER_STATUSES,
  quoteExtension,
  type IsoDate,
  type OrderStatus,
  type PriceParams,
} from "@avably/core";

/**
 * Czy zamówienie w danym statusie wolno przedłużyć: tylko statusy, w których
 * bramka 0010 pilnuje dat (AVAILABILITY_BLOCKING). Statusy terminalne
 * (zwrócone, anulowane) nie pokazują wejścia w przedłużenie — nie ma to sensu
 * operacyjnego (ADR-028), a akcja i tak by odmówiła (filtr `.in()` w mutacji).
 *
 * Mieszka w tym czystym module (a nie w RSC `extension-section.tsx`, który
 * importuje `next/headers` przez guard sesji), żeby reguła miała BEZPOŚREDNI
 * dowód w teście, bez uruchamiania całego grafu serwerowego.
 */
export function canExtendOrder(status: OrderStatus): boolean {
  return AVAILABILITY_BLOCKING_ORDER_STATUSES.includes(status);
}

/** Wiersz produktu z odczytu PostgREST — numeric przychodzi jako string. */
export interface ExtensionProductRow {
  base_price_day_grosze: number;
  deposit_grosze: number;
  auto_increment_multiplier: number | string;
  pricing_tiers: { tier_days: number; multiplier: number | string }[];
}

export function priceParamsFromRow(row: ExtensionProductRow): PriceParams {
  return {
    basePriceDayGrosze: row.base_price_day_grosze,
    depositGrosze: row.deposit_grosze,
    autoIncrementMultiplier: Number(row.auto_increment_multiplier),
    tiers: row.pricing_tiers.map((tier) => ({
      tierDays: tier.tier_days,
      multiplier: Number(tier.multiplier),
    })),
  };
}

export interface ExtensionItemPricing {
  itemId: string;
  params: PriceParams;
}

/** Dopłata przedłużenia dla POJEDYNCZEJ pozycji — dokładna liczba z silnika. */
export interface ExtensionItemSurcharge {
  itemId: string;
  additionalRentalGrosze: number;
}

export interface OrderExtensionQuote {
  newEndDate: IsoDate;
  additionalDays: number;
  additionalRentalGrosze: number;
  /**
   * Rozbicie dopłaty NA POZYCJE. Każda kwota to WPROST wynik silnika dla tej
   * pozycji — `additionalRentalGrosze` jest ich sumą CO DO GROSZA (nie proporcja
   * ani rozsmarowanie z zaokrągleniami): akcja dopisuje te liczby do pozycji, więc
   * sumy zamówienia i pozycji nie mają jak się rozjechać. Pozycje bez cennika
   * (produkt wygaszony twardo) nie trafiają na wejście i nie ma ich tutaj — nie
   * uczestniczą w wycenie i nie dostają dopłaty.
   */
  items: ExtensionItemSurcharge[];
}

export function quoteOrderExtension(
  order: { startDate: IsoDate; endDate: IsoDate },
  newEndDate: IsoDate,
  items: ExtensionItemPricing[],
): OrderExtensionQuote {
  // additionalDays nie zależy od cennika — liczymy raz, na pustym cenniku,
  // żeby zamówienie bez pozycji też dostało poprawną liczbę dni (i jawny
  // błąd silnika przy skróceniu terminu).
  const { additionalDays } = quoteExtension(order, newEndDate, {
    basePriceDayGrosze: 0,
    depositGrosze: 0,
    autoIncrementMultiplier: 1,
    tiers: [],
  });

  let additionalRentalGrosze = 0;
  const itemSurcharges: ExtensionItemSurcharge[] = [];
  for (const item of items) {
    const itemAdditional = quoteExtension(order, newEndDate, item.params).additionalRentalGrosze;
    additionalRentalGrosze += itemAdditional;
    itemSurcharges.push({ itemId: item.itemId, additionalRentalGrosze: itemAdditional });
  }

  return { newEndDate, additionalDays, additionalRentalGrosze, items: itemSurcharges };
}

/** Absolutna nowa kwota najmu jednej pozycji do zapisania. */
export interface ExtensionItemRentalUpdate {
  itemId: string;
  rentalGrosze: number;
}

/**
 * Nowe (absolutne) kwoty najmu pozycji po doliczeniu dopłat przedłużenia.
 * `currentRentalById` to BIEŻĄCE kwoty z bazy (mogą być ręcznie skorygowane),
 * `surcharges` to `quote.items` z `quoteOrderExtension` — dokładne liczby
 * silnika. Zwraca tylko pozycje ZE ZMIANĄ (dopłata != 0; zero-dopłata nie
 * potrzebuje zapisu ani nie tworzy rozjazdu) oraz `hasNegative`: czy któraś
 * zeszłaby poniżej zera (lustro CHECK `rental_grosze >= 0` — ręczny rabat
 * pozycji plus ujemna dopłata przy zejściu w tańszy próg). PostgREST nie
 * potrafi `x = x + n`, więc absolut liczymy tutaj, na odczytanej kwocie.
 */
export function extensionItemRentals(
  currentRentalById: Map<string, number>,
  surcharges: readonly ExtensionItemSurcharge[],
): { updates: ExtensionItemRentalUpdate[]; hasNegative: boolean } {
  const updates: ExtensionItemRentalUpdate[] = [];
  let hasNegative = false;
  for (const surcharge of surcharges) {
    if (surcharge.additionalRentalGrosze === 0) continue;
    const current = currentRentalById.get(surcharge.itemId);
    if (current === undefined) continue; // pozycja zniknęła między odczytem a wyceną
    const next = current + surcharge.additionalRentalGrosze;
    if (next < 0) hasNegative = true;
    updates.push({ itemId: surcharge.itemId, rentalGrosze: next });
  }
  return { updates, hasNegative };
}
