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

  it("PLN jest domyślną walutą rynku startowego", () => {
    expect(DEFAULT_CURRENCY).toBe("PLN");
  });

  it("isCurrencyCode odsiewa nieobsługiwane kody", () => {
    expect(isCurrencyCode("PLN")).toBe(true);
    expect(isCurrencyCode("GBP")).toBe(false);
  });
});
