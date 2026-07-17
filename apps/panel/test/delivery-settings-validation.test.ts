import { describe, expect, it } from "vitest";

import {
  deliverySettingsCredentialsSchema,
  deliverySettingsParcelSchema,
  deliverySettingsPricingSchema,
  deliverySettingsSenderSchema,
} from "../app/[locale]/ustawienia-dostaw/delivery-settings-validation";

describe("deliverySettingsCredentialsSchema", () => {
  it("akceptuje poprawne credentiale", () => {
    expect(
      deliverySettingsCredentialsSchema.safeParse({
        email: "kurier@example.com",
        password: "haslo",
        environment: "test",
      }).success,
    ).toBe(true);
  });

  it.each([
    ["zły e-mail", { email: "x", password: "haslo", environment: "test" }],
    ["puste hasło", { email: "kurier@example.com", password: "", environment: "test" }],
    ["środowisko spoza listy", { email: "kurier@example.com", password: "h", environment: "prod" }],
  ])("odrzuca: %s", (_label, input) => {
    expect(deliverySettingsCredentialsSchema.safeParse(input).success).toBe(false);
  });
});

describe("deliverySettingsSenderSchema", () => {
  const VALID = {
    name: "Wypożyczalnia Testowa",
    street: "Przykładowa",
    houseNumber: "1",
    apartmentNumber: "",
    postCode: "00-001",
    city: "Miastko",
    phone: "+48600000000",
    email: "nadawca@example.com",
  };

  it("produkuje jsonb w kształcie bazy (snake_case), bez pustego numeru lokalu", () => {
    const parsed = deliverySettingsSenderSchema.parse(VALID);
    expect(parsed).toEqual({
      name: "Wypożyczalnia Testowa",
      street: "Przykładowa",
      house_number: "1",
      post_code: "00-001",
      city: "Miastko",
      phone: "+48600000000",
      email: "nadawca@example.com",
    });
    expect(parsed).not.toHaveProperty("apartment_number");
  });

  it("odrzuca brak telefonu", () => {
    expect(deliverySettingsSenderSchema.safeParse({ ...VALID, phone: " " }).success).toBe(false);
  });
});

describe("deliverySettingsParcelSchema", () => {
  it("koercjonuje i mapuje na snake_case", () => {
    expect(
      deliverySettingsParcelSchema.parse({
        lengthCm: "60",
        widthCm: "40",
        heightCm: "30",
        weightKg: "10.5",
      }),
    ).toEqual({ length_cm: 60, width_cm: 40, height_cm: 30, weight_kg: 10.5 });
  });

  it("odrzuca wymiar zerowy", () => {
    expect(
      deliverySettingsParcelSchema.safeParse({
        lengthCm: "0",
        widthCm: "40",
        heightCm: "30",
        weightKg: "10",
      }).success,
    ).toBe(false);
  });
});

describe("deliverySettingsPricingSchema", () => {
  const EMPTY = {
    courierPrice: "",
    courierFreeAbove: "",
    parcelLockerPrice: "",
    parcelLockerFreeAbove: "",
    ownDeliveryPrice: "",
    ownDeliveryFreeAbove: "",
  };

  it("złote → grosze, metody bez ceny pominięte, próg opcjonalny", () => {
    const parsed = deliverySettingsPricingSchema.parse({
      ...EMPTY,
      courierPrice: "25,00",
      courierFreeAbove: "500",
      ownDeliveryPrice: "99.99",
    });
    expect(parsed).toEqual({
      courier: { price_grosze: 2500, free_above_grosze: 50_000 },
      own_delivery: { price_grosze: 9999 },
    });
    expect(parsed).not.toHaveProperty("parcel_locker");
  });

  it("pusty cennik jest legalny (pusty obiekt)", () => {
    expect(deliverySettingsPricingSchema.parse(EMPTY)).toEqual({});
  });

  it("próg bez ceny → odrzucony, nie cicho zgubiony", () => {
    expect(
      deliverySettingsPricingSchema.safeParse({ ...EMPTY, courierFreeAbove: "500" }).success,
    ).toBe(false);
  });

  it("nieprawidłowa kwota → odrzucona", () => {
    expect(
      deliverySettingsPricingSchema.safeParse({ ...EMPTY, courierPrice: "25,999" }).success,
    ).toBe(false);
  });
});
