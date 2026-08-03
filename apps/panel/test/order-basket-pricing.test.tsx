// @vitest-environment jsdom

/**
 * KOSZYK POKAZUJE CENĘ POZYCJI I DAJE JĄ EDYTOWAĆ (R3-1c, uwagi 3 i 4).
 *
 * ================== CZEGO PILNUJE TEN TEST ==================
 *
 * 1. Kwota przy wierszu jest KWOTĄ SILNIKA, a nie iloczynem ceny dobowej
 *    i liczby dni. Fabryka produktu ma PRÓG CENOWY, więc obie liczby są
 *    różne — i właśnie ta różnica jest tu dowodem. Wiersz liczony „po
 *    ludzku" w komponencie przechodziłby test na produkcie bez progów
 *    i kłamał dokładnie u tych najemców, którzy mają własny cennik.
 *
 * 2. Kwota wiersza rośnie z ILOŚCIĄ, bo wiersz to suma swoich sztuk — ta sama
 *    arytmetyka, którą serwer zastosuje do pozycji zamówienia.
 *
 * 3. Bez terminu wiersz mówi WPROST, że ceny jeszcze nie ma. Zero byłoby
 *    kwotą (gratis), a nie brakiem odpowiedzi.
 *
 * Renderowany jest PRAWDZIWY `OrderWizard` — te same sekcje i ta sama wycena,
 * które pojadą do akcji serwerowej; zamockowana jest wyłącznie akcja.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { calculatePrice, formatMoney } from "@avably/core";

import messages from "../messages/pl.json";

import { OrderWizard } from "@/app/[locale]/(panel)/zamowienia/nowe/order-wizard";
import type { WizardProduct } from "@/app/[locale]/(panel)/zamowienia/nowe/wizard-data";

const form = messages.orders.form;

/**
 * Produkt z PROGIEM CENOWYM — od 3 doby cena idzie z mnożnikiem 0,5.
 * Fabryka jest celowo „niewygodna": pięć dób po 100 zł daje 500 zł liczone
 * mnożeniem, a silnikiem — mniej. Test bez progu nie odróżniłby wyceny
 * silnika od mnożenia w komponencie.
 */
function tieredProduct(id: string, name: string): WizardProduct {
  return {
    pricing: {
      id,
      base_price_day_grosze: 10_000,
      deposit_grosze: 20_000,
      auto_increment_multiplier: 1,
      buffer_before_days: 0,
      buffer_after_days: 0,
      pricing_tiers: [{ tier_days: 3, multiplier: 0.5 }],
    },
    name,
    units: [
      { unitId: `${id}-u1`, unavailableFrom: null, unavailableTo: null },
      { unitId: `${id}-u2`, unavailableFrom: null, unavailableTo: null },
      { unitId: `${id}-u3`, unavailableFrom: null, unavailableTo: null },
    ],
    booked: [],
    dayMap: [] as WizardProduct["dayMap"],
  };
}

const HEATER = tieredProduct("00000000-0000-4000-8000-0000000000c1", "Nagrzewnica 20 kW");

/**
 * Termin testu: 1–5 dnia NASTĘPNEGO miesiąca. Miesiąc następny, a nie stała
 * data w 2026 — kalendarz otwiera się na bieżącym, więc stała oznaczałaby
 * pętlę klikania rosnącą z każdym rokiem (i test wolniejszy co miesiąc).
 * Jedno kliknięcie „dalej" wystarcza zawsze.
 */
const TERM_MONTH = (() => {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth() + 1, 1);
})();

const TERM_FROM = new Date(TERM_MONTH.getFullYear(), TERM_MONTH.getMonth(), 1);
const TERM_TO = new Date(TERM_MONTH.getFullYear(), TERM_MONTH.getMonth(), 5);

function iso(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Kwota JEDNEJ sztuki w terminie testu — liczona tym samym silnikiem. */
const ONE_UNIT = calculatePrice(iso(TERM_FROM), iso(TERM_TO), {
  basePriceDayGrosze: HEATER.pricing.base_price_day_grosze,
  depositGrosze: HEATER.pricing.deposit_grosze,
  autoIncrementMultiplier: 1,
  tiers: [{ tierDays: 3, multiplier: 0.5 }],
});

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

function mount() {
  render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <OrderWizard
        action={vi.fn(async () => ({}))}
        customers={[]}
        customersTruncated={false}
        products={[HEATER]}
        locations={[]}
        currency="PLN"
        locale="pl"
        deliveryPricing={{ courier: { priceGrosze: 2_500 } }}
        paymentAccountConnected={false}
      />
    </NextIntlClientProvider>,
  );
}

function addHeater() {
  fireEvent.click(screen.getByRole("button", { name: form.addItem }));
  fireEvent.click(
    within(document.querySelector("[data-item-results]") as HTMLElement).getByText(
      HEATER.name,
    ),
  );
}

/** Termin przez kalendarz stojący otwarto w prawej kolumnie (jak operator). */
function pickTerm() {
  // Etykieta nawigacji przychodzi z locale kalendarza (R3-1c, uwaga 5).
  fireEvent.click(screen.getByRole("button", { name: /następnego miesiąca/i }));
  const day = (date: Date) =>
    document.querySelector<HTMLButtonElement>(
      `button[data-day="${date.toLocaleDateString("pl")}"]`,
    )!;
  fireEvent.click(day(TERM_FROM));
  fireEvent.click(day(TERM_TO));
}

function row() {
  return document.querySelector(`[data-order-item="${HEATER.pricing.id}"]`) as HTMLElement;
}

describe("koszyk kreatora — cena przy pozycji", () => {
  it("bez terminu wiersz mówi, że ceny jeszcze nie ma (a nie „0,00 zł”)", () => {
    mount();
    addHeater();

    expect(within(row()).getByText(form.itemPriceUnknown)).toBeTruthy();
    expect(row().querySelector("[data-item-price]")).toBeNull();
  });

  it("cena wiersza jest kwotą SILNIKA, nie ceną dobową razy liczba dni", () => {
    mount();
    addHeater();
    pickTerm();

    const naive = HEATER.pricing.base_price_day_grosze * 5;
    // Kontrola po pustym zbiorze: fabryka MUSI dawać dwie różne liczby,
    // inaczej asercja niżej nie odróżniałaby silnika od mnożenia.
    expect(ONE_UNIT.rentalGrosze, "fabryka bez progu nic tu nie dowodzi").not.toBe(naive);

    const price = row().querySelector("[data-item-price]")!.textContent!;
    expect(price).toContain(formatMoney(ONE_UNIT.rentalGrosze, "PLN", "pl"));
    expect(price).not.toContain(formatMoney(naive, "PLN", "pl"));
  });

  it("kaucja pozycji stoi przy cenie, gdy produkt jej wymaga", () => {
    mount();
    addHeater();
    pickTerm();

    expect(row().querySelector("[data-item-price]")!.textContent).toContain(
      formatMoney(ONE_UNIT.depositGrosze, "PLN", "pl"),
    );
  });

  it("kwota wiersza rośnie z ilością — wiersz to suma swoich sztuk", () => {
    mount();
    addHeater();
    pickTerm();

    fireEvent.click(row().querySelector<HTMLButtonElement>("[data-item-quantity-increase]")!);

    const price = row().querySelector("[data-item-price]")!.textContent!;
    expect(price).toContain(formatMoney(ONE_UNIT.rentalGrosze * 2, "PLN", "pl"));
    expect(price).toContain(formatMoney(ONE_UNIT.depositGrosze * 2, "PLN", "pl"));
  });

  it("wiersz koszyka zgadza się co do grosza ze zbiorczą wyceną obok", () => {
    // Dwie powierzchnie, jedna liczba: gdyby koszyk liczył po swojemu,
    // ekran mówiłby dwie różne rzeczy o tym samym zamówieniu.
    mount();
    addHeater();
    pickTerm();
    fireEvent.click(row().querySelector<HTMLButtonElement>("[data-item-quantity-increase]")!);

    const total = formatMoney(ONE_UNIT.rentalGrosze * 2, "PLN", "pl");
    expect(row().querySelector("[data-item-price]")!.textContent).toContain(total);
    expect(document.querySelector("[data-order-preview]")!.textContent).toContain(total);
  });
});

describe("koszyk kreatora — edycja ilości wiersza", () => {
  it("„−” przy jednej sztuce jest WYŁĄCZONY, zamiast zerować wiersz po cichu", () => {
    mount();
    addHeater();

    const minus = row().querySelector<HTMLButtonElement>("[data-item-quantity-decrease]")!;
    expect(minus.disabled).toBe(true);
    // Usunięcie ma własną, jawną drogę — i ona działa.
    expect(within(row()).getByRole("button", { name: form.removeItem })).toBeTruthy();
  });

  it("wpisanie ilości w pole zmienia liczbę sztuk w wysyłce", () => {
    mount();
    addHeater();

    const input = row().querySelector<HTMLInputElement>("[data-item-quantity-input]")!;
    fireEvent.change(input, { target: { value: "3" } });

    const items = JSON.parse(
      document.querySelector<HTMLInputElement>('input[name="items"]')!.value,
    );
    expect(items).toHaveLength(3);
    expect(items.every((item: { productId: string }) => item.productId === HEATER.pricing.id)).toBe(
      true,
    );
  });

  it("skasowanie zawartości pola NIE zdejmuje sztuk w połowie edycji", () => {
    mount();
    addHeater();
    const input = row().querySelector<HTMLInputElement>("[data-item-quantity-input]")!;
    fireEvent.change(input, { target: { value: "2" } });

    fireEvent.change(input, { target: { value: "" } });

    expect(
      JSON.parse(document.querySelector<HTMLInputElement>('input[name="items"]')!.value),
    ).toHaveLength(2);
  });

  it("wklejona liczba spoza klamry wchodzi przycięta, a nie setką pozycji", () => {
    mount();
    addHeater();
    const input = row().querySelector<HTMLInputElement>("[data-item-quantity-input]")!;

    fireEvent.change(input, { target: { value: "500" } });

    expect(
      JSON.parse(document.querySelector<HTMLInputElement>('input[name="items"]')!.value),
    ).toHaveLength(99);
  });
});
