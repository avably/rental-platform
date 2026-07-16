/**
 * Wycena, przypisanie egzemplarzy i kalendarz zamówień MUSZĄ być tożsame
 * z silnikiem — moduł pricing.ts nie ma prawa mieć własnej arytmetyki.
 * Wzorzec dowodu: tiers-preview.test.ts (ADR-022):
 *   1. wektory przypięte RĘCZNIE (kanon ADR-018),
 *   2. równość z calculatePrice/checkAvailability punkt po punkcie.
 */
import { addDays, calculatePrice, checkAvailability, type IsoDate } from "@avably/core";
import { describe, expect, it } from "vitest";

import {
  availabilityForRange,
  buildDayMap,
  pickUnits,
  priceOrderItems,
  type ProductPricingRow,
} from "@/app/[locale]/zamowienia/pricing";

/** Cennik odniesienia jak w pricing.test.ts: baza 100 zł, progi 3×2.8 i 7×6.5. */
const tieredProduct: ProductPricingRow = {
  id: "prod-1",
  base_price_day_grosze: 10_000,
  deposit_grosze: 5_000,
  auto_increment_multiplier: 1.0,
  buffer_before_days: 1,
  buffer_after_days: 1,
  pricing_tiers: [
    { tier_days: 3, multiplier: 2.8 },
    { tier_days: 7, multiplier: 6.5 },
  ],
};

const products = new Map([[tieredProduct.id, tieredProduct]]);

describe("priceOrderItems — wektory przypięte ręcznie (ADR-018)", () => {
  it("dwie pozycje tego samego produktu na 7 dni: 2 × 65 000 gr najmu, 2 × 5 000 gr kaucji", () => {
    const pricing = priceOrderItems(["prod-1", "prod-1"], products, "2026-08-01", "2026-08-07");
    expect(pricing.items).toEqual([
      { productId: "prod-1", rentalGrosze: 65_000, depositGrosze: 5_000 },
      { productId: "prod-1", rentalGrosze: 65_000, depositGrosze: 5_000 },
    ]);
    expect(pricing.totalRentalGrosze).toBe(130_000);
    expect(pricing.totalDepositGrosze).toBe(10_000);
    expect(pricing.days).toBe(7);
  });

  it("mnożnik progu NIE jest dzienny: 7 dni to 65 000 gr, nie 455 000 gr", () => {
    const pricing = priceOrderItems(["prod-1"], products, "2026-08-01", "2026-08-07");
    expect(pricing.items[0]!.rentalGrosze).toBe(65_000);
    expect(pricing.items[0]!.rentalGrosze).not.toBe(455_000);
  });

  it("między progami płaci się cenę progu niższego: 4 dni = 28 000 gr", () => {
    const pricing = priceOrderItems(["prod-1"], products, "2026-08-01", "2026-08-04");
    expect(pricing.items[0]!.rentalGrosze).toBe(28_000);
  });

  it("produkt nieobecny w mapie to wyjątek, nie cicha pozycja za zero", () => {
    expect(() => priceOrderItems(["prod-nieznany"], products, "2026-08-01", "2026-08-03")).toThrow(
      /prod-nieznany/,
    );
  });
});

describe("priceOrderItems — równość z calculatePrice punkt po punkcie", () => {
  it("każda długość najmu 1..10 dni: pozycja == wynik silnika", () => {
    const start: IsoDate = "2026-08-01";
    for (let days = 1; days <= 10; days += 1) {
      const end = addDays(start, days - 1);
      const engine = calculatePrice(start, end, {
        basePriceDayGrosze: tieredProduct.base_price_day_grosze,
        depositGrosze: tieredProduct.deposit_grosze,
        autoIncrementMultiplier: tieredProduct.auto_increment_multiplier,
        tiers: [
          { tierDays: 3, multiplier: 2.8 },
          { tierDays: 7, multiplier: 6.5 },
        ],
      });
      const pricing = priceOrderItems(["prod-1"], products, start, end);
      expect(pricing.items[0]!.rentalGrosze, `dzień ${days}`).toBe(engine.rentalGrosze);
      expect(pricing.items[0]!.depositGrosze, `dzień ${days}`).toBe(engine.depositGrosze);
      expect(pricing.days, `dzień ${days}`).toBe(engine.days);
    }
  });
});

describe("pickUnits — deterministyczne przypisanie pierwszych wolnych", () => {
  it("przydziela kolejne wolne egzemplarze w podanej kolejności", () => {
    const assigned = pickUnits(
      ["prod-1", "prod-1"],
      new Map([["prod-1", ["u1", "u2", "u3"]]]),
    );
    expect(assigned).toEqual(["u1", "u2"]);
  });

  it("dwa produkty dostają egzemplarze z własnych pul", () => {
    const assigned = pickUnits(
      ["prod-1", "prod-2", "prod-1"],
      new Map([
        ["prod-1", ["a1", "a2"]],
        ["prod-2", ["b1"]],
      ]),
    );
    expect(assigned).toEqual(["a1", "b1", "a2"]);
  });

  it("za mało wolnych egzemplarzy → null (nie częściowe przypisanie)", () => {
    expect(pickUnits(["prod-1", "prod-1"], new Map([["prod-1", ["u1"]]]))).toBeNull();
  });

  it("produkt bez wpisu w mapie → null", () => {
    expect(pickUnits(["prod-1"], new Map())).toBeNull();
  });
});

describe("buildDayMap — kalendarz pokazuje DOKŁADNIE to, co widzi silnik", () => {
  const units = [{ unitId: "u1", unavailableFrom: null, unavailableTo: null }];
  const booked = [{ unitId: "u1", startDate: "2026-08-10", endDate: "2026-08-12" }];
  const buffers = { bufferBeforeDays: 1, bufferAfterDays: 1 };

  it("bufory są widoczne jako zajętość: 9-13 zajęte, 8 i 14 wolne", () => {
    const map = buildDayMap(units, booked, buffers, "2026-08-06", 10);
    const byDay = new Map(map.map((entry) => [entry.day, entry.available]));
    expect(byDay.get("2026-08-08"), "dzień przed buforem").toBe(true);
    expect(byDay.get("2026-08-09"), "bufor przed najmem").toBe(false);
    expect(byDay.get("2026-08-10"), "start najmu").toBe(false);
    expect(byDay.get("2026-08-12"), "koniec najmu").toBe(false);
    expect(byDay.get("2026-08-13"), "bufor po najmie").toBe(false);
    expect(byDay.get("2026-08-14"), "dzień po buforze").toBe(true);
  });

  it("każdy dzień mapy == werdykt checkAvailability dla najmu jednodniowego", () => {
    const map = buildDayMap(units, booked, buffers, "2026-08-01", 20);
    expect(map).toHaveLength(20);
    for (const entry of map) {
      const engine = checkAvailability(
        units,
        booked,
        { start: entry.day, end: entry.day },
        buffers,
      );
      expect(entry.available, entry.day).toBe(engine.available);
    }
  });
});

describe("availabilityForRange — cienka owijka silnika", () => {
  it("zwraca dokładnie wynik checkAvailability", () => {
    const units = [{ unitId: "u1", unavailableFrom: null, unavailableTo: null }];
    const booked = [{ unitId: "u1", startDate: "2026-08-10", endDate: "2026-08-12" }];
    const params = { bufferBeforeDays: 0, bufferAfterDays: 0 };
    expect(availabilityForRange(units, booked, "2026-08-11", "2026-08-13", params)).toEqual(
      checkAvailability(units, booked, { start: "2026-08-11", end: "2026-08-13" }, params),
    );
  });
});
