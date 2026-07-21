/**
 * Wycena, przypisanie egzemplarzy i kalendarz zamówień. JEDYNE miejsce,
 * w którym panel woła silnik dla zamówień — komponenty i akcje konsumują
 * wyniki tego modułu i nie mają prawa liczyć niczego same (ADR-018/ADR-022;
 * tożsamość z silnikiem przypina test order-pricing.test.ts, wzorzec
 * tiers-preview.test.ts).
 *
 * Suma pozycji zamówienia (total_*_grosze) mieszka TUTAJ, nie w UI:
 * silnik wycenia jedną pozycję, a jedynym legalnym działaniem na jego
 * wynikach jest dodawanie pozycji do siebie — w jednym, testowanym miejscu.
 */
import {
  addDays,
  calculatePrice,
  checkAvailability,
  type AvailabilityParams,
  type AvailabilityResult,
  type BookedRange,
  type IsoDate,
  type UnitServiceWindow,
} from "@avably/core";

/** Wiersz produktu z autorytatywnego odczytu cennika (kolumny 0007). */
export interface ProductPricingRow {
  id: string;
  base_price_day_grosze: number;
  deposit_grosze: number;
  auto_increment_multiplier: number;
  buffer_before_days: number;
  buffer_after_days: number;
  pricing_tiers: { tier_days: number; multiplier: number }[];
}

export interface PricedItem {
  productId: string;
  rentalGrosze: number;
  depositGrosze: number;
}

export interface OrderPricing {
  items: PricedItem[];
  totalRentalGrosze: number;
  totalDepositGrosze: number;
  days: number;
}

/**
 * Wycena pozycji zamówienia: każda pozycja to jedna sztuka produktu na cały
 * termin, wyceniana calculatePrice na cenniku SWOJEGO produktu.
 */
export function priceOrderItems(
  productIds: string[],
  products: Map<string, ProductPricingRow>,
  start: IsoDate,
  end: IsoDate,
): OrderPricing {
  const items: PricedItem[] = [];
  let days = 0;

  for (const productId of productIds) {
    const product = products.get(productId);
    if (!product) {
      // Głośny błąd zamiast pozycji za zero: brak produktu w mapie to błąd
      // odczytu (albo produkt usunięty w międzyczasie), nie darmowy najem.
      throw new Error(`Brak cennika produktu ${productId} — pozycja nie może zostać wyceniona.`);
    }

    const result = calculatePrice(start, end, {
      basePriceDayGrosze: product.base_price_day_grosze,
      depositGrosze: product.deposit_grosze,
      autoIncrementMultiplier: Number(product.auto_increment_multiplier),
      tiers: product.pricing_tiers.map((tier) => ({
        tierDays: tier.tier_days,
        multiplier: Number(tier.multiplier),
      })),
    });

    days = result.days;
    items.push({
      productId,
      rentalGrosze: result.rentalGrosze,
      depositGrosze: result.depositGrosze,
    });
  }

  return {
    items,
    totalRentalGrosze: items.reduce((sum, item) => sum + item.rentalGrosze, 0),
    totalDepositGrosze: items.reduce((sum, item) => sum + item.depositGrosze, 0),
    days,
  };
}

/**
 * Przypisanie egzemplarzy do pozycji: pierwsze wolne w kolejności podanej
 * przez wywołującego (zapytanie panelu sortuje po created_at — stabilnie).
 * To jest decyzja BIZNESOWA warstwy zamówień (silnik celowo jej nie
 * podejmuje — patrz komentarz w availability.ts); strategia najprostsza
 * z możliwych, rotacja/lokalizacja to przyszły pas.
 *
 * `null` = zabrakło egzemplarzy — nigdy częściowe przypisanie.
 */
export function pickUnits(
  productIds: string[],
  availableUnitIdsByProduct: Map<string, readonly string[]>,
): string[] | null {
  const cursor = new Map<string, number>();
  const assigned: string[] = [];

  for (const productId of productIds) {
    const pool = availableUnitIdsByProduct.get(productId);
    const index = cursor.get(productId) ?? 0;
    if (!pool || index >= pool.length) return null;
    assigned.push(pool[index]!);
    cursor.set(productId, index + 1);
  }

  return assigned;
}

export interface DayAvailability {
  day: IsoDate;
  available: boolean;
}

/**
 * Mapa dostępności dzień po dniu dla kalendarza: dzień jest zajęty, gdy
 * silnik nie znajduje ani jednego egzemplarza dla najmu jednodniowego
 * w tym dniu. Bufory są w mapie widoczne jako zajętość DLATEGO, że tak
 * mówi silnik — komponent kalendarza nie liczy żadnych dat sam.
 */
export function buildDayMap(
  units: UnitServiceWindow[],
  booked: BookedRange[],
  params: AvailabilityParams,
  fromDay: IsoDate,
  days: number,
): DayAvailability[] {
  const map: DayAvailability[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = addDays(fromDay, i);
    map.push({
      day,
      available: checkAvailability(units, booked, { start: day, end: day }, params).available,
    });
  }
  return map;
}

/** Dostępność żądanego terminu — cienka owijka silnika (jedno wejście modułu). */
export function availabilityForRange(
  units: UnitServiceWindow[],
  booked: BookedRange[],
  start: IsoDate,
  end: IsoDate,
  params: AvailabilityParams,
): AvailabilityResult {
  return checkAvailability(units, booked, { start, end }, params);
}
