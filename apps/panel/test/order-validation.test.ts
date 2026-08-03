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

/**
 * Pola R3 w kształcie, w jakim wysyła je formularz przy metodzie NIEwymagającej
 * ani punktu przewoźnika, ani adresu. Pusty string znaczy „pole nieadekwatne do
 * metody" — dokładnie to, co jedzie z ekranu ukrytym inputem.
 */
const R3_EMPTY = {
  paymentMethod: "",
  deliveryPriceSource: "pricing",
  deliveryPrice: "",
  deliveryPointProvider: "",
  deliveryPointCode: "",
  deliveryPointAddress: "",
  deliveryAddressSource: "",
  deliveryAddressName: "",
  deliveryAddressStreet: "",
  deliveryAddressZip: "",
  deliveryAddressCity: "",
  deliveryAddressPhone: "",
};

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
  ...R3_EMPTY,
  // Kurier jedzie POD ADRES, więc źródło adresu jest wymagane (ADR-089).
  deliveryAddressSource: "customer",
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
        // Odbiór osobisty nie jedzie ani do punktu przewoźnika, ani pod adres.
        deliveryAddressSource: "",
      }).success,
    ).toBe(true);
  });

  it("metoda spoza CHECK-a jest odrzucana", () => {
    expect(orderFormSchema.safeParse({ ...validBase, deliveryMethod: "dron" }).success).toBe(false);
  });
});

/**
 * R3 / ADR-089 — CEL DOSTARCZENIA. Lustra bramek 0044: reguły są dwustronne,
 * bo wariant „zignoruj nieadekwatne pole" gubi dane po cichu (klasa błędu
 * zamknięta migracją 0041).
 */
describe("orderFormSchema — punkt odbioru przewoźnika (pinezka ff2dfefc)", () => {
  const parcel = {
    ...validBase,
    deliveryMethod: "parcel_locker",
    deliveryAddressSource: "",
    deliveryPointProvider: "inpost",
    deliveryPointCode: "POZ08M",
  };

  it("paczkomat z dostawcą i numerem punktu przechodzi i niesie strukturę", () => {
    const parsed = orderFormSchema.safeParse({
      ...parcel,
      deliveryPointAddress: "ul. Cumownicza 1, Poznań",
    });
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    if (parsed.success) {
      expect(parsed.data.destination).toEqual({
        kind: "point",
        point: { provider: "inpost", code: "POZ08M", address: "ul. Cumownicza 1, Poznań" },
      });
    }
  });

  it("adres opisowy punktu jest opcjonalny — przewoźnik adresuje numerem", () => {
    const parsed = orderFormSchema.safeParse(parcel);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.destination.kind === "point") {
      expect(parsed.data.destination.point.address).toBeNull();
    }
  });

  it("paczkomat bez numeru punktu jest odrzucany", () => {
    const parsed = orderFormSchema.safeParse({ ...parcel, deliveryPointCode: "" });
    expect(parsed.success).toBe(false);
  });

  it("nieznany dostawca punktu jest odrzucany", () => {
    expect(
      orderFormSchema.safeParse({ ...parcel, deliveryPointProvider: "kurier-z-ulicy" }).success,
    ).toBe(false);
  });

  it("numer punktu przy kurierze jest odrzucany, a nie po cichu porzucany", () => {
    const parsed = orderFormSchema.safeParse({
      ...validBase,
      deliveryPointProvider: "inpost",
      deliveryPointCode: "POZ08M",
    });
    expect(parsed.success).toBe(false);
  });

  it("numer punktu dłuższy niż limit kolumny jest odrzucany", () => {
    expect(
      orderFormSchema.safeParse({ ...parcel, deliveryPointCode: "P".repeat(33) }).success,
    ).toBe(false);
  });
});

describe("orderFormSchema — adres dostarczenia (pinezka e2aef3f6)", () => {
  it("adres z kartoteki to WSKAŹNIK — zamówienie nie niesie kopii pól", () => {
    const parsed = orderFormSchema.safeParse(validBase);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.destination).toEqual({ kind: "customer" });
    }
  });

  it("inny adres z kompletem ulica+kod+miasto przechodzi jako migawka", () => {
    const parsed = orderFormSchema.safeParse({
      ...validBase,
      deliveryAddressSource: "custom",
      deliveryAddressName: "Magazyn budowy",
      deliveryAddressStreet: "ul. Polna 7",
      deliveryAddressZip: "61-001",
      deliveryAddressCity: "Poznań",
      deliveryAddressPhone: "500600700",
    });
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    if (parsed.success) {
      expect(parsed.data.destination).toEqual({
        kind: "custom",
        address: {
          name: "Magazyn budowy",
          street: "ul. Polna 7",
          zip: "61-001",
          city: "Poznań",
          phone: "500600700",
        },
      });
    }
  });

  it("inny adres bez miejscowości jest odrzucany", () => {
    expect(
      orderFormSchema.safeParse({
        ...validBase,
        deliveryAddressSource: "custom",
        deliveryAddressStreet: "ul. Polna 7",
        deliveryAddressZip: "61-001",
      }).success,
    ).toBe(false);
  });

  it("adres z kartoteki z DOPISANYMI polami jest odrzucany — druga prawda o adresie", () => {
    expect(
      orderFormSchema.safeParse({
        ...validBase,
        deliveryAddressSource: "customer",
        deliveryAddressStreet: "ul. Inna 1",
      }).success,
    ).toBe(false);
  });

  it("kurier bez wskazania adresu jest odrzucany", () => {
    expect(orderFormSchema.safeParse({ ...validBase, deliveryAddressSource: "" }).success).toBe(
      false,
    );
  });

  it("adres przy paczkomacie jest odrzucany — przesyłka jedzie do punktu", () => {
    expect(
      orderFormSchema.safeParse({
        ...validBase,
        deliveryMethod: "parcel_locker",
        deliveryPointProvider: "inpost",
        deliveryPointCode: "POZ08M",
        deliveryAddressSource: "customer",
      }).success,
    ).toBe(false);
  });

  it("dostawa własna korzysta z tej samej reguły adresu co kurier", () => {
    const parsed = orderFormSchema.safeParse({ ...validBase, deliveryMethod: "own_delivery" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.destination).toEqual({ kind: "customer" });
  });
});

describe("orderFormSchema — cena dostawy (pinezka 3c944a2d)", () => {
  it("bez nadpisania nie ma kwoty — koszt policzy cennik", () => {
    const parsed = orderFormSchema.safeParse(validBase);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.deliveryPriceOverrideGrosze).toBeNull();
  });

  it("cena własna wchodzi jako całkowite grosze", () => {
    const parsed = orderFormSchema.safeParse({
      ...validBase,
      deliveryPriceSource: "manual",
      deliveryPrice: "19,90",
    });
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    if (parsed.success) expect(parsed.data.deliveryPriceOverrideGrosze).toBe(1990);
  });

  it("zero jest poprawną ceną własną — dostawa gratis to decyzja", () => {
    const parsed = orderFormSchema.safeParse({
      ...validBase,
      deliveryPriceSource: "manual",
      deliveryPrice: "0",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.deliveryPriceOverrideGrosze).toBe(0);
  });

  it("deklaracja ceny własnej bez kwoty jest odrzucana", () => {
    expect(
      orderFormSchema.safeParse({ ...validBase, deliveryPriceSource: "manual", deliveryPrice: "" })
        .success,
    ).toBe(false);
  });

  it("kwota przy cenie z cennika jest odrzucana — porzucona liczba nic nie znaczy", () => {
    expect(
      orderFormSchema.safeParse({ ...validBase, deliveryPriceSource: "pricing", deliveryPrice: "19" })
        .success,
    ).toBe(false);
  });

  it("kwota ponad granicę jest odrzucana, a nie przycinana", () => {
    expect(
      orderFormSchema.safeParse({
        ...validBase,
        deliveryPriceSource: "manual",
        deliveryPrice: "10001",
      }).success,
    ).toBe(false);
  });

  it("kwota ujemna i trzy miejsca po przecinku są odrzucane", () => {
    for (const price of ["-1", "19,905"]) {
      expect(
        orderFormSchema.safeParse({ ...validBase, deliveryPriceSource: "manual", deliveryPrice: price })
          .success,
        price,
      ).toBe(false);
    }
  });

  it("odbiór osobisty nie przyjmuje ceny własnej (ADR-030: bezpłatny z definicji)", () => {
    expect(
      orderFormSchema.safeParse({
        ...validBase,
        deliveryMethod: "pickup",
        pickupLocationId: LOCATION_ID,
        deliveryAddressSource: "",
        deliveryPriceSource: "manual",
        deliveryPrice: "19",
      }).success,
    ).toBe(false);
  });
});

describe("orderFormSchema — forma płatności (pinezka 82a0c41a)", () => {
  it("każda forma ze słownika przechodzi", () => {
    for (const method of ["cod", "transfer", "online"] as const) {
      const parsed = orderFormSchema.safeParse({ ...validBase, paymentMethod: method });
      expect(parsed.success, method).toBe(true);
      if (parsed.success) expect(parsed.data.paymentMethod).toBe(method);
    }
  });

  it("brak wyboru jest poprawny i daje null, nie pusty napis", () => {
    const parsed = orderFormSchema.safeParse(validBase);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.paymentMethod).toBeNull();
  });

  it("forma spoza enuma jest odrzucana", () => {
    for (const method of ["blik", "karta", "gotowka"]) {
      expect(orderFormSchema.safeParse({ ...validBase, paymentMethod: method }).success, method).toBe(
        false,
      );
    }
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

  it("q/sort/dir/preset: komplet poprawnych przechodzi", () => {
    const parsed = ordersFilterSchema.parse({
      q: "  Kowalski  ",
      sort: "kwota",
      dir: "asc",
      preset: "biezacy-miesiac",
    });
    expect(parsed.q).toBe("Kowalski"); // przycięte
    expect(parsed.sort).toBe("kwota");
    expect(parsed.dir).toBe("asc");
    expect(parsed.preset).toBe("biezacy-miesiac");
  });

  it("nieznany sort/dir/preset jest IGNOROWANY (undefined), nie błędem", () => {
    const parsed = ordersFilterSchema.parse({
      sort: "order_number", // spoza whitelisty — celowo kolumna bazy, nie klucz
      dir: "rosnaco",
      preset: "zeszly-rok",
    });
    expect(parsed.sort).toBeUndefined();
    expect(parsed.dir).toBeUndefined();
    expect(parsed.preset).toBeUndefined();
  });

  it("puste q spada na undefined (pole wyszukiwarki wysłane bez wpisu)", () => {
    expect(ordersFilterSchema.parse({ q: "   " }).q).toBeUndefined();
  });

  it("nadmiarowo długie q jest ignorowane, nie wywraca strony", () => {
    expect(ordersFilterSchema.parse({ q: "x".repeat(500) }).q).toBeUndefined();
  });
});
