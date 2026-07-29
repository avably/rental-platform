/**
 * Sumowanie dopłaty przedłużenia po pozycjach — silnik wycenia JEDEN
 * produkt (quoteExtension), zamówienie wieloproduktowe sumuje panel.
 * Tożsamość z silnikiem przypięta wprost: suma == suma wywołań silnika
 * (wzorzec order-pricing.test.ts / tiers-preview.test.ts).
 */
import { quoteExtension, type PriceParams } from "@avably/core";
import { describe, expect, it } from "vitest";

import {
  extensionItemRentals,
  priceParamsFromRow,
  quoteOrderExtension,
} from "@/app/[locale]/(panel)/zamowienia/[id]/extension-pricing";

const ORDER = { startDate: "2027-03-01", endDate: "2027-03-05" };

const ZAGESZCZARKA: PriceParams = {
  basePriceDayGrosze: 10_000,
  depositGrosze: 5_000,
  autoIncrementMultiplier: 1.0,
  tiers: [{ tierDays: 7, multiplier: 6.5 }],
};
const AGREGAT: PriceParams = {
  basePriceDayGrosze: 20_000,
  depositGrosze: 0,
  autoIncrementMultiplier: 1.2,
  tiers: [],
};

describe("quoteOrderExtension — suma dopłat pozycji", () => {
  it("dwie pozycje różnych produktów: suma == suma quoteExtension per produkt", () => {
    const items = [
      { itemId: "i1", params: ZAGESZCZARKA },
      { itemId: "i2", params: AGREGAT },
    ];
    const expected =
      quoteExtension(ORDER, "2027-03-08", ZAGESZCZARKA).additionalRentalGrosze +
      quoteExtension(ORDER, "2027-03-08", AGREGAT).additionalRentalGrosze;

    const quote = quoteOrderExtension(ORDER, "2027-03-08", items);
    expect(quote.additionalRentalGrosze).toBe(expected); // 25 000 + 60 000 = 85 000
    expect(quote.additionalRentalGrosze).toBe(85_000); // pin ręczny — gdyby silnik i suma rozjechały się zgodnie
    expect(quote.additionalDays).toBe(3);
    expect(quote.newEndDate).toBe("2027-03-08");

    // Rozbicie NA POZYCJE to dokładnie liczby silnika per pozycja, a ich suma
    // == dopłata całości CO DO GROSZA (żadnego rozsmarowywania z zaokrągleniem).
    expect(quote.items).toEqual([
      { itemId: "i1", additionalRentalGrosze: 25_000 },
      { itemId: "i2", additionalRentalGrosze: 60_000 },
    ]);
    expect(quote.items.reduce((sum, item) => sum + item.additionalRentalGrosze, 0)).toBe(
      quote.additionalRentalGrosze,
    );
  });

  it("dopłaty przeciwnych znaków sumują się uczciwie", () => {
    const cheapTier: PriceParams = { ...ZAGESZCZARKA, tiers: [{ tierDays: 7, multiplier: 5.5 }] };
    const items = [
      { itemId: "i1", params: cheapTier }, // 6→7 dni: −5 000
      { itemId: "i2", params: AGREGAT }, // 6→7 dni: +20 000 (brak progów → doba bazowa)
    ];
    const sixDays = { startDate: "2027-03-01", endDate: "2027-03-06" };
    const quote = quoteOrderExtension(sixDays, "2027-03-07", items);
    expect(quote.additionalRentalGrosze).toBe(-5_000 + 20_000);
  });

  it("zamówienie bez pozycji: dopłata 0 (bramka 0010 i tak re-waliduje daty)", () => {
    const quote = quoteOrderExtension(ORDER, "2027-03-08", []);
    expect(quote).toEqual({
      newEndDate: "2027-03-08",
      additionalDays: 3,
      additionalRentalGrosze: 0,
      items: [],
    });
  });

  it("skrócenie terminu propaguje jawny błąd silnika", () => {
    expect(() => quoteOrderExtension(ORDER, "2027-03-05", [])).toThrow(RangeError);
  });
});

describe("extensionItemRentals — absolutne kwoty pozycji do zapisu", () => {
  it("dolicza dopłatę do bieżącego najmu i pomija pozycje bez zmiany", () => {
    const { updates, hasNegative } = extensionItemRentals(
      new Map([
        ["i1", 40_000],
        ["i2", 100_000],
        ["i3", 7_000],
      ]),
      [
        { itemId: "i1", additionalRentalGrosze: 25_000 },
        { itemId: "i2", additionalRentalGrosze: 60_000 },
        { itemId: "i3", additionalRentalGrosze: 0 }, // bez zmiany → bez zapisu
      ],
    );
    expect(hasNegative).toBe(false);
    expect(updates).toEqual([
      { itemId: "i1", rentalGrosze: 65_000 },
      { itemId: "i2", rentalGrosze: 160_000 },
    ]);
  });

  it("suma nowych kwot pozycji == stara suma + dopłata całości (co do grosza)", () => {
    const current = new Map([
      ["i1", 40_000],
      ["i2", 100_000],
    ]);
    const surcharges = [
      { itemId: "i1", additionalRentalGrosze: 25_000 },
      { itemId: "i2", additionalRentalGrosze: 60_000 },
    ];
    const { updates } = extensionItemRentals(current, surcharges);
    const oldSum = [...current.values()].reduce((sum, value) => sum + value, 0);
    const additional = surcharges.reduce((sum, item) => sum + item.additionalRentalGrosze, 0);
    const newSum = updates.reduce((sum, item) => sum + item.rentalGrosze, 0);
    expect(newSum).toBe(oldSum + additional);
  });

  it("ręczny rabat pozycji + ujemna dopłata poniżej zera → hasNegative", () => {
    const { updates, hasNegative } = extensionItemRentals(
      new Map([["i1", 3_000]]), // operator dał rabat
      [{ itemId: "i1", additionalRentalGrosze: -5_000 }], // zejście w tańszy próg
    );
    expect(hasNegative).toBe(true);
    expect(updates).toEqual([{ itemId: "i1", rentalGrosze: -2_000 }]);
  });
});

describe("priceParamsFromRow — konwersja wiersza PostgREST", () => {
  it("numeric przychodzi jako string i jest konwertowany", () => {
    const params = priceParamsFromRow({
      base_price_day_grosze: 10_000,
      deposit_grosze: 5_000,
      auto_increment_multiplier: "1.5",
      pricing_tiers: [{ tier_days: 7, multiplier: "6.5" }],
    });
    expect(params).toEqual({
      basePriceDayGrosze: 10_000,
      depositGrosze: 5_000,
      autoIncrementMultiplier: 1.5,
      tiers: [{ tierDays: 7, multiplier: 6.5 }],
    });
  });
});
