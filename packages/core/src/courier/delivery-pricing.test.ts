import { describe, expect, it } from "vitest";

import { DeliveryPricingError, calculateDeliveryCost } from "./delivery-pricing";
import type { DeliveryPricing } from "./types";

const PRICING: DeliveryPricing = {
  courier: { priceGrosze: 2500, freeAboveGrosze: 50_000 },
  own_delivery: { priceGrosze: 9900 },
};

describe("calculateDeliveryCost", () => {
  it("pickup jest zawsze darmowy i nie wymaga cennika", () => {
    expect(
      calculateDeliveryCost({ method: "pickup", pricing: null, rentalTotalGrosze: 0 }),
    ).toBe(0);
  });

  it("koszt stały metody poniżej progu darmowej dostawy", () => {
    expect(
      calculateDeliveryCost({ method: "courier", pricing: PRICING, rentalTotalGrosze: 30_000 }),
    ).toBe(2500);
  });

  it("próg darmowej dostawy jest INCLUSIVE: total równy progowi → 0", () => {
    expect(
      calculateDeliveryCost({ method: "courier", pricing: PRICING, rentalTotalGrosze: 50_000 }),
    ).toBe(0);
    expect(
      calculateDeliveryCost({ method: "courier", pricing: PRICING, rentalTotalGrosze: 50_001 }),
    ).toBe(0);
  });

  it("metoda bez progu: cena niezależna od wartości najmu", () => {
    expect(
      calculateDeliveryCost({
        method: "own_delivery",
        pricing: PRICING,
        rentalTotalGrosze: 1_000_000,
      }),
    ).toBe(9900);
  });

  it("metoda płatna bez cennika = DeliveryPricingError, nie 0 (zero fallbacków)", () => {
    expect(() =>
      calculateDeliveryCost({ method: "courier", pricing: null, rentalTotalGrosze: 10_000 }),
    ).toThrowError(DeliveryPricingError);
  });

  it("metoda nieobecna w cenniku = DeliveryPricingError z nazwą metody", () => {
    let caught: unknown;
    try {
      calculateDeliveryCost({ method: "parcel_locker", pricing: PRICING, rentalTotalGrosze: 0 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DeliveryPricingError);
    expect((caught as DeliveryPricingError).message).toContain("parcel_locker");
    expect((caught as DeliveryPricingError).message).toContain("delivery_pricing");
  });
});
