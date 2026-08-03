/**
 * Dostępność KOSZYKA — scalanie map dni z silnika (R3, kalendarz terminu).
 *
 * Reguła jest jedna i nieoczywista w skutkach: dzień koszyka jest wolny
 * DOKŁADNIE wtedy, gdy każdy produkt jest tego dnia wolny. Ten test pilnuje
 * także obu przypadków, w których łatwo obiecać dostępność bez pokrycia:
 * pustego koszyka i dnia spoza mapy któregoś produktu.
 */
import { describe, expect, it } from "vitest";

import {
  blockedDays,
  mergeDayMaps,
  rangeIsFree,
} from "@/app/[locale]/(panel)/zamowienia/nowe/basket-availability";
import type { DayAvailability } from "@/app/[locale]/(panel)/zamowienia/pricing";

const map = (entries: [string, boolean][]): DayAvailability[] =>
  entries.map(([day, available]) => ({ day, available })) as DayAvailability[];

const FREE_WEEK = map([
  ["2026-09-01", true],
  ["2026-09-02", true],
  ["2026-09-03", true],
]);

const BUSY_MIDDLE = map([
  ["2026-09-01", true],
  ["2026-09-02", false],
  ["2026-09-03", true],
]);

describe("mergeDayMaps", () => {
  it("pusty koszyk daje PUSTĄ mapę, a nie „wszystko wolne”", () => {
    expect(mergeDayMaps([])).toEqual([]);
  });

  it("jeden produkt przechodzi bez zmian", () => {
    expect(mergeDayMaps([BUSY_MIDDLE])).toEqual(BUSY_MIDDLE);
  });

  it("jeden zajęty produkt blokuje dzień całego koszyka", () => {
    expect(mergeDayMaps([FREE_WEEK, BUSY_MIDDLE])).toEqual(BUSY_MIDDLE);
  });

  it("dzień nieobecny w którejś mapie jest NIEZNANY, czyli zajęty", () => {
    const short = map([["2026-09-01", true]]);
    expect(mergeDayMaps([FREE_WEEK, short])).toEqual(
      map([
        ["2026-09-01", true],
        ["2026-09-02", false],
        ["2026-09-03", false],
      ]),
    );
  });

  it("wynik jest posortowany po dniu niezależnie od kolejności wejścia", () => {
    const shuffled = map([
      ["2026-09-03", true],
      ["2026-09-01", true],
    ]);
    expect(mergeDayMaps([shuffled]).map((entry) => entry.day)).toEqual([
      "2026-09-01",
      "2026-09-03",
    ]);
  });
});

describe("blockedDays", () => {
  it("zwraca same dni zajęte, w kolejności mapy", () => {
    expect(blockedDays(BUSY_MIDDLE)).toEqual(["2026-09-02"]);
    expect(blockedDays(FREE_WEEK)).toEqual([]);
  });
});

describe("rangeIsFree", () => {
  it("zakres w całości wolny przechodzi", () => {
    expect(rangeIsFree(FREE_WEEK, "2026-09-01", "2026-09-03")).toBe(true);
  });

  it("zakres zawierający dzień zajęty nie przechodzi", () => {
    expect(rangeIsFree(BUSY_MIDDLE, "2026-09-01", "2026-09-03")).toBe(false);
  });

  it("zakres obok dnia zajętego przechodzi", () => {
    expect(rangeIsFree(BUSY_MIDDLE, "2026-09-03", "2026-09-03")).toBe(true);
  });

  it("zakres wystający poza znaną mapę nie przechodzi — nieznane to nie wolne", () => {
    expect(rangeIsFree(FREE_WEEK, "2026-09-01", "2026-09-09")).toBe(false);
    expect(rangeIsFree(FREE_WEEK, "2026-08-20", "2026-09-02")).toBe(false);
  });

  it("zakres odwrócony i pusty nie są terminem", () => {
    expect(rangeIsFree(FREE_WEEK, "2026-09-03", "2026-09-01")).toBe(false);
    expect(rangeIsFree(FREE_WEEK, "", "")).toBe(false);
  });

  it("pusta mapa (pusty koszyk) nie obiecuje wolnego terminu", () => {
    expect(rangeIsFree([], "2026-09-01", "2026-09-03")).toBe(false);
  });
});
