/**
 * formatRentalRange (F8) — zakresy w jednym/dwóch miesiącach/latach, PL+EN,
 * atomowość frazy (NBSP) i kontrakt błędów z dates.ts.
 *
 * Asercje porównują NAJPIERW treść po normalizacji NBSP→spacja (czytelność
 * oczekiwań), a atomowość osobno: jedyna ZWYKŁA spacja stoi przed „·" —
 * czyli fraza ma dokładnie jeden legalny punkt łamania, nigdy w środku daty
 * (audyt S-10: „2026-08-/28").
 */
import { describe, expect, it } from "vitest";

import { formatRentalRange } from "./format-range";

const NBSP = "\u00a0";
const readable = (value: string) => value.replaceAll(NBSP, " ");

describe("formatRentalRange — PL", () => {
  it("wspólny miesiąc i rok zwiera zakres do dni", () => {
    expect(readable(formatRentalRange("2026-08-26", "2026-08-28", "pl"))).toBe(
      "26–28 sie 2026 · 3 dni",
    );
  });

  it("różne miesiące rozpisują obie daty z odstępami wokół półpauzy", () => {
    expect(readable(formatRentalRange("2026-08-26", "2026-09-02", "pl"))).toBe(
      "26 sie – 2 wrz 2026 · 8 dni",
    );
  });

  it("różne lata niosą oba lata", () => {
    expect(readable(formatRentalRange("2026-12-28", "2027-01-03", "pl"))).toBe(
      "28 gru 2026 – 3 sty 2027 · 7 dni",
    );
  });

  it("ta sama doba to jedna data i „1 dzień” (odmiana)", () => {
    expect(readable(formatRentalRange("2026-08-26", "2026-08-26", "pl"))).toBe(
      "26 sie 2026 · 1 dzień",
    );
  });
});

describe("formatRentalRange — EN", () => {
  it("wspólny miesiąc i rok zwiera zakres do dni", () => {
    expect(readable(formatRentalRange("2026-08-26", "2026-08-28", "en"))).toBe(
      "Aug 26–28, 2026 · 3 days",
    );
  });

  it("różne miesiące rozpisują obie daty", () => {
    expect(readable(formatRentalRange("2026-08-26", "2026-09-02", "en"))).toBe(
      "Aug 26 – Sep 2, 2026 · 8 days",
    );
  });

  it("różne lata niosą oba lata", () => {
    expect(readable(formatRentalRange("2026-12-28", "2027-01-03", "en"))).toBe(
      "Dec 28, 2026 – Jan 3, 2027 · 7 days",
    );
  });

  it("ta sama doba to jedna data i „1 day” (liczba pojedyncza)", () => {
    expect(readable(formatRentalRange("2026-08-26", "2026-08-26", "en"))).toBe(
      "Aug 26, 2026 · 1 day",
    );
  });
});

describe("formatRentalRange — fraza atomowa (S-10)", () => {
  it.each([
    ["pl", "2026-08-26", "2026-08-28"],
    ["pl", "2026-08-26", "2026-09-02"],
    ["pl", "2026-12-28", "2027-01-03"],
    ["en", "2026-08-26", "2026-09-02"],
  ] as const)("jedyna zwykła spacja stoi przed „·” (%s %s–%s)", (locale, start, end) => {
    const phrase = formatRentalRange(start, end, locale);
    const plainSpaceParts = phrase.split(" ");
    // Dokładnie jeden punkt łamania: [zakres, „· N dni”].
    expect(plainSpaceParts).toHaveLength(2);
    expect(plainSpaceParts[1]!.startsWith("·")).toBe(true);
    // Wewnątrz tokenów wyłącznie NBSP — data nie złamie się w środku.
    expect(plainSpaceParts[0]).not.toContain(" ");
  });
});

describe("formatRentalRange — kontrakt błędów (dates.ts)", () => {
  it("zakres odwrócony rzuca RangeError", () => {
    expect(() => formatRentalRange("2026-08-28", "2026-08-26", "pl")).toThrow(RangeError);
  });

  it("data spoza kalendarza rzuca RangeError", () => {
    expect(() => formatRentalRange("2026-02-31", "2026-03-02", "pl")).toThrow(RangeError);
  });

  it("zły kształt daty rzuca RangeError", () => {
    expect(() => formatRentalRange("26.08.2026", "2026-08-28", "pl")).toThrow(RangeError);
  });
});
