/**
 * Kalendarz zakresu (faza 5, ADR-179) — testy SKUTKU.
 *
 * Nie sprawdzamy, czy komponent „renderuje siatkę", tylko co robi kliknięcie
 * i co siatka mówi o dniach. Przy każdym bloku zapisano, co musiałoby się
 * zepsuć, żeby test spłonął.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SiteDateRangeCalendar,
  initialSiteCalendarMonth,
  nextSiteDateRange,
  shiftSiteCalendarMonth,
  siteCalendarDayState,
  siteCalendarMonthDays,
  siteCalendarWeekdayIndex,
  type SiteCalendarLabels,
} from "./date-range-calendar";

// jsdom trzyma dokument między przypadkami — bez tego `querySelector` po
// atrybucie trafia w węzeł z POPRZEDNIEGO renderu i test kłamie w obie strony.
afterEach(cleanup);

const LABELS: SiteCalendarLabels = {
  previousMonth: "Poprzedni miesiąc",
  nextMonth: "Następny miesiąc",
  weekdays: ["pon", "wt", "śr", "czw", "pt", "sob", "nd"],
  dayAvailable: "wolne sztuki: {units}",
  dayUnavailable: "brak wolnych sztuk",
  dayOutOfRange: "poza oknem wyboru",
};

function renderCalendar(overrides: Partial<React.ComponentProps<typeof SiteDateRangeCalendar>> = {}) {
  const onSelect = vi.fn();
  const onMonthChange = vi.fn();
  const props = {
    month: "2027-05",
    onMonthChange,
    start: null,
    end: null,
    onSelect,
    minDate: "2027-05-05",
    maxDate: "2027-07-20",
    labels: LABELS,
    locale: "pl-PL",
    ...overrides,
  } as React.ComponentProps<typeof SiteDateRangeCalendar>;
  render(<SiteDateRangeCalendar {...props} />);
  return { onSelect, onMonthChange };
}

function day(iso: string): HTMLButtonElement {
  const node = document.querySelector<HTMLButtonElement>(`[data-calendar-day="${iso}"]`);
  if (node === null) throw new Error(`Brak dnia ${iso} w siatce`);
  return node;
}

describe("arytmetyka siatki", () => {
  it("maj 2027 ma 31 dni i zaczyna się w sobotę (indeks 5 od poniedziałku)", () => {
    const days = siteCalendarMonthDays("2027-05");
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2027-05-01");
    expect(days.at(-1)).toBe("2027-05-31");
    expect(siteCalendarWeekdayIndex("2027-05-01")).toBe(5);
  });

  it("przesunięcie miesiąca przechodzi przez granicę roku w obie strony", () => {
    expect(shiftSiteCalendarMonth("2027-12", 1)).toBe("2028-01");
    expect(shiftSiteCalendarMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftSiteCalendarMonth("2027-01", -13)).toBe("2025-12");
  });

  it("miesiąc startowy idzie za WYBRANYM terminem, a nie za dzisiaj", () => {
    // Klient wrócił do sklepu z terminem w lipcu — kalendarz ma go pokazać,
    // a nie kazać przewijać dwa razy do przodu.
    expect(initialSiteCalendarMonth("2027-07-03", "2027-05-05", "2027-05-05", "2027-08-02")).toBe(
      "2027-07",
    );
    expect(initialSiteCalendarMonth(null, "2027-05-05", "2027-05-05", "2027-08-02")).toBe("2027-05");
    // Termin sprzed okna (koszyk z zeszłego tygodnia) nie może wypchnąć siatki
    // w przeszłość, w której nie ma ani jednego wybieralnego dnia.
    expect(initialSiteCalendarMonth("2027-01-02", "2027-05-05", "2027-05-05", "2027-08-02")).toBe(
      "2027-05",
    );
  });
});

describe("reguła zakresu", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: dowolna zmiana w tym, co znaczy kliknięcie —
  // np. drugi klik nadpisujący początek zamiast domykać zakres.
  it("pierwszy klik otwiera, drugi domyka, trzeci zaczyna od nowa", () => {
    expect(nextSiteDateRange({ start: null, end: null }, "2027-05-10")).toEqual({
      start: "2027-05-10",
      end: null,
    });
    expect(nextSiteDateRange({ start: "2027-05-10", end: null }, "2027-05-14")).toEqual({
      start: "2027-05-10",
      end: "2027-05-14",
    });
    expect(nextSiteDateRange({ start: "2027-05-10", end: "2027-05-14" }, "2027-06-01")).toEqual({
      start: "2027-06-01",
      end: null,
    });
  });

  it("klik PRZED otwartym początkiem otwiera zakres na nowo, nie odwraca go", () => {
    // Zakres odwrócony nie ma prawa powstać: to jest ten sam niezmiennik,
    // którego pilnuje CHECK w bazie i walidacja koszyka.
    expect(nextSiteDateRange({ start: "2027-05-14", end: null }, "2027-05-10")).toEqual({
      start: "2027-05-10",
      end: null,
    });
  });

  it("klik w dzień woła onSelect ze zmienionym zakresem", () => {
    const { onSelect } = renderCalendar({ start: "2027-05-10", end: null });
    fireEvent.click(day("2027-05-14"));
    expect(onSelect).toHaveBeenCalledWith({ start: "2027-05-10", end: "2027-05-14" });
  });
});

describe("okno wyboru", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie blokady dat spoza okna. Nic innego tego
  // nie przykrywa — baza odrzuci dopiero SZEROKOŚĆ okna zapytania, a nie
  // pojedynczy dzień z przeszłości.
  it("dni przed minDate i po maxDate są nieklikalne", () => {
    const { onSelect } = renderCalendar();
    expect(day("2027-05-04").disabled).toBe(true);
    expect(day("2027-05-05").disabled).toBe(false);

    fireEvent.click(day("2027-05-04"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("stan dnia rozstrzyga się wyliczeniem, nie zapamiętaniem", () => {
    expect(siteCalendarDayState("2027-05-04", "2027-05-05", "2027-07-20", null)).toBe("outOfRange");
    expect(siteCalendarDayState("2027-05-06", "2027-05-05", "2027-07-20", null)).toBe("available");
    expect(siteCalendarDayState("2027-05-06", "2027-05-05", "2027-07-20", { "2027-05-06": 0 })).toBe(
      "unavailable",
    );
    // Dzień NIEOBECNY w mapie to „nie wiem", a nie „zajęty".
    expect(siteCalendarDayState("2027-05-06", "2027-05-05", "2027-07-20", {})).toBe("available");
  });

  it("nawigacja gaśnie na krańcach okna, nie na krańcach roku", () => {
    cleanup();
    const back = renderCalendar({ month: "2027-05" });
    expect(screen.getByLabelText(LABELS.previousMonth)).toBeDisabled();
    expect(screen.getByLabelText(LABELS.nextMonth)).not.toBeDisabled();
    expect(back.onMonthChange).not.toHaveBeenCalled();

    cleanup();
    renderCalendar({ month: "2027-07" });
    expect(screen.getByLabelText(LABELS.nextMonth)).toBeDisabled();
  });
});

describe("dwie powierzchnie: powłoka i strona sprzętu", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ (R2 ADR-179): gdyby powłoka zaczęła malować
  // zajętość, w siatce pojawiłaby się liczba przy dniu — sygnał, który wygląda
  // na dowód dostępności, choć nie wiadomo, DLA CZEGO miałby być dowodem.
  it("BEZ dayUnits siatka nie niesie ani jednej liczby wolnych sztuk", () => {
    renderCalendar();
    const cell = day("2027-05-10");
    expect(cell.dataset.calendarDayState).toBe("available");
    // Jedyna treść przycisku to numer dnia.
    expect(cell.textContent).toBe("10");
    expect(cell.getAttribute("aria-label")).toBe("2027-05-10");
  });

  it("Z dayUnits dzień niesie liczbę, a dzień z zerem przestaje być wybieralny", () => {
    const { onSelect } = renderCalendar({
      dayUnits: { "2027-05-10": 3, "2027-05-11": 0 },
    });

    const free = day("2027-05-10");
    expect(free.textContent).toBe("103");
    expect(free.getAttribute("aria-label")).toBe("2027-05-10 — wolne sztuki: 3");

    const busy = day("2027-05-11");
    expect(busy.dataset.calendarDayState).toBe("unavailable");
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-label")).toBe("2027-05-11 — brak wolnych sztuk");

    fireEvent.click(busy);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("widok kilku miesięcy (ADR-194)", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: modal zakresu prosi o dwa miesiące, a dostaje
  // jeden (wybór „od piątku do wtorku za dwa tygodnie" znowu wymaga
  // przewijania) — albo dostaje dwa z DWIEMA parami strzałek, czyli dwie
  // konkurujące nawigacje jednego stanu.
  it("months=2 maluje dni OBU miesięcy przy JEDNEJ parze strzałek", () => {
    renderCalendar({ months: 2, maxDate: "2027-08-20" });

    // Dzień z pierwszego i z drugiego miesiąca — oba w dokumencie.
    expect(day("2027-05-20")).toBeTruthy();
    expect(day("2027-06-10")).toBeTruthy();
    // Nawigacja jest JEDNA: getByLabelText rzuciłby przy dwóch trafieniach.
    expect(screen.getByLabelText("Następny miesiąc")).toBeTruthy();
    expect(screen.getByLabelText("Poprzedni miesiąc")).toBeTruthy();
  });

  it("strzałka przesuwa KOTWICĘ o jeden miesiąc — miesiące pochodne jadą za nią", () => {
    const { onMonthChange } = renderCalendar({ months: 2, maxDate: "2027-08-20" });
    fireEvent.click(screen.getByLabelText("Następny miesiąc"));
    expect(onMonthChange).toHaveBeenCalledWith("2027-06");
  });

  // Klik w dzień DRUGIEGO miesiąca przechodzi przez tę samą regułę zakresu,
  // co pierwszy — dwie siatki, jedna mechanika.
  it("klik w dzień drugiego miesiąca woła onSelect tą samą regułą zakresu", () => {
    const { onSelect } = renderCalendar({
      months: 2,
      maxDate: "2027-08-20",
      start: "2027-05-20",
      end: null,
    });
    fireEvent.click(day("2027-06-03"));
    expect(onSelect).toHaveBeenCalledWith({ start: "2027-05-20", end: "2027-06-03" });
  });

  // Domyślne months=1 to DOKŁADNIE dotychczasowy kształt — bez drugiej siatki.
  it("bez months siatka ma jeden miesiąc (kontrola wsteczna)", () => {
    renderCalendar();
    expect(document.querySelector('[data-calendar-day="2027-06-10"]')).toBeNull();
  });
});

describe("zaznaczenie zakresu", () => {
  it("krańce i środek zakresu są rozróżnialne, a dni poza nim nieoznaczone", () => {
    renderCalendar({ start: "2027-05-10", end: "2027-05-13" });
    expect(day("2027-05-10").dataset.calendarDaySelected).toBe("edge");
    expect(day("2027-05-13").dataset.calendarDaySelected).toBe("edge");
    expect(day("2027-05-11").dataset.calendarDaySelected).toBe("middle");
    expect(day("2027-05-14").dataset.calendarDaySelected).toBeUndefined();
    expect(day("2027-05-11").getAttribute("aria-pressed")).toBe("true");
    expect(day("2027-05-14").getAttribute("aria-pressed")).toBe("false");
  });
});
