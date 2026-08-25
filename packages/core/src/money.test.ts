import { describe, expect, it } from "vitest";

import { DEFAULT_CURRENCY, formatMoney, isCurrencyCode } from "./money";

describe("formatMoney", () => {
  it("to samo PLN inaczej zapisane w pl i en (locale ≠ waluta)", () => {
    expect(formatMoney(129_900, "PLN", "pl")).toContain("299");
    expect(formatMoney(129_900, "PLN", "en")).toContain("299");
  });

  it("waluta jest parametrem — EUR/USD nie wymagają zmiany kodu", () => {
    expect(formatMoney(1000, "EUR", "en")).toContain("10");
    expect(formatMoney(1000, "USD", "en")).toContain("10");
  });

  it("jednostki podrzędne dzielone poprawnie", () => {
    expect(formatMoney(1, "PLN", "pl")).toContain("0,01");
  });

  // UWAGA: spacje wewnątrz wzorców kwot NIŻEJ to PRAWDZIWE U+00A0 (twarde),
  // nie zwykłe spacje — gołym okiem ich nie odróżnisz, a różnica jest całym
  // findingiem. Test „fraza atomowa” pilnuje tego wprost.
  describe("separator tysięcy OD CZTERECH cyfr (S-48a)", () => {
    it("pl: 4 cyfry grupowane twardą spacją U+00A0 — „1 000,00 zł”", () => {
      // CLDR pl ma minimumGroupingDigits=2 (grupowanie od 5 cyfr) — formatter
      // MUSI go znieść, inaczej „1000,00 zł” wraca przy pierwszej zmianie opcji.
      expect(formatMoney(100_000, "PLN", "pl")).toBe("1 000,00 zł");
    });

    it("pl: 6 cyfr — „100 000,00 zł”", () => {
      expect(formatMoney(10_000_000, "PLN", "pl")).toBe("100 000,00 zł");
    });

    it("pl: separator jest NIEŁAMLIWY (U+00A0), nie zwykłą spacją — fraza atomowa", () => {
      const label = formatMoney(368_000, "PLN", "pl");
      expect(label).toContain("3 680,00");
      expect(label.includes(" "), `zwykła spacja w kwocie: ${JSON.stringify(label)}`).toBe(false);
    });

    it("pl: trzy cyfry zostają BEZ separatora — grupowanie nie dokleja się na siłę", () => {
      expect(formatMoney(99_900, "PLN", "pl")).toBe("999,00 zł");
    });

    it("en: grupowanie przecinkiem jak dotąd — „PLN 1,000.00”", () => {
      expect(formatMoney(100_000, "PLN", "en")).toBe("PLN 1,000.00");
      expect(formatMoney(10_000_000, "PLN", "en")).toBe("PLN 100,000.00");
    });
  });

  it("PLN jest domyślną walutą rynku startowego", () => {
    expect(DEFAULT_CURRENCY).toBe("PLN");
  });

  it("isCurrencyCode odsiewa nieobsługiwane kody", () => {
    expect(isCurrencyCode("PLN")).toBe(true);
    expect(isCurrencyCode("GBP")).toBe(false);
  });
});
