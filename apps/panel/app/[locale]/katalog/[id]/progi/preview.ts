/**
 * Logika podglądu wyceny dla edytora progów — czyste funkcje, bez Reacta.
 *
 * KAŻDA kwota podglądu pochodzi z calculatePrice z @avably/core — podgląd
 * nie ma własnej implementacji wyceny (przypina to test
 * tiers-preview.test.ts, porównujący wyniki z ręcznie wyliczonymi wektorami
 * ADR-018). Komponent edytora (tiers-editor.tsx) wyłącznie formatuje te
 * liczby do wyświetlenia.
 */
import { addDays, calculatePrice, type IsoDate, type PricingTier } from "@avably/core";

import { parseMultiplier } from "@/lib/money-input";

/** Data zakotwiczenia podglądu — silnik liczy DŁUGOŚCI (zakres inclusive),
 * więc dowolna stała data daje te same kwoty dla tych samych długości. */
const PREVIEW_START: IsoDate = "2026-01-01" as IsoDate;

/** Ile dób ponad najwyższy próg pokazać — żeby auto_increment było widać. */
const PREVIEW_EXTRA_DAYS = 3;
const PREVIEW_MIN_DAYS = 7;
const PREVIEW_MAX_DAYS = 60;

export interface TierRowValues {
  tierDays: string;
  multiplier: string;
  label: string;
  sortOrder: string;
}

export interface TiersPricingParams {
  basePriceDayGrosze: number;
  depositGrosze: number;
  autoIncrementMultiplier: number;
}

export interface PreviewRow {
  days: number;
  rentalGrosze: number;
  /** null = wycena po cenie bazowej (żaden próg nie sięga tej długości). */
  appliedTierDays: number | null;
}

export function parseTierDays(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days > 0 ? days : null;
}

/**
 * Wiersze edytora → progi dla silnika: tylko wiersze kompletne i poprawne;
 * duplikat tier_days pomijany (zapis i tak go odrzuci — tiersSchema).
 */
export function rowsToEngineTiers(rows: TierRowValues[]): PricingTier[] {
  const tiers: PricingTier[] = [];
  const seenDays = new Set<number>();
  for (const row of rows) {
    const tierDays = parseTierDays(row.tierDays);
    const multiplier = parseMultiplier(row.multiplier);
    if (tierDays === null || multiplier === null || seenDays.has(tierDays)) continue;
    seenDays.add(tierDays);
    tiers.push({ tierDays, multiplier });
  }
  return tiers;
}

/** Zakres podglądu: 1..(najwyższy próg + zapas na auto_increment), z limitem. */
export function previewDaysRange(tiers: PricingTier[]): number[] {
  const highest = tiers.reduce((max, tier) => Math.max(max, tier.tierDays), 0);
  const total = Math.min(
    Math.max(highest + PREVIEW_EXTRA_DAYS, PREVIEW_MIN_DAYS),
    PREVIEW_MAX_DAYS,
  );
  return Array.from({ length: total }, (_, index) => index + 1);
}

/** Tabela podglądu: cena najmu każdej długości — WYŁĄCZNIE z silnika. */
export function buildPreviewRows(
  tiers: PricingTier[],
  pricing: TiersPricingParams,
): PreviewRow[] {
  return previewDaysRange(tiers).map((days) => {
    const result = calculatePrice(PREVIEW_START, addDays(PREVIEW_START, days - 1), {
      basePriceDayGrosze: pricing.basePriceDayGrosze,
      depositGrosze: pricing.depositGrosze,
      autoIncrementMultiplier: pricing.autoIncrementMultiplier,
      tiers,
    });
    return {
      days,
      rentalGrosze: result.rentalGrosze,
      appliedTierDays: result.appliedTierDays,
    };
  });
}

/**
 * Kolumna „cena progu” przy wierszu edytora: koszt najmu o długości DOKŁADNIE
 * tier_days z samym tym progiem — czyli kwota, którą ADR-018 każe rozumieć
 * pod mnożnikiem (cena CAŁKOWITA progu). Też z silnika, nie z mnożenia w UI.
 */
export function tierPriceGrosze(
  row: Pick<TierRowValues, "tierDays" | "multiplier">,
  pricing: Pick<TiersPricingParams, "basePriceDayGrosze" | "autoIncrementMultiplier">,
): number | null {
  const tierDays = parseTierDays(row.tierDays);
  const multiplier = parseMultiplier(row.multiplier);
  if (tierDays === null || multiplier === null) return null;

  const result = calculatePrice(PREVIEW_START, addDays(PREVIEW_START, tierDays - 1), {
    basePriceDayGrosze: pricing.basePriceDayGrosze,
    depositGrosze: 0,
    autoIncrementMultiplier: pricing.autoIncrementMultiplier,
    tiers: [{ tierDays, multiplier }],
  });
  return result.rentalGrosze;
}
