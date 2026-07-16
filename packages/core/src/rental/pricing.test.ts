import { describe, expect, it } from "vitest";

import { calculatePrice, type PriceParams } from "./pricing";

/** Cennik odniesienia: baza 100 zł/doba, progi 3 i 7 dni, doba ekstra = 1× baza. */
const params = (over: Partial<PriceParams> = {}): PriceParams => ({
  basePriceDayGrosze: 10_000,
  depositGrosze: 0,
  autoIncrementMultiplier: 1.0,
  tiers: [
    { tierDays: 3, multiplier: 2.8 },
    { tierDays: 7, multiplier: 6.5 },
  ],
  ...over,
});

describe("calculatePrice — progi jako cena całkowita", () => {
  it("kanon z migracji 0007: base 100 zł, próg 7 dni × 6.5 = 650 zł za 7 dni", () => {
    const result = calculatePrice("2026-03-02", "2026-03-08", params());

    expect(result.days).toBe(7);
    expect(result.rentalGrosze).toBe(65_000);
    expect(result.appliedTierDays).toBe(7);
  });

  it("multiplier NIE jest mnożnikiem dziennym (650 zł, a nie 7 × 650 zł)", () => {
    expect(calculatePrice("2026-03-02", "2026-03-08", params()).rentalGrosze).not.toBe(455_000);
  });

  it.each([
    { start: "2026-03-02", end: "2026-03-02", days: 1, rental: 10_000, tier: null, why: "poniżej najniższego progu — cena bazowa" },
    { start: "2026-03-02", end: "2026-03-03", days: 2, rental: 20_000, tier: null, why: "2 doby po cenie bazowej" },
    { start: "2026-03-02", end: "2026-03-04", days: 3, rental: 28_000, tier: 3, why: "próg 3 dni × 2.8 = 280 zł" },
    { start: "2026-03-02", end: "2026-03-05", days: 4, rental: 28_000, tier: 3, why: "między progami płaci cenę progu niższego" },
    { start: "2026-03-02", end: "2026-03-08", days: 7, rental: 65_000, tier: 7, why: "próg 7 dni × 6.5 = 650 zł" },
  ])("$why", ({ start, end, days, rental, tier }) => {
    const result = calculatePrice(start, end, params());
    expect(result.days).toBe(days);
    expect(result.rentalGrosze).toBe(rental);
    expect(result.appliedTierDays).toBe(tier);
  });
});

describe("calculatePrice — doby ponad najwyższym progiem", () => {
  it("dzień ekstra ponad próg 7 dni dolicza się przez auto_increment (650 + 100 = 750 zł)", () => {
    const result = calculatePrice("2026-03-02", "2026-03-09", params());

    expect(result.days).toBe(8);
    expect(result.rentalGrosze).toBe(75_000);
    expect(result.appliedTierDays).toBe(7);
  });

  it("auto_increment 0.5 przecenia dobę ekstra o połowę (650 + 3 × 50 = 800 zł)", () => {
    const result = calculatePrice("2026-03-02", "2026-03-11", params({ autoIncrementMultiplier: 0.5 }));

    expect(result.days).toBe(10);
    expect(result.rentalGrosze).toBe(80_000);
  });

  it("cennik rośnie monotonicznie ponad najwyższym progiem", () => {
    const at = (end: string) => calculatePrice("2026-03-02", end, params()).rentalGrosze;
    expect(at("2026-03-09")).toBeGreaterThan(at("2026-03-08"));
    expect(at("2026-03-10")).toBeGreaterThan(at("2026-03-09"));
  });
});

describe("calculatePrice — cennik bez progów", () => {
  it("brak progów = cena bazowa × doby, ZERO cichego rabatu za długi najem", () => {
    // Silnik źródłowy dawał tu -10% powyżej 7 dni. Rabat, którego nie ma
    // w cenniku, jest tu błędem — 10 dób ma kosztować pełne 1000 zł.
    const result = calculatePrice("2026-03-02", "2026-03-11", params({ tiers: [] }));

    expect(result.days).toBe(10);
    expect(result.rentalGrosze).toBe(100_000);
    expect(result.appliedTierDays).toBeNull();
  });
});

describe("calculatePrice — kaucja", () => {
  it("kaucja nie wchodzi do ceny najmu, dolicza się dopiero do sumy", () => {
    const result = calculatePrice("2026-03-02", "2026-03-08", params({ depositGrosze: 50_000 }));

    expect(result.rentalGrosze).toBe(65_000);
    expect(result.depositGrosze).toBe(50_000);
    expect(result.totalGrosze).toBe(115_000);
  });

  it("kaucja zerowa jest legalna", () => {
    expect(calculatePrice("2026-03-02", "2026-03-08", params()).totalGrosze).toBe(65_000);
  });
});

describe("calculatePrice — kolejność progów i walidacja", () => {
  it("progi podane w odwrotnej kolejności wyceniają się tak samo", () => {
    const shuffled = params({
      tiers: [
        { tierDays: 7, multiplier: 6.5 },
        { tierDays: 3, multiplier: 2.8 },
      ],
    });
    expect(calculatePrice("2026-03-02", "2026-03-08", shuffled).rentalGrosze).toBe(65_000);
  });

  it("wynik jest całkowitą liczbą groszy (bez ułamków po multiplierze)", () => {
    const result = calculatePrice("2026-03-02", "2026-03-04", params({ basePriceDayGrosze: 3_333 }));
    expect(Number.isInteger(result.rentalGrosze)).toBe(true);
    expect(result.rentalGrosze).toBe(Math.round(3_333 * 2.8));
  });

  it.each([
    { over: { basePriceDayGrosze: -1 }, pattern: /basePriceDayGrosze/ },
    { over: { basePriceDayGrosze: 10.5 }, pattern: /basePriceDayGrosze/ },
    { over: { depositGrosze: -1 }, pattern: /depositGrosze/ },
    { over: { autoIncrementMultiplier: 0 }, pattern: /autoIncrementMultiplier/ },
    { over: { tiers: [{ tierDays: 0, multiplier: 1 }] }, pattern: /tierDays/ },
    { over: { tiers: [{ tierDays: 3, multiplier: 0 }] }, pattern: /multiplier/ },
  ])("odrzuca niepoprawny cennik: $pattern", ({ over, pattern }) => {
    expect(() => calculatePrice("2026-03-02", "2026-03-08", params(over))).toThrow(pattern);
  });

  it("odwrócony zakres to błąd", () => {
    expect(() => calculatePrice("2026-03-08", "2026-03-02", params())).toThrow(/odwrócony/);
  });
});
