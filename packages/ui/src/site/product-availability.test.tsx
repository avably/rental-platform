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
  /** Trzy formy liczebnika — lustro słownika najemcy (F11). */
  low: {
    one: "Została {units} szt.",
    few: "Zostały {units} szt.",
    many: "Zostało {units} szt.",
  },
  unavailable: "Zajęty w tym terminie",
} as const;

function dostepnosc(
  units: Record<string, number>,
  locale: "pl" | "en" = "pl",
): SiteProductAvailability {
  return { units, ...LABELS, locale };
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

  /*
   * ODMIANA LICZEBNIKA (F11). Chip mówił „Zostały 1 szt." — jedna forma
   * wystarcza po angielsku i nie wystarcza po polsku. Sprawdzamy WSZYSTKIE
   * liczby, które stan `low` może w ogóle przyjąć (1..próg), bo to jest cały
   * zbiór wejść tej reguły.
   */
  it.each([
    [1, "Została 1 szt."],
    [2, "Zostały 2 szt."],
    [3, "Zostały 3 szt."],
  ])("po polsku %i sztuk(a/i) czyta się „%s”", (units, oczekiwane) => {
    narysuj(dostepnosc({ [PID]: units }));
    expect(badge()!.textContent).toBe(oczekiwane);
  });

  it("po polsku próg 5+ wziąłby formę „Zostało” (kontrola reguły, nie progu)", () => {
    // Stan `low` kończy się na progu, ale reguła ma być regułą języka, a nie
    // trzema `if`-ami dopasowanymi do dzisiejszej wartości LOW_STOCK_THRESHOLD.
    narysuj(dostepnosc({ [PID]: 5 }, "pl"));
    // 5 sztuk to już `available` — etykieta bez liczby; sam wybór formy
    // sprawdzamy tam, gdzie żyje (rdzeń), a tu pilnujemy, że stan się zgadza.
    expect(badge()!.getAttribute("data-products-availability-state")).toBe("available");
  });

  it("po angielsku jedna sztuka czyta się „1 left” (dwie formy, nie trzy)", () => {
    narysuj(
      {
        units: { [PID]: 1 },
        available: "Available",
        low: { one: "{units} left", few: "{units} left", many: "{units} left" },
        unavailable: "Unavailable for these dates",
        locale: "en",
      },
    );
    expect(badge()!.textContent).toBe("1 left");
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

  /*
    [F7b] Asercja przepisana z „trzy różne glify" na „trzy różne ETYKIETY".
    Właściciel zdjął wykrzyknik ze stanu `low` („z chipsa dostępności usuń
    wykrzyknik") — chip niedoboru nie ma dziś ŻADNEGO znaku. Warunek 1.4.1
    dotyczy tego, żeby informacji nie niósł sam KOLOR; nośnikiem jest tekst
    i to on musi się różnić między stanami. Stany skrajne dalej dostają znak
    (ptaszek / krzyżyk) i tego pilnuje druga noga asercji.
  */
  it("każdy stan mówi SWOIM tekstem, nie samym kolorem", () => {
    const tekst = (units: number) => {
      cleanup();
      narysuj(dostepnosc({ [PID]: units }));
      return badge()!.textContent;
    };
    const available = tekst(9);
    const low = tekst(1);
    const unavailable = tekst(0);
    expect(new Set([available, low, unavailable]).size).toBe(3);
  });

  it("niedobór NIE MA wykrzyknika (ani żadnego znaku); stany skrajne mają swój", () => {
    const znak = (units: number) => {
      cleanup();
      narysuj(dostepnosc({ [PID]: units }));
      return badge()!.querySelector("svg");
    };
    expect(znak(1), "wykrzyknik wrócił na chip niedoboru — właściciel go zdjął").toBeNull();
    const available = znak(9)!.innerHTML;
    const unavailable = znak(0)!.innerHTML;
    expect(available).not.toBe(unavailable);
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
