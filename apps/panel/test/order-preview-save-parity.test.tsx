// @vitest-environment jsdom

/**
 * TOŻSAMOŚĆ PODGLĄDU Z ZAPISEM — sedno paczki U7 i klasa błędu, na którą tu
 * polujemy: ekran ogłaszający kwotę, której system potem nie policzy.
 *
 * ================== DLACZEGO NIE DWA WYWOŁANIA TEJ SAMEJ FUNKCJI ==================
 *
 * Test „preview() === preview()" nie dowodzi niczego: dwie kopie tej samej
 * pomyłki zgadzają się doskonale. Dlatego porównywane są DWA RÓŻNE ŹRÓDŁA:
 *
 *   1. LICZBY Z EKRANU — odczytane z wyrenderowanego `OrderWizard`
 *      (`[data-summary-row]`), czyli dokładnie to, co widzi operator;
 *   2. ŁADUNEK REALNEGO ZAPISU — `createOrderAction` (prawdziwa akcja
 *      serwerowa: prawdziwy schemat Zod, prawdziwy `priceOrderItems`,
 *      prawdziwy `resolveDeliveryCost`, prawdziwe `destinationColumns`)
 *      wywołana `FormData` ZBUDOWANYM Z TEGO SAMEGO FORMULARZA, z którego
 *      odczytaliśmy kwoty. Podstawiony jest wyłącznie klient Supabase —
 *      jedyna granica, za którą jest baza; argumenty `app.create_order`
 *      przechwytujemy w atrapie.
 *
 * Rozjazd któregokolwiek składnika (najem, kaucja, dostawa) pali test.
 *
 * ================== DRUGA POŁOWA: LISTA BRAKÓW ↔ SCHEMAT ==================
 *
 * Przycisk zapisu jest wygaszany listą z `readiness.ts`. Gdyby ta lista
 * rozjechała się z `orderFormSchema`, ekran albo odmawiałby bez powodu, albo
 * obiecywał zapis, którego schemat nie przyjmie. Tablica stanów formularza
 * sprawdza RÓWNOWAŻNOŚĆ w obie strony: „brak blokad ⟺ schemat przyjmuje".
 *
 * ================== TRZECIA CZĘŚĆ: SONDA IZOLACJI ==================
 *
 * Podgląd liczy WYŁĄCZNIE na cenniku wczytanym dla najemcy. Pozycja o cudzym
 * identyfikatorze produktu nie ma prawa dać ani kwoty, ani nazwy — ani na
 * ekranie, ani przy zapisie (sonda `order-wizard-isolation.test.ts` dowodzi
 * tego samego na żywej bazie, od strony zapytania).
 */
import { calculatePrice, formatMoney, type DeliveryPricing } from "@avably/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

import { orderFormSchema } from "@/lib/order-validation";
import { OrderWizard } from "@/app/[locale]/(panel)/zamowienia/nowe/order-wizard";
import { orderBlockers, type OrderDraft } from "@/app/[locale]/(panel)/zamowienia/nowe/readiness";
import type {
  WizardCustomer,
  WizardProduct,
} from "@/app/[locale]/(panel)/zamowienia/nowe/wizard-data";

const form = messages.orders.form;

const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "00000000-0000-4000-8000-0000000000c1";
const LOCATION_ID = "00000000-0000-4000-8000-0000000000d1";
/** Produkt CUDZEGO najemcy — nigdy nie wchodzi do danych ekranu. */
const FOREIGN_PRODUCT_ID = "00000000-0000-4000-8000-00000000beef";

/** Cennik z progiem — mnożnik progu jest najczęstszym miejscem rozjazdu. */
const PRICING_INPUT = {
  basePriceDayGrosze: 10_000,
  depositGrosze: 5_000,
  autoIncrementMultiplier: 1,
  tiers: [{ tierDays: 3, multiplier: 2.8 }],
};

/** Wiersz produktu w kształcie ODCZYTU Z BAZY — tak widzi go akcja serwerowa. */
const PRODUCT_ROW = {
  id: PRODUCT_ID,
  base_price_day_grosze: PRICING_INPUT.basePriceDayGrosze,
  deposit_grosze: PRICING_INPUT.depositGrosze,
  auto_increment_multiplier: PRICING_INPUT.autoIncrementMultiplier,
  buffer_before_days: 0,
  buffer_after_days: 0,
  pricing_tiers: [{ tier_days: 3, multiplier: 2.8 }],
  product_units: [
    { id: `${PRODUCT_ID}-u0`, unavailable_from: null, unavailable_to: null },
    { id: `${PRODUCT_ID}-u1`, unavailable_from: null, unavailable_to: null },
  ],
};

const DELIVERY_PRICING_ROW = {
  key: "delivery_pricing",
  value: { courier: { price_grosze: 2_500 }, parcel_locker: { price_grosze: 1_200 } },
};

const DELIVERY_PRICING: DeliveryPricing = {
  courier: { priceGrosze: 2_500 },
  parcel_locker: { priceGrosze: 1_200 },
};

const KOWALSKI: WizardCustomer = {
  id: CUSTOMER_ID,
  email: "jan.kowalski@example.test",
  full_name: "Jan Kowalski",
  phone: "500600700",
  address_street: "ul. Polna 7",
  address_zip: "61-001",
  address_city: "Poznań",
};

const HEATER: WizardProduct = {
  pricing: {
    id: PRODUCT_ID,
    base_price_day_grosze: PRODUCT_ROW.base_price_day_grosze,
    deposit_grosze: PRODUCT_ROW.deposit_grosze,
    auto_increment_multiplier: PRODUCT_ROW.auto_increment_multiplier,
    buffer_before_days: 0,
    buffer_after_days: 0,
    pricing_tiers: PRODUCT_ROW.pricing_tiers,
  },
  name: "Nagrzewnica 20 kW",
  units: PRODUCT_ROW.product_units.map((unit) => ({
    unitId: unit.id,
    unavailableFrom: null,
    unavailableTo: null,
  })),
  booked: [],
  dayMap: [
    { day: "2026-09-01", available: true },
    { day: "2026-09-02", available: true },
    { day: "2026-09-03", available: true },
  ] as WizardProduct["dayMap"],
};

/* ======================= ATRAPA BAZY POD AKCJĘ ======================= */

interface Captured {
  rpc: Record<string, unknown> | null;
  productFilters: [string, unknown][];
}

const captured: Captured = { rpc: null, productFilters: [] };

/**
 * Atrapa klienta Supabase pod produkcyjne zapytania `createOrderAction`:
 * odczyt cennika produktów, odczyt zajętości, odczyt cennika dostaw i wywołanie
 * `app.create_order`. Odczyt produktów RESPEKTUJE filtry — dzięki temu pozycja
 * o cudzym identyfikatorze nie znajduje wiersza, dokładnie jak w bazie z RLS.
 */
function fakeSupabase() {
  function resolve(q: {
    table: string;
    filters: [string, unknown][];
    ins: [string, unknown[]][];
  }) {
    if (q.table === "products") {
      captured.productFilters = q.filters;
      const wanted = q.ins.find(([column]) => column === "id")?.[1] ?? [];
      const tenantOk = q.filters.some(
        ([column, value]) => column === "tenant_id" && value === TENANT,
      );
      const rows = tenantOk && wanted.includes(PRODUCT_ID) ? [PRODUCT_ROW] : [];
      return { data: rows, error: null };
    }
    if (q.table === "order_items") return { data: [], error: null };
    if (q.table === "tenant_settings") return { data: [DELIVERY_PRICING_ROW], error: null };
    if (q.table === "orders") return { data: [{ id: "order-1" }], error: null };
    return { data: [], error: null };
  }

  function builder(table: string) {
    const q = { table, filters: [] as [string, unknown][], ins: [] as [string, unknown[]][] };
    const b: Record<string, unknown> = {
      select: () => b,
      update: () => b,
      insert: () => b,
      eq: (column: string, value: unknown) => {
        q.filters.push([column, value]);
        return b;
      },
      in: (column: string, values: unknown[]) => {
        q.ins.push([column, values]);
        return b;
      },
      not: () => b,
      order: () => b,
      limit: () => b,
      single: async () => ({ data: null, error: null }),
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve(q)).then(onFulfilled, onRejected),
    };
    return b;
  }

  return {
    from: (table: string) => builder(table),
    schema: () => ({
      rpc: async (name: string, payload: Record<string, unknown>) => {
        if (name === "create_order") captured.rpc = payload;
        return { data: "00000000-0000-4000-8000-00000000000f", error: null };
      },
    }),
  };
}

const requireMemberMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-server", () => ({
  requireMember: () => requireMemberMock(),
}));
vi.mock("@/lib/custom-fields-server", () => ({
  readCustomFieldsForCreate: async () => ({ values: {}, fieldErrors: {} }),
  readCustomFieldsForUpdate: async () => ({ values: {}, fieldErrors: {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  permanentRedirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "pl",
}));

const { createOrderAction } = await import("@/app/[locale]/(panel)/zamowienia/actions");

/* ======================= NARZĘDZIA EKRANU ======================= */

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  captured.rpc = null;
  captured.productFilters = [];
  requireMemberMock.mockReturnValue({
    user: { id: "user-1", email: "op@test.local" },
    tenantId: TENANT,
    role: "owner",
    superadmin: false,
    aal: "aal1",
    amr: [],
    supabase: fakeSupabase(),
  });
});

afterEach(cleanup);

function mount(products: WizardProduct[] = [HEATER]) {
  render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <OrderWizard
        action={vi.fn(async () => ({}))}
        customers={[KOWALSKI]}
        customersTruncated={false}
        products={products}
        locations={[{ id: LOCATION_ID, name: "Magazyn Poznań" }]}
        currency="PLN"
        locale="pl"
        deliveryPricing={DELIVERY_PRICING}
        paymentAccountConnected
      />
    </NextIntlClientProvider>,
  );
}

const summary = () => document.querySelector("[data-order-preview]") as HTMLElement;

function row(name: string): string {
  const node = summary().querySelector(`[data-summary-row="${name}"] [data-summary-amount]`);
  if (!node) throw new Error(`Brak wiersza podsumowania „${name}"`);
  return node.textContent!.trim();
}

function radio(name: string, value: string): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (!field) throw new Error(`Brak pola ${name}=${value}`);
  return field;
}

function fillOrder(options?: { courier?: boolean; quantity?: number }) {
  fireEvent.change(screen.getByLabelText(form.customerSearchLabel), { target: { value: "kowalski" } });
  fireEvent.click(screen.getByText("Jan Kowalski"));

  fireEvent.click(screen.getByRole("button", { name: form.addItem }));
  fireEvent.click(
    within(document.querySelector("[data-item-results]") as HTMLElement).getByText(
      "Nagrzewnica 20 kW",
    ),
  );
  for (let extra = 1; extra < (options?.quantity ?? 1); extra += 1) {
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-item-quantity-increase]")!);
  }

  const today = new Date();
  const monthsAhead = (2026 - today.getFullYear()) * 12 + (8 - today.getMonth());
  for (let step = 0; step < monthsAhead; step += 1) {
    fireEvent.click(screen.getByRole("button", { name: /następnego miesiąca/i }));
  }
  const day = (date: Date) =>
    document.querySelector<HTMLButtonElement>(
      `button[data-day="${date.toLocaleDateString("pl-PL")}"]`,
    )!;
  fireEvent.click(day(new Date(2026, 8, 1)));
  fireEvent.click(day(new Date(2026, 8, 3)));

  if (options?.courier) {
    fireEvent.click(radio("deliveryMethod", "courier"));
  }
}

/** Zapis TYM SAMYM formularzem, z którego czytamy kwoty na ekranie. */
async function saveRenderedForm() {
  const formData = new FormData(document.querySelector("form")!);
  await expect(createOrderAction({}, formData)).rejects.toThrow(/REDIRECT:/);
  if (captured.rpc === null) throw new Error("app.create_order nie zostało wywołane");
  return captured.rpc;
}

const money = (grosze: number) => formatMoney(grosze, "PLN", "pl");

describe("kwota z podglądu zgadza się z kwotą ZAPISANĄ", () => {
  it("odbiór osobisty: najem, kaucja i dostawa z ekranu == ładunek app.create_order", async () => {
    mount();
    fillOrder();

    // Najpierw dowód, że ekran w ogóle podał kwoty — porównanie „—" z „—"
    // byłoby zgodnością po pustym zbiorze.
    expect(summary().getAttribute("data-summary-state")).toBe("priced");
    const screenRental = row("rental");
    const screenDeposit = row("deposit");
    const screenDelivery = row("delivery");
    const screenTotal = row("total");
    expect(screenRental).not.toBe("—");

    const rpc = await saveRenderedForm();

    expect(screenRental).toBe(money(rpc.p_total_rental_grosze as number));
    expect(screenDeposit).toBe(money(rpc.p_total_deposit_grosze as number));
    expect(screenDelivery).toBe(money(rpc.p_delivery_grosze as number));
    expect(screenTotal).toBe(
      money((rpc.p_total_rental_grosze as number) + (rpc.p_delivery_grosze as number)),
    );

    // Kontrola trzecia: obie strony zgadzają się z SILNIKIEM, a nie tylko
    // ze sobą — dwie kopie tej samej pomyłki też byłyby zgodne.
    const expected = calculatePrice("2026-09-01", "2026-09-03", PRICING_INPUT);
    expect(rpc.p_total_rental_grosze).toBe(expected.rentalGrosze);
    expect(rpc.p_total_deposit_grosze).toBe(expected.depositGrosze);
  });

  it("kurier z cennika: koszt dostawy z ekranu == koszt zapisany", async () => {
    mount();
    fillOrder({ courier: true });

    const screenDelivery = row("delivery");
    const screenTotal = row("total");
    expect(screenDelivery).toBe(money(2_500));

    const rpc = await saveRenderedForm();
    expect(rpc.p_delivery_grosze).toBe(2_500);
    expect(rpc.p_delivery_price_source).toBe("pricing");
    expect(screenDelivery).toBe(money(rpc.p_delivery_grosze as number));
    expect(screenTotal).toBe(
      money((rpc.p_total_rental_grosze as number) + (rpc.p_delivery_grosze as number)),
    );
  });

  it("dwie sztuki: suma z ekranu == suma zapisana (a nie kwota jednej sztuki)", async () => {
    mount();
    fillOrder({ quantity: 2 });

    const screenRental = row("rental");
    const rpc = await saveRenderedForm();

    expect((rpc.p_items as unknown[]).length).toBe(2);
    expect(screenRental).toBe(money(rpc.p_total_rental_grosze as number));
    const one = calculatePrice("2026-09-01", "2026-09-03", PRICING_INPUT).rentalGrosze;
    expect(rpc.p_total_rental_grosze).toBe(one * 2);
    expect(screenRental).not.toBe(money(one));
  });

  it("cena własna dostawy: kwota z ekranu == kwota zapisana, ze źródłem „manual”", async () => {
    mount();
    fillOrder({ courier: true });
    fireEvent.click(document.querySelector("[data-delivery-price-manual]")!);
    fireEvent.change(document.querySelector("[data-delivery-price-input]")!, {
      target: { value: "19,90" },
    });

    const screenDelivery = row("delivery");
    expect(screenDelivery).toBe(money(1_990));

    const rpc = await saveRenderedForm();
    expect(rpc.p_delivery_grosze).toBe(1_990);
    expect(rpc.p_delivery_price_source).toBe("manual");
    expect(screenDelivery).toBe(money(rpc.p_delivery_grosze as number));
  });
});

describe("lista braków ↔ orderFormSchema (przycisk mówi to, co zrobi zapis)", () => {
  const READY: OrderDraft = {
    hasCustomer: true,
    itemCount: 1,
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    method: "pickup",
    pickupLocationId: LOCATION_ID,
    pointCode: "",
    addressSource: "",
    addressStreet: "",
    addressZip: "",
    addressCity: "",
    priceSource: "pricing",
    price: "",
    deliveryPricingProblem: false,
    shortageCount: 0,
  };

  /** Ładunek formularza w kształcie, w jakim czyta go akcja serwerowa. */
  function payload(draft: OrderDraft) {
    return {
      customerId: draft.hasCustomer ? CUSTOMER_ID : "",
      newCustomerEmail: "",
      newCustomerName: "",
      newCustomerPhone: "",
      items: JSON.stringify(
        Array.from({ length: draft.itemCount }, () => ({ productId: PRODUCT_ID })),
      ),
      startDate: draft.startDate,
      endDate: draft.endDate,
      deliveryMethod: draft.method,
      pickupLocationId: draft.pickupLocationId,
      notes: "",
      paymentMethod: "",
      deliveryPriceSource: draft.priceSource,
      deliveryPrice: draft.priceSource === "manual" ? draft.price : "",
      deliveryPointProvider: draft.pointCode === "" ? "" : "inpost",
      deliveryPointCode: draft.pointCode,
      deliveryPointAddress: "",
      deliveryAddressSource: draft.addressSource,
      deliveryAddressName: "",
      deliveryAddressStreet: draft.addressStreet,
      deliveryAddressZip: draft.addressZip,
      deliveryAddressCity: draft.addressCity,
      deliveryAddressPhone: "",
    };
  }

  /**
   * Stany formularza: każdy z osobna wywraca jedną regułę. Nazwa mówi, czego
   * dotyczy — komunikat błędu ma wskazywać regułę, nie numer wiersza tablicy.
   */
  const CASES: [string, OrderDraft][] = [
    ["komplet, odbiór osobisty", READY],
    ["bez klienta", { ...READY, hasCustomer: false }],
    ["pusty koszyk", { ...READY, itemCount: 0 }],
    ["bez terminu", { ...READY, startDate: "", endDate: "" }],
    ["data nieistniejąca w kalendarzu", { ...READY, startDate: "2026-02-31", endDate: "2026-03-02" }],
    ["koniec przed początkiem", { ...READY, startDate: "2026-09-03", endDate: "2026-09-01" }],
    ["odbiór osobisty bez punktu", { ...READY, pickupLocationId: "" }],
    [
      "paczkomat bez numeru punktu",
      { ...READY, method: "parcel_locker", pickupLocationId: "", pointCode: "" },
    ],
    [
      "paczkomat z numerem punktu",
      { ...READY, method: "parcel_locker", pickupLocationId: "", pointCode: "POZ08M" },
    ],
    [
      "kurier bez wskazania adresu",
      { ...READY, method: "courier", pickupLocationId: "", addressSource: "" },
    ],
    [
      "kurier z adresem z kartoteki",
      { ...READY, method: "courier", pickupLocationId: "", addressSource: "customer" },
    ],
    [
      "kurier z niekompletnym innym adresem",
      {
        ...READY,
        method: "courier",
        pickupLocationId: "",
        addressSource: "custom",
        addressStreet: "ul. Inna 1",
        addressZip: "",
        addressCity: "Poznań",
      },
    ],
    [
      "kurier z kompletnym innym adresem",
      {
        ...READY,
        method: "courier",
        pickupLocationId: "",
        addressSource: "custom",
        addressStreet: "ul. Inna 1",
        addressZip: "61-001",
        addressCity: "Poznań",
      },
    ],
    [
      "cena własna bez kwoty",
      {
        ...READY,
        method: "courier",
        pickupLocationId: "",
        addressSource: "customer",
        priceSource: "manual",
        price: "",
      },
    ],
    [
      "cena własna z kwotą",
      {
        ...READY,
        method: "courier",
        pickupLocationId: "",
        addressSource: "customer",
        priceSource: "manual",
        price: "19,90",
      },
    ],
    [
      "cena własna ponad granicą",
      {
        ...READY,
        method: "courier",
        pickupLocationId: "",
        addressSource: "customer",
        priceSource: "manual",
        price: "10001",
      },
    ],
  ];

  it("tablica stanów obejmuje OBIE odpowiedzi — inaczej równoważność jest pusta", () => {
    const accepted = CASES.filter(([, draft]) => orderFormSchema.safeParse(payload(draft)).success);
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.length).toBeLessThan(CASES.length);
  });

  it.each(CASES)("%s: brak blokad ⟺ schemat przyjmuje", (_name, draft) => {
    const blocked = orderBlockers(draft).length > 0;
    const rejected = !orderFormSchema.safeParse(payload(draft)).success;
    expect(blocked, blocked ? "ekran blokuje, a schemat przyjmuje" : "ekran puszcza, a schemat odmawia").toBe(
      rejected,
    );
  });
});

describe("sonda izolacji: cudzy produkt nie daje ani kwoty, ani nazwy", () => {
  it("pozycja spoza katalogu najemcy nie wycenia się na ekranie", () => {
    // Wejście awaryjne: produkt, którego NIE MA w danych ekranu (tak wygląda
    // identyfikator z cudzego tenanta po odczycie zawężonym po tenant_id).
    const foreign: WizardProduct = {
      ...HEATER,
      pricing: { ...HEATER.pricing, id: FOREIGN_PRODUCT_ID },
      name: "Sprzęt cudzego najemcy",
    };
    mount([foreign]);

    // Najpierw dowód, że ekran ma z czego liczyć — karta wyceny JEST.
    expect(summary()).not.toBeNull();
    fireEvent.change(screen.getByLabelText(form.customerSearchLabel), {
      target: { value: "kowalski" },
    });
    fireEvent.click(screen.getByText("Jan Kowalski"));

    // Ekran zna wyłącznie produkty, które przyszły z odczytu tenanta — cudzego
    // identyfikatora nie da się do koszyka wpisać inaczej niż podmieniając
    // ukryte pole, co jest właśnie ścieżką sprawdzaną niżej przy zapisie.
    const items = document.querySelector<HTMLInputElement>('input[name="items"]')!;
    expect(JSON.parse(items.value)).toEqual([]);
  });

  it("zapis pozycji o cudzym identyfikatorze odmawia BEZ ceny i BEZ nazwy", async () => {
    mount();
    fillOrder();

    // Podmiana ukrytego pola: dokładnie to, co może zrobić klient przeglądarki.
    const items = document.querySelector<HTMLInputElement>('input[name="items"]')!;
    items.value = JSON.stringify([{ productId: FOREIGN_PRODUCT_ID }]);

    const formData = new FormData(document.querySelector("form")!);
    const result = await createOrderAction({}, formData);

    expect(captured.rpc, "zamówienie na cudzy produkt zostało utworzone").toBeNull();
    expect(result.formError).toBeTruthy();
    // Odmowa nie wynosi ŻADNEJ wiedzy o cudzym produkcie: ani nazwy, ani kwoty.
    expect(result.formError).not.toMatch(/Nagrzewnica|Sprzęt cudzego najemcy/);
    expect(result.formError).not.toMatch(/\d{3,}/);
  });

  it("odczyt cennika przy zapisie jest ZAWĘŻONY do najemcy", async () => {
    mount();
    fillOrder();
    await saveRenderedForm();

    expect(captured.productFilters).toContainEqual(["tenant_id", TENANT]);
  });
});
