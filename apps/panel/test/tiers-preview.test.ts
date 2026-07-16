/**
 * Podgląd wyceny w edytorze progów MUSI być tożsamy z silnikiem — nie może
 * mieć własnej implementacji wyceny.
 *
 * Dowód w dwóch warstwach:
 *   1. wektory RĘCZNIE przypięte (kanon ADR-018 / pricing.test.ts w @avably/core):
 *      gdyby buildPreviewRows liczył cokolwiek samodzielnie (np. mnożnik jako
 *      dzienny — pomyłka ~7×), te asercje płoną niezależnie od silnika,
 *   2. równość z calculatePrice dla każdej długości zakresu podglądu — gdyby
 *      podgląd rozjechał się z silnikiem w JAKIMKOLWIEK punkcie.
 */
import { addDays, calculatePrice, type IsoDate } from "@avably/core";
import { describe, expect, it } from "vitest";

import {
  buildPreviewRows,
  previewDaysRange,
  rowsToEngineTiers,
  tierPriceGrosze,
  type TierRowValues,
} from "@/app/[locale]/katalog/[id]/progi/preview";

/** Cennik odniesienia jak w pricing.test.ts: baza 100 zł, progi 3 i 7 dni. */
const pricing = {
  basePriceDayGrosze: 10_000,
  depositGrosze: 0,
  autoIncrementMultiplier: 1.0,
};

const row = (tierDays: string, multiplier: string): TierRowValues => ({
  tierDays,
  multiplier,
  label: "",
  sortOrder: "0",
});

const referenceRows = [row("3", "2,8"), row("7", "6.5")];

describe("podgląd wyceny — wektory przypięte ręcznie (ADR-018)", () => {
  it("tabela 1..10 dni dla progów 3×2.8 i 7×6.5 przy bazie 100 zł", () => {
    const tiers = rowsToEngineTiers(referenceRows);
    const preview = buildPreviewRows(tiers, pricing);

    const byDays = new Map(preview.map((row) => [row.days, row]));
    // Ręcznie z definicji progu (cena CAŁKOWITA progu, między progami cena
    // progu niższego, ponad najwyższym auto_increment × baza za dobę):
    const expected: [number, number, number | null][] = [
      [1, 10_000, null],
      [2, 20_000, null],
      [3, 28_000, 3],
      [4, 28_000, 3],
      [5, 28_000, 3],
      [6, 28_000, 3],
      [7, 65_000, 7],
      [8, 75_000, 7],
      [9, 85_000, 7],
      [10, 95_000, 7],
    ];
    for (const [days, rentalGrosze, appliedTierDays] of expected) {
      expect(byDays.get(days), `dzień ${days}`).toEqual({ days, rentalGrosze, appliedTierDays });
    }
  });

  it("mnożnik NIE jest dzienny: 7 dni to 65 000 gr, nie 455 000 gr", () => {
    const preview = buildPreviewRows(rowsToEngineTiers(referenceRows), pricing);
    const day7 = preview.find((row) => row.days === 7)!;
    expect(day7.rentalGrosze).toBe(65_000);
    expect(day7.rentalGrosze).not.toBe(455_000);
  });

  it("kolumna „cena progu” = cena całkowita progu z silnika", () => {
    expect(tierPriceGrosze(row("7", "6,5"), pricing)).toBe(65_000);
    expect(tierPriceGrosze(row("3", "2.8"), pricing)).toBe(28_000);
    // Wiersz niekompletny nie udaje kwoty.
    expect(tierPriceGrosze(row("", "6,5"), pricing)).toBeNull();
    expect(tierPriceGrosze(row("7", "0"), pricing)).toBeNull();
  });

  it("bez progów: cena bazowa × doby (zero cichych rabatów)", () => {
    const preview = buildPreviewRows([], pricing);
    for (const { days, rentalGrosze, appliedTierDays } of preview) {
      expect(rentalGrosze).toBe(10_000 * days);
      expect(appliedTierDays).toBeNull();
    }
  });
});

describe("podgląd wyceny — równość z calculatePrice punkt po punkcie", () => {
  it("każdy wiersz podglądu = wynik silnika dla tej samej długości", () => {
    const tiers = rowsToEngineTiers(referenceRows);
    const preview = buildPreviewRows(tiers, {
      ...pricing,
      depositGrosze: 5_000,
      autoIncrementMultiplier: 0.5,
    });

    const start: IsoDate = "2026-01-01" as IsoDate;
    for (const previewRow of preview) {
      const engine = calculatePrice(start, addDays(start, previewRow.days - 1), {
        basePriceDayGrosze: pricing.basePriceDayGrosze,
        depositGrosze: 5_000,
        autoIncrementMultiplier: 0.5,
        tiers,
      });
      expect(previewRow.rentalGrosze).toBe(engine.rentalGrosze);
      expect(previewRow.appliedTierDays).toBe(engine.appliedTierDays);
    }
  });

  it("zakres podglądu obejmuje 1..(najwyższy próg + zapas) — auto_increment jest widoczny", () => {
    const tiers = rowsToEngineTiers(referenceRows);
    const range = previewDaysRange(tiers);
    expect(range[0]).toBe(1);
    expect(range.at(-1)!).toBeGreaterThan(7);
    // Bez progów podgląd i tak pokazuje sensowny tydzień.
    expect(previewDaysRange([]).length).toBeGreaterThanOrEqual(7);
  });
});

describe("wiersze edytora → progi silnika", () => {
  it("wiersze niekompletne/błędne i duplikaty dni są pomijane", () => {
    expect(
      rowsToEngineTiers([
        row("3", "2,8"),
        row("", "5"),
        row("abc", "5"),
        row("7", ""),
        row("3", "9"),
      ]),
    ).toEqual([{ tierDays: 3, multiplier: 2.8 }]);
  });
});
