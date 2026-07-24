import { describe, expect, it } from "vitest";

import {
  carrierSearchSchema,
  shipmentCreateSchema,
  shipmentRefreshSchema,
} from "../app/[locale]/(panel)/zamowienia/[id]/delivery-validation";

const PARTY = {
  senderName: "Wypożyczalnia Testowa",
  senderStreet: "Przykładowa",
  senderHouseNumber: "1",
  senderApartmentNumber: "2",
  senderPostCode: "00-001",
  senderCity: "Miastko",
  senderPhone: "+48600000000",
  senderEmail: "nadawca@example.com",
  recipientName: "Jan Testowy",
  recipientStreet: "Próbna",
  recipientHouseNumber: "12",
  recipientApartmentNumber: "3",
  recipientPostCode: "11-111",
  recipientCity: "Wieśno",
  recipientPhone: "+48611111111",
  recipientEmail: "klient@example.com",
};

const VALID = {
  orderId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  shipmentType: "outbound",
  lengthCm: "60",
  widthCm: "40",
  heightCm: "30",
  weightKg: "10.5",
  content: "Sprzęt na wynajem",
  productId: "",
  insurance: "",
  insuranceValuePln: "",
  saturdayDelivery: "",
  ...PARTY,
};

describe("shipmentCreateSchema", () => {
  it("akceptuje poprawne dane i koercjonuje wymiary do liczb", () => {
    const parsed = shipmentCreateSchema.parse(VALID);
    expect(parsed.lengthCm).toBe(60);
    expect(parsed.weightKg).toBe(10.5);
    expect(parsed.shipmentType).toBe("outbound");
    expect(parsed.recipientName).toBe("Jan Testowy");
    expect(parsed.senderEmail).toBe("nadawca@example.com");
  });

  it("pusty numer lokalu znika (undefined), nie zostaje pustym stringiem", () => {
    const parsed = shipmentCreateSchema.parse({ ...VALID, recipientApartmentNumber: " " });
    expect(parsed.recipientApartmentNumber).toBeUndefined();
  });

  it("brak wyboru przewoźnika: productId undefined (bestPrice dobiera najtańszy)", () => {
    const parsed = shipmentCreateSchema.parse(VALID);
    expect(parsed.productId).toBeUndefined();
    expect(parsed.insurance).toBe(false);
    expect(parsed.saturdayDelivery).toBe(false);
  });

  it("dostawa w sobotę: checkbox 'on' → boolean true (uniwersalny, bez wartości)", () => {
    const parsed = shipmentCreateSchema.parse({ ...VALID, saturdayDelivery: "on" });
    expect(parsed.saturdayDelivery).toBe(true);
  });

  it("wybrany przewoźnik: productId koercjonowany do liczby całkowitej", () => {
    const parsed = shipmentCreateSchema.parse({ ...VALID, productId: "4242" });
    expect(parsed.productId).toBe(4242);
  });

  it("ubezpieczenie: checkbox 'on' + wartość → boolean true i liczba PLN", () => {
    const parsed = shipmentCreateSchema.parse({
      ...VALID,
      insurance: "on",
      insuranceValuePln: "1500",
    });
    expect(parsed.insurance).toBe(true);
    expect(parsed.insuranceValuePln).toBe(1500);
  });

  it("ubezpieczenie zaznaczone bez wartości → odrzucone", () => {
    expect(
      shipmentCreateSchema.safeParse({ ...VALID, insurance: "on", insuranceValuePln: "" })
        .success,
    ).toBe(false);
  });

  it.each([
    ["typ spoza listy", { shipmentType: "sideways" }],
    ["orderId nie-uuid", { orderId: "nie-uuid" }],
    ["wymiar zerowy", { lengthCm: "0" }],
    ["wymiar ujemny", { widthCm: "-5" }],
    ["waga poza zakresem (pomyłka jednostek)", { weightKg: "10500" }],
    ["pusty numer domu nadawcy", { senderHouseNumber: "  " }],
    ["pusty odbiorca", { recipientName: "" }],
    ["e-mail odbiorcy nieprawidłowy", { recipientEmail: "to-nie-email" }],
    ["pusty kod pocztowy nadawcy", { senderPostCode: "" }],
    ["pusta zawartość", { content: "" }],
    ["zawartość za długa", { content: "x".repeat(201) }],
    ["productId ujemny", { productId: "-3" }],
  ])("odrzuca: %s", (_label, patch) => {
    expect(shipmentCreateSchema.safeParse({ ...VALID, ...patch }).success).toBe(false);
  });
});

describe("carrierSearchSchema", () => {
  const SEARCH = {
    orderId: VALID.orderId,
    senderPostCode: "00-001",
    receiverPostCode: "11-111",
    lengthCm: "60",
    widthCm: "40",
    heightCm: "30",
    weightKg: "10",
  };

  it("akceptuje dwa kody + gabaryty i koercjonuje wymiary", () => {
    const parsed = carrierSearchSchema.parse(SEARCH);
    expect(parsed.senderPostCode).toBe("00-001");
    expect(parsed.lengthCm).toBe(60);
  });

  it.each([
    ["brak kodu nadania", { senderPostCode: "" }],
    ["brak kodu doręczenia", { receiverPostCode: "" }],
    ["wymiar zerowy", { widthCm: "0" }],
  ])("odrzuca: %s", (_label, patch) => {
    expect(carrierSearchSchema.safeParse({ ...SEARCH, ...patch }).success).toBe(false);
  });
});

describe("shipmentRefreshSchema", () => {
  it("wymaga uuid przesyłki", () => {
    expect(shipmentRefreshSchema.safeParse({ shipmentId: VALID.orderId }).success).toBe(true);
    expect(shipmentRefreshSchema.safeParse({ shipmentId: "x" }).success).toBe(false);
  });
});
