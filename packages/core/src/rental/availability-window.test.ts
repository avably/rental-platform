import { describe, expect, it } from "vitest";

import {
  AVAILABILITY_WINDOW_MAX_DAYS,
  availabilityWindowEnd,
  isWithinAvailabilityWindow,
} from "./availability-window";
import { rentalDaysInclusive } from "./dates";

describe("okno dostępności (ADR-179)", () => {
  it("horyzont jest OSTATNIM dniem okna, a nie dniem za nim", () => {
    // Rachunek liczony przez rentalDaysInclusive, a nie przez odjęcie dat
    // w teście: gdyby horyzont był o dzień za daleko, szerokość wyszłaby
    // o jeden większa od sufitu i baza odrzuciłaby okno, które interfejs
    // uważa za swoje. To jest cały sens tej asercji.
    const end = availabilityWindowEnd("2027-01-01");
    expect(rentalDaysInclusive("2027-01-01", end)).toBe(AVAILABILITY_WINDOW_MAX_DAYS);
    expect(isWithinAvailabilityWindow("2027-01-01", end)).toBe(true);
  });

  it("granica jest WŁĄCZNA: szerokość sufitu przechodzi, o dzień szersza nie", () => {
    const start = "2027-01-01";
    const atCeiling = availabilityWindowEnd(start);
    const overCeiling = availabilityWindowEnd("2027-01-02");

    expect(isWithinAvailabilityWindow(start, atCeiling)).toBe(true);
    expect(rentalDaysInclusive(start, overCeiling)).toBe(AVAILABILITY_WINDOW_MAX_DAYS + 1);
    expect(isWithinAvailabilityWindow(start, overCeiling)).toBe(false);
  });

  it("okno jednodniowe ma szerokość 1, więc mieści się zawsze", () => {
    expect(isWithinAvailabilityWindow("2027-03-29", "2027-03-29")).toBe(true);
  });

  it("horyzont przechodzi przez zmianę czasu bez zgubionej doby", () => {
    // 29 marca 2026 to zmiana czasu w Europie. Arytmetyka idzie przez UTC
    // (lib dates.ts), więc doba nie ma jak zniknąć — ta asercja pilnuje, że
    // nikt nie przepisze horyzontu na lokalny `new Date`.
    const end = availabilityWindowEnd("2026-03-01");
    expect(rentalDaysInclusive("2026-03-01", end)).toBe(AVAILABILITY_WINDOW_MAX_DAYS);
  });

  it("zakres odwrócony NIE mieści się w oknie, ale nie jest wyjątkiem", () => {
    expect(isWithinAvailabilityWindow("2027-01-10", "2027-01-09")).toBe(false);
  });

  it("śmieć w dacie pozostaje twardym błędem", () => {
    expect(() => isWithinAvailabilityWindow("wczoraj", "2027-01-09")).toThrow(RangeError);
    expect(() => availabilityWindowEnd("2027-02-31")).toThrow(RangeError);
  });
});
