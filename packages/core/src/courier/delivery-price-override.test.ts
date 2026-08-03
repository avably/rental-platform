import { describe, expect, it } from "vitest";

import {
  DELIVERY_PRICE_OVERRIDE_MAX_GROSZE,
  DeliveryPriceOverrideError,
  DeliveryPricingError,
  resolveDeliveryCost,
} from "./delivery-pricing";
import type { DeliveryPricing } from "./types";

const PRICING: DeliveryPricing = {
  courier: { priceGrosze: 2500, freeAboveGrosze: 50_000 },
  parcel_locker: { priceGrosze: 1200 },
};

describe("resolveDeliveryCost — cennik jako propozycja", () => {
  it("bez nadpisania liczy dokładnie to, co cennik, i mówi że to cennik", () => {
    expect(
      resolveDeliveryCost({
        method: "courier",
        pricing: PRICING,
        rentalTotalGrosze: 30_000,
        overrideGrosze: null,
      }),
    ).toEqual({ grosze: 2500, source: "pricing" });
  });

  it("bez nadpisania respektuje próg darmowej dostawy", () => {
    expect(
      resolveDeliveryCost({
        method: "courier",
        pricing: PRICING,
        rentalTotalGrosze: 50_000,
        overrideGrosze: null,
      }),
    ).toEqual({ grosze: 0, source: "pricing" });
  });

  it("bez nadpisania metoda płatna bez cennika nadal jest błędem konfiguracji, nie darmową dostawą", () => {
    expect(() =>
      resolveDeliveryCost({
        method: "own_delivery",
        pricing: PRICING,
        rentalTotalGrosze: 10_000,
        overrideGrosze: null,
      }),
    ).toThrow(DeliveryPricingError);
  });
});

describe("resolveDeliveryCost — nadpisanie ręczne", () => {
  it("nadpisanie wygrywa z cennikiem i jest oznaczone jako ręczne", () => {
    expect(
      resolveDeliveryCost({
        method: "courier",
        pricing: PRICING,
        rentalTotalGrosze: 30_000,
        overrideGrosze: 999,
      }),
    ).toEqual({ grosze: 999, source: "manual" });
  });

  it("nadpisanie wygrywa także nad progiem darmowej dostawy (operator wie lepiej)", () => {
    expect(
      resolveDeliveryCost({
        method: "courier",
        pricing: PRICING,
        rentalTotalGrosze: 90_000,
        overrideGrosze: 1500,
      }),
    ).toEqual({ grosze: 1500, source: "manual" });
  });

  it("nadpisanie działa BEZ cennika — ręczna cena jest odpowiedzią na jego brak", () => {
    expect(
      resolveDeliveryCost({
        method: "own_delivery",
        pricing: null,
        rentalTotalGrosze: 10_000,
        overrideGrosze: 4900,
      }),
    ).toEqual({ grosze: 4900, source: "manual" });
  });

  it("zero jest poprawnym nadpisaniem — dostawa gratis to decyzja, nie brak danych", () => {
    expect(
      resolveDeliveryCost({
        method: "parcel_locker",
        pricing: PRICING,
        rentalTotalGrosze: 10_000,
        overrideGrosze: 0,
      }),
    ).toEqual({ grosze: 0, source: "manual" });
  });

  it("granica jest INCLUSIVE, a grosz ponad nią to odmowa", () => {
    expect(
      resolveDeliveryCost({
        method: "courier",
        pricing: PRICING,
        rentalTotalGrosze: 0,
        overrideGrosze: DELIVERY_PRICE_OVERRIDE_MAX_GROSZE,
      }),
    ).toEqual({ grosze: DELIVERY_PRICE_OVERRIDE_MAX_GROSZE, source: "manual" });

    expect(() =>
      resolveDeliveryCost({
        method: "courier",
        pricing: PRICING,
        rentalTotalGrosze: 0,
        overrideGrosze: DELIVERY_PRICE_OVERRIDE_MAX_GROSZE + 1,
      }),
    ).toThrow(DeliveryPriceOverrideError);
  });

  it("kwota ujemna jest odrzucana, nie podnoszona do zera", () => {
    expect(() =>
      resolveDeliveryCost({
        method: "courier",
        pricing: PRICING,
        rentalTotalGrosze: 0,
        overrideGrosze: -1,
      }),
    ).toThrow(DeliveryPriceOverrideError);
  });

  it("ułamek grosza jest odrzucany, nie zaokrąglany", () => {
    expect(() =>
      resolveDeliveryCost({
        method: "courier",
        pricing: PRICING,
        rentalTotalGrosze: 0,
        overrideGrosze: 1990.5,
      }),
    ).toThrow(DeliveryPriceOverrideError);
  });

  it("odbiór osobisty nie przyjmuje ceny — inaczej byłyby dwie sprzeczne definicje metody", () => {
    expect(() =>
      resolveDeliveryCost({
        method: "pickup",
        pricing: PRICING,
        rentalTotalGrosze: 0,
        overrideGrosze: 500,
      }),
    ).toThrow(DeliveryPriceOverrideError);
  });
});
