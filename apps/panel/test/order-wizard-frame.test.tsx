// @vitest-environment jsdom

/**
 * RAMA I KARTY EKRANU „NOWE ZAMÓWIENIE" (R3-1c, uwagi właściciela 1 i 2).
 *
 * Uwaga 1 — „nie trzyma się w kontencie". Miara wiersza formularza siedziała
 * na `<form>`, czyli na RAMIE OBU KOLUMN: przy 1280 px i rozwiniętym menu
 * kontener panelu ma 1044 px, a formularz stał w 672 px — kolumna pól spadała
 * do 296 px, kalendarz obok miał 352 px, a 372 px kontenera zostawało puste.
 * Miara jest regułą DŁUGOŚCI WIERSZA, więc należy do kolumny pól; rama
 * rozpina się na kontener, jak na szczególe zamówienia.
 *
 * Uwaga 2 — stan wybrany i najechanie kart dostawy. Karta miała wyłącznie
 * stan wybrany i ani jednego stanu najechania, więc kliknięcie przeskakiwało
 * z jasnego obrysu na niemal czarny bez kroku pośredniego.
 *
 * Test broni STRUKTURY i STANÓW, a nie pikseli: liczby zmierzone zostały
 * w przeglądarce (raport zadania), a tutaj pilnujemy tego, co je wywołuje.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

import { OrderWizard } from "@/app/[locale]/(panel)/zamowienia/nowe/order-wizard";
import type { WizardProduct } from "@/app/[locale]/(panel)/zamowienia/nowe/wizard-data";

const delivery = messages.orders.delivery;

const PRODUCT: WizardProduct = {
  pricing: {
    id: "00000000-0000-4000-8000-0000000000c1",
    base_price_day_grosze: 10_000,
    deposit_grosze: 0,
    auto_increment_multiplier: 1,
    buffer_before_days: 0,
    buffer_after_days: 0,
    pricing_tiers: [],
  },
  name: "Nagrzewnica 20 kW",
  units: [{ unitId: "u1", unavailableFrom: null, unavailableTo: null }],
  booked: [],
  dayMap: [] as WizardProduct["dayMap"],
};

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
        products={[PRODUCT]}
        locations={[{ id: "00000000-0000-4000-8000-0000000000d1", name: "Magazyn" }]}
        currency="PLN"
        locale="pl"
        deliveryPricing={{ courier: { priceGrosze: 2_500 }, parcel_locker: { priceGrosze: 1_290 } }}
        paymentAccountConnected={false}
      />
    </NextIntlClientProvider>,
  );
}

describe("rama ekranu — miara obejmuje kolumnę pól, nie obie kolumny", () => {
  it("formularz NIE nosi miary — inaczej przycina cały ekran do 42 rem", () => {
    mount();
    const form = document.querySelector("form")!;
    expect(form.hasAttribute("data-form-line-measure")).toBe(false);
  });

  it("miarę nosi kolumna pól, stojąca WEWNĄTRZ siatki dwukolumnowej", () => {
    mount();
    const measured = document.querySelector("[data-form-line-measure]");
    expect(measured, "ekran wypadł spod wspólnej miary").not.toBeNull();

    const grid = measured!.parentElement!;
    expect(grid.className).toContain("grid");
    // Siatka jest dzieckiem formularza, a nie odwrotnie: rama rozpina się na
    // kontener panelu, a przycięta do miary jest wyłącznie kolumna pól.
    expect(grid.parentElement!.tagName).toBe("FORM");
  });

  it("kalendarz i wycena stoją POZA miarą, w drugiej kolumnie siatki", () => {
    mount();
    const measured = document.querySelector("[data-form-line-measure]")!;
    const aside = document.querySelector("aside")!;

    expect(measured.contains(aside), "kolumna boczna wpadła pod miarę pól").toBe(false);
    expect(aside.parentElement).toBe(measured.parentElement);
  });

  it("pod miarą są WSZYSTKIE pola treści zamówienia — klient, pozycje, dostawa", () => {
    // Kontrola po pustym zbiorze: gdyby miara trafiła na pusty wrapper,
    // asercje wyżej wciąż byłyby zielone.
    mount();
    const measured = document.querySelector("[data-form-line-measure]")!;
    expect(measured.querySelectorAll("fieldset").length).toBeGreaterThanOrEqual(3);
    expect(measured.querySelector("[data-add-item]")).not.toBeNull();
    expect(measured.querySelector("[data-delivery-methods]")).not.toBeNull();
  });
});

describe("karty metody dostawy — trzy stany, jedna geometria", () => {
  function card(method: string): HTMLElement {
    return document.querySelector(`[data-delivery-method="${method}"]`) as HTMLElement;
  }

  it("karta wybrana niesie stan wybrany panelu (limonka + obrys treści)", () => {
    mount();
    // Domyślną metodą kreatora jest kurier.
    expect(card("courier").getAttribute("data-selected")).toBe("true");
    expect(card("courier").className).toContain("bg-accent");
    expect(card("courier").className).toContain("border-foreground");
  });

  it("karta niewybrana ma stan NAJECHANIA — czego przed R3-1c nie miała", () => {
    mount();
    for (const method of ["pickup", "parcel_locker", "own_delivery"]) {
      expect(card(method).className, `karta bez hoveru: ${method}`).toMatch(/hover:/);
    }
  });

  it("stan wybrany i stan spoczynku wykluczają się, zamiast nakładać", () => {
    // Gdyby oba zestawy siedziały na jednym elemencie jako warianty, o wyniku
    // decydowałaby kolejność reguł w arkuszu — najechanie na kartę wybraną
    // potrafiłoby zdjąć z niej limonkę.
    mount();
    expect(card("courier").className).not.toMatch(/hover:bg-secondary/);
    expect(card("pickup").className).not.toContain("bg-accent");
  });

  it("wybór PRZENOSI stan, a nie dokłada drugiego zaznaczenia", () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(delivery.parcel_locker) }));

    expect(document.querySelectorAll("[data-delivery-method][data-selected]")).toHaveLength(1);
    expect(card("parcel_locker").getAttribute("data-selected")).toBe("true");
    expect(card("courier").hasAttribute("data-selected")).toBe(false);
  });

  it("geometria jest STAŁA we wszystkich stanach — obrys nigdy nie skacze", () => {
    mount();
    // Geometria to SZEROKOŚĆ obrysu, zaokrąglenie i odstępy — nie kolor.
    // Kolor obrysu ma się różnić (to jest sygnał stanu); różnić się nie może
    // ani jeden token, który zajmuje miejsce w układzie.
    const geometry = (element: HTMLElement) =>
      element.className
        .split(/\s+/)
        .filter((token) => /^(?:border(?:-\d+)?|rounded-[\w-]+|p-\d+|gap-\d+)$/.test(token))
        .sort()
        .join(" ");

    const selected = geometry(card("courier"));
    for (const method of ["pickup", "parcel_locker", "own_delivery"]) {
      expect(geometry(card(method)), `inna geometria niż karta wybrana: ${method}`).toBe(selected);
    }
    // Wyróżnienie fokusa idzie `outline`, który nie zajmuje miejsca w układzie.
    expect(card("courier").className).toContain("has-[:focus-visible]:outline");
  });
});
