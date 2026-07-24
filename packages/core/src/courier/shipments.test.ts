import { describe, expect, it } from "vitest";

import {
  buildBestPriceRequest,
  courierOfferFromProduct,
  mapProviderStatus,
  type ShipmentParty,
} from "./shipments";
import type { CourierSender, GlobKurierProduct, ParcelDimensions } from "./types";

const SENDER: CourierSender = {
  name: "Wypożyczalnia Testowa",
  street: "Przykładowa",
  houseNumber: "1",
  postCode: "00-001",
  city: "Miastko",
  phone: "+48600000000",
  email: "nadawca@example.com",
};

const CUSTOMER: ShipmentParty = {
  name: "Jan Testowy",
  street: "Próbna",
  houseNumber: "2",
  apartmentNumber: "3",
  postCode: "11-111",
  city: "Wieśno",
  phone: "+48611111111",
  email: "klient@example.com",
};

const PARCEL: ParcelDimensions = { lengthCm: 60, widthCm: 40, heightCm: 30, weightKg: 10 };

describe("buildBestPriceRequest", () => {
  it("outbound: nadawca tenanta → klient, gabaryty i stałe żądania na miejscu", () => {
    const req = buildBestPriceRequest({
      type: "outbound",
      sender: SENDER,
      customer: CUSTOMER,
      parcel: PARCEL,
      content: "Sprzęt na wynajem",
      referenceNumber: "AV-2026-001",
    });
    expect(req.senderAddress).toMatchObject({
      name: "Wypożyczalnia Testowa",
      street: "Przykładowa",
      houseNumber: "1",
      postCode: "00-001",
      city: "Miastko",
      country: "PL",
    });
    expect(req.receiverAddress).toMatchObject({
      name: "Jan Testowy",
      houseNumber: "2",
      apartmentNumber: "3",
      country: "PL",
    });
    expect(req.shipment).toEqual({ length: 60, width: 40, height: 30, weight: 10, quantity: 1 });
    expect(req).toMatchObject({
      content: "Sprzęt na wynajem",
      referenceNumber: "AV-2026-001",
      paymentId: 9,
      collectionType: "PICKUP",
      deliveryType: "PICKUP",
      purpose: "NOT_SOLD",
      receiverType: "PRIVATE_PERSON",
      agreements: { receiveElectronicBills: true, processingPersonalData: true },
    });
  });

  it("zwrot jest LUSTREM wysyłki: adresy zamienione, reszta identyczna (wzorzec pierwowzoru)", () => {
    const params = {
      sender: SENDER,
      customer: CUSTOMER,
      parcel: PARCEL,
      content: "Sprzęt",
      referenceNumber: "AV-2026-001",
    };
    const outbound = buildBestPriceRequest({ type: "outbound", ...params });
    const ret = buildBestPriceRequest({ type: "return", ...params });
    expect(ret.senderAddress).toEqual(outbound.receiverAddress);
    expect(ret.receiverAddress).toEqual(outbound.senderAddress);
    expect(ret.shipment).toEqual(outbound.shipment);
    expect(ret.paymentId).toBe(outbound.paymentId);
    expect(ret.content).toBe(outbound.content);
  });

  it("nadawca bez numeru lokalu nie wstrzykuje pola apartmentNumber", () => {
    const req = buildBestPriceRequest({
      type: "outbound",
      sender: SENDER,
      customer: { ...CUSTOMER, apartmentNumber: undefined },
      parcel: PARCEL,
      content: "Sprzęt",
      referenceNumber: "AV-2026-001",
    });
    expect(req.senderAddress).not.toHaveProperty("apartmentNumber");
    expect(req.receiverAddress).not.toHaveProperty("apartmentNumber");
  });

  it("wybrany przewoźnik: productId przypina produkt w shipment (bramka wyboru)", () => {
    const req = buildBestPriceRequest({
      type: "outbound",
      sender: SENDER,
      customer: CUSTOMER,
      parcel: PARCEL,
      content: "Sprzęt",
      referenceNumber: "AV-2026-001",
      productId: 4242,
    });
    // To jest DOWÓD MUTACYJNY wyboru przewoźnika: bez przeniesienia productId
    // do shipment bestPrice dobiera najtańszy sam, a wybór operatora znika.
    expect(req.shipment.productId).toBe(4242);
  });

  it("bez wyboru: brak productId → bestPrice dobiera najtańszy (zachowanie sprzed wyszukiwarki)", () => {
    const req = buildBestPriceRequest({
      type: "outbound",
      sender: SENDER,
      customer: CUSTOMER,
      parcel: PARCEL,
      content: "Sprzęt",
      referenceNumber: "AV-2026-001",
    });
    expect(req.shipment).not.toHaveProperty("productId");
    expect(req.addons).toBeUndefined();
  });

  it("ubezpieczenie: zadeklarowana wartość → addons.INSURANCE (kategoria, nie ADDON_ID)", () => {
    const req = buildBestPriceRequest({
      type: "outbound",
      sender: SENDER,
      customer: CUSTOMER,
      parcel: PARCEL,
      content: "Sprzęt",
      referenceNumber: "AV-2026-001",
      insuranceValuePln: 1500,
    });
    expect(req.addons).toEqual({ INSURANCE: { value: 1500 } });
  });
});

const PRODUCT: GlobKurierProduct = {
  id: 4242,
  name: "Paczka standard",
  carrierName: "Przewoźnik A",
  carrierLogo: "https://logo.example/a.png",
  priceGross: 23.45,
  priceNet: 19.06,
  currency: "PLN",
  deliveryTime: "1-2 dni",
  deliveryDays: 2,
  collectionType: "PICKUP",
  serviceCode: "STD",
};

describe("courierOfferFromProduct", () => {
  it("produkt API → oferta UI: cena w groszach (int), productId zachowany", () => {
    const offer = courierOfferFromProduct(PRODUCT);
    expect(offer).toEqual({
      productId: 4242,
      carrierName: "Przewoźnik A",
      carrierLogo: "https://logo.example/a.png",
      priceGrosze: 2345,
      currency: "PLN",
      deliveryDays: 2,
      deliveryTime: "1-2 dni",
      serviceCode: "STD",
    });
  });

  it("pola opcjonalne (logo/serviceCode/czas) nieobecne, gdy API ich nie podało", () => {
    const offer = courierOfferFromProduct({
      id: 7,
      name: "",
      carrierName: "Przewoźnik B",
      priceGross: 10,
      priceNet: 8.13,
      currency: "PLN",
      collectionType: "PICKUP",
    });
    expect(offer.priceGrosze).toBe(1000);
    expect(offer).not.toHaveProperty("carrierLogo");
    expect(offer).not.toHaveProperty("serviceCode");
    expect(offer).not.toHaveProperty("deliveryDays");
  });
});

describe("mapProviderStatus", () => {
  it("znane statusy dostawcy mapowane na wewnętrzny cykl życia", () => {
    expect(mapProviderStatus("NEW_SHIPMENT")).toBe("created");
    expect(mapProviderStatus("IN_PROGRESS")).toBe("in_progress");
    expect(mapProviderStatus("IN_TRANSIT")).toBe("in_transit");
    expect(mapProviderStatus("DELIVERED")).toBe("delivered");
    expect(mapProviderStatus("CANCELED")).toBe("cancelled");
    expect(mapProviderStatus("RETURNED_TO_SENDER")).toBe("returned_to_sender");
  });

  it("nieznany status → null: dryf API dostawcy nie może wywalać syncu (ADR-031)", () => {
    expect(mapProviderStatus("COŚ_NOWEGO")).toBeNull();
    expect(mapProviderStatus("")).toBeNull();
  });
});
