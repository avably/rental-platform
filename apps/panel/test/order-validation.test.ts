/**
 * Schematy Zod formularzy zamówień — lustra CHECK-ów z 0007 (czytelny
 * komunikat PRZED bramką bazy), wzorzec catalog-validation.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  orderFormSchema,
  ordersFilterSchema,
  statusChangeFromFormData,
  statusChangeSchema,
} from "@/lib/order-validation";

const CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000002";
const LOCATION_ID = "00000000-0000-4000-8000-000000000003";
const ORDER_ID = "00000000-0000-4000-8000-000000000004";

const validBase = {
  customerId: CUSTOMER_ID,
  newCustomerEmail: "",
  newCustomerName: "",
  newCustomerPhone: "",
  items: JSON.stringify([{ productId: PRODUCT_ID }]),
  startDate: "2026-08-01",
  endDate: "2026-08-03",
  deliveryMethod: "courier",
  pickupLocationId: "",
  notes: "",
};

describe("orderFormSchema — klient", () => {
  it("istniejący klient (customerId) przechodzi", () => {
    const parsed = orderFormSchema.safeParse(validBase);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    if (parsed.success) {
      expect(parsed.data.customerId).toBe(CUSTOMER_ID);
      expect(parsed.data.newCustomer).toBeNull();
    }
  });

  it("nowy klient (e-mail) przechodzi i niesie komplet pól", () => {
    const parsed = orderFormSchema.safeParse({
      ...validBase,
      customerId: "",
      newCustomerEmail: "jan@example.com",
      newCustomerName: "Jan Testowy",
      newCustomerPhone: "+48 600 000 000",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.customerId).toBeNull();
      expect(parsed.data.newCustomer).toEqual({
        email: "jan@example.com",
        fullName: "Jan Testowy",
        phone: "+48 600 000 000",
      });
    }
  });

  it("ani istniejący, ani nowy klient → błąd pola customerId", () => {
    const parsed = orderFormSchema.safeParse({ ...validBase, customerId: "" });
    expect(parsed.success).toBe(false);
  });

  it("jednocześnie istniejący I nowy klient → błąd (wybór musi być jednoznaczny)", () => {
    const parsed = orderFormSchema.safeParse({
      ...validBase,
      newCustomerEmail: "jan@example.com",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("orderFormSchema — pozycje", () => {
  it("niepoprawny JSON pozycji jest odrzucany", () => {
    expect(orderFormSchema.safeParse({ ...validBase, items: "nie-json" }).success).toBe(false);
  });

  it("puste pozycje są odrzucane", () => {
    expect(orderFormSchema.safeParse({ ...validBase, items: "[]" }).success).toBe(false);
  });

  it("pozycja bez poprawnego productId jest odrzucana", () => {
    expect(
      orderFormSchema.safeParse({
        ...validBase,
        items: JSON.stringify([{ productId: "nie-uuid" }]),
      }).success,
    ).toBe(false);
  });

  it("więcej niż 50 pozycji jest odrzucane", () => {
    const items = Array.from({ length: 51 }, () => ({ productId: PRODUCT_ID }));
    expect(orderFormSchema.safeParse({ ...validBase, items: JSON.stringify(items) }).success).toBe(
      false,
    );
  });
});

describe("orderFormSchema — termin (lustro orders_dates_ordered)", () => {
  it("koniec przed początkiem jest odrzucany", () => {
    expect(
      orderFormSchema.safeParse({ ...validBase, startDate: "2026-08-05", endDate: "2026-08-01" })
        .success,
    ).toBe(false);
  });

  it("najem jednodniowy (start = end) przechodzi — zakres INCLUSIVE", () => {
    expect(
      orderFormSchema.safeParse({ ...validBase, startDate: "2026-08-01", endDate: "2026-08-01" })
        .success,
    ).toBe(true);
  });

  it("data nieistniejąca w kalendarzu (2026-02-31) jest odrzucana", () => {
    // Walidację robi assertIsoDate z silnika — zero własnej logiki dat.
    expect(
      orderFormSchema.safeParse({ ...validBase, startDate: "2026-02-31", endDate: "2026-03-02" })
        .success,
    ).toBe(false);
  });
});

describe("orderFormSchema — dostawa (lustro orders_pickup_requires_location)", () => {
  it("odbiór osobisty bez punktu → błąd pola pickupLocationId", () => {
    const parsed = orderFormSchema.safeParse({ ...validBase, deliveryMethod: "pickup" });
    expect(parsed.success).toBe(false);
  });

  it("odbiór osobisty z punktem przechodzi", () => {
    expect(
      orderFormSchema.safeParse({
        ...validBase,
        deliveryMethod: "pickup",
        pickupLocationId: LOCATION_ID,
      }).success,
    ).toBe(true);
  });

  it("metoda spoza CHECK-a jest odrzucana", () => {
    expect(orderFormSchema.safeParse({ ...validBase, deliveryMethod: "dron" }).success).toBe(false);
  });
});

describe("statusChangeSchema", () => {
  it("poprawna zmiana statusu przechodzi", () => {
    expect(
      statusChangeSchema.safeParse({ orderId: ORDER_ID, to: "reserved", expectedFrom: "pending" })
        .success,
    ).toBe(true);
  });

  it("status spoza zbioru jest odrzucany", () => {
    expect(
      statusChangeSchema.safeParse({ orderId: ORDER_ID, to: "wysłane", expectedFrom: "pending" })
        .success,
    ).toBe(false);
  });
});

/**
 * Sklejka FormData → schemat. Testowana OSOBNO, bo pole dodane do schematu,
 * ale nieodczytane z formularza, niczego nie wywala — jest po prostu zawsze
 * undefined, a zależna od niego gałąź nigdy się nie wykonuje. Tak przepadła
 * pierwsza wersja wysyłki e-maili, złapana dopiero w przeglądarce.
 */
describe("statusChangeFromFormData", () => {
  function formData(entries: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(entries)) fd.set(key, value);
    return fd;
  }

  const base = { orderId: ORDER_ID, to: "reserved", expectedFrom: "pending" };

  it("przenosi zaznaczony checkbox wysyłki do wejścia schematu", () => {
    const parsed = statusChangeSchema.safeParse(
      statusChangeFromFormData(formData({ ...base, sendEmail: "on" })),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.sendEmail).toBe("on");
  });

  it("odznaczony checkbox (brak pola) daje undefined, a tranzycja nadal przechodzi", () => {
    const parsed = statusChangeSchema.safeParse(statusChangeFromFormData(formData(base)));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.sendEmail).toBeUndefined();
  });

  it("przenosi pozostałe pola tranzycji", () => {
    const parsed = statusChangeSchema.safeParse(
      statusChangeFromFormData(formData({ ...base, sendEmail: "on" })),
    );
    expect(parsed.success && parsed.data).toMatchObject(base);
  });
});

describe("ordersFilterSchema — filtry listy (błędne wartości są IGNOROWANE, nie błędem)", () => {
  it("komplet poprawnych filtrów przechodzi", () => {
    const parsed = ordersFilterSchema.parse({
      status: "reserved",
      od: "2026-08-01",
      do: "2026-08-31",
      klient: CUSTOMER_ID,
    });
    expect(parsed).toEqual({
      status: "reserved",
      od: "2026-08-01",
      do: "2026-08-31",
      klient: CUSTOMER_ID,
    });
  });

  it("błędne wartości spadają na undefined — link z zepsutym filtrem nie wywraca listy", () => {
    const parsed = ordersFilterSchema.parse({
      status: "zmyślony",
      od: "nie-data",
      do: "2026-02-31",
      klient: "nie-uuid",
    });
    expect(parsed).toEqual({ status: undefined, od: undefined, do: undefined, klient: undefined });
  });
});
