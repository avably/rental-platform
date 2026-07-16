/**
 * Wycena najmu. Czysta funkcja: przyjmuje cennik jako DANE, nie czyta go
 * z bazy — pobranie progów i kaucji należy do warstwy wywołującej.
 *
 * Kluczowa semantyka progu (kanon: migracja 0007 / ADR-018):
 * `multiplier` to CENA CAŁKOWITA progu wyrażona w krotności ceny dziennej,
 * a NIE mnożnik ceny za dobę. Przy base = 100 zł, tier_days = 7,
 * multiplier = 6.5 najem siedmiodniowy kosztuje 650 zł (a nie 4550 zł).
 * Stąd `multiplier < tier_days` to rabat za dłuższy najem — i tak właśnie
 * cennik jest pomyślany.
 *
 * Progi są jedynym mechanizmem rabatowym. Silnik źródłowy miał obok nich
 * zaszyty rabat „legacy" (sztywne -10% powyżej 7 dni), włączający się, gdy
 * progów brakowało. Nie przenosimy go świadomie: cichy rabat, którego nie
 * widać w cenniku, to cena, której najemca nie umie sobie wytłumaczyć,
 * a operator — cofnąć. Brak progów = cena bazowa razy liczba dób.
 */

import { rentalDaysInclusive, type IsoDate } from "./dates";

export interface PricingTier {
  tierDays: number;
  multiplier: number;
}

export interface PriceParams {
  basePriceDayGrosze: number;
  depositGrosze: number;
  autoIncrementMultiplier: number;
  tiers: PricingTier[];
}

export interface PriceResult {
  days: number;
  rentalGrosze: number;
  depositGrosze: number;
  totalGrosze: number;
  /** Próg użyty do wyceny; `null` = wycena po cenie bazowej za dobę. */
  appliedTierDays: number | null;
}

function assertMoney(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label}: kwota musi być całkowitą liczbą groszy >= 0, otrzymano ${value}`);
  }
}

function assertPositiveFactor(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label}: mnożnik musi być liczbą > 0, otrzymano ${value}`);
  }
}

/**
 * Cena najmu za zakres INCLUSIVE.
 *
 * Wybieramy NAJWYŻSZY próg, którego `tierDays` mieści się w długości najmu.
 * Powyżej najwyższego progu cena progu jest podstawą, a każdą dobę ponad niego
 * doliczamy przez `autoIncrementMultiplier` — inaczej najem o dzień dłuższy
 * niż ostatni próg kosztowałby tyle samo co próg, i cennik przestałby rosnąć.
 *
 * Kaucja NIE jest przychodem z najmu: trzymamy ją osobno w `depositGrosze`
 * i dodajemy dopiero do `totalGrosze`, bo podlega zwrotowi i rozlicza się
 * własną ścieżką (deposit_events).
 */
export function calculatePrice(start: IsoDate, end: IsoDate, params: PriceParams): PriceResult {
  const days = rentalDaysInclusive(start, end);

  const { basePriceDayGrosze, depositGrosze, autoIncrementMultiplier, tiers } = params;

  assertMoney(basePriceDayGrosze, "basePriceDayGrosze");
  assertMoney(depositGrosze, "depositGrosze");
  assertPositiveFactor(autoIncrementMultiplier, "autoIncrementMultiplier");

  for (const tier of tiers) {
    if (!Number.isInteger(tier.tierDays) || tier.tierDays <= 0) {
      throw new RangeError(`tierDays: próg musi być całkowitą liczbą dób > 0, otrzymano ${tier.tierDays}`);
    }
    assertPositiveFactor(tier.multiplier, "tier.multiplier");
  }

  const sortedTiers = [...tiers].sort((a, b) => a.tierDays - b.tierDays);

  let matchedTier: PricingTier | null = null;
  for (const tier of sortedTiers) {
    if (tier.tierDays <= days) matchedTier = tier;
    else break;
  }

  // Najem krótszy niż najniższy próg (albo cennik bez progów): cena bazowa.
  if (!matchedTier) {
    const rentalGrosze = basePriceDayGrosze * days;
    return {
      days,
      rentalGrosze,
      depositGrosze,
      totalGrosze: rentalGrosze + depositGrosze,
      appliedTierDays: null,
    };
  }

  // Doby ekstra dolicza WYŁĄCZNIE najwyższy próg. Najem między progami płaci
  // cenę progu niższego: przy progach 3 i 7 najem pięciodniowy kosztuje tyle
  // co trzydniowy. To nie przeoczenie, tylko sens progu — cennik jest schodkiem,
  // a operator, który chce naliczać dobę czwartą i piątą, dostawia próg.
  // Auto-increment jest domknięciem cennika PO ostatnim schodku, żeby najem
  // dłuższy od najwyższego progu nie kosztował tyle samo co ten próg.
  const highestTier = sortedTiers[sortedTiers.length - 1]!;
  const extraDays = days > highestTier.tierDays ? days - highestTier.tierDays : 0;

  const tierGrosze = Math.round(basePriceDayGrosze * matchedTier.multiplier);
  const extraGrosze =
    extraDays > 0 ? Math.round(basePriceDayGrosze * autoIncrementMultiplier * extraDays) : 0;
  const rentalGrosze = tierGrosze + extraGrosze;

  return {
    days,
    rentalGrosze,
    depositGrosze,
    totalGrosze: rentalGrosze + depositGrosze,
    appliedTierDays: matchedTier.tierDays,
  };
}
