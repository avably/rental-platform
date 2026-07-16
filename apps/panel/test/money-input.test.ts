/**
 * Konwersja kwot formularz ↔ grosze (lib/money-input.ts) — jedyne miejsce
 * konwersji w panelu, więc jedyne miejsce, w którym pomyłka o rząd wielkości
 * mogłaby wejść do bazy. Tabelarycznie: wejścia poprawne, odrzucane i pełny
 * cykl "100,50" → 10050 → render formatMoney.
 */
import { formatMoney } from "@avably/core";
import { describe, expect, it } from "vitest";

import { groszeToInputValue, parseMajorToGrosze, parseMultiplier } from "@/lib/money-input";

describe("parseMajorToGrosze", () => {
  it.each([
    ["100,50", 10050],
    ["100.50", 10050],
    ["100", 10000],
    ["0", 0],
    ["0,5", 50],
    ["0.05", 5],
    ["1,2", 120],
    ["999999", 99999900],
    [" 100,50 ", 10050],
  ])("%s → %d groszy", (raw, grosze) => {
    expect(parseMajorToGrosze(raw)).toBe(grosze);
  });

  // Zaokrągleń NIE MA: trzecie miejsce dziesiętne to odrzucenie, nie
  // przycięcie — kwota po zaokrągleniu nie byłaby kwotą wpisaną przez
  // operatora.
  it.each([
    ["100,505"],
    ["100.999"],
    ["0,001"],
  ])("%s (więcej niż 2 miejsca) → odrzucone, nie zaokrąglone", (raw) => {
    expect(parseMajorToGrosze(raw)).toBeNull();
  });

  it.each([
    [""],
    ["   "],
    ["abc"],
    ["100,"],
    [",50"],
    ["-100"],
    ["+100"],
    ["1 000"],
    ["1,000.50"],
    ["1.000,50"],
    ["100,50zł"],
    ["1e2"],
    ["Infinity"],
    ["NaN"],
  ])("%s → odrzucone", (raw) => {
    expect(parseMajorToGrosze(raw)).toBeNull();
  });
});

describe("groszeToInputValue", () => {
  it.each([
    [10050, "100.50"],
    [10000, "100"],
    [5, "0.05"],
    [50, "0.50"],
    [0, "0"],
    [123456789, "1234567.89"],
  ])("%d groszy → %s", (grosze, value) => {
    expect(groszeToInputValue(grosze)).toBe(value);
  });

  it("odrzuca kwoty niecałkowite i ujemne", () => {
    expect(() => groszeToInputValue(100.5)).toThrow(RangeError);
    expect(() => groszeToInputValue(-1)).toThrow(RangeError);
  });

  it("wartość pola przechodzi z powrotem przez parser bez zmiany kwoty", () => {
    for (const grosze of [0, 1, 99, 100, 10050, 99999900]) {
      expect(parseMajorToGrosze(groszeToInputValue(grosze))).toBe(grosze);
    }
  });
});

describe("pełny cykl formularz → baza → render", () => {
  it('"100,50" → 10050 groszy → "100,50 zł" (PLN, locale pl)', () => {
    const grosze = parseMajorToGrosze("100,50");
    expect(grosze).toBe(10050);
    // formatMoney z @avably/core — panel nie ma własnego renderu kwot.
    // Intl wstawia spacje niełamliwe (U+00A0/U+202F) — normalizacja do zwykłej
    // spacji dotyczy zapisu, nie kwoty.
    expect(formatMoney(grosze!, "PLN", "pl").replace(/[\u00A0\u202F]/g, " ")).toBe("100,50 zł");
  });

  it("ta sama kwota w locale en niesie kod waluty, nie zaszyte „zł”", () => {
    const rendered = formatMoney(10050, "PLN", "en");
    expect(rendered).toContain("100.50");
    expect(rendered).not.toContain("zł");
  });
});

describe("parseMultiplier", () => {
  it.each([
    ["6,5", 6.5],
    ["6.5", 6.5],
    ["1", 1],
    ["0,95", 0.95],
    ["12.25", 12.25],
  ])("%s → %d", (raw, value) => {
    expect(parseMultiplier(raw)).toBe(value);
  });

  it.each([["0"], ["0,00"], ["-1"], ["6,555"], [""], ["abc"], ["1e2"]])(
    "%s → odrzucone",
    (raw) => {
      expect(parseMultiplier(raw)).toBeNull();
    },
  );
});
