# Zadanie 7 — Dostawy: metody + port GlobKurier + zwroty — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cel:** Zamówienie w panelu dostaje pełną obsługę dostawy: koszt dostawy per metoda
(stały + próg darmowej dostawy z `tenant_settings`), przesyłki kurierskie GlobKurier
(utworzenie, etykieta PDF, przesyłka zwrotna jako lustro, odświeżenie statusu na
żądanie) — z konfiguracją per tenant i ZERO twardych fallbacków.

**Architektura:** czysty klient GlobKurier portowany ze starkita do
`packages/core/src/courier/**` (fetch wstrzykiwany → testy kontraktowe na fixtures,
token cache per INSTANCJĘ — starkitowy cache modułowy to bug wielotenantowy);
konfiguracja tenanta w `tenant_settings` (4 nowe klucze z CHECK-ami wartości wzorcem
`order_number_prefix` z 0007); tabela `courier_shipments` (migracja 0013, konwencje
0007/0011); panel czyta/zapisuje przez RLS, sekcja dostawy w szczególe zamówienia to
samowystarczalny server component (page.tsx: 1 import + 1 linia — protokół
antykolizyjny z Zadaniem 6).

**Stack:** TypeScript strict, Vitest, Zod (tylko panel — core bez zależności),
Supabase (RLS), Next.js App Router (server actions + route handler dla PDF).

## Ograniczenia globalne (z briefu — obowiązują każdy task)

- Pas: `packages/db`, `packages/core`, `apps/panel`. NIE dotykać: `apps/storefront`,
  `packages/ui`, `packages/emails`, `packages/pdf`.
- Protokół antykolizyjny (Zadanie 6 biegnie równolegle): moje pliki to
  `packages/core/src/courier/**`, migracja `0013`, pliki `delivery-*` w
  `apps/panel/app/[locale]/zamowienia/[id]/`, ekran ustawień kuriera
  (`ustawienia-dostaw/`). W `page.tsx` szczegółu zamówienia: JEDEN import + JEDNA
  linia. W `messages/{en,pl}.json`: wyłącznie namespace `orders.delivery.*`.
  NIE dotykać `packages/core/src/rental/extension.ts` ani plików `extension-*`.
- Numery: **ADR-030** i **ADR-031**, migracja **0013** (0012 zarezerwowane dla Z6 —
  luka leksykalna jest OK).
- ZERO twardych fallbacków konfiguracji kurierskiej; ZERO realnych adresów/danych
  w kodzie i testach (fixtures wyłącznie fikcyjne).
- Kody błędów bazy: wyłącznie standardowe SQLSTATE (22xxx/23xxx) — P0xxx PostgREST
  zjada do gołego 500 (nagłówek 0011).
- Autor commitów: `Avably <admin@avably.io>`; zero wzmianek AI/konkurencji; polski.
- CI nie bije w żywe API GlobKurier; żadnych credentiali w repo.
- Waluta: grosze jako int; `plans.currency` jedynym źródłem waluty (0007).

## Decyzje projektowe (do spisania jako ADR-030/031 w Task 12)

**ADR-030 — koszt dostawy zamówienia:**
- `orders.delivery_grosze int not null default 0 check (>= 0)` — denormalizacja
  uzgodnionego kosztu (jak `total_rental_grosze`); cennik w `tenant_settings`
  pod kluczem `delivery_pricing` (per metoda: `price_grosze` + opcjonalny
  `free_above_grosze`); `pickup` zawsze 0 i NIE występuje w cenniku.
- Wyliczenie wyłącznie w silniku: `calculateDeliveryCost` w
  `packages/core/src/courier/delivery-pricing.ts`; brak cennika/metody = wyjątek
  `DeliveryPricingError` (czytelny błąd konfiguracji), nigdy ciche 0.
- Dług (spisany, poza zakresem): wpięcie kosztu w formularz tworzenia zamówienia
  (plik poza moim pasem antykolizyjnym w tym zadaniu).

**ADR-031 — cykl życia przesyłki kurierskiej:**
- Status WEWNĘTRZNY `courier_shipments.status` (text+CHECK:
  created|in_progress|in_transit|delivered|cancelled|returned_to_sender) +
  `provider_status` verbatim BEZ CHECK-a: status dostawcy to dana zewnętrzna,
  CHECK na cudzych wartościach zamieniałby dryf API dostawcy w twardą awarię
  synchronizacji. Mapowanie w silniku (`mapProviderStatus`), nieznany status →
  wewnętrzny bez zmian, surowy zapisany.
- Sync statusów NA ŻĄDANIE (przycisk). Webhooki/cron = dług.
- Etykieta PDF: NIE przechowujemy — pobierana on-demand z API po
  `provider_order_hash` (route handler `delivery-label`), hash nie wychodzi do
  klienta.
- Credentiale GlobKurier w `tenant_settings` (jsonb, RLS per tenant). Dług:
  szyfrowanie/sejf sekretów; gating zapisu ustawień do ownera (dziś RLS 0007
  pozwala każdemu członkowi — UI nie udaje bramki, której nie ma).
- Token cache per instancję klienta (fix buga starkita: cache modułowy
  serwowałby token tenanta A instancji tenanta B).

## Struktura plików

**packages/core/src/courier/** (nowe):
`types.ts` (typy GK + typy konfiguracji tenanta), `config.ts` (URL-e per środowisko,
PAYMENT_IDS, COUNTRY_IDS), `api.ts` (klient), `tenant-config.ts` (parser
tenant_settings → config, CourierConfigError), `delivery-pricing.ts`
(calculateDeliveryCost), `shipments.ts` (buildBestPriceRequest lustro +
mapProviderStatus), `index.ts`; testy kolokowane `*.test.ts`.
Root `packages/core/src/index.ts`: dopisany blok eksportów z `./courier`.

**packages/db:** `supabase/migrations/0013_courier_shipments.sql`,
`test/helpers/seed-tenants.ts` (fabryka + patch), `test/courier-shipments.test.ts`.

**apps/panel/app/[locale]/zamowienia/[id]/** (nowe): `delivery.ts`,
`delivery-validation.ts`, `delivery-actions.ts`, `delivery-forms.tsx`,
`delivery-section.tsx`, `delivery-label/route.ts`; `page.tsx` — 1 import + 1 linia.

**apps/panel/app/[locale]/ustawienia-dostaw/** (nowe): `page.tsx`,
`delivery-settings-validation.ts`, `delivery-settings-actions.ts`,
`delivery-settings-forms.tsx`.

**apps/panel/test/**: `delivery-validation.test.ts`, `delivery-settings-validation.test.ts`.

**apps/panel/messages/{en,pl}.json**: rozszerzenie `orders.delivery` o `section`,
`statuses`, `types`, `settings`.

**docs/dokumentacja/index.html**: karta modułu, model danych, ADR-030/031, dziennik.

---

### Task 1: Core — typy i konfiguracja stała (port `types.ts` + `config.ts`)

**Files:**
- Create: `packages/core/src/courier/types.ts`
- Create: `packages/core/src/courier/config.ts`
- Test: `packages/core/src/courier/config.test.ts`

**Interfaces (produces):** wszystkie typy GK (`GlobKurierEnvironment`,
`GlobKurierAddress`, `GlobKurierShipment`, `GlobKurierBestPriceRequest`,
`GlobKurierBestPriceAddress`, `GlobKurierOrderResponse`, `GlobKurierProduct`,
`GlobKurierSearchProductsRequest`, `GlobKurierLabelResponse`,
`GlobKurierErrorResponse`, `GlobKurierAgreements`, `GlobKurierCollectionType`,
`GlobKurierPurpose`, `GlobKurierOrderStatus`, `GlobKurierCreateOrderRequest`,
`GlobKurierAddon`, `GlobKurierBestPriceAddons`) oraz typy konfiguracji tenanta:
`CourierCredentials { email; password; environment }`,
`CourierSender { name; street; houseNumber; apartmentNumber?; postCode; city; phone; email }`,
`ParcelDimensions { lengthCm; widthCm; heightCm; weightKg }`,
`DeliveryMethodPricing { priceGrosze: number; freeAboveGrosze?: number }`,
`PaidDeliveryMethod = "courier" | "parcel_locker" | "own_delivery"`,
`DeliveryMethod = "pickup" | PaidDeliveryMethod`,
`DeliveryPricing = Partial<Record<PaidDeliveryMethod, DeliveryMethodPricing>>`,
`ShipmentType = "outbound" | "return"`,
`ShipmentStatus = "created" | "in_progress" | "in_transit" | "delivered" | "cancelled" | "returned_to_sender"`.
`config.ts`: `getApiUrl(environment: GlobKurierEnvironment): string`,
`PAYMENT_IDS` (ONLINE 2, BANK_TRANSFER 1, DEFERRED 4, PREPAID 9),
`COUNTRY_IDS = { POLAND: 1 }`.

Port 1:1 ze starkitowego `lib/courier/globkurier/types.ts` Z WYJĄTKAMI (świadome
odstępstwa, do docs):
- BEZ `PARCEL_SIZES` i `SenderConfig` — twarde gabaryty pod konkretny sprzęt i
  nadawca w kodzie to anty-wzorzec (decyzja wiążąca nr 5); zastępują je typy
  konfiguracji tenanta powyżej.
- BEZ `getEnvironment()` z `NODE_ENV` — środowisko GK jest konfiguracją TENANTA,
  nie procesu.
- BEZ `ADDON_IDS` / `CARRIER_PRODUCTS` — martwe stałe „reference only, DO NOT USE".

- [ ] **Step 1: test `config.test.ts`** — pełny kod:

```ts
import { describe, expect, it } from "vitest";

import { getApiUrl } from "./config";

describe("getApiUrl", () => {
  it("zwraca URL produkcyjny i testowy per środowisko", () => {
    expect(getApiUrl("production")).toBe("https://api.globkurier.pl/v1");
    expect(getApiUrl("test")).toBe("https://test.api.globkurier.pl/v1");
  });
});
```

- [ ] **Step 2:** `pnpm --filter @avably/core test` → FAIL (moduł nie istnieje).
- [ ] **Step 3:** napisz `types.ts` (port typów j.w. + typy tenanta) i `config.ts`.
- [ ] **Step 4:** testy zielone; `pnpm --filter @avably/core typecheck` zielony.
- [ ] **Step 5:** commit `feat(core): typy i konfiguracja klienta GlobKurier (port, bez twardych fallbacków)`.

### Task 2: Core — klient `GlobKurierAPI` (port z fetchImpl + token cache per instancję)

**Files:**
- Create: `packages/core/src/courier/api.ts`
- Test: `packages/core/src/courier/api.test.ts`

**Interfaces (produces):**
```ts
export class GlobKurierAPIError extends Error {
  constructor(message: string, public statusCode?: number, public code?: string,
    public details?: Record<string, string[]>);
}
export class GlobKurierAPI {
  constructor(credentials: CourierCredentials, options?: { fetchImpl?: typeof fetch });
  searchProducts(params: GlobKurierSearchProductsRequest): Promise<GlobKurierProduct[]>;
  createOrder(orderData: GlobKurierCreateOrderRequest): Promise<GlobKurierOrderResponse>;
  createOrderBestPrice(orderData: GlobKurierBestPriceRequest,
    options?: { onlyPricing?: boolean }): Promise<GlobKurierOrderResponse>;
  getOrder(orderNumber: string): Promise<GlobKurierOrderResponse>;
  getLabels(orderNumber: string): Promise<GlobKurierLabelResponse[]>;
  getLabelsByHashes(orderHashes: string[], format?: "A4" | "A6"): Promise<Uint8Array>;
  cancelOrder(orderNumber: string): Promise<void>;
  testConnection(): Promise<boolean>;
  clearTokenCache(): void;
}
```

Port semantyki 1:1 z `~/starkit-system/lib/courier/globkurier/api.ts` ze zmianami:
1. **Token cache per INSTANCJĘ** (pole `private tokenCache`), nie moduł — cache
   modułowy współdzielony między instancjami serwowałby token tenanta A tenantowi B.
2. `fetchImpl` wstrzykiwany (default `globalThis.fetch`) — testy kontraktowe bez
   sieci.
3. Binarne odpowiedzi jako `Uint8Array` (nie `Buffer`) — neutralność runtime.
4. BEZ `console.log/error` (szum debugowy starkita).
5. BEZ fabryki `createGlobKurierAPI(supabase)` — I/O konfiguracji żyje w panelu,
   parsowanie w `tenant-config.ts` (Task 3).
Reszta (mapowania odpowiedzi, obsługa błędów z details/violations, nagłówki
X-Auth-Token/Accept-Language, bufor 5 min ważności tokenu, 1h cache) — 1:1.

- [ ] **Step 1: testy kontraktowe na fixtures** — pełny kod (dane FIKCYJNE):

```ts
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
        id: 42, name: "Kurier standard", carrierName: "Przewoźnik X",
        grossPrice: 25.09, netPrice: 20.4, currency: { code: "PLN" },
        averageDelivery: 1, serviceCode: "STD",
      },
    ],
  },
  bestPrice: {
    orders: [{ number: "GK260717000001", hash: "hash-abc", trackingNumber: "TRK1" }],
    totalGrossPrice: 30.75, totalNetPrice: 25, currency: "PLN", vatPercent: 23,
    status: "NEW_SHIPMENT", creationDate: "2026-07-17T10:00:00Z",
  },
  order: {
    number: "GK260717000001", hash: "hash-abc", status: "IN_TRANSIT",
    creationDate: "2026-07-17T10:00:00Z",
    pricing: { priceGross: 30.75, priceNet: 25, vatPercent: 23, currency: "PLN" },
    trackingNumber: "TRK1", trackingUrl: "https://example.com/t/TRK1",
  },
  labels: { items: [{ type: "WAYBILL", format: "PDF", content: "JVBERi0x" }] },
  error422: {
    message: "Validation failed", code: "VALIDATION",
    errors: { "receiverAddress.postCode": ["invalid"] },
  },
} as const;

type Route = { match: (url: string, init?: RequestInit) => boolean; respond: () => Response };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
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
    name: "Wypożyczalnia Testowa", city: "Miastko", street: "Przykładowa",
    houseNumber: "1", postCode: "00-001", country: "PL",
    phone: "+48600000000", email: "nadawca@example.com",
  },
  receiverAddress: {
    name: "Jan Testowy", city: "Wieśno", street: "Próbna", houseNumber: "2",
    postCode: "11-111", country: "PL", phone: "+48611111111",
    email: "klient@example.com",
  },
  content: "Sprzęt na wynajem", paymentId: 9,
  agreements: { receiveElectronicBills: true, processingPersonalData: true },
  collectionType: "PICKUP", deliveryType: "PICKUP", referenceNumber: "AV-2026-001",
};

describe("GlobKurierAPI (kontrakt na fixtures)", () => {
  it("loguje się raz i cache'uje token per INSTANCJĘ (nie per moduł)", async () => {
    const a = fetchStub([loginRoute, {
      match: (url) => url.includes("/order?number="), respond: () => json(FIX.order),
    }]);
    const apiA = new GlobKurierAPI(CREDS, { fetchImpl: a.impl });
    await apiA.getOrder("GK260717000001");
    await apiA.getOrder("GK260717000001");
    const loginsA = a.calls.filter((c) => c.url.endsWith("/auth/login")).length;
    expect(loginsA, "drugie wywołanie ma użyć tokenu z cache").toBe(1);

    // Druga instancja (inny tenant) MUSI zalogować się własnym kontem —
    // cache modułowy ze starkita dałby tu 0 logowań i cudzy token.
    const b = fetchStub([loginRoute, {
      match: (url) => url.includes("/order?number="), respond: () => json(FIX.order),
    }]);
    const apiB = new GlobKurierAPI({ ...CREDS, email: "inny@example.com" }, { fetchImpl: b.impl });
    await apiB.getOrder("GK260717000001");
    expect(b.calls.filter((c) => c.url.endsWith("/auth/login")).length).toBe(1);
  });

  it("searchProducts: parametry zapytania + mapowanie listy flat", async () => {
    const s = fetchStub([loginRoute, {
      match: (url) => url.includes("/products?"), respond: () => json(FIX.productsFlat),
    }]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    const products = await api.searchProducts({
      senderPostCode: "00-001", senderCountryId: 1,
      receiverPostCode: "11-111", receiverCountryId: 1,
      length: 60, width: 40, height: 30, weight: 10,
    });
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: 42, carrierName: "Przewoźnik X", priceGross: 25.09, currency: "PLN",
    });
    const url = s.calls.find((c) => c.url.includes("/products?"))!.url;
    expect(url).toContain("senderPostCode=00-001");
    expect(url).toContain("collectionTypes%5B%5D=POINT");
  });

  it("createOrderBestPrice: wyciąga numer/hash/tracking z tablicy orders", async () => {
    const s = fetchStub([loginRoute, {
      match: (url) => url.includes("/order/bestPrice"), respond: () => json(FIX.bestPrice),
    }]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    const res = await api.createOrderBestPrice(BEST_PRICE_REQ);
    expect(res).toMatchObject({
      number: "GK260717000001", hash: "hash-abc", trackingNumber: "TRK1",
      status: "NEW_SHIPMENT",
      pricing: { priceGross: 30.75, priceNet: 25, vatPercent: 23, currency: "PLN" },
    });
    const url = s.calls.find((c) => c.url.includes("/order/bestPrice"))!.url;
    expect(url).toContain("createFully=true");
    expect(url).toContain("onlyPricing=false");
  });

  it("getLabelsByHashes: zwraca bajty PDF i pyta o format", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const s = fetchStub([loginRoute, {
      match: (url) => url.includes("/order/labels?"),
      respond: () => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }),
    }]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    const bytes = await api.getLabelsByHashes(["hash-abc"], "A6");
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
    const url = s.calls.find((c) => c.url.includes("/order/labels?"))!.url;
    expect(url).toContain("orderHashes%5B%5D=hash-abc");
    expect(url).toContain("format=A6");
  });

  it("błąd walidacji API: komunikat + szczegóły pól w GlobKurierAPIError", async () => {
    const s = fetchStub([loginRoute, {
      match: (url) => url.includes("/order/bestPrice"), respond: () => json(FIX.error422, 422),
    }]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    const err = await api.createOrderBestPrice(BEST_PRICE_REQ).catch((e) => e);
    expect(err).toBeInstanceOf(GlobKurierAPIError);
    expect((err as GlobKurierAPIError).statusCode).toBe(422);
    expect((err as GlobKurierAPIError).message).toContain("Validation failed");
    expect((err as GlobKurierAPIError).message).toContain("receiverAddress.postCode");
  });

  it("nieudane logowanie: GlobKurierAPIError ze statusem", async () => {
    const s = fetchStub([{
      match: (url) => url.endsWith("/auth/login"),
      respond: () => json({ message: "Bad credentials" }, 401),
    }]);
    const api = new GlobKurierAPI(CREDS, { fetchImpl: s.impl });
    await expect(api.getOrder("X")).rejects.toMatchObject({ statusCode: 401 });
    expect(await api.testConnection()).toBe(false);
  });
});
```

- [ ] **Step 2:** testy → FAIL (brak `api.ts`).
- [ ] **Step 3:** implementacja `api.ts` (port wg listy zmian wyżej).
- [ ] **Step 4:** testy + typecheck zielone.
- [ ] **Step 5:** commit `feat(core): klient GlobKurier — port ze wstrzykiwanym fetch i token cache per instancję`.

### Task 3: Core — parser konfiguracji tenanta + cennik dostaw (zero fallbacków)

**Files:**
- Create: `packages/core/src/courier/tenant-config.ts`
- Create: `packages/core/src/courier/delivery-pricing.ts`
- Create: `packages/core/src/courier/index.ts`
- Modify: `packages/core/src/index.ts` (blok eksportów `./courier`)
- Test: `packages/core/src/courier/tenant-config.test.ts`,
  `packages/core/src/courier/delivery-pricing.test.ts`

**Interfaces (produces):**
```ts
// tenant-config.ts
export const GLOBKURIER_CREDENTIALS_KEY = "globkurier_credentials";
export const COURIER_SENDER_KEY = "courier_sender";
export const COURIER_PARCEL_KEY = "courier_parcel";
export const DELIVERY_PRICING_KEY = "delivery_pricing";
export const COURIER_CONFIG_KEYS: readonly string[]; // 3 klucze konfiguracji kuriera
export interface TenantSettingRow { key: string; value: unknown }
export class CourierConfigError extends Error { readonly problems: string[] }
export interface CourierTenantConfig {
  credentials: CourierCredentials; sender: CourierSender; parcel: ParcelDimensions;
}
export function courierConfigFromSettings(rows: TenantSettingRow[]): CourierTenantConfig;
export function deliveryPricingFromSettings(rows: TenantSettingRow[]): DeliveryPricing | null;

// delivery-pricing.ts
export class DeliveryPricingError extends Error {}
export function calculateDeliveryCost(params: {
  method: DeliveryMethod; pricing: DeliveryPricing | null; rentalTotalGrosze: number;
}): number;
```

Zasady (twarde, z briefu): `courierConfigFromSettings` zbiera WSZYSTKIE braki/wady
(np. `brak ustawienia globkurier_credentials`, `courier_sender: brak pola phone`)
i rzuca `CourierConfigError` z listą — NIGDY nie podstawia defaultów. Kształt jsonb
w bazie: snake_case (`house_number`, `post_code`, `length_cm`, `weight_kg`,
`price_grosze`, `free_above_grosze`); parser mapuje na camelCase typów.
`calculateDeliveryCost`: `pickup` → 0; `pricing === null` lub brak wpisu metody →
`DeliveryPricingError` z nazwą metody i klucza; `freeAboveGrosze` ustawione i
`rentalTotalGrosze >= freeAboveGrosze` → 0; inaczej `priceGrosze`.

- [ ] **Step 1: testy** — kluczowe przypadki (pełne ciała w plikach testowych):
  - happy path: 3 poprawne wiersze → config zmapowany na camelCase;
  - brak WSZYSTKICH kluczy → `CourierConfigError`, `problems` zawiera 3 wpisy,
    `message` wymienia nazwy kluczy (czytelny błąd konfiguracji — wymóg briefu);
  - `courier_sender` bez `phone` → problems zawiera `phone`;
  - `courier_parcel` z `weight_kg: 0` → problem (dodatnie wymagane);
  - `deliveryPricingFromSettings`: brak klucza → null; poprawny → mapa; wpis z
    ujemnym `price_grosze` → CourierConfigError;
  - `calculateDeliveryCost`: pickup→0; kurier 2500 przy progu 50000 i totalu
    30000→2500; totalu 50000→0 (próg inclusive); bez progu→zawsze cena; brak
    cennika→`DeliveryPricingError`; brak metody w cenniku→`DeliveryPricingError`.

Przykład dwóch najważniejszych testów (anty-fallback — muszą umieć zapłonąć przy
mutacji „wprowadź default"):

```ts
it("brak konfiguracji tenanta = czytelny błąd konfiguracji, nigdy cichy default", () => {
  expect(() => courierConfigFromSettings([])).toThrowError(CourierConfigError);
  const err = (() => { try { courierConfigFromSettings([]); } catch (e) { return e as CourierConfigError; } })()!;
  expect(err.problems).toHaveLength(3);
  expect(err.message).toContain("globkurier_credentials");
  expect(err.message).toContain("courier_sender");
  expect(err.message).toContain("courier_parcel");
});

it("metoda płatna bez cennika = DeliveryPricingError, nie 0", () => {
  expect(() =>
    calculateDeliveryCost({ method: "courier", pricing: null, rentalTotalGrosze: 10_000 }),
  ).toThrowError(DeliveryPricingError);
  expect(() =>
    calculateDeliveryCost({ method: "own_delivery", pricing: { courier: { priceGrosze: 2500 } }, rentalTotalGrosze: 0 }),
  ).toThrowError(DeliveryPricingError);
});
```

- [ ] **Step 2:** FAIL → **Step 3:** implementacja → **Step 4:** zielone + typecheck.
- [ ] **Step 5: dowód mutacyjny (nie commitować mutacji):** w
  `courierConfigFromSettings` podstaw tymczasowo default nadawcy przy braku klucza
  (odtworzenie anty-wzorca `DEFAULT_SENDER_CONFIG`) → test anty-fallbackowy MUSI
  być czerwony; w `calculateDeliveryCost` zwróć 0 przy braku cennika → test MUSI
  być czerwony. Przywróć, zanotuj do raportu które asercje paliły.
  Pytanie kontrolne o maskowanie (ADR-024): asercje idą po `problems`/typie
  wyjątku, nie po samym `toThrow()` bez typu — `TypeError` z literówki nie
  zamaskuje zieleni.
- [ ] **Step 6:** eksporty w `courier/index.ts` + root `src/index.ts`; typecheck.
- [ ] **Step 7:** commit `feat(core): konfiguracja kurierska tenanta i cennik dostaw — czytelne błędy zamiast fallbacków`.

### Task 4: Core — budowa żądania przesyłki (outbound + zwrot lustrzany) i mapowanie statusów

**Files:**
- Create: `packages/core/src/courier/shipments.ts`
- Modify: `packages/core/src/courier/index.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/courier/shipments.test.ts`

**Interfaces (produces):**
```ts
export interface ShipmentParty {
  name: string; street: string; houseNumber: string; apartmentNumber?: string;
  postCode: string; city: string; phone: string; email: string;
}
export function buildBestPriceRequest(params: {
  type: ShipmentType; sender: CourierSender; customer: ShipmentParty;
  parcel: ParcelDimensions; content: string; referenceNumber: string;
}): GlobKurierBestPriceRequest;
export function mapProviderStatus(providerStatus: string): ShipmentStatus | null;
```

Semantyka: `outbound` — senderAddress=nadawca tenanta, receiverAddress=klient;
`return` — LUSTRO (wzorzec starkit): senderAddress=klient, receiverAddress=nadawca
tenanta. Stałe żądania: `paymentId: PAYMENT_IDS.PREPAID`, `collectionType` i
`deliveryType`: `"PICKUP"`, `purpose: "NOT_SOLD"`, `receiverType:
"PRIVATE_PERSON"`, `agreements: { receiveElectronicBills: true,
processingPersonalData: true }`, `country: "PL"`, `quantity: 1`.
`mapProviderStatus`: NEW_SHIPMENT→created, IN_PROGRESS→in_progress,
IN_TRANSIT→in_transit, DELIVERED→delivered, CANCELED→cancelled,
RETURNED_TO_SENDER→returned_to_sender, inne→null (ADR-031).

- [ ] **Step 1: testy** — m.in.:

```ts
it("zwrot jest LUSTREM wysyłki: adresy zamienione, reszta identyczna", () => {
  const outbound = buildBestPriceRequest({ type: "outbound", sender: SENDER, customer: CUSTOMER, parcel: PARCEL, content: "Sprzęt", referenceNumber: "AV-2026-001" });
  const ret = buildBestPriceRequest({ type: "return", sender: SENDER, customer: CUSTOMER, parcel: PARCEL, content: "Sprzęt", referenceNumber: "AV-2026-001" });
  expect(ret.senderAddress).toEqual(outbound.receiverAddress);
  expect(ret.receiverAddress).toEqual(outbound.senderAddress);
  expect(ret.shipment).toEqual(outbound.shipment);
});

it("mapProviderStatus: znane statusy mapowane, nieznane → null (nie wyjątek, nie zgadywanie)", () => {
  expect(mapProviderStatus("NEW_SHIPMENT")).toBe("created");
  expect(mapProviderStatus("RETURNED_TO_SENDER")).toBe("returned_to_sender");
  expect(mapProviderStatus("COŚ_NOWEGO")).toBeNull();
});
```

- [ ] **Steps 2–4:** FAIL → implementacja → zielone.
- [ ] **Step 5:** commit `feat(core): żądanie przesyłki GlobKurier — zwrot jako lustro, mapowanie statusów dostawcy`.

### Task 5: Migracja 0013 — `courier_shipments`, `orders.delivery_grosze`, CHECK-i `tenant_settings`

**Files:**
- Create: `packages/db/supabase/migrations/0013_courier_shipments.sql`
- Modify: `packages/db/test/helpers/seed-tenants.ts` (fabryka + patch)

**Interfaces (produces):** tabela `public.courier_shipments` (kolumny niżej),
kolumna `public.orders.delivery_grosze`, klucze `tenant_settings`:
`globkurier_credentials`, `courier_sender`, `courier_parcel`, `delivery_pricing`
z CHECK-ami wartości; funkcja `app.delivery_pricing_valid(jsonb)`.

Treść migracji (kompletna, z komentarzami-uzasadnieniami wg konwencji 0007/0011;
nagłówek wymienia ADR-030/031 i konwencje: text+CHECK, revoke przed grantami,
FK złożony, indeks od tenant_id, tylko standardowe SQLSTATE):

```sql
-- Sekcja 1: koszt dostawy zamówienia (ADR-030)
alter table public.orders
  add column delivery_grosze int not null default 0 check (delivery_grosze >= 0);

-- Sekcja 2: walidacja nowych kluczy tenant_settings (wzorzec
-- tenant_settings_order_number_prefix_valid z 0007 — walidacja U ŹRÓDŁA, 23514)
create or replace function app.delivery_pricing_valid(value jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(value) = 'object'
    and not exists (
      select 1 from jsonb_each(value) as e(method, entry)
      where e.method not in ('courier','parcel_locker','own_delivery')
         or jsonb_typeof(e.entry) <> 'object'
         or jsonb_typeof(e.entry->'price_grosze') <> 'number'
         or (e.entry->>'price_grosze')::numeric < 0
         or floor((e.entry->>'price_grosze')::numeric) <> (e.entry->>'price_grosze')::numeric
         or (e.entry ? 'free_above_grosze' and (
              jsonb_typeof(e.entry->'free_above_grosze') <> 'number'
              or (e.entry->>'free_above_grosze')::numeric < 0
              or floor((e.entry->>'free_above_grosze')::numeric) <> (e.entry->>'free_above_grosze')::numeric))
    )
$$;
alter function app.delivery_pricing_valid(jsonb) set search_path = pg_catalog;

alter table public.tenant_settings add constraint tenant_settings_globkurier_credentials_valid check (
  key <> 'globkurier_credentials' or (
    jsonb_typeof(value) = 'object'
    and jsonb_typeof(value->'email') = 'string' and length(value->>'email') between 3 and 320
    and jsonb_typeof(value->'password') = 'string' and length(value->>'password') > 0
    and (value->>'environment') in ('test','production')
  )
);
alter table public.tenant_settings add constraint tenant_settings_courier_sender_valid check (
  key <> 'courier_sender' or (
    jsonb_typeof(value) = 'object'
    and jsonb_typeof(value->'name') = 'string' and length(btrim(value->>'name')) > 0
    and jsonb_typeof(value->'street') = 'string' and length(btrim(value->>'street')) > 0
    and jsonb_typeof(value->'house_number') = 'string' and length(btrim(value->>'house_number')) > 0
    and jsonb_typeof(value->'post_code') = 'string' and length(btrim(value->>'post_code')) > 0
    and jsonb_typeof(value->'city') = 'string' and length(btrim(value->>'city')) > 0
    and jsonb_typeof(value->'phone') = 'string' and length(btrim(value->>'phone')) > 0
    and jsonb_typeof(value->'email') = 'string' and length(value->>'email') between 3 and 320
  )
);
alter table public.tenant_settings add constraint tenant_settings_courier_parcel_valid check (
  key <> 'courier_parcel' or (
    jsonb_typeof(value) = 'object'
    and jsonb_typeof(value->'length_cm') = 'number' and (value->>'length_cm')::numeric > 0
    and jsonb_typeof(value->'width_cm') = 'number' and (value->>'width_cm')::numeric > 0
    and jsonb_typeof(value->'height_cm') = 'number' and (value->>'height_cm')::numeric > 0
    and jsonb_typeof(value->'weight_kg') = 'number' and (value->>'weight_kg')::numeric > 0
  )
);
alter table public.tenant_settings add constraint tenant_settings_delivery_pricing_valid check (
  key <> 'delivery_pricing' or app.delivery_pricing_valid(value)
);
-- + aktualizacja comment on column public.tenant_settings.key (lista znanych kluczy)

-- Sekcja 3: courier_shipments
create table public.courier_shipments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  shipment_type text not null check (shipment_type in ('outbound','return')),
  status text not null default 'created'
    check (status in ('created','in_progress','in_transit','delivered','cancelled','returned_to_sender')),
  provider text not null default 'globkurier' check (provider in ('globkurier')),
  provider_order_number text not null
    check (length(btrim(provider_order_number)) between 1 and 100),
  provider_order_hash text,
  provider_status text,
  tracking_number text,
  tracking_url text,
  price_grosze int check (price_grosze is null or price_grosze >= 0),
  length_cm numeric not null check (length_cm > 0),
  width_cm numeric not null check (width_cm > 0),
  height_cm numeric not null check (height_cm > 0),
  weight_kg numeric not null check (weight_kg > 0),
  content text,
  created_by uuid,   -- bez FK: wiersz przetrwa usunięcie konta (wzorzec deposit_events)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courier_shipments_tenant_id_key unique (tenant_id, id),
  constraint courier_shipments_order_fk
    foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete cascade
);
create index courier_shipments_tenant_order_idx
  on public.courier_shipments (tenant_id, order_id, created_at);
-- comment on table/columns (m.in. provider_status: verbatim od dostawcy, BEZ
-- CHECK-a — ADR-031; status: wewnętrzny cykl życia).

-- Sekcja 4: RLS + revoke przed grantami + polityki (wzorzec 0007)
alter table public.courier_shipments enable row level security;
revoke all on public.courier_shipments from anon, authenticated;
grant select, insert, update, delete on public.courier_shipments to authenticated, service_role;
create policy tenant_select on public.courier_shipments for select
  using (tenant_id = app.tenant_id() or app.is_superadmin());
create policy tenant_insert on public.courier_shipments for insert
  with check (tenant_id = app.tenant_id());
create policy tenant_update on public.courier_shipments for update
  using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
-- delete tylko owner (ścieżka naprawy pomyłki — wzorzec orders):
create policy tenant_delete on public.courier_shipments for delete
  using (tenant_id = app.tenant_id() and app.is_tenant_owner());
```

- [ ] **Step 1:** napisz migrację; `supabase db reset` z `packages/db` przechodzi.
- [ ] **Step 2:** fabryka + patch w `seed-tenants.ts`:

```ts
courier_shipments: async (ctx, tenantId) => ({
  tenant_id: tenantId,
  order_id: await createOrder(ctx, tenantId),
  shipment_type: "outbound",
  provider_order_number: `GK-TEST-${randomUUID().slice(0, 8)}`,
  length_cm: 60, width_cm: 40, height_cm: 30, weight_kg: 10,
}),
// MUTATION_PATCHES:
courier_shipments: { tracking_number: "rls-test-hacked" },
```

- [ ] **Step 3:** macierz izolacji zielona (`pnpm --filter @avably/db test` z env
  SUPABASE_LOCAL_*); courier_shipments w macierzy (asercja objęcia: bez fabryki
  test głośno pada — to jest wbudowana bramka).
- [ ] **Step 4: dowód mutacyjny RLS (nie commitować):** lokalnie
  `alter policy tenant_update on public.courier_shipments using (true) with check (true);`
  → macierz MUSI być czerwona (gołe UPDATE dosięga wierszy tenanta B); przywróć
  (`supabase db reset`). Zanotuj do raportu dokładny czerwony test.
- [ ] **Step 5:** commit `feat(db): 0013 — courier_shipments, koszt dostawy zamówienia i konfiguracja kurierska tenanta`.

### Task 6: Testy DB — CHECK-i 0013 i FK międzytenantowy

**Files:**
- Test: `packages/db/test/courier-shipments.test.ts` (wzorzec strukturalny:
  `deposit-gates.test.ts` / `rental-core.test.ts` — helpery `seedTwoTenants`,
  `createAdminClient`, guard env `integrationEnv`)

Przypadki (wszystkie asercje na KODACH SQLSTATE, nie na „cokolwiek rzuciło"):
- `shipment_type: 'sideways'` → 23514; `status: 'lost'` → 23514;
  `provider: 'inny'` → 23514; `weight_kg: 0` → 23514;
- `orders.delivery_grosze = -1` → 23514;
- FK złożony: INSERT (service-role!) przesyłki z `tenant_id` A i `order_id`
  zamówienia tenanta B → 23503 — wiersz międzytenantowy jest
  NIEREPREZENTOWALNY niezależnie od RLS (wzorzec 0007);
- `tenant_settings`: `globkurier_credentials` bez `password` → 23514; ze
  `environment: 'prod'` → 23514; poprawny → INSERT przechodzi;
  `courier_sender` bez `phone` → 23514; `courier_parcel` z `weight_kg: 0`
  → 23514; `delivery_pricing` z kluczem `teleport` → 23514, z ujemnym
  `price_grosze` → 23514, z ułamkowym `price_grosze: 25.5` → 23514, poprawny
  (z progiem i bez) → przechodzi.

- [ ] **Step 1:** testy (FAIL na braku migracji jeśli pisane przed Task 5 — tu po,
  więc od razu weryfikują); **Step 2:** zielone.
- [ ] **Step 3: dowód mutacyjny CHECK (nie commitować):** zakomentuj w kopii
  lokalnej bazy constraint `tenant_settings_delivery_pricing_valid`
  (`alter table ... drop constraint ...`) → testy delivery_pricing MUSZĄ być
  czerwone; `supabase db reset` przywraca. Zanotuj.
- [ ] **Step 4:** commit `test(db): kształty i izolacja courier_shipments oraz kluczy konfiguracji dostaw`.

### Task 7: Panel — walidacja i czyste helpery sekcji dostaw

**Files:**
- Create: `apps/panel/app/[locale]/zamowienia/[id]/delivery.ts`
- Create: `apps/panel/app/[locale]/zamowienia/[id]/delivery-validation.ts`
- Test: `apps/panel/test/delivery-validation.test.ts`

**Interfaces (produces):**
```ts
// delivery.ts
export interface ShipmentRow {
  id: string; shipment_type: "outbound" | "return"; status: string;
  provider_order_number: string; provider_status: string | null;
  tracking_number: string | null; tracking_url: string | null;
  price_grosze: number | null; created_at: string;
}
export const SHIPMENT_ELIGIBLE_METHODS: readonly string[] = ["courier"];
export function canCreateShipments(deliveryMethod: string): boolean;

// delivery-validation.ts (zod; uuidSchema z @/lib/order-validation — tylko import,
// bez edycji tamtego pliku!)
export const shipmentCreateSchema; // { orderId, shipmentType: enum, lengthCm, widthCm, heightCm: coerce>0<=999, weightKg: coerce>0<=999, content: trim 1..200 }
export const shipmentRefreshSchema; // { shipmentId: uuidSchema }
export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>;
```

- [ ] **Step 1:** testy walidacji (odrzucenie: zła metoda typu, wymiar 0, wymiar
  ujemny, content pusty/zbyt długi, orderId nie-uuid; akceptacja: przecinki NIE są
  wspierane w wymiarach — pola numeryczne HTML `type="number"` z kropką; wagi
  ułamkowe legalne `10.5`).
- [ ] **Steps 2–4:** FAIL → implementacja → zielone.
- [ ] **Step 5:** commit `feat(panel): walidacja przesyłek kurierskich zamówienia`.

### Task 8: Panel — akcje dostaw (utworzenie przesyłki/zwrotu, odświeżenie statusu)

**Files:**
- Create: `apps/panel/app/[locale]/zamowienia/[id]/delivery-actions.ts`

**Interfaces:**
- Consumes: `requireMember` (`@/lib/supabase-server`), `AuthError` (`@/lib/auth`),
  `FormState`/`zodErrorToState` (`@/lib/form-state`), core: `GlobKurierAPI`,
  `GlobKurierAPIError`, `courierConfigFromSettings`, `CourierConfigError`,
  `COURIER_CONFIG_KEYS`, `buildBestPriceRequest`, `mapProviderStatus`,
  `type ShipmentParty`.
- Produces: `createShipmentAction(prev: FormState, formData: FormData):
  Promise<FormState>`, `refreshShipmentStatusAction(prev, formData)`.

Szkielet (wzorzec deposit-actions.ts — komunikaty PL literałami w akcji):

```ts
"use server";
// Nagłówek-komentarz: bramkami są RLS (0013) i CHECK-i; konfiguracja tenanta
// czytana per żądanie; CourierConfigError → czytelny komunikat z listą braków
// (zero fallbacków — decyzja wiążąca nr 5, ADR-030/031).

async function loadCourierApi(ctx: AuthContext): Promise<
  { api: GlobKurierAPI; config: CourierTenantConfig } | { configError: string }
> {
  const { data } = await ctx.supabase
    .from("tenant_settings").select("key, value")
    .eq("tenant_id", ctx.tenantId).in("key", [...COURIER_CONFIG_KEYS]);
  try {
    const config = courierConfigFromSettings(data ?? []);
    return { api: new GlobKurierAPI(config.credentials), config };
  } catch (err) {
    if (err instanceof CourierConfigError) return { configError: err.message };
    throw err;
  }
}

export async function createShipmentAction(prev, formData) {
  // 1. zod shipmentCreateSchema; 2. requireMember (AuthError → formError);
  // 3. zamówienie + klient:
  //    .from("orders").select("id, order_number, delivery_method, customers(full_name, email, phone, address_street, address_zip, address_city)")
  //    .eq("tenant_id", ctx.tenantId).eq("id", orderId).maybeSingle(); brak → formError.
  //    delivery_method !== "courier" → formError „Przesyłki kurierskie są dostępne
  //    tylko dla zamówień z dostawą kurierem."
  // 4. adres klienta: braki (street/zip/city/phone/full_name) wymienione z nazw
  //    w formError — czytelnie, bez zgadywania. Parsowanie ulicy: całość
  //    address_street idzie w `street`, houseNumber "—"? NIE: houseNumber
  //    wymagany przez GK — customers nie ma osobnego numeru domu, więc
  //    address_street trafia w street ORAZ houseNumber "." jest fabrykacją.
  //    DECYZJA: street = address_street, houseNumber = "" jest odrzucane przez
  //    GK; zamiast fabrykować — heurystyka NIE, pole „numer domu" dodane do
  //    formularza przesyłki (operator wpisuje przy nadaniu; walidacja min 1).
  // 5. buildBestPriceRequest({ type, sender: config.sender, customer, parcel:
  //    wymiary z formularza, content, referenceNumber: order_number });
  // 6. api.createOrderBestPrice(...) — GlobKurierAPIError → formError
  //    `Nadanie przesyłki odrzucone przez GlobKurier: ${err.message}`;
  // 7. INSERT courier_shipments (status "created", provider_* z odpowiedzi,
  //    price_grosze: Number.isFinite(priceGross) ? Math.round(priceGross*100) : null,
  //    created_by: ctx.user.id) + .select("id") — pusty wynik = formError
  //    (RLS nie zgłasza odmowy, dosięga zero wierszy — wzorzec deposit-actions);
  //    UWAGA: INSERT po udanym nadaniu u dostawcy — jego porażka NIE może
  //    zgubić przesyłki: formError niesie numer GK („Przesyłka nadana
  //    (GK...), ale zapis w systemie nie powiódł się...").
  // 8. revalidatePath("/", "layout"); return { success: "created" }.
}

export async function refreshShipmentStatusAction(prev, formData) {
  // zod → requireMember → shipment .select("id, provider_order_number")
  //   .eq("tenant_id",...).eq("id", shipmentId).maybeSingle() → loadCourierApi →
  //   api.getOrder(number) → mapProviderStatus(res.status) →
  //   UPDATE: { provider_status: res.status, ...(mapped ? { status: mapped } : {}),
  //     tracking_number: res.trackingNumber ?? null, tracking_url: res.trackingUrl ?? null,
  //     updated_at: new Date().toISOString() } .select("id") → revalidate → success.
}
```

UWAGA do kroku 4 (rozstrzygnięte tu, żeby implementer nie zgadywał): formularz
przesyłki ma pole `houseNumber` (+ opcjonalne `apartmentNumber`) wpisywane przez
operatora przy nadaniu — `customers` nie rozbija adresu na numer domu, a
fabrykowanie wartości do API kurierskiego to dokładnie klasa fallbacków, którą to
zadanie usuwa. `shipmentCreateSchema` dostaje `houseNumber: z.string().trim().min(1).max(20)`,
`apartmentNumber: z.string().trim().max(20).optional()` (Task 7 uwzględnia to od razu).

- [ ] **Step 1:** implementacja wg szkieletu (typecheck + lint zielone).
- [ ] **Step 2:** commit `feat(panel): akcje przesyłek kurierskich — nadanie, zwrot lustrzany, odświeżenie statusu`.

### Task 9: Panel — sekcja dostawy w szczególe zamówienia + formularze + wpięcie w page.tsx

**Files:**
- Create: `apps/panel/app/[locale]/zamowienia/[id]/delivery-section.tsx`
- Create: `apps/panel/app/[locale]/zamowienia/[id]/delivery-forms.tsx`
- Modify: `apps/panel/app/[locale]/zamowienia/[id]/page.tsx` — WYŁĄCZNIE:
  `import { DeliverySection } from "./delivery-section";` + jedna linia
  `<DeliverySection orderId={row.id} deliveryMethod={row.delivery_method} totalRentalGrosze={row.total_rental_grosze} />`
  po sekcji kaucji.
- Modify: `apps/panel/messages/en.json`, `apps/panel/messages/pl.json` —
  WYŁĄCZNIE wewnątrz `orders.delivery`.

**Interfaces:**
- Consumes: akcje z Task 8, `ShipmentRow`/`canCreateShipments` z Task 7, core
  (`deliveryPricingFromSettings`, `calculateDeliveryCost`, `DeliveryPricingError`,
  `courierConfigFromSettings`, `CourierConfigError`, `DELIVERY_PRICING_KEY`,
  `COURIER_CONFIG_KEYS`), `requireMember`, `formatMoney`, `getTenantCurrency`,
  komponenty `@avably/ui` (Table*, Badge, Button, Input, Label), `Link` z
  `@/i18n/navigation`.

`delivery-section.tsx` (async server component):
1. `requireMember()`; SELECT przesyłek:
   `.from("courier_shipments").select("id, shipment_type, status, provider_order_number, provider_status, tracking_number, tracking_url, price_grosze, created_at").eq("tenant_id",...).eq("order_id", orderId).order("created_at")`.
2. SELECT `tenant_settings` (COURIER_CONFIG_KEYS + DELIVERY_PRICING_KEY jednym
   zapytaniem `in`).
3. Koszt dostawy metody: `try { calculateDeliveryCost({ method, pricing, rentalTotalGrosze: totalRentalGrosze }) } catch (DeliveryPricingError)` →
   pokaż kwotę ALBO komunikat o braku cennika z linkiem do `/ustawienia-dostaw`
   (Link). `pickup` → wiersz kosztu pominięty.
4. Kompletność konfiguracji kuriera: `try { courierConfigFromSettings(...) }` →
   przy błędzie sekcja pokazuje `configMissing` + `err.problems` listą + Link do
   ustawień; formularz nadania ukryty.
5. Tabela przesyłek: typ (`types.outbound/return`), status (Badge,
   `statuses.<status>`; obok surowy `provider_status`, jeśli różny od
   zmapowanego), numer GK, tracking (link `tracking_url` albo sam numer), koszt
   (`formatMoney`), data, etykieta: `<a href={\`/zamowienia/${orderId}/delivery-label?shipment=${s.id}\`} target="_blank">`,
   przycisk odśwież (form → `refreshShipmentStatusAction`).
6. `canCreateShipments(deliveryMethod)` → `<DeliveryForms .../>` (client) z
   defaultami wymiarów z `courier_parcel` (props), inaczej informacja
   `notCourier`.

`delivery-forms.tsx` (client, wzorzec deposit-forms.tsx: `useActionState`,
`FormMessages` własna kopia lokalna): jeden formularz z: select typu
(outbound/return), pola `houseNumber`/`apartmentNumber` klienta (opis: numer domu
adresu klienta — GK wymaga rozbicia), wymiary+waga (defaultValue z propsów,
`type="number"`, `step="0.1"`), `content` (defaultValue z i18n
`contentDefault`), submit. Akcje przekazane z serwera przez props
`{ create: createShipmentAction, refresh: refreshShipmentStatusAction }` — refresh
używany per wiersz tabeli (osobny mały komponent `RefreshStatusButton` w tym samym
pliku).

Klucze i18n (obie wersje językowe, pełna lista — implementer kopiuje 1:1):
`orders.delivery.section`: `title`, `empty`, `colType`, `colStatus`, `colNumber`,
`colTracking`, `colPrice`, `colCreated`, `colLabel`, `labelLink`, `refreshCta`,
`types.outbound`, `types.return`,
`statuses.created|in_progress|in_transit|delivered|cancelled|returned_to_sender`,
`deliveryCost`, `deliveryCostFree`, `pricingMissing`, `configMissing`,
`settingsLink`, `notCourier`, `createTitle`, `typeLabel`, `houseNumberLabel`,
`apartmentNumberLabel`, `lengthLabel`, `widthLabel`, `heightLabel`, `weightLabel`,
`contentLabel`, `contentDefault`, `createCta`.

- [ ] **Step 1:** i18n + komponenty + wpięcie; `pnpm --filter panel typecheck && pnpm --filter panel lint`.
- [ ] **Step 2:** `git diff apps/panel/app/\[locale\]/zamowienia/\[id\]/page.tsx` —
  MUSI pokazywać dokładnie 2 dodane linie (protokół antykolizyjny).
- [ ] **Step 3:** commit `feat(panel): sekcja dostawy zamówienia — przesyłki, etykiety, zwroty, koszt dostawy`.

### Task 10: Panel — route handler etykiety PDF

**Files:**
- Create: `apps/panel/app/[locale]/zamowienia/[id]/delivery-label/route.ts`

GET `?shipment=<uuid>`: `requireMember` (AuthError → `new Response(null, { status: 401 })`);
walidacja uuid (`uuidSchema`); SELECT
`id, provider_order_number, provider_order_hash` po `(tenant_id, id, order_id=params.id)`
— brak wiersza → 404; brak hasha → 409 z krótkim tekstem PL; `loadCourierApi`-em
z Task 8 (eksportowany? — TAK: `delivery-actions.ts` eksportuje też
`loadCourierApi`; plik route importuje ją) — configError → 409 z komunikatem;
`api.getLabelsByHashes([hash], "A4")` → `GlobKurierAPIError` → 502 z komunikatem;
sukces:

```ts
return new Response(bytes, {
  headers: {
    "content-type": "application/pdf",
    "content-disposition": `inline; filename="etykieta-${shipment.provider_order_number}.pdf"`,
    "cache-control": "private, no-store",
  },
});
```

UWAGA: eksport `loadCourierApi` z pliku `"use server"` jest niedozwolony dla
nie-akcji — jeśli Next odrzuci (funkcja nie-async-action w module akcji),
przenieś `loadCourierApi` do `delivery.ts` (bez dyrektywy, importowany przez oba)
— rozstrzygnij w implementacji, oba pliki są w moim pasie. `delivery.ts` pozostaje
wolny od importów client-side.

- [ ] **Step 1:** implementacja + typecheck.
- [ ] **Step 2:** commit `feat(panel): etykieta przewozowa PDF na żądanie (bez przechowywania)`.

### Task 11: Panel — ekran ustawień dostaw (minimalny zakres)

**Files:**
- Create: `apps/panel/app/[locale]/ustawienia-dostaw/page.tsx`
- Create: `apps/panel/app/[locale]/ustawienia-dostaw/delivery-settings-validation.ts`
- Create: `apps/panel/app/[locale]/ustawienia-dostaw/delivery-settings-actions.ts`
- Create: `apps/panel/app/[locale]/ustawienia-dostaw/delivery-settings-forms.tsx`
- Modify: `apps/panel/messages/{en,pl}.json` (`orders.delivery.settings.*`)
- Test: `apps/panel/test/delivery-settings-validation.test.ts`

Minimalny zakres (ADR-031): jedna strona, 4 formularze (credentiale GK —
email/hasło/środowisko; nadawca — 7 pól + opc. nr lokalu; domyślna paczka — 4
liczby; cennik — dla 3 metod płatnych: cena (zł, `parseMajorToGrosze` z
`@/lib/money-input`) + opcjonalny próg darmowej dostawy). Zapis per formularz:
server action → `upsert` do `tenant_settings`
(`onConflict: "tenant_id,key"`, `updated_at: new Date().toISOString()`); 23514 →
formError „Wartości odrzucone przez walidację bazy…". Stored hasło NIGDY nie
wraca do formularza — strona pokazuje jedynie badge „skonfigurowane" (SELECT
sprawdza istnienie klucza, nie renderuje wartości credentiali; pozostałe grupy
prefill z wartości). Pusty próg = klucz `free_above_grosze` NIEOBECNY w jsonb
(nie null — CHECK). Cennik: metody bez wpisanej ceny pominięte w obiekcie.
Zod: `deliverySettingsCredentialsSchema`, `deliverySettingsSenderSchema`,
`deliverySettingsParcelSchema`, `deliverySettingsPricingSchema` — lustrzane wobec
CHECK-ów z 0013 (walidacja u źródła w UI, autorytatywna w bazie).
Testy walidacji: happy + odrzucenia (email zły, hasło puste, wymiar 0, cena
ujemna, próg bez ceny → odrzucony).

Dostęp: `requireMemberPage` (każdy członek — RLS 0007 i tak pozwala; UI nie udaje
bramki; dług: gating do ownera — ADR-031).

- [ ] **Steps:** testy walidacji FAIL → implementacja → zielone → typecheck/lint →
  commit `feat(panel): ustawienia dostaw — credentiale kuriera, nadawca, paczka, cennik`.

### Task 12: Dokumentacja HTML + dziennik

**Files:**
- Modify: `docs/dokumentacja/index.html`

1. Karta modułu „Dostawy i kurier (GlobKurier)" w sekcji modułów Claude'a: cel,
   publiczny interfejs (eksporty core: klient, parser konfiguracji, cennik,
   builder przesyłek — sygnatury), zależności, kluczowe pliki, świadome
   odstępstwa od starkita (token cache per instancję; bez PARCEL_SIZES /
   DEFAULT_SENDER_CONFIG / getEnvironment).
2. Model danych: `courier_shipments` (kolumny, RLS, FK złożony),
   `orders.delivery_grosze`, klucze `tenant_settings` + CHECK-i.
3. Dziennik decyzji: **ADR-030** i **ADR-031** (treść z sekcji „Decyzje
   projektowe" tego planu: kontekst, decyzja, konsekwencje, długi).
4. Dziennik budowy: wpis na górze (data, Zadanie 7, nr PR, jedno zdanie).
- [ ] Commit `docs: moduł dostaw — ADR-030/031, model danych, dziennik Zadania 7`.

### Task 13: Weryfikacja pełna + PR

- [ ] `supabase db reset` od zera (z `packages/db` worktree) — przechodzi z 0013.
- [ ] Env `SUPABASE_LOCAL_*` z `supabase status -o env`; potem:
  `pnpm --filter @avably/db test`, `pnpm --filter @avably/core test`,
  `pnpm --filter panel test` — komplet zielony (flaky false-red przy równoległym
  Z6: powtórz zanim zaczniesz diagnozować).
- [ ] Bramki repo: `pnpm turbo run typecheck lint test --force` (weryfikacja
  bramek z `--force` — zasada twarda briefu).
- [ ] Odtwórz usera demo `demo-katalog@test.local` (skrypt/kroki z wpisu
  pamięci panel-local-dev-setup / README packages/db — sprawdź na miejscu),
  zasiej przykładową konfigurację dostaw przez EKRAN USTAWIEŃ (to jest test
  ścieżki zapisu), zasiej zamówienie kurierskie.
- [ ] Panel w przeglądarce (dev server z worktree na porcie 3002 — wpis launch
  `avably-panel-dostawy` wzorem `avably-panel-zamowienia`): sekcja dostawy
  widoczna, koszt dostawy/cennik działa, formularz nadania pokazuje czytelny
  błąd konfiguracji przy braku credentiali (dowód briefowy!), ekran ustawień
  zapisuje i odczytuje. NADANIA NIE testujemy na żywym API (CI/dev bez
  credentiali — kontrakt na fixtures w core).
- [ ] Zrzut ekranu sekcji + ustawień do raportu.
- [ ] Rebase na świeży main (pierwszeństwo lądowania ma Z6 — rozwiąż trywialny
  konflikt page.tsx/messages po swojej stronie), push `feat/dostawy`, PR do main
  (opis: co/dlaczego/jak zweryfikowane; bez wzmianek AI), CI zielone (oba joby).
- [ ] Raport końcowy wg kontraktu briefu (status, PR, dowody mutacyjne — które
  asercje paliły, decyzje ADR-030/031, długi, zmiany env).

## Długi spisane (do raportu i docs)

1. Webhooki/cron syncu statusów (dziś: przycisk).
2. Wpięcie `delivery_grosze` w formularz tworzenia zamówienia (poza pasem tego
   zadania — kolumna i silnik gotowe).
3. Paczkomaty (`parcel_locker`): wymaga `pointId` InPost — nadanie ograniczone do
   metody `courier`.
4. Szyfrowanie credentiali GK / sejf sekretów; gating ustawień do ownera.
5. Link nawigacyjny do `/ustawienia-dostaw` w layoucie (plik wspólny — poza pasem);
   dziś dojście: link z sekcji dostawy przy brakującej konfiguracji + URL.
6. Anulowanie przesyłki u dostawcy (`cancelOrder` jest w kliencie — bez UI).

## Self-review (wykonany)

- Pokrycie briefu: port 1:1 semantyki (T1–T4), per-tenant config + zero fallbacków
  (T3/T5/T8, testy anty-fallbackowe + dowody mutacyjne), migracja 0013 z macierzą
  i FK złożonym (T5/T6), sekcja panelu + etykieta + zwrot lustrzany + sync na
  żądanie (T8–T10), koszt stały + próg darmowej dostawy (T3/T5/T9, ADR-030),
  i18n we własnym namespace (T9/T11), ekran ustawień minimalny (T11), docs+ADR
  (T12), DoD (T13). Etykiety NIE generujemy (pas GPT `packages/pdf` nietknięty) —
  tylko passthrough PDF od dostawcy.
- Spójność typów: `CourierTenantConfig`/`ShipmentParty`/`DeliveryPricing` używane
  w T3/T4/T8/T9 — nazwy jednolite; `houseNumber` w schemacie (T7) dopisany po
  decyzji z T8.
- Bez placeholderów: rozstrzygnięte w planie — numer domu klienta (pole formularza,
  nie fabrykacja), lokalizacja `loadCourierApi` (z awaryjną przeprowadzką do
  `delivery.ts`), próg darmowej dostawy inclusive, `price_grosze` w groszach z
  zaokrągleniem `Math.round(priceGross*100)`.
