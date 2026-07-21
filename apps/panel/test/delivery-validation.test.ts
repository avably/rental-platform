import { describe, expect, it } from "vitest";

import {
  shipmentCreateSchema,
  shipmentRefreshSchema,
} from "../app/[locale]/(panel)/zamowienia/[id]/delivery-validation";

const VALID = {
  orderId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  shipmentType: "outbound",
  houseNumber: "12",
  apartmentNumber: "3",
  lengthCm: "60",
  widthCm: "40",
  heightCm: "30",
  weightKg: "10.5",
  content: "Sprzęt na wynajem",
};

describe("shipmentCreateSchema", () => {
  it("akceptuje poprawne dane i koercjonuje wymiary do liczb", () => {
    const parsed = shipmentCreateSchema.parse(VALID);
    expect(parsed.lengthCm).toBe(60);
    expect(parsed.weightKg).toBe(10.5);
    expect(parsed.shipmentType).toBe("outbound");
  });

  it("pusty numer lokalu znika (undefined), nie zostaje pustym stringiem", () => {
    const parsed = shipmentCreateSchema.parse({ ...VALID, apartmentNumber: " " });
    expect(parsed.apartmentNumber).toBeUndefined();
  });

  it.each([
    ["typ spoza listy", { shipmentType: "sideways" }],
    ["orderId nie-uuid", { orderId: "nie-uuid" }],
    ["wymiar zerowy", { lengthCm: "0" }],
    ["wymiar ujemny", { widthCm: "-5" }],
    ["waga poza zakresem (pomyłka jednostek)", { weightKg: "10500" }],
    ["pusty numer domu", { houseNumber: "  " }],
    ["pusta zawartość", { content: "" }],
    ["zawartość za długa", { content: "x".repeat(201) }],
  ])("odrzuca: %s", (_label, patch) => {
    expect(shipmentCreateSchema.safeParse({ ...VALID, ...patch }).success).toBe(false);
  });
});

describe("shipmentRefreshSchema", () => {
  it("wymaga uuid przesyłki", () => {
    expect(
      shipmentRefreshSchema.safeParse({ shipmentId: VALID.orderId }).success,
    ).toBe(true);
    expect(shipmentRefreshSchema.safeParse({ shipmentId: "x" }).success).toBe(false);
  });
});
