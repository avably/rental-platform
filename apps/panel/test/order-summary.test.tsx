// @vitest-environment jsdom

/**
 * PODSUMOWANIE KWOTY I GOTOWOŚĆ ZAPISU na ekranie „Nowe zamówienie" (U7).
 *
 * ================== CO TEN TEST PILNUJE ==================
 *
 * Audyt UX 2.6 zapisał pięć pinezek; ten plik broni czterech z nich
 * BEHAWIORALNIE, na PRAWDZIWYM `OrderWizard` (zamockowana jest wyłącznie
 * akcja serwerowa — jedyna granica, za którą jest baza):
 *
 *   §1 kwota widoczna PRZED zapisem — karta wyceny stoi ZAWSZE, z rozbiciem
 *      najem · kaucja · dostawa · razem, i przelicza się przy zmianie dat,
 *      pozycji i metody dostawy;
 *   §2 domyślną metodą jest odbiór osobisty, a nie kurier „bez cennika";
 *   §3 kolejność kroków stoi w układzie (ponumerowane sekcje), nie
 *      w rozproszonych podpowiedziach;
 *   §4 zapis pustego formularza jest ZABLOKOWANY, a powód widoczny ZANIM
 *      operator kliknie;
 *   §5 pole notatki mówi, czy zobaczy ją klient.
 *
 * ================== DYSCYPLINA ASERCJI ==================
 *
 * Asercje „czegoś nie ma" (myślnik zamiast kwoty, brak blokady) są zawsze
 * poprzedzone potwierdzeniem, że badany fragment JEST na ekranie — inaczej
 * przechodziłyby również wtedy, gdyby komponent w ogóle się nie wyrenderował.
 *
 * Kwoty NIE są tu przepisane z palca: oczekiwanie liczy `calculatePrice`
 * z silnika, więc test nie może „przyklepać" własnej arytmetyki podglądu.
 * Tożsamość podglądu z ZAPISEM (a nie tylko z silnikiem) dowodzi osobno
 * `order-preview-save-parity.test.tsx`.
 */
import { calculatePrice, formatMoney, type DeliveryPricing } from "@avably/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

/** Cennik odniesienia ADR-018: baza 100 zł, próg 3 dni × 2.8, kaucja 50 zł. */
const PRICING_INPUT = {
  basePriceDayGrosze: 10_000,
  depositGrosze: 5_000,
  autoIncrementMultiplier: 1,
  tiers: [{ tierDays: 3, multiplier: 2.8 }],
};

function product(id: string, name: string, units: number): WizardProduct {
  return {
    pricing: {
      id,
      base_price_day_grosze: PRICING_INPUT.basePriceDayGrosze,
      deposit_grosze: PRICING_INPUT.depositGrosze,
      auto_increment_multiplier: PRICING_INPUT.autoIncrementMultiplier,
      buffer_before_days: 0,
      buffer_after_days: 0,
      pricing_tiers: PRICING_INPUT.tiers.map((tier) => ({
        tier_days: tier.tierDays,
        multiplier: tier.multiplier,
      })),
    },
    name,
    units: Array.from({ length: units }, (_, index) => ({
      unitId: `${id}-u${index}`,
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
}

const HEATER = product("00000000-0000-4000-8000-0000000000c1", "Nagrzewnica 20 kW", 2);
const SINGLE = product("00000000-0000-4000-8000-0000000000c2", "Agregat (jedna sztuka)", 1);

const DELIVERY_PRICING: DeliveryPricing = {
  courier: { priceGrosze: 2_500 },
  parcel_locker: { priceGrosze: 1_200 },
};

const LOCATION = { id: "00000000-0000-4000-8000-0000000000d1", name: "Magazyn Poznań" };

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

function mount(overrides?: { pricing?: DeliveryPricing | null; locations?: typeof LOCATION[] }) {
  render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <OrderWizard
        action={vi.fn(async () => ({}))}
        customers={[KOWALSKI]}
        customersTruncated={false}
        products={[HEATER, SINGLE]}
        locations={overrides?.locations ?? [LOCATION]}
        currency="PLN"
        locale="pl"
        deliveryPricing={overrides?.pricing === undefined ? DELIVERY_PRICING : overrides.pricing}
        paymentAccountConnected
      />
    </NextIntlClientProvider>,
  );
}

const summary = () => document.querySelector("[data-order-preview]") as HTMLElement;

/** Kwota wiersza podsumowania — wyłącznie z karty wyceny, nie z całego ekranu. */
function row(name: string): string {
  const node = summary().querySelector(`[data-summary-row="${name}"] [data-summary-amount]`);
  if (!node) throw new Error(`Brak wiersza podsumowania „${name}"`);
  return node.textContent!.trim();
}

const blockers = () =>
  [...summary().querySelectorAll("[data-blocker]")].map((node) => node.getAttribute("data-blocker"));

const saveButton = () => screen.getByRole("button", { name: form.save }) as HTMLButtonElement;

function radio(name: string, value: string): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (!field) throw new Error(`Brak pola ${name}=${value}`);
  return field;
}

function pickCustomer() {
  fireEvent.change(screen.getByLabelText(form.customerSearchLabel), { target: { value: "kowalski" } });
  fireEvent.click(screen.getByText("Jan Kowalski"));
}

function addItem(name: string) {
  fireEvent.click(screen.getByRole("button", { name: form.addItem }));
  fireEvent.click(
    within(document.querySelector("[data-item-results]") as HTMLElement).getByText(name),
  );
}

/** Termin 1–3 września 2026 — miesiąc, dla którego fabryka ma mapę dostępności. */
function pickTerm() {
  const today = new Date();
  const monthsAhead = (2026 - today.getFullYear()) * 12 + (8 - today.getMonth());
  for (let step = 0; step < monthsAhead; step += 1) {
    fireEvent.click(screen.getByRole("button", { name: /następnego miesiąca/i }));
  }
  const day = (date: Date) =>
    document.querySelector<HTMLButtonElement>(`button[data-day="${date.toLocaleDateString("pl-PL")}"]`)!;
  fireEvent.click(day(new Date(2026, 8, 1)));
  fireEvent.click(day(new Date(2026, 8, 3)));
}

const money = (grosze: number) => formatMoney(grosze, "PLN", "pl");

/** Wynik SILNIKA dla wybranego terminu — źródło oczekiwań, nie liczba z palca. */
const engine = calculatePrice("2026-09-01", "2026-09-03", PRICING_INPUT);

describe("podsumowanie kwoty stoi ZAWSZE (audyt 2.6 §1)", () => {
  it("pusty formularz ma kartę wyceny z czterema wierszami i myślnikami zamiast zer", () => {
    mount();

    // Najpierw dowód, że badany fragment JEST na ekranie — bez tego asercje
    // o jego treści przeszłyby także dla komponentu, który się nie pojawił.
    expect(summary(), "brak karty wyceny na pustym formularzu").not.toBeNull();
    expect(summary().getAttribute("data-summary-state")).toBe("pending");

    for (const name of ["rental", "deposit", "delivery", "total"]) {
      expect(
        summary().querySelector(`[data-summary-row="${name}"]`),
        `brak wiersza ${name}`,
      ).not.toBeNull();
    }

    // Zero jest kwotą, a nie brakiem odpowiedzi — dopóki nie ma pozycji
    // i terminu, wiersz mówi „nie policzyliśmy", nie „0,00 zł".
    expect(row("rental")).toBe("—");
    expect(row("deposit")).toBe("—");
    expect(row("total")).toBe("—");
    expect(screen.getByText(form.summaryPending)).toBeTruthy();
  });

  it("komplet klient + pozycja + termin daje rozbicie policzone SILNIKIEM", () => {
    mount();
    pickCustomer();
    addItem("Nagrzewnica 20 kW");
    pickTerm();

    expect(summary().getAttribute("data-summary-state")).toBe("priced");
    expect(row("rental")).toBe(money(engine.rentalGrosze));
    expect(row("deposit")).toBe(money(engine.depositGrosze));
    // Odbiór osobisty jest bezpłatny z definicji (ADR-030).
    expect(row("delivery")).toBe(money(0));
    expect(row("total")).toBe(money(engine.rentalGrosze));
    // Kaucja stoi POZA sumą — inaczej operator podałby klientowi kwotę
    // zawyżoną o zwrotny depozyt.
    expect(row("total")).not.toBe(money(engine.rentalGrosze + engine.depositGrosze));
  });

  it("zmiana metody dostawy przelicza koszt i sumę bez ruszania najmu", () => {
    mount();
    pickCustomer();
    addItem("Nagrzewnica 20 kW");
    pickTerm();

    fireEvent.click(radio("deliveryMethod", "courier"));

    expect(row("delivery")).toBe(money(2_500));
    expect(row("rental")).toBe(money(engine.rentalGrosze));
    expect(row("total")).toBe(money(engine.rentalGrosze + 2_500));
  });

  it("druga sztuka zmienia kwotę — podgląd reaguje na pozycje, nie tylko na daty", () => {
    mount();
    pickCustomer();
    addItem("Nagrzewnica 20 kW");
    pickTerm();
    const single = row("rental");

    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-item-quantity-increase]")!);

    expect(row("rental")).toBe(money(engine.rentalGrosze * 2));
    expect(row("rental")).not.toBe(single);
  });

  it("metoda płatna bez cennika nie dostaje cichego zera, tylko powód", () => {
    mount({ pricing: null });
    pickCustomer();
    addItem("Nagrzewnica 20 kW");
    pickTerm();

    fireEvent.click(radio("deliveryMethod", "courier"));

    expect(row("delivery")).toBe("—");
    expect(row("total")).toBe("—");
    expect(blockers()).toContain("deliveryPricing");
    expect(screen.getByText(form.deliveryPricingMissing)).toBeTruthy();
  });
});

describe("zapis pustego zamówienia jest zablokowany z powodem (audyt 2.6 §4)", () => {
  it("pusty formularz: przycisk wygaszony, a powody WIDOCZNE przed kliknięciem", () => {
    mount();

    expect(saveButton().disabled).toBe(true);
    expect(blockers()).toEqual(["customer", "items", "term"]);
    for (const text of [form.readinessCustomer, form.readinessItems, form.readinessTerm]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    // Wygaszenie bez wyjaśnienia jest gorsze niż przycisk czynny — powód
    // jest powiązany z przyciskiem, nie tylko postawiony obok.
    expect(document.querySelector("[data-save-blocked]")).not.toBeNull();
    expect(saveButton().getAttribute("aria-describedby")).toBe("order-readiness");
  });

  it("każdy uzupełniony krok ZDEJMUJE swój powód, a komplet odblokowuje zapis", () => {
    mount();
    pickCustomer();
    expect(blockers()).toEqual(["items", "term"]);

    addItem("Nagrzewnica 20 kW");
    expect(blockers()).toEqual(["term"]);

    pickTerm();
    expect(blockers()).toEqual([]);
    expect(document.querySelector("[data-order-ready]")).not.toBeNull();
    expect(document.querySelector("[data-save-blocked]")).toBeNull();
    expect(saveButton().disabled).toBe(false);
    expect(saveButton().getAttribute("aria-describedby")).toBeNull();
  });

  it("odbiór osobisty bez punktu odbioru blokuje zapis i mówi, czego brakuje", () => {
    mount({ locations: [] });
    pickCustomer();
    addItem("Nagrzewnica 20 kW");
    pickTerm();

    expect(blockers()).toEqual(["pickupLocation"]);
    expect(saveButton().disabled).toBe(true);
  });

  it("paczkomat bez numeru punktu blokuje, a wpisany numer odblokowuje", () => {
    mount();
    pickCustomer();
    addItem("Nagrzewnica 20 kW");
    pickTerm();
    fireEvent.click(radio("deliveryMethod", "parcel_locker"));

    expect(blockers()).toEqual(["deliveryPoint"]);
    fireEvent.change(document.querySelector("[data-delivery-point-code]")!, {
      target: { value: "POZ08M" },
    });
    expect(blockers()).toEqual([]);
    expect(saveButton().disabled).toBe(false);
  });

  it("cena własna bez kwoty blokuje, a wpisana kwota wchodzi do sumy", () => {
    mount();
    pickCustomer();
    addItem("Nagrzewnica 20 kW");
    pickTerm();
    fireEvent.click(radio("deliveryMethod", "courier"));
    fireEvent.click(document.querySelector("[data-delivery-price-manual]")!);

    expect(blockers()).toEqual(["deliveryPrice"]);
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(document.querySelector("[data-delivery-price-input]")!, {
      target: { value: "19,90" },
    });
    expect(blockers()).toEqual([]);
    expect(row("delivery")).toBe(money(1_990));
    expect(row("total")).toBe(money(engine.rentalGrosze + 1_990));
  });

  it("brak wolnych egzemplarzy blokuje zapis i nazywa produkt po imieniu", () => {
    mount();
    pickCustomer();
    addItem("Agregat (jedna sztuka)");
    pickTerm();
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-item-quantity-increase]")!);

    expect(blockers()).toEqual(["availability"]);
    expect(summary().querySelector(`[data-shortage="${SINGLE.pricing.id}"]`)).not.toBeNull();
    expect(saveButton().disabled).toBe(true);
  });

  it("klient zakładany w locie liczy się jako wskazany, gdy ma e-mail", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: form.quickAddCustomer }));
    expect(blockers()).toContain("customer");

    fireEvent.change(screen.getByLabelText(form.newCustomerEmail), {
      target: { value: "nowy@example.test" },
    });
    expect(blockers()).not.toContain("customer");
  });
});

describe("domyślna metoda dostawy i kolejność kroków (audyt 2.6 §2 i §3)", () => {
  it("domyślnie wybrany jest ODBIÓR OSOBISTY, a kurier nie jest zaznaczony", () => {
    mount();
    const card = (method: string) => document.querySelector(`[data-delivery-method="${method}"]`)!;

    expect(card("pickup").getAttribute("data-selected")).toBe("true");
    expect(radio("deliveryMethod", "pickup").checked).toBe(true);
    expect(card("courier").hasAttribute("data-selected")).toBe(false);
    expect(radio("deliveryMethod", "courier").checked).toBe(false);
  });

  it("domyślna metoda nigdy nie jest metodą z etykietą „brak cennika”", () => {
    // Najemca „dzień zero" nie ma żadnego cennika dostaw — i to jest stan,
    // w którym stara domyślna (kurier) zalecała metodę bez ceny.
    mount({ pricing: null });
    const selected = document.querySelector("[data-delivery-method][data-selected]")!;
    expect(selected.getAttribute("data-delivery-method")).toBe("pickup");
    expect(selected.querySelector("[data-delivery-price]")!.textContent!.trim()).toBe(
      form.deliveryFree,
    );
  });

  it("sekcje niosą NUMER KROKU w treści nagłówka, a nie w podpowiedziach", () => {
    mount();
    const steps = [...document.querySelectorAll("legend[data-step]")].map((node) => [
      node.getAttribute("data-step"),
      node.textContent,
    ]);
    expect(steps).toEqual([
      ["1", `1. ${form.customerSection}`],
      ["2", `2. ${form.itemsSection}`],
      ["3", `3. ${form.deliverySection}`],
    ]);
  });
});

describe("notatka mówi, kto ją zobaczy (audyt 2.6 §5)", () => {
  it("pole notatki ma podpowiedź o wewnętrznym charakterze i wiąże ją z polem", () => {
    mount();
    const hint = document.querySelector("[data-notes-hint]");
    expect(hint, "brak podpowiedzi przy notatce").not.toBeNull();
    expect(hint!.textContent).toBe(form.notesHint);
    expect(hint!.textContent).toMatch(/wewnętrzna/i);
    expect(screen.getByLabelText(form.notes).getAttribute("aria-describedby")).toBe(
      "order-notes-hint",
    );
  });
});
