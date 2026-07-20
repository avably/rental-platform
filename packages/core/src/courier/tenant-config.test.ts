import { describe, expect, it } from "vitest";

import {
  COURIER_CONFIG_KEYS,
  COURIER_PARCEL_KEY,
  COURIER_SENDER_KEY,
  CourierConfigError,
  DELIVERY_PRICING_KEY,
  GLOBKURIER_CREDENTIALS_KEY,
  courierConfigFromSettings,
  deliveryPricingFromSettings,
  type TenantSettingRow,
} from "./tenant-config";

/** Poprawny komplet ustawień — dane FIKCYJNE (wymóg planu: zero realnych adresów). */
const VALID_ROWS: TenantSettingRow[] = [
  {
    key: GLOBKURIER_CREDENTIALS_KEY,
    value: { email: "kurier@example.com", environment: "test" },
  },
  {
    key: COURIER_SENDER_KEY,
    value: {
      name: "Wypożyczalnia Testowa",
      street: "Przykładowa",
      house_number: "1",
      apartment_number: "2",
      post_code: "00-001",
      city: "Miastko",
      phone: "+48600000000",
      email: "nadawca@example.com",
    },
  },
  {
    key: COURIER_PARCEL_KEY,
    value: { length_cm: 60, width_cm: 40, height_cm: 30, weight_kg: 10.5 },
  },
];

const PASSWORD = "haslo-testowe";

function configError(
  rows: TenantSettingRow[],
  password: string | null = PASSWORD,
): CourierConfigError {
  try {
    courierConfigFromSettings(rows, password);
  } catch (err) {
    if (err instanceof CourierConfigError) return err;
    throw err;
  }
  throw new Error("Oczekiwano CourierConfigError, a konfiguracja przeszła");
}

describe("courierConfigFromSettings", () => {
  it("komplet ustawień mapowany na camelCase konfiguracji", () => {
    const config = courierConfigFromSettings(VALID_ROWS, PASSWORD);
    expect(config.credentials).toEqual({
      email: "kurier@example.com",
      password: "haslo-testowe",
      environment: "test",
    });
    expect(config.sender).toEqual({
      name: "Wypożyczalnia Testowa",
      street: "Przykładowa",
      houseNumber: "1",
      apartmentNumber: "2",
      postCode: "00-001",
      city: "Miastko",
      phone: "+48600000000",
      email: "nadawca@example.com",
    });
    expect(config.parcel).toEqual({ lengthCm: 60, widthCm: 40, heightCm: 30, weightKg: 10.5 });
  });

  it("nadawca bez numeru lokalu: pole opcjonalne pominięte, nie undefined-wpisane", () => {
    const rows = VALID_ROWS.map((row) =>
      row.key === COURIER_SENDER_KEY
        ? {
            key: row.key,
            value: { ...(row.value as Record<string, unknown>), apartment_number: undefined },
          }
        : row,
    );
    const config = courierConfigFromSettings(rows, PASSWORD);
    expect(config.sender.apartmentNumber).toBeUndefined();
  });

  it("brak konfiguracji tenanta = czytelny błąd konfiguracji, nigdy cichy default", () => {
    const err = configError([]);
    // Trzy braki wymienione z klucza — operator ma wiedzieć, CO uzupełnić.
    expect(err.problems).toHaveLength(3);
    expect(err.message).toContain(GLOBKURIER_CREDENTIALS_KEY);
    expect(err.message).toContain(COURIER_SENDER_KEY);
    expect(err.message).toContain(COURIER_PARCEL_KEY);
  });

  it("częściowa konfiguracja: wymienia wyłącznie brakujące klucze", () => {
    const err = configError(VALID_ROWS.filter((r) => r.key !== COURIER_PARCEL_KEY));
    expect(err.problems).toHaveLength(1);
    expect(err.message).toContain(COURIER_PARCEL_KEY);
    expect(err.message).not.toContain(GLOBKURIER_CREDENTIALS_KEY);
  });

  it("brak zapisanego hasła: problem na tej samej liście co pozostałe braki (ADR-052)", () => {
    // Hasło nie leży już w tenant_settings, ale jego brak ma być dla operatora
    // TYM SAMYM rodzajem zdarzenia co brak nadawcy — jedna lista do uzupełnienia,
    // nie osobna, tajemnicza awaria dopiero przy próbie nadania.
    const err = configError(VALID_ROWS, null);
    expect(err.problems).toHaveLength(1);
    expect(err.problems.join(" ")).toContain("hasła");
  });

  it("hasło przemycone do części jawnej jest ignorowane — liczy się sekret", () => {
    // Zapora przed regresem: gdyby ktoś odłożył hasło do jsonb (CHECK 0024
    // tego zabrania, ale parser nie ma na tym polegać), konfiguracja bierze
    // wartość z zaszyfrowanego magazynu, a nie z jawnego ustawienia.
    const rows = VALID_ROWS.map((row) =>
      row.key === GLOBKURIER_CREDENTIALS_KEY
        ? {
            key: row.key,
            value: { ...(row.value as Record<string, unknown>), password: "przemycone" },
          }
        : row,
    );
    const config = courierConfigFromSettings(rows, PASSWORD);
    expect(config.credentials.password).toBe(PASSWORD);
  });

  it("nadawca bez telefonu: problem wskazuje pole", () => {
    const rows = VALID_ROWS.map((row) =>
      row.key === COURIER_SENDER_KEY
        ? {
            key: row.key,
            value: { ...(row.value as Record<string, unknown>), phone: "" },
          }
        : row,
    );
    const err = configError(rows);
    expect(err.problems.join(" ")).toContain("phone");
  });

  it("paczka z zerową wagą: problem wskazuje pole", () => {
    const rows = VALID_ROWS.map((row) =>
      row.key === COURIER_PARCEL_KEY
        ? { key: row.key, value: { length_cm: 60, width_cm: 40, height_cm: 30, weight_kg: 0 } }
        : row,
    );
    const err = configError(rows);
    expect(err.problems.join(" ")).toContain("weight_kg");
  });

  it("credentiale ze złym środowiskiem: problem wskazuje pole", () => {
    const rows = VALID_ROWS.map((row) =>
      row.key === GLOBKURIER_CREDENTIALS_KEY
        ? {
            key: row.key,
            value: { email: "kurier@example.com", environment: "prod" },
          }
        : row,
    );
    const err = configError(rows);
    expect(err.problems.join(" ")).toContain("environment");
  });

  it("COURIER_CONFIG_KEYS to dokładnie trzy klucze konfiguracji kuriera", () => {
    expect([...COURIER_CONFIG_KEYS].sort()).toEqual(
      [GLOBKURIER_CREDENTIALS_KEY, COURIER_SENDER_KEY, COURIER_PARCEL_KEY].sort(),
    );
  });
});

describe("deliveryPricingFromSettings", () => {
  it("brak klucza delivery_pricing → null (rozstrzyga calculateDeliveryCost)", () => {
    expect(deliveryPricingFromSettings(VALID_ROWS)).toBeNull();
  });

  it("poprawny cennik mapowany na camelCase, metody nieskonfigurowane pominięte", () => {
    const pricing = deliveryPricingFromSettings([
      {
        key: DELIVERY_PRICING_KEY,
        value: {
          courier: { price_grosze: 2500, free_above_grosze: 50_000 },
          own_delivery: { price_grosze: 9900 },
        },
      },
    ]);
    expect(pricing).toEqual({
      courier: { priceGrosze: 2500, freeAboveGrosze: 50_000 },
      own_delivery: { priceGrosze: 9900 },
    });
    expect(pricing).not.toHaveProperty("parcel_locker");
  });

  it("ujemna cena w cenniku → CourierConfigError (nie ciche pominięcie)", () => {
    expect(() =>
      deliveryPricingFromSettings([
        { key: DELIVERY_PRICING_KEY, value: { courier: { price_grosze: -1 } } },
      ]),
    ).toThrowError(CourierConfigError);
  });
});
