/**
 * Wycena przedłużenia (Zadanie 6). Sedno semantyki: dopłata to różnica
 * wyceny CAŁEGO nowego okresu i całego dotychczasowego — progi liczą się
 * od całości, nie „cena dodatkowych dni osobno". Wektor kanoniczny z planu
 * fazy: 5 dni → przedłużenie do 8 przy progu 7 przelicza całość po progu.
 */
import { describe, expect, it } from "vitest";

import { quoteExtension } from "./extension";
import type { PriceParams } from "./pricing";

/** Cennik jak w testach zamówień: baza 100 zł/doba, próg 7 dni za 6.5×. */
const PARAMS: PriceParams = {
  basePriceDayGrosze: 10_000,
  depositGrosze: 5_000,
  autoIncrementMultiplier: 1.0,
  tiers: [{ tierDays: 7, multiplier: 6.5 }],
};

describe("quoteExtension — dopłata jako różnica wyceny całości", () => {
  it.each([
    // [opis, endDate, newEndDate, additionalDays, additionalRentalGrosze]
    // 5 dni (50 000) → 8 dni: próg 7 (65 000) + 1 doba auto-increment (10 000) = 75 000.
    ["wektor z planu: 5→8 dni przelicza całość po progu 7", "2027-03-05", "2027-03-08", 3, 25_000],
    // 5 dni (50 000) → 7 dni: dokładnie próg (65 000) — 2 doby „kosztują" 15 000, nie 20 000.
    ["lądowanie dokładnie na progu: 5→7 dni", "2027-03-05", "2027-03-07", 2, 15_000],
    // 2 dni (20 000) → 4 dni: poniżej progu, czysta cena bazowa.
    ["poniżej progu: 2→4 dni po cenie bazowej", "2027-03-02", "2027-03-04", 2, 20_000],
    // 8 dni (75 000) → 10 dni: obie wyceny nad progiem, różnica = 2 doby auto-increment.
    ["nad progiem po obu stronach: 8→10 dni", "2027-03-08", "2027-03-10", 2, 20_000],
  ])("%s", (_label, endDate, newEndDate, additionalDays, additionalRentalGrosze) => {
    const quote = quoteExtension({ startDate: "2027-03-01", endDate }, newEndDate, PARAMS);
    expect(quote).toEqual({ newEndDate, additionalDays, additionalRentalGrosze });
  });

  it("różnica może być UJEMNA: próg tańszy niż suma dób (monotoniczność niewymuszana — ADR-022)", () => {
    // 6 dni bez progu = 60 000; 7 dni po progu 5.5 = 55 000. Uczciwa różnica: −5 000.
    const cheapTier: PriceParams = { ...PARAMS, tiers: [{ tierDays: 7, multiplier: 5.5 }] };
    const quote = quoteExtension(
      { startDate: "2027-03-01", endDate: "2027-03-06" },
      "2027-03-07",
      cheapTier,
    );
    expect(quote).toEqual({
      newEndDate: "2027-03-07",
      additionalDays: 1,
      additionalRentalGrosze: -5_000,
    });
  });

  it("kaucja nie wchodzi do dopłaty (dotyczy najmu, nie kaucji)", () => {
    const quote = quoteExtension(
      { startDate: "2027-03-01", endDate: "2027-03-02" },
      "2027-03-03",
      PARAMS,
    );
    // 2→3 dni po bazie: 10 000, bez śladu depositGrosze (5 000).
    expect(quote.additionalRentalGrosze).toBe(10_000);
  });

  it.each([
    ["newEndDate równa endDate", "2027-03-05"],
    ["newEndDate przed endDate", "2027-03-04"],
  ])("skrócenie terminu to jawny błąd (%s) — poza zakresem Z6", (_label, newEndDate) => {
    expect(() =>
      quoteExtension({ startDate: "2027-03-01", endDate: "2027-03-05" }, newEndDate, PARAMS),
    ).toThrow(RangeError);
  });

  it("nieistniejąca data nowego końca jest odrzucana (2027-02-31 nie rolluje się cicho)", () => {
    expect(() =>
      quoteExtension({ startDate: "2027-02-01", endDate: "2027-02-05" }, "2027-02-31", PARAMS),
    ).toThrow(RangeError);
  });
});
