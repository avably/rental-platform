// @vitest-environment jsdom

/**
 * BADGE DOSTĘPNOŚCI NA KAFLU — TRZY STANY, PRÓG I A11Y (ADR-245, faza B).
 *
 * ==================== CO TU JEST NAPRAWDĘ SPRAWDZANE ====================
 *
 * Nie „badge się narysował", tylko: liczba wolnych sztuk streszcza się do
 * WŁAŚCIWEGO stanu handlowego (`available` / `low` / `unavailable`), stan niesie
 * WŁAŚCIWĄ etykietę, a niedobór — DOKŁADNĄ liczbę. Do tego twardy warunek
 * dostępności: stan da się odczytać BEZ koloru (WCAG 1.4.1) — z etykiety i ze
 * znaku, przy czym znak jest `aria-hidden`, żeby czytnik ekranu nie czytał go
 * drugi raz obok etykiety.
 *
 * Granica progu jest osobnym przypadkiem, bo to jedyne miejsce, gdzie `<=`
 * kontra `<` rozjeżdża wynik — i nie widać tego poza tą jedną wartością.
 */
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  availabilityStateOf,
  LOW_STOCK_THRESHOLD,
  SiteProductAvailabilityMark,
  SiteProductAvailabilityProvider,
  type SiteProductAvailability,
} from "./product-availability";

const PID = "prod-1";

const LABELS = {
  available: "Dostępny",
  low: "Zostały {units} szt.",
  unavailable: "Zajęty w tym terminie",
} as const;

function dostepnosc(units: Record<string, number>): SiteProductAvailability {
  return { units, ...LABELS };
}

/** Renderuje badge dla JEDNEJ pozycji w podanym kontekście dostępności. */
function narysuj(value: SiteProductAvailability | null) {
  return render(
    <SiteProductAvailabilityProvider value={value}>
      <SiteProductAvailabilityMark productId={PID} className="site-availability" />
    </SiteProductAvailabilityProvider>,
  );
}

/** Badge pozycji `PID` albo `null`, gdy kafel milczy. */
function badge(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-products-availability="${PID}"]`);
}

afterEach(cleanup);

describe("liczba wolnych sztuk → stan handlowy (funkcja czysta)", () => {
  it("zero to unavailable, 1..próg to low, powyżej progu to available", () => {
    expect(availabilityStateOf(0)).toBe("unavailable");
    expect(availabilityStateOf(1)).toBe("low");
    expect(availabilityStateOf(LOW_STOCK_THRESHOLD)).toBe("low");
    expect(availabilityStateOf(LOW_STOCK_THRESHOLD + 1)).toBe("available");
    expect(availabilityStateOf(99)).toBe("available");
  });
});

describe("badge streszcza dostępność do trzech stanów", () => {
  it("nadmiar: „Dostępny” BEZ liczby, stan available", () => {
    narysuj(dostepnosc({ [PID]: LOW_STOCK_THRESHOLD + 4 }));
    const el = badge()!;
    expect(el.getAttribute("data-products-availability-state")).toBe("available");
    expect(el.textContent).toBe(LABELS.available);
    // Nadmiar nie pokazuje licznika — a liczba i tak zostaje w atrybucie.
    expect(el.textContent).not.toMatch(/\d/);
    expect(el.getAttribute("data-products-availability-units")).toBe(String(LOW_STOCK_THRESHOLD + 4));
  });

  it("niedobór: „Zostały N szt.” z DOKŁADNĄ liczbą, stan low", () => {
    narysuj(dostepnosc({ [PID]: 2 }));
    const el = badge()!;
    expect(el.getAttribute("data-products-availability-state")).toBe("low");
    expect(el.textContent).toContain("2");
    expect(el.getAttribute("data-products-availability-units")).toBe("2");
  });

  it("zero: „Zajęty w tym terminie” słowami, stan unavailable", () => {
    narysuj(dostepnosc({ [PID]: 0 }));
    const el = badge()!;
    expect(el.getAttribute("data-products-availability-state")).toBe("unavailable");
    expect(el.textContent).toBe(LABELS.unavailable);
    expect(el.getAttribute("data-products-availability-units")).toBe("0");
  });

  // GRANICA: dokładnie na progu jeszcze low, o jeden wyżej już available.
  it("na progu to jeszcze low, o jeden wyżej to już available", () => {
    narysuj(dostepnosc({ [PID]: LOW_STOCK_THRESHOLD }));
    expect(badge()!.getAttribute("data-products-availability-state")).toBe("low");
    cleanup();
    narysuj(dostepnosc({ [PID]: LOW_STOCK_THRESHOLD + 1 }));
    expect(badge()!.getAttribute("data-products-availability-state")).toBe("available");
  });
});

describe("stan czytelny BEZ koloru (WCAG 1.4.1)", () => {
  it("znak jest aria-hidden, a nazwę dostępną niesie SAMA etykieta", () => {
    narysuj(dostepnosc({ [PID]: 0 }));
    const el = badge()!;
    const znak = el.querySelector("svg")!;
    expect(znak.getAttribute("aria-hidden")).toBe("true");
    // Znaczenie stanu jest w tekście, nie w kształcie — czytnik ekranu ma je
    // z etykiety, a nie z powtórzonego glifu.
    expect(within(el).getByText(LABELS.unavailable)).toBeTruthy();
  });

  it("każdy stan rysuje SWÓJ glif (trzy różne kształty, nie jeden kolor)", () => {
    const ksztalt = (units: number) => {
      cleanup();
      narysuj(dostepnosc({ [PID]: units }));
      return badge()!.querySelector("svg")!.innerHTML;
    };
    const available = ksztalt(9);
    const low = ksztalt(1);
    const unavailable = ksztalt(0);
    expect(new Set([available, low, unavailable]).size).toBe(3);
  });
});

describe("brak informacji = badge MILCZY", () => {
  it("bez dostawcy (płótno kreatora, miniatura) nie ma badge'a", () => {
    narysuj(null);
    expect(badge()).toBeNull();
  });

  it("pozycja spoza mapy odpowiedzi milczy — brak klucza to „nie wiem”, nie zero", () => {
    narysuj(dostepnosc({ "inny-produkt": 5 }));
    expect(badge()).toBeNull();
  });
});
