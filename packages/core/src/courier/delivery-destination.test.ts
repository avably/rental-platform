import { describe, expect, it } from "vitest";

import {
  destinationColumns,
  destinationMatchesMethod,
  isDeliveryPointProvider,
  methodUsesDeliveryAddress,
  methodUsesDeliveryPoint,
  type DeliveryDestination,
} from "./delivery-destination";

const POINT: DeliveryDestination = {
  kind: "point",
  point: { provider: "inpost", code: "POZ08M", address: "ul. Cumownicza 1, Poznań" },
};

const CUSTOM: DeliveryDestination = {
  kind: "custom",
  address: {
    name: "Magazyn budowy",
    street: "ul. Polna 7",
    zip: "61-001",
    city: "Poznań",
    phone: "500600700",
  },
};

describe("która metoda dokąd jedzie", () => {
  it("do punktu przewoźnika jedzie wyłącznie paczkomat", () => {
    expect(methodUsesDeliveryPoint("parcel_locker")).toBe(true);
    for (const method of ["pickup", "courier", "own_delivery"] as const) {
      expect(methodUsesDeliveryPoint(method)).toBe(false);
    }
  });

  it("pod adres jadą kurier i dostawa własna", () => {
    expect(methodUsesDeliveryAddress("courier")).toBe(true);
    expect(methodUsesDeliveryAddress("own_delivery")).toBe(true);
    expect(methodUsesDeliveryAddress("pickup")).toBe(false);
    expect(methodUsesDeliveryAddress("parcel_locker")).toBe(false);
  });

  it("odbiór osobisty nie ma celu poza własnym punktem najemcy", () => {
    expect(destinationMatchesMethod("pickup", { kind: "none" })).toBe(true);
    expect(destinationMatchesMethod("pickup", POINT)).toBe(false);
    expect(destinationMatchesMethod("pickup", { kind: "customer" })).toBe(false);
  });

  it("punkt przy kurierze i adres przy paczkomacie to sprzeczność, nie nadmiar", () => {
    expect(destinationMatchesMethod("courier", POINT)).toBe(false);
    expect(destinationMatchesMethod("parcel_locker", { kind: "customer" })).toBe(false);
    expect(destinationMatchesMethod("parcel_locker", CUSTOM)).toBe(false);
  });

  it("brak celu przy metodzie, która go potrzebuje, nie przechodzi", () => {
    expect(destinationMatchesMethod("courier", { kind: "none" })).toBe(false);
    expect(destinationMatchesMethod("parcel_locker", { kind: "none" })).toBe(false);
  });

  it("nieznany dostawca punktu nie przechodzi", () => {
    expect(isDeliveryPointProvider("inpost")).toBe(true);
    expect(isDeliveryPointProvider("kurier-z-ulicy")).toBe(false);
    expect(isDeliveryPointProvider("")).toBe(false);
  });
});

describe("destinationColumns — rozkład celu na kolumny 0044", () => {
  it("punkt niesie dostawcę i kod; adres opisowy zostaje opcjonalny", () => {
    expect(destinationColumns(POINT)).toEqual({
      deliveryPointProvider: "inpost",
      deliveryPointCode: "POZ08M",
      deliveryPointAddress: "ul. Cumownicza 1, Poznań",
      deliveryAddressSource: null,
      deliveryAddressName: null,
      deliveryAddressStreet: null,
      deliveryAddressZip: null,
      deliveryAddressCity: null,
      deliveryAddressPhone: null,
    });
  });

  it("punkt bez opisu zapisuje NULL, a nie pusty napis", () => {
    const columns = destinationColumns({
      kind: "point",
      point: { provider: "inpost", code: "POZ08M", address: null },
    });
    expect(columns.deliveryPointAddress).toBeNull();
    expect(columns.deliveryPointCode).toBe("POZ08M");
  });

  it("adres z kartoteki to WSKAŹNIK: samo źródło, zero kopii pól", () => {
    expect(destinationColumns({ kind: "customer" })).toEqual({
      deliveryPointProvider: null,
      deliveryPointCode: null,
      deliveryPointAddress: null,
      deliveryAddressSource: "customer",
      deliveryAddressName: null,
      deliveryAddressStreet: null,
      deliveryAddressZip: null,
      deliveryAddressCity: null,
      deliveryAddressPhone: null,
    });
  });

  it("inny adres to MIGAWKA: komplet pól przy źródle custom", () => {
    expect(destinationColumns(CUSTOM)).toEqual({
      deliveryPointProvider: null,
      deliveryPointCode: null,
      deliveryPointAddress: null,
      deliveryAddressSource: "custom",
      deliveryAddressName: "Magazyn budowy",
      deliveryAddressStreet: "ul. Polna 7",
      deliveryAddressZip: "61-001",
      deliveryAddressCity: "Poznań",
      deliveryAddressPhone: "500600700",
    });
  });

  it("brak celu zeruje wszystkie kolumny — nie zostawia śmieci po poprzednim wyborze", () => {
    const columns = destinationColumns({ kind: "none" });
    expect(Object.values(columns).every((value) => value === null)).toBe(true);
  });
});
