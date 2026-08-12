// @vitest-environment jsdom

/**
 * Ekran „Nowe zamówienie" po przebudowie R3 — zachowanie, nie wygląd.
 *
 * ================== CO TEN TEST PILNUJE ==================
 *
 * Każda asercja odpowiada jednej pinezce przeglądu i jest o TREŚCI, która
 * pojedzie do akcji serwerowej (ukryte pola formularza), a nie o samym fakcie,
 * że coś się kliknęło. Kreator, który „wygląda dobrze", ale wysyła pusty
 * `customerId` albo gubi numer paczkomatu, przechodziłby test asercji
 * o widoczności.
 *
 *   bed18451 — wyszukiwarka klientów zawęża listę i wybór ustawia customerId;
 *   0007c5a4 — pozycje dodaje się przez wyszukiwarkę, koszyk jedzie JSON-em;
 *   00aa35ca — termin wybiera się kalendarzem stojącym otwarto po prawej;
 *   3c944a2d — ceny metod dostawy pokazane z cennika, cena własna do wpisania;
 *   ff2dfefc — paczkomat odsłania pole numeru punktu;
 *   e2aef3f6 — kurier daje wybór „z danych klienta" / „inny adres";
 *   82a0c41a — forma płatności, z płatnością online zablokowaną bez konta.
 *
 * Renderowany jest PRAWDZIWY `OrderWizard` z prawdziwymi sekcjami; zamockowana
 * jest wyłącznie akcja serwerowa — jedyna granica, za którą jest baza.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { DeliveryPricing } from "@avably/core";

import messages from "../messages/pl.json";

import { OrderWizard } from "@/app/[locale]/(panel)/zamowienia/nowe/order-wizard";
import type {
  WizardCustomer,
  WizardProduct,
} from "@/app/[locale]/(panel)/zamowienia/nowe/wizard-data";

const form = messages.orders.form;

const KOWALSKI: WizardCustomer = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "jan.kowalski@example.test",
  full_name: "Jan Kowalski",
  phone: "500600700",
  address_street: "ul. Polna 7",
  address_zip: "61-001",
  address_city: "Poznań",
};

const NOWAK: WizardCustomer = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "anna.nowak@example.test",
  full_name: "Anna Nowak",
  phone: "600700800",
  address_street: null,
  address_zip: null,
  address_city: null,
};

function product(id: string, name: string): WizardProduct {
  return {
    pricing: {
      id,
      base_price_day_grosze: 10_000,
      deposit_grosze: 0,
      auto_increment_multiplier: 1,
      buffer_before_days: 0,
      buffer_after_days: 0,
      pricing_tiers: [],
    },
    name,
    units: [{ unitId: `${id}-u1`, unavailableFrom: null, unavailableTo: null }],
    booked: [],
    dayMap: [
      { day: "2026-09-01", available: true },
      { day: "2026-09-02", available: false },
      { day: "2026-09-03", available: true },
    ] as WizardProduct["dayMap"],
  };
}

const HEATER = product("00000000-0000-4000-8000-0000000000c1", "Nagrzewnica 20 kW");
const LADDER = product("00000000-0000-4000-8000-0000000000c2", "Drabina aluminiowa");

const PRICING: DeliveryPricing = {
  courier: { priceGrosze: 2500 },
  parcel_locker: { priceGrosze: 1200 },
};

/** Radix Select (punkt odbioru) woła API, których jsdom nie implementuje. */
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

afterEach(cleanup);

function mount(overrides?: {
  customers?: WizardCustomer[];
  customersTruncated?: boolean;
  paymentAccountConnected?: boolean;
  pricing?: DeliveryPricing | null;
}) {
  const action = vi.fn(async () => ({}));
  render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <OrderWizard
        action={action}
        customers={overrides?.customers ?? [KOWALSKI, NOWAK]}
        customersTruncated={overrides?.customersTruncated ?? false}
        products={[HEATER, LADDER]}
        locations={[{ id: "00000000-0000-4000-8000-0000000000d1", name: "Magazyn Poznań" }]}
        currency="PLN"
        locale="pl"
        deliveryPricing={overrides?.pricing === undefined ? PRICING : overrides.pricing}
        paymentAccountConnected={overrides?.paymentAccountConnected ?? true}
      />
    </NextIntlClientProvider>,
  );
  return { action };
}

/** Wartość ukrytego pola formularza — to ona jedzie do akcji serwerowej. */
function hidden(name: string): string | null {
  const field = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  return field ? field.value : null;
}

function radio(name: string, value: string): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>(
    `input[name="${name}"][value="${value}"]`,
  );
  if (!field) throw new Error(`Brak pola ${name}=${value}`);
  return field;
}

describe("nowe zamówienie — wyszukiwarka klientów (pinezka bed18451)", () => {
  it("bez frazy nie sypie listą klientów, a wpisana fraza zawęża do pasujących", () => {
    mount();
    expect(document.querySelector("[data-customer-results]")).toBeNull();

    fireEvent.change(screen.getByLabelText(form.customerSearchLabel), {
      target: { value: "nowak" },
    });

    const results = document.querySelector("[data-customer-results]")!;
    expect(within(results as HTMLElement).getByText("Anna Nowak")).toBeTruthy();
    expect(within(results as HTMLElement).queryByText("Jan Kowalski")).toBeNull();
  });

  it("szuka także po e-mailu i telefonie, nie tylko po nazwisku", () => {
    mount();
    const search = screen.getByLabelText(form.customerSearchLabel);

    fireEvent.change(search, { target: { value: "jan.kowalski@example.test" } });
    expect(screen.getByText("Jan Kowalski")).toBeTruthy();

    fireEvent.change(search, { target: { value: "600700800" } });
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
  });

  it("wybór klienta ustawia customerId i pokazuje kartę z jego danymi", () => {
    mount();
    expect(hidden("customerId")).toBe("");

    fireEvent.change(screen.getByLabelText(form.customerSearchLabel), {
      target: { value: "kowalski" },
    });
    fireEvent.click(screen.getByText("Jan Kowalski"));

    expect(hidden("customerId")).toBe(KOWALSKI.id);
    // Karta wybranego klienta niesie komplet: nazwa, kontakt, adres. Adres
    // pojawia się na ekranie DWA razy (druga kopia to podpowiedź przy wyborze
    // adresu dostarczenia), więc asercja jest o karcie, nie o całym ekranie.
    const card = screen.getByRole("button", { name: form.changeCustomer }).closest("div")!;
    expect(within(card).getByText("jan.kowalski@example.test")).toBeTruthy();
    expect(within(card).getByText("500600700")).toBeTruthy();
    expect(within(card).getByText("ul. Polna 7, 61-001 Poznań")).toBeTruthy();
  });

  it("brak dopasowania mówi to wprost i zostawia drogę do dodania klienta", () => {
    mount();
    fireEvent.change(screen.getByLabelText(form.customerSearchLabel), {
      target: { value: "nieistniejacy" },
    });

    // Komunikat „brak dopasowania" jest jednym z kilku obszarów `status` na
    // ekranie (drugi to podsumowanie terminu) — szukamy po treści.
    expect(screen.getByText(/nieistniejacy/)).toBeTruthy();
    expect(document.querySelector("[data-customer-results]")).toBeNull();
    expect(screen.getByRole("button", { name: form.quickAddCustomer })).toBeTruthy();
  });

  it("ucięta kartoteka jest nazwana, a nie przemilczana", () => {
    mount({ customersTruncated: true });
    fireEvent.change(screen.getByLabelText(form.customerSearchLabel), {
      target: { value: "kowalski" },
    });
    expect(screen.getByText(form.customerListTruncated)).toBeTruthy();
  });

  it("szybkie dodanie klienta odsłania pola nowego i zeruje customerId", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: form.quickAddCustomer }));

    expect(screen.getByLabelText(form.newCustomerEmail)).toBeTruthy();
    expect(screen.getByLabelText(form.newCustomerPhone)).toBeTruthy();
    expect(hidden("customerId")).toBe("");
  });
});

describe("nowe zamówienie — pozycje przez wyszukiwarkę (pinezka 0007c5a4)", () => {
  it("start jest pusty i nie ma ani jednej listy rozwijanej produktów", () => {
    mount();
    expect(screen.getByText(form.itemsEmpty)).toBeTruthy();
    expect(hidden("items")).toBe("[]");
  });

  it("wyszukiwarka zawęża katalog, a klik dokłada pozycję do koszyka", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: form.addItem }));

    const search = document.querySelector<HTMLInputElement>("[data-item-search]")!;
    fireEvent.change(search, { target: { value: "drabina" } });

    const results = document.querySelector("[data-item-results]")! as HTMLElement;
    expect(within(results).queryByText("Nagrzewnica 20 kW")).toBeNull();
    fireEvent.click(within(results).getByText("Drabina aluminiowa"));

    expect(JSON.parse(hidden("items")!)).toEqual([{ productId: LADDER.pricing.id }]);
    // Wyszukiwarka zamyka się po dodaniu — dokładanie pozycji jest krokiem,
    // a nie trybem, w którym ekran zostaje.
    expect(document.querySelector("[data-item-search]")).toBeNull();
  });

  it("ten sam produkt dwa razy to JEDEN wiersz o ilości 2, a wysyłka nadal dwie sztuki", () => {
    // R3-1c (uwaga 4): duplikaty zwijają się w wiersz z licznikiem, ale
    // KONTRAKT WYSYŁKI zostaje płaski — pozycja zamówienia to jedna sztuka
    // z własnym egzemplarzem (`order_items` nie ma kolumny ilości).
    mount();
    for (const _ of [0, 1]) {
      fireEvent.click(screen.getByRole("button", { name: form.addItem }));
      fireEvent.click(
        within(document.querySelector("[data-item-results]") as HTMLElement).getByText(
          "Nagrzewnica 20 kW",
        ),
      );
    }

    expect(JSON.parse(hidden("items")!)).toHaveLength(2);
    expect(document.querySelectorAll("[data-order-item]")).toHaveLength(1);
    expect(
      document
        .querySelector(`[data-order-item="${HEATER.pricing.id}"] [data-item-quantity]`)!
        .getAttribute("data-item-quantity"),
    ).toBe("2");

    // „−" zdejmuje JEDNĄ sztukę…
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-item-quantity-decrease]")!);
    expect(JSON.parse(hidden("items")!)).toEqual([{ productId: HEATER.pricing.id }]);

    // …a „Usuń" zdejmuje CAŁY wiersz.
    fireEvent.click(screen.getByRole("button", { name: form.removeItem }));
    expect(JSON.parse(hidden("items")!)).toEqual([]);
  });
});

describe("nowe zamówienie — termin kalendarzem (pinezka 00aa35ca)", () => {
  it("kalendarz stoi otwarty, bez klikania w wyzwalacz", () => {
    mount();
    expect(document.querySelector("[data-inline-date-range]")).not.toBeNull();
    expect(screen.getByRole("grid")).toBeTruthy();
  });

  it("wybór dnia ustawia ukryte pola dat i podsumowanie liczby dób", () => {
    mount();
    const day = (label: string) =>
      document.querySelector<HTMLButtonElement>(`button[data-day="${label}"]`)!;

    // Kalendarz otwiera się na miesiącu bieżącym — nawigujemy do września 2026,
    // czyli miesiąca, dla którego fabryka produktu ma mapę dostępności.
    const today = new Date();
    const monthsAhead =
      (2026 - today.getFullYear()) * 12 + (8 /* wrzesień, licząc od zera */ - today.getMonth());
    // Etykieta nawigacji przychodzi z locale kalendarza (R3-1c, uwaga 5) —
    // pod `pl` jest po polsku, a jej dokładne brzmienie należy do biblioteki,
    // nie do nas. Dlatego dopasowanie po sensie, a nie po całym stringu.
    for (let step = 0; step < monthsAhead; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: /następnego miesiąca/i }));
    }

    fireEvent.click(day(new Date(2026, 8, 1).toLocaleDateString("pl-PL")));
    fireEvent.click(day(new Date(2026, 8, 3).toLocaleDateString("pl-PL")));

    expect(hidden("startDate")).toBe("2026-09-01");
    expect(hidden("endDate")).toBe("2026-09-03");
    expect(document.querySelector("[data-term-summary]")!.textContent).toContain("3 doby najmu");
  });
});

describe("nowe zamówienie — dostawa: ceny z cennika i cena własna (pinezka 3c944a2d)", () => {
  it("każda metoda niesie swoją cenę z cennika, a odbiór osobisty jest bezpłatny", () => {
    mount();
    const price = (method: string) =>
      document
        .querySelector(`[data-delivery-method="${method}"] [data-delivery-price]`)!
        .textContent!.trim();

    expect(price("pickup")).toBe(form.deliveryFree);
    expect(price("courier")).toContain("25");
    expect(price("parcel_locker")).toContain("12");
    // Metoda bez wpisu w cenniku NIE dostaje cichego zera (ADR-030).
    expect(price("own_delivery")).toBe(form.deliveryNoPricing);
  });

  it("brak cennika w ogóle nie zamienia dostaw w darmowe", () => {
    mount({ pricing: null });
    for (const method of ["courier", "parcel_locker", "own_delivery"]) {
      expect(
        document
          .querySelector(`[data-delivery-method="${method}"] [data-delivery-price]`)!
          .textContent!.trim(),
      ).toBe(form.deliveryNoPricing);
    }
  });

  it("cena własna odsłania pole kwoty i wysyła je jako deliveryPrice", () => {
    mount();
    // Cena własna dotyczy metod PŁATNYCH — od U7 kreator startuje na odbiorze
    // osobistym, który z definicji ceny nie ma (ADR-030).
    fireEvent.click(radio("deliveryMethod", "courier"));
    expect(document.querySelector("[data-delivery-price-input]")).toBeNull();

    fireEvent.click(document.querySelector("[data-delivery-price-manual]")!);
    const input = document.querySelector<HTMLInputElement>("[data-delivery-price-input]")!;
    fireEvent.change(input, { target: { value: "19,90" } });

    expect(radio("deliveryPriceSource", "manual").checked).toBe(true);
    expect(input.value).toBe("19,90");
  });

  it("odbiór osobisty nie oferuje ceny własnej i wysyła źródło z cennika", () => {
    mount();
    fireEvent.click(radio("deliveryMethod", "pickup"));

    expect(document.querySelector("[data-delivery-price-manual]")).toBeNull();
    expect(hidden("deliveryPriceSource")).toBe("pricing");
    expect(hidden("deliveryPrice")).toBe("");
  });
});

describe("nowe zamówienie — punkt odbioru i adres (pinezki ff2dfefc, e2aef3f6)", () => {
  it("paczkomat odsłania numer punktu i dokłada dostawcę", () => {
    mount();
    expect(document.querySelector("[data-delivery-point-code]")).toBeNull();

    fireEvent.click(radio("deliveryMethod", "parcel_locker"));
    const code = document.querySelector<HTMLInputElement>("[data-delivery-point-code]")!;
    fireEvent.change(code, { target: { value: "poz08m" } });

    // Kod punktu normalizuje się do wersalików już przy wpisywaniu — inaczej
    // ten sam punkt trafiałby do bazy w dwóch zapisach.
    expect(code.value).toBe("POZ08M");
    expect(hidden("deliveryPointProvider")).toBe("inpost");
  });

  it("paczkomat nie pyta o adres dostarczenia, a kurier nie pyta o punkt", () => {
    mount();
    fireEvent.click(radio("deliveryMethod", "parcel_locker"));
    expect(document.querySelector("[data-delivery-address-source]")).toBeNull();
    expect(hidden("deliveryAddressSource")).toBe("");

    fireEvent.click(radio("deliveryMethod", "courier"));
    expect(document.querySelector("[data-delivery-point-code]")).toBeNull();
    expect(hidden("deliveryPointCode")).toBe("");
  });

  it("zmiana metody czyści dane celu poprzedniej", () => {
    mount();
    fireEvent.click(radio("deliveryMethod", "parcel_locker"));
    fireEvent.change(document.querySelector("[data-delivery-point-code]")!, {
      target: { value: "POZ08M" },
    });

    fireEvent.click(radio("deliveryMethod", "courier"));
    expect(hidden("deliveryPointCode")).toBe("");

    fireEvent.click(radio("deliveryMethod", "parcel_locker"));
    expect(document.querySelector<HTMLInputElement>("[data-delivery-point-code]")!.value).toBe("");
  });

  it("kurier domyślnie bierze adres z kartoteki i pokazuje, jaki to adres", () => {
    mount();
    fireEvent.change(screen.getByLabelText(form.customerSearchLabel), {
      target: { value: "kowalski" },
    });
    fireEvent.click(screen.getByText("Jan Kowalski"));
    fireEvent.click(radio("deliveryMethod", "courier"));

    expect(radio("deliveryAddressSource", "customer").checked).toBe(true);
    expect(document.querySelector("[data-customer-address]")!.textContent).toBe(
      "ul. Polna 7, 61-001 Poznań",
    );
  });

  it("klient bez adresu w kartotece dostaje o tym zdanie zamiast pustego miejsca", () => {
    mount();
    fireEvent.change(screen.getByLabelText(form.customerSearchLabel), {
      target: { value: "nowak" },
    });
    fireEvent.click(screen.getByText("Anna Nowak"));
    fireEvent.click(radio("deliveryMethod", "courier"));

    expect(document.querySelector("[data-customer-address]")!.textContent).toBe(
      form.deliveryAddressCustomerEmpty,
    );
  });

  it("„inny adres” odsłania formularz w miejscu, bez modalu", () => {
    mount();
    fireEvent.click(radio("deliveryMethod", "courier"));
    expect(document.querySelector("[data-delivery-address-street]")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    fireEvent.click(radio("deliveryAddressSource", "custom"));

    expect(document.querySelector("[data-delivery-address-street]")).not.toBeNull();
    expect(screen.getByLabelText(form.deliveryAddressCity)).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("powrót do adresu z kartoteki zeruje wpisane pola — jeden adres, nie dwa", () => {
    mount();
    fireEvent.click(radio("deliveryMethod", "courier"));
    fireEvent.click(radio("deliveryAddressSource", "custom"));
    fireEvent.change(document.querySelector("[data-delivery-address-street]")!, {
      target: { value: "ul. Inna 1" },
    });

    fireEvent.click(radio("deliveryAddressSource", "customer"));
    expect(hidden("deliveryAddressStreet")).toBe("");
  });
});

describe("nowe zamówienie — forma płatności (pinezka 82a0c41a)", () => {
  it("oferuje dokładnie trzy formy plus jawne „jeszcze nie ustalono”", () => {
    mount();
    const group = document.querySelector("[data-payment-methods]")!;
    const values = [...group.querySelectorAll<HTMLInputElement>('input[name="paymentMethod"]')].map(
      (input) => input.value,
    );
    expect(values).toEqual(["cod", "transfer", "online", ""]);
  });

  it("domyślnie nic nie jest wybrane — zamówienie bez ustalonej formy jest poprawne", () => {
    mount();
    expect(radio("paymentMethod", "").checked).toBe(true);
  });

  it("bez konta rozliczeniowego płatność online jest wygaszona i nazywa powód", () => {
    mount({ paymentAccountConnected: false });
    expect(radio("paymentMethod", "online").disabled).toBe(true);
    expect(screen.getByText(form.paymentMethodOnlineBlocked)).toBeTruthy();

    // Formy offline zostają dostępne — brak konta blokuje JEDNĄ ścieżkę.
    expect(radio("paymentMethod", "cod").disabled).toBe(false);
    expect(radio("paymentMethod", "transfer").disabled).toBe(false);
  });

  it("z podłączonym kontem płatność online da się wybrać", () => {
    mount({ paymentAccountConnected: true });
    const online = radio("paymentMethod", "online");
    expect(online.disabled).toBe(false);
    fireEvent.click(online);
    expect(online.checked).toBe(true);
  });
});
