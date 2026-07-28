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

export interface OrderExtensionQuote {
  newEndDate: IsoDate;
  additionalDays: number;
  additionalRentalGrosze: number;
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
  for (const item of items) {
    additionalRentalGrosze += quoteExtension(order, newEndDate, item.params).additionalRentalGrosze;
  }

  return { newEndDate, additionalDays, additionalRentalGrosze };
}
