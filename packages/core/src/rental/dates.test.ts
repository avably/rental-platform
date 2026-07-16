import { describe, expect, it } from "vitest";

import { addDays, assertIsoDate, rangesOverlapInclusive, rentalDaysInclusive } from "./dates";

describe("rentalDaysInclusive", () => {
  it.each([
    { start: "2026-03-02", end: "2026-03-08", days: 7, why: "2→8 marca = 7 dni (zakres inclusive)" },
    { start: "2026-03-02", end: "2026-03-02", days: 1, why: "najem jednodniowy = 1 dzień, nie 0" },
    { start: "2026-03-02", end: "2026-03-03", days: 2, why: "sąsiednie doby" },
    { start: "2026-02-27", end: "2026-03-01", days: 3, why: "przez koniec lutego (2026 nieprzestępny)" },
    { start: "2024-02-27", end: "2024-03-01", days: 4, why: "rok przestępny ma 29 lutego" },
    { start: "2026-12-30", end: "2027-01-02", days: 4, why: "przez koniec roku" },
    { start: "2026-01-01", end: "2026-12-31", days: 365, why: "pełny rok" },
  ])("$why", ({ start, end, days }) => {
    expect(rentalDaysInclusive(start, end)).toBe(days);
  });

  it("zmiana czasu nie gubi ani nie dokłada doby (arytmetyka w UTC)", () => {
    // Ostatnia niedziela marca i października 2026 — przejścia DST w Europie.
    expect(rentalDaysInclusive("2026-03-28", "2026-03-30")).toBe(3);
    expect(rentalDaysInclusive("2026-10-24", "2026-10-26")).toBe(3);
  });

  it("odwrócony zakres to błąd, nie ujemna liczba dni", () => {
    expect(() => rentalDaysInclusive("2026-03-08", "2026-03-02")).toThrow(/odwrócony/);
  });
});

describe("assertIsoDate", () => {
  it.each(["2026-3-02", "02-03-2026", "2026-03-02T00:00:00Z", "", "jutro"])(
    "odrzuca zapis %s",
    (value) => {
      expect(() => assertIsoDate(value)).toThrow(/YYYY-MM-DD/);
    },
  );

  it.each(["2026-02-31", "2026-13-01", "2026-00-10", "2026-04-31", "2025-02-29"])(
    "odrzuca datę spoza kalendarza %s (kształt poprawny, dzień nie istnieje)",
    (value) => {
      expect(() => assertIsoDate(value)).toThrow(/nie istnieje/);
    },
  );

  it("przepuszcza 29 lutego w roku przestępnym", () => {
    expect(assertIsoDate("2024-02-29")).toBe("2024-02-29");
  });
});

describe("addDays", () => {
  it.each([
    { date: "2026-03-02", days: -2, expected: "2026-02-28" },
    { date: "2026-03-02", days: 0, expected: "2026-03-02" },
    { date: "2026-12-31", days: 1, expected: "2027-01-01" },
    { date: "2024-02-28", days: 1, expected: "2024-02-29" },
    { date: "2026-02-28", days: 1, expected: "2026-03-01" },
  ])("$date + $days dni = $expected", ({ date, days, expected }) => {
    expect(addDays(date, days)).toBe(expected);
  });
});

describe("rangesOverlapInclusive", () => {
  it("styk dzień w dzień JEST kolizją (zakresy domknięte)", () => {
    expect(rangesOverlapInclusive("2026-03-02", "2026-03-08", "2026-03-08", "2026-03-10")).toBe(true);
  });

  it("rozłączne zakresy nie kolidują", () => {
    expect(rangesOverlapInclusive("2026-03-02", "2026-03-08", "2026-03-09", "2026-03-10")).toBe(false);
  });

  it("zakres zawarty w drugim koliduje", () => {
    expect(rangesOverlapInclusive("2026-03-04", "2026-03-05", "2026-03-02", "2026-03-08")).toBe(true);
  });
});
