import { describe, expect, it } from "vitest";

import { checkAvailability, type BookedRange, type UnitServiceWindow } from "./availability";
import { addDays } from "./dates";

const free = (unitId: string): UnitServiceWindow => ({
  unitId,
  unavailableFrom: null,
  unavailableTo: null,
});

const noBuffers = { bufferBeforeDays: 0, bufferAfterDays: 0 };

describe("checkAvailability — kolizje z kalendarzem", () => {
  const booked: BookedRange[] = [{ unitId: "u1", startDate: "2026-03-10", endDate: "2026-03-12" }];

  it.each([
    { start: "2026-03-10", end: "2026-03-12", available: false, why: "ten sam termin" },
    { start: "2026-03-11", end: "2026-03-11", available: false, why: "termin zawarty w najmie" },
    { start: "2026-03-08", end: "2026-03-10", available: false, why: "styk w dzień startu JEST kolizją" },
    { start: "2026-03-12", end: "2026-03-14", available: false, why: "styk w dzień końca JEST kolizją" },
    { start: "2026-03-08", end: "2026-03-09", available: true, why: "kończy się dzień przed najmem" },
    { start: "2026-03-13", end: "2026-03-14", available: true, why: "zaczyna się dzień po najmie" },
  ])("$why", ({ start, end, available }) => {
    const result = checkAvailability([free("u1")], booked, { start, end }, noBuffers);
    expect(result.available).toBe(available);
  });

  it("najem innego egzemplarza nie blokuje tego egzemplarza", () => {
    const result = checkAvailability(
      [free("u1")],
      [{ unitId: "u2", startDate: "2026-03-10", endDate: "2026-03-12" }],
      { start: "2026-03-10", end: "2026-03-12" },
      noBuffers,
    );

    expect(result.available).toBe(true);
    expect(result.availableUnitIds).toEqual(["u1"]);
  });
});

describe("checkAvailability — bufory", () => {
  const booked: BookedRange[] = [{ unitId: "u1", startDate: "2026-03-10", endDate: "2026-03-12" }];

  it("bufor PRZED najmem blokuje dobę bezpośrednio po cudzym najmie", () => {
    const params = { bufferBeforeDays: 1, bufferAfterDays: 0 };
    // 13 marca to pierwszy wolny dzień, ale bufor „przed" wymaga doby na przegląd.
    expect(checkAvailability([free("u1")], booked, { start: "2026-03-13", end: "2026-03-14" }, params).available).toBe(false);
    expect(checkAvailability([free("u1")], booked, { start: "2026-03-14", end: "2026-03-15" }, params).available).toBe(true);
  });

  it("bufor PO najmie blokuje dobę bezpośrednio przed cudzym najmem", () => {
    const params = { bufferBeforeDays: 0, bufferAfterDays: 2 };
    expect(checkAvailability([free("u1")], booked, { start: "2026-03-08", end: "2026-03-09" }, params).available).toBe(false);
    expect(checkAvailability([free("u1")], booked, { start: "2026-03-06", end: "2026-03-07" }, params).available).toBe(true);
  });

  it("bufory zerowe pozwalają wydać sprzęt dzień po zwrocie", () => {
    expect(checkAvailability([free("u1")], booked, { start: "2026-03-13", end: "2026-03-13" }, noBuffers).available).toBe(true);
  });

  it.each([
    { params: { bufferBeforeDays: -1, bufferAfterDays: 0 }, pattern: /bufferBeforeDays/ },
    { params: { bufferBeforeDays: 0, bufferAfterDays: 1.5 }, pattern: /bufferAfterDays/ },
  ])("odrzuca niepoprawny bufor: $pattern", ({ params, pattern }) => {
    expect(() => checkAvailability([free("u1")], [], { start: "2026-03-02", end: "2026-03-08" }, params)).toThrow(pattern);
  });
});

describe("checkAvailability — okna serwisowe", () => {
  it.each([
    { from: "2026-03-05", to: "2026-03-15", available: false, why: "serwis obejmuje cały termin" },
    { from: "2026-03-12", to: "2026-03-20", available: false, why: "serwis zachodzi na koniec terminu" },
    { from: "2026-03-01", to: "2026-03-09", available: true, why: "serwis kończy się przed terminem" },
    { from: "2026-03-13", to: "2026-03-20", available: true, why: "serwis zaczyna się po terminie" },
    { from: "2026-03-10", to: null, available: false, why: "serwis otwarty z prawej obejmuje termin" },
    { from: "2026-03-13", to: null, available: true, why: "serwis otwarty z prawej zaczyna się po terminie" },
    { from: null, to: "2026-03-10", available: false, why: "serwis otwarty z lewej obejmuje termin" },
    { from: null, to: "2026-03-09", available: true, why: "serwis otwarty z lewej kończy się przed terminem" },
  ])("$why", ({ from, to, available }) => {
    const unit: UnitServiceWindow = { unitId: "u1", unavailableFrom: from, unavailableTo: to };
    const result = checkAvailability([unit], [], { start: "2026-03-10", end: "2026-03-12" }, noBuffers);
    expect(result.available).toBe(available);
  });

  it("egzemplarz w serwisie trafia na listę zablokowanych, nie znika", () => {
    const units: UnitServiceWindow[] = [
      { unitId: "u1", unavailableFrom: "2026-03-01", unavailableTo: "2026-03-31" },
      free("u2"),
    ];
    const result = checkAvailability(units, [], { start: "2026-03-10", end: "2026-03-12" }, noBuffers);

    expect(result.availableUnitIds).toEqual(["u2"]);
    expect(result.blockedUnitIds).toEqual(["u1"]);
  });
});

describe("checkAvailability — kontrakt wyniku", () => {
  it("każdy egzemplarz jest albo wolny, albo zablokowany — listy dzielą wejście", () => {
    const units = [free("u1"), free("u2"), { unitId: "u3", unavailableFrom: "2026-03-01", unavailableTo: "2026-03-31" }];
    const booked: BookedRange[] = [{ unitId: "u2", startDate: "2026-03-10", endDate: "2026-03-12" }];

    const result = checkAvailability(units, booked, { start: "2026-03-10", end: "2026-03-12" }, noBuffers);

    expect([...result.availableUnitIds, ...result.blockedUnitIds].sort()).toEqual(["u1", "u2", "u3"]);
    expect(result.availableUnitIds).toEqual(["u1"]);
  });

  it("brak egzemplarzy = brak dostępności", () => {
    const result = checkAvailability([], [], { start: "2026-03-10", end: "2026-03-12" }, noBuffers);

    expect(result.available).toBe(false);
    expect(result.availableUnitIds).toEqual([]);
  });

  it("nie mutuje wejścia", () => {
    const units = [free("u1")];
    const booked: BookedRange[] = [{ unitId: "u1", startDate: "2026-03-10", endDate: "2026-03-12" }];
    const snapshot = JSON.stringify({ units, booked });

    checkAvailability(units, booked, { start: "2026-03-10", end: "2026-03-12" }, { bufferBeforeDays: 1, bufferAfterDays: 2 });

    expect(JSON.stringify({ units, booked })).toBe(snapshot);
  });

  it("odwrócony zakres to błąd", () => {
    expect(() => checkAvailability([free("u1")], [], { start: "2026-03-12", end: "2026-03-10" }, noBuffers)).toThrow(/odwrócony/);
  });
});

/**
 * Property-test: żadna para najmów tego samego egzemplarza nie narusza buforów.
 *
 * Zamiast losowania — pełny przegląd małej dziedziny: wszystkie terminy
 * w oknie 25 dób × wszystkie kombinacje buforów. Wyczerpanie dziedziny jest
 * mocniejsze od próbkowania (nie ma czego przeoczyć) i nie wymaga zależności.
 *
 * Wyrocznia liczy odstęp WPROST w dobach i nie dzieli ani linijki kodu
 * z silnikiem — test, który liczyłby to tą samą funkcją, potwierdzałby
 * wyłącznie sam siebie.
 */
describe("property: bufory rozdzielają najmy tego samego egzemplarza", () => {
  const ORIGIN = "2026-03-01";
  const WINDOW_DAYS = 25;
  const iso = (dayIndex: number) => addDays(ORIGIN, dayIndex);

  const BOOKED_START = 9;
  const BOOKED_END = 11;
  const booked: BookedRange[] = [{ unitId: "u1", startDate: iso(BOOKED_START), endDate: iso(BOOKED_END) }];

  for (const bufferBeforeDays of [0, 1, 2, 3]) {
    for (const bufferAfterDays of [0, 1, 2, 3]) {
      it(`bufory ${bufferBeforeDays}/${bufferAfterDays}: silnik zgadza się z odstępem liczonym wprost`, () => {
        for (let start = 0; start < WINDOW_DAYS; start++) {
          for (let end = start; end < WINDOW_DAYS; end++) {
            const result = checkAvailability(
              [free("u1")],
              booked,
              { start: iso(start), end: iso(end) },
              { bufferBeforeDays, bufferAfterDays },
            );

            // Termin jest wolny wtedy i tylko wtedy, gdy zostawia dość wolnych
            // dób od cudzego najmu: leżąc przed nim — co najmniej `bufferAfter`
            // (bufor domyka najem, który jest wcześniej), leżąc po nim — co
            // najmniej `bufferBefore`. Odstęp RÓWNY buforowi wystarcza: bufor
            // jednodniowy to żądanie jednej wolnej doby, a nie dwóch.
            const gapBefore = BOOKED_START - end - 1;
            const gapAfter = start - BOOKED_END - 1;
            const expected = gapBefore >= bufferAfterDays || gapAfter >= bufferBeforeDays;

            expect(
              result.available,
              `termin ${iso(start)}..${iso(end)} przy buforach ${bufferBeforeDays}/${bufferAfterDays}`,
            ).toBe(expected);
          }
        }
      });
    }
  }

  it("wolny termin zwrócony przez silnik NIGDY nie styka się z cudzym najmem bliżej niż bufor", () => {
    for (const bufferBeforeDays of [0, 1, 2, 3]) {
      for (const bufferAfterDays of [0, 1, 2, 3]) {
        for (let start = 0; start < WINDOW_DAYS; start++) {
          for (let end = start; end < WINDOW_DAYS; end++) {
            const { available } = checkAvailability(
              [free("u1")],
              booked,
              { start: iso(start), end: iso(end) },
              { bufferBeforeDays, bufferAfterDays },
            );
            if (!available) continue;

            const gapBefore = BOOKED_START - end - 1;
            const gapAfter = start - BOOKED_END - 1;
            expect(
              Math.max(gapBefore - bufferAfterDays, gapAfter - bufferBeforeDays),
            ).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});
