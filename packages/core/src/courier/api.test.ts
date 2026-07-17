/**
 * Testy KONTRAKTOWE klienta GlobKurier — nagrany kontrakt (fixtures) zamiast
 * żywego API: kształty odpowiedzi wg dokumentacji dostawcy, dane WYŁĄCZNIE
 * fikcyjne (wymóg planu fazy 1 — CI nie bije w sieć, zero credentiali w repo).
 */
import { describe, expect, it, vi } from "vitest";

import { GlobKurierAPI, GlobKurierAPIError } from "./api";
import type { CourierCredentials, GlobKurierBestPriceRequest } from "./types";

const CREDS: CourierCredentials = {
  email: "kurier@example.com",
  password: "haslo-testowe",
  environment: "test",
};

/** Nagrany kontrakt: kształty odpowiedzi wg dokumentacji API, dane fikcyjne. */
const FIX = {
  login: { token: "tok-123" },
  productsFlat: {
    standard: [
      {
        id: 42,
        name: "Kurier standard",
        carrierName: "Przewoźnik X",
        grossPrice: 25.09,
        netPrice: 20.4,
        currency: { code: "PLN" },
        averageDelivery: 1,
        serviceCode: "STD",
      },
    ],
  },
  bestPrice: {
    orders: [{ number: "GK260717000001", hash: "hash-abc", trackingNumber: "TRK1" }],
    totalGrossPrice: 30.75,
    totalNetPrice: 25,
    currency: "PLN",
    vatPercent: 23,
    status: "NEW_SHIPMENT",
    creationDate: "2026-07-17T10:00:00Z",
  },
  order: {
    number: "GK260717000001",
    hash: "hash-abc",
    status: "IN_TRANSIT",
    creationDate: "2026-07-17T10:00:00Z",
    pricing: { priceGross: 30.75, priceNet: 25, vatPercent: 23, currency: "PLN" },
    trackingNumber: "TRK1",
    trackingUrl: "https://example.com/t/TRK1",
  },
  labels: { items: [{ type: "WAYBILL", format: "PDF", content: "JVBERi0x" }] },
  error422: {
    message: "Validation failed",
    code: "VALIDATION",
    errors: { "receiverAddress.postCode": ["invalid"] },
  },
} as const;

type Route = {
  match: (url: string, init?: RequestInit) => boolean;
  respond: () => Response;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchStub(routes: Route[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find((r) => r.match(url, init));
    if (!route) throw new Error(`Brak trasy fixture dla: ${url}`);
    return route.respond();
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const loginRoute: Route = {
  match: (url) => url.endsWith("/auth/login"),
  respond: () => json(FIX.login),
};

const BEST_PRICE_REQ: GlobKurierBestPriceRequest = {
  shipment: { length: 60, width: 40, height: 30, weight: 10, quantity: 1 },
  senderAddress: {
    name: "Wypożyczalnia Testowa",
    city: "Miastko",
    street: "Przykładowa",
    houseNumber: "1",
    postCode: "00-001",
    country: "PL",
    phone: "+48600000000",
    email: "nadawca@example.com",
  },
  receiverAddress: {
    name: "Jan Testowy",
    city: "Wieśno",
    street: "Próbna",
    houseNumber: "2",
    postCode: "11-111",
    country: "PL",
    phone: "+48611111111",
    email: "klient@example.com",
  },
  content: "Sprzęt na wynajem",
  paymentId: 9,
  agreements: { receiveElectronicBills: true, processingPersonalData: true },
  collectionType: "PICKUP",
  deliveryType: "PICKUP",
  referenceNumber: "AV-2026-001",
};

describe("GlobKurierAPI (kontrakt na fixtures)", () => {
  it("loguje się raz i cache'uje token per INSTANCJĘ (nie per moduł)", async () => {
    const a = fetchStub([
      loginRoute,
      { match: (url) => url.includes("/order?number="), respond: () => json(FIX.order) },
    ]);
    const apiA = new GlobKurierAPI(CREDS, { fetchImpl: a.impl });
    await apiA.getOrder("GK260717000001");
    await apiA.getOrder("GK260717000001");
    const loginsA = a.calls.filter((c) => c.url.endsWith("/auth/login")).length;
    expect(loginsA, "drugie wywołanie ma użyć tokenu z cache").toBe(1);

    // Druga instancja (inny tenant) MUSI zalogować się własnym kontem —
    // cache modułowy z pierwowzoru dałby tu 0 logowań i CUDZY token.
    const b = fetchStub([
      loginRoute,
      { match: (url) => url.includes("/order?number="), respond: () => json(FIX.order) },
    ]);
    const apiB = new GlobKurierAPI(
      { ...CREDS, email: "inny@example.com" },
      { fetchImpl: b.impl },
    );
    await apiB.getOrder("GK260717000001");
    expect(
      b.calls.filter((c) => c.url.endsWith("/auth/login")).length,
      "świeża instancja nie może dziedziczyć tokenu innej instancji",
    ).toBe(1);
  });

  it("środowisko credentiali steruje adresem API", async () => {
    const s = fetchStub([
      {
        match: (url) => url.startsWith("https://api.globkurier.pl/v1/auth/login"),
        respond: () => json(FIX.login),
      },
      { match: (url) => url.includes("/order?number="), respond: () => json(FIX.order) },
    ]);
    const api = new GlobKurierAPI({ ...CREDS, environment: "production" }, { fetchImpl: s.impl });
    await api.getOrder("GK260717000001");
    expect(s.calls[0]!.url).toBe("https://api.globkurier.pl/v1/auth/login");
  });

  it("searchProducts: parametry zapytania + mapowanie listy flat", async () => {
    const s = fetchStub([
      loginRoute,
      { match: (url) => url.includes("/products?"), respond: () => json(FIX.productsFlat) },
    ]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    const products = await api.searchProducts({
      senderPostCode: "00-001",
      senderCountryId: 1,
      receiverPostCode: "11-111",
      receiverCountryId: 1,
      length: 60,
      width: 40,
      height: 30,
      weight: 10,
    });
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: 42,
      carrierName: "Przewoźnik X",
      priceGross: 25.09,
      priceNet: 20.4,
      currency: "PLN",
      deliveryDays: 1,
      serviceCode: "STD",
    });
    const url = s.calls.find((c) => c.url.includes("/products?"))!.url;
    expect(url).toContain("senderPostCode=00-001");
    expect(url).toContain("collectionTypes%5B%5D=POINT");
    expect(url).toContain("deliveryTypes%5B%5D=POINT");
  });

  it("createOrderBestPrice: wyciąga numer/hash/tracking z tablicy orders", async () => {
    const s = fetchStub([
      loginRoute,
      { match: (url) => url.includes("/order/bestPrice"), respond: () => json(FIX.bestPrice) },
    ]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    const res = await api.createOrderBestPrice(BEST_PRICE_REQ);
    expect(res).toMatchObject({
      number: "GK260717000001",
      hash: "hash-abc",
      trackingNumber: "TRK1",
      status: "NEW_SHIPMENT",
      pricing: { priceGross: 30.75, priceNet: 25, vatPercent: 23, currency: "PLN" },
    });
    const call = s.calls.find((c) => c.url.includes("/order/bestPrice"))!;
    expect(call.url).toContain("createFully=true");
    expect(call.url).toContain("onlyPricing=false");
    expect(JSON.parse(String(call.init?.body))).toMatchObject({
      referenceNumber: "AV-2026-001",
    });
  });

  it("createOrderBestPrice z onlyPricing: nie tworzy zamówienia, zwraca wycenę", async () => {
    const s = fetchStub([
      loginRoute,
      {
        match: (url) => url.includes("/order/bestPrice"),
        respond: () => json({ totalGrossPrice: 19.99, totalNetPrice: 16.25, currency: "PLN" }),
      },
    ]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    const res = await api.createOrderBestPrice(BEST_PRICE_REQ, { onlyPricing: true });
    expect(res.pricing.priceGross).toBe(19.99);
    const url = s.calls.find((c) => c.url.includes("/order/bestPrice"))!.url;
    expect(url).toContain("createFully=false");
    expect(url).toContain("onlyPricing=true");
  });

  it("getLabels: mapuje etykiety base64", async () => {
    const s = fetchStub([
      loginRoute,
      {
        match: (url) => url.includes("/order/GK260717000001/labels"),
        respond: () => json(FIX.labels),
      },
    ]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    const labels = await api.getLabels("GK260717000001");
    expect(labels).toEqual([{ type: "WAYBILL", format: "PDF", content: "JVBERi0x" }]);
  });

  it("getLabelsByHashes: zwraca bajty PDF i pyta o format", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const s = fetchStub([
      loginRoute,
      {
        match: (url) => url.includes("/order/labels?"),
        respond: () =>
          new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }),
      },
    ]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    const bytes = await api.getLabelsByHashes(["hash-abc"], "A6");
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
    const url = s.calls.find((c) => c.url.includes("/order/labels?"))!.url;
    expect(url).toContain("orderHashes%5B%5D=hash-abc");
    expect(url).toContain("format=A6");
  });

  it("cancelOrder: DELETE na numerze zamówienia", async () => {
    const s = fetchStub([
      loginRoute,
      {
        match: (url, init) =>
          url.endsWith("/order/GK260717000001") && init?.method === "DELETE",
        respond: () => json({}),
      },
    ]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    await expect(api.cancelOrder("GK260717000001")).resolves.toBeUndefined();
  });

  it("błąd walidacji API: komunikat + szczegóły pól w GlobKurierAPIError", async () => {
    const s = fetchStub([
      loginRoute,
      { match: (url) => url.includes("/order/bestPrice"), respond: () => json(FIX.error422, 422) },
    ]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    const err = await api.createOrderBestPrice(BEST_PRICE_REQ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GlobKurierAPIError);
    expect((err as GlobKurierAPIError).statusCode).toBe(422);
    expect((err as GlobKurierAPIError).message).toContain("Validation failed");
    expect((err as GlobKurierAPIError).message).toContain("receiverAddress.postCode");
  });

  it("nieudane logowanie: GlobKurierAPIError ze statusem, testConnection false", async () => {
    const s = fetchStub([
      {
        match: (url) => url.endsWith("/auth/login"),
        respond: () => json({ message: "Bad credentials" }, 401),
      },
    ]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    await expect(api.getOrder("X")).rejects.toMatchObject({ statusCode: 401 });
    expect(await api.testConnection()).toBe(false);
  });

  it("odpowiedź nie-JSON: błąd sieciowo-protokołowy zamiast cichego przejścia", async () => {
    const s = fetchStub([
      loginRoute,
      {
        match: (url) => url.includes("/order?number="),
        respond: () =>
          new Response("<html>maintenance</html>", {
            status: 503,
            headers: { "content-type": "text/html" },
          }),
      },
    ]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    await expect(api.getOrder("GK260717000001")).rejects.toBeInstanceOf(GlobKurierAPIError);
  });
});
