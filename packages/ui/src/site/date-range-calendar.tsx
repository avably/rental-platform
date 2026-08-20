"use client";

/**
 * KALENDARZ ZAKRESU DLA SKLEPU NAJEMCY (faza 5, ADR-179).
 *
 * ==================== CO ZASTĘPUJE ====================
 *
 * Do tego komponentu termin najmu wybierało się dwoma `<input type="date">`.
 * Systemowy widżet daty nie umie dwóch rzeczy, których sklep wynajmu
 * potrzebuje: pokazać ZAKRES jako jedną całość i nanieść na siatkę dni
 * informację, ilu sztuk sprzętu tego dnia brakuje. Nie umie też wyglądać jak
 * sklep najemcy — rysuje go przeglądarka, a nie motyw.
 *
 * ==================== JEDEN KOMPONENT, DWIE POWIERZCHNIE ====================
 *
 * To jest CELOWO jeden komponent dla dwóch miejsc o różnym pytaniu:
 *
 *   • POWŁOKA SKLEPU pyta „na kiedy?" i nie ma kontekstu sprzętu. Dostaje go
 *     BEZ `dayUnits` — maluje sam wybór zakresu i blokadę dat spoza okna.
 *     Malowanie „zajętości w ogóle" byłoby tu sygnałem, który wygląda na dowód,
 *     a nim nie jest: zajęte DLA CZEGO?
 *   • STRONA SPRZĘTU pyta „czy TEN sprzęt jest wolny?" i kontekst ma. Dostaje
 *     `dayUnits` z `app.get_public_availability_days` — siatka niesie wtedy
 *     liczbę wolnych sztuk per dzień, a dni z zerem przestają być wybieralne.
 *
 * Rozdzielenie na dwa komponenty dałoby dwie odpowiedzi na pytanie „co znaczy
 * kliknięcie w dzień" i dwa miejsca, w których arytmetyka zakresu mogłaby się
 * rozjechać z drugim.
 *
 * ==================== CZEGO TEN KOMPONENT NIE ROBI ====================
 *
 * Nie czyta bazy, nie zna koszyka, nie zna najemcy. Jest CZYSTĄ PREZENTACJĄ:
 * dostaje zakres i mapę liczb, oddaje zdarzenia. Dzięki temu ta sama siatka
 * stoi w sklepie i w podglądzie panelu, a jej testy nie potrzebują ani bazy,
 * ani przeglądarki z siecią.
 *
 * ZAKRES WEWNĄTRZ NIE JEST WALIDOWANY po `dayUnits` i to jest decyzja: komponent
 * odmawia POSTAWIENIA krańca na dniu z zerem, ale nie orzeka o dniach pomiędzy.
 * O dostępności całego zakresu odpowiada `app.get_public_availability` — jedna
 * odpowiedź na to pytanie, w miejscu, w którym i tak trzeba ją pokazać.
 *
 * WYGLĄD Z MOTYWU NAJEMCY (K6, ADR-092): komponent nosi wyłącznie ROLE
 * (`site-card`, `site-field`, `site-label`, `site-text-muted`, `site-cta`,
 * `site-day*`), nigdy kolory. Dni są ZWYKŁYMI `<button>`, nie komponentami
 * panelu — te wnoszą własne tokeny (`bg-primary`, `border-input`), których skan
 * źródeł tego pliku by nie zobaczył.
 */
import { addDays } from "@avably/core";

import { cn } from "../lib/cn";

/** Napisy kalendarza — wołający podaje je gotowe (pakiet nie zna copy najemcy). */
export interface SiteCalendarLabels {
  /** Etykieta czytnika ekranu przycisku „poprzedni miesiąc". */
  previousMonth: string;
  nextMonth: string;
  /** Skróty dni tygodnia OD PONIEDZIAŁKU — dokładnie siedem. */
  weekdays: readonly string[];
  /** Etykieta dnia z liczbą wolnych sztuk; interpolacja `{units}`. */
  dayAvailable: string;
  /** Etykieta dnia bez wolnych sztuk. */
  dayUnavailable: string;
  /** Etykieta dnia poza oknem wyboru (przeszłość albo za horyzontem). */
  dayOutOfRange: string;
}

export interface SiteDateRangeSelection {
  start: string | null;
  end: string | null;
}

export interface SiteDateRangeCalendarProps {
  /** Widoczny miesiąc `YYYY-MM`. Kontrolowany z zewnątrz — komponent go nie pamięta. */
  month: string;
  onMonthChange: (month: string) => void;
  /**
   * ILE KOLEJNYCH MIESIĘCY MALUJE SIATKA (ADR-194). Domyślnie jeden — dokładnie
   * dotychczasowy kształt. Modal zakresu podaje dwa: wybór „od piątku do
   * wtorku za dwa tygodnie" przestaje wymagać przewijania, bo oba krańce widać
   * naraz. Nawigacja zostaje JEDNĄ parą strzałek i przesuwa KOTWICĘ
   * (`month`); miesiące kolejne są pochodną, nie drugim stanem. Na wąskim
   * oknie miesiące poza pierwszym CHOWAJĄ SIĘ stylem (`max-sm:hidden`) —
   * media query, nie pomiar w skrypcie, bo pomiar wymagałby efektu i dawał
   * błysk dwóch siatek na telefonie. Kotwica przy krańcu okna może pokazać
   * drugi miesiąc w całości poza oknem (same dni nieklikalne) — to świadomy
   * koszt: klamrowanie kotwicy zabierałoby wąskiemu oknu ostatni miesiąc.
   */
  months?: number;
  /** Wybrany zakres (ISO `YYYY-MM-DD`); `end` bez `start` jest nielegalny. */
  start: string | null;
  end: string | null;
  /**
   * Woła się przy KAŻDYM kliknięciu w dzień — także tym, które dopiero otwiera
   * zakres (`{start: d, end: null}`). Wołający decyduje, co z niekompletnym
   * zakresem zrobić; komponent nie trzyma stanu pośredniego u siebie, bo
   * wtedy prawda o terminie mieszkałaby w dwóch miejscach naraz.
   */
  onSelect: (selection: SiteDateRangeSelection) => void;
  /** Najwcześniejszy wybieralny dzień — zwykle dziś. */
  minDate: string;
  /** Najpóźniejszy wybieralny dzień — horyzont z `availabilityWindowEnd`. */
  maxDate: string;
  /**
   * Dzień → liczba WOLNYCH sztuk. Pominięta albo `null` = powłoka sklepu:
   * sam wybór zakresu, bez malowania dostępności (ADR-179).
   *
   * Dzień NIEOBECNY w podanej mapie znaczy „nie wiem" i zostaje wybieralny bez
   * liczby — malowanie go na „zajęty" cicho traciłoby sprzedaż, a na „wolny"
   * obiecywałoby coś, czego nikt nie sprawdził.
   */
  dayUnits?: Record<string, number> | null;
  labels: SiteCalendarLabels;
  /** BCP-47 — wyłącznie do nazwy miesiąca w nagłówku. */
  locale: string;
  className?: string;
}

/** Stan dnia w siatce. Rozłączny i wyliczany, nigdy przechowywany. */
export type SiteCalendarDayState = "outOfRange" | "unavailable" | "available";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Czy `YYYY-MM` jest miesiącem, a nie dowolnym tekstem. */
export function isSiteCalendarMonth(value: string): boolean {
  return MONTH_PATTERN.test(value);
}

/** Miesiąc `YYYY-MM`, w którym leży dzień ISO. */
export function siteCalendarMonthOf(day: string): string {
  return day.slice(0, 7);
}

/** Przesunięcie miesiąca o `delta` — arytmetyka na liczbach, nie na `Date`. */
export function shiftSiteCalendarMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const total = year * 12 + (index - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextIndex = total - nextYear * 12 + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextIndex).padStart(2, "0")}`;
}

/**
 * Dni miesiąca jako daty ISO. Liczone w UTC, bo to KALENDARZ, a nie chwila —
 * `new Date("2026-03-29")` w strefie ze zmianą czasu potrafi zgubić dobę.
 */
export function siteCalendarMonthDays(month: string): string[] {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const days: string[] = [];
  const cursor = new Date(Date.UTC(year, index - 1, 1));
  while (cursor.getUTCMonth() === index - 1) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Indeks dnia tygodnia z PONIEDZIAŁKIEM jako zerem (kalendarz polski). */
export function siteCalendarWeekdayIndex(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * Co znaczy kliknięcie w dzień — CZYSTA funkcja, żeby reguła zakresu dała się
 * sprawdzić bez renderu i żeby istniała dokładnie raz.
 *
 * Reguła: pierwszy klik otwiera zakres, drugi go domyka. Klik PRZED otwartym
 * początkiem nie jest błędem — otwiera zakres na nowo od klikniętego dnia, bo
 * to jest to, co użytkownik miał na myśli („jednak od wcześniej"). Klik przy
 * zamkniętym zakresie zaczyna od zera.
 */
export function nextSiteDateRange(
  current: SiteDateRangeSelection,
  day: string,
): SiteDateRangeSelection {
  const { start, end } = current;
  if (start === null || end !== null) return { start: day, end: null };
  if (day < start) return { start: day, end: null };
  return { start, end: day };
}

export function siteCalendarDayState(
  day: string,
  minDate: string,
  maxDate: string,
  dayUnits: Record<string, number> | null | undefined,
): SiteCalendarDayState {
  if (day < minDate || day > maxDate) return "outOfRange";
  if (dayUnits && dayUnits[day] === 0) return "unavailable";
  return "available";
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/**
 * Siatka JEDNEGO miesiąca — tabela dni bez nagłówka i bez nawigacji.
 * Wydzielona, bo od ADR-194 kalendarz potrafi malować kilka miesięcy obok
 * siebie, a reguły dnia (stan, etykieta, zaznaczenie) mają istnieć RAZ.
 */
function SiteCalendarMonthGrid({
  month,
  start,
  end,
  minDate,
  maxDate,
  dayUnits,
  labels,
  onDay,
  className,
}: {
  month: string;
  start: string | null;
  end: string | null;
  minDate: string;
  maxDate: string;
  dayUnits: Record<string, number> | null | undefined;
  labels: SiteCalendarLabels;
  onDay: (day: string) => void;
  className?: string;
}) {
  const days = isSiteCalendarMonth(month) ? siteCalendarMonthDays(month) : [];
  const leadingBlanks = days.length > 0 ? siteCalendarWeekdayIndex(days[0]!) : 0;

  return (
    <table className={cn("w-full table-fixed border-collapse", className)}>
      <thead>
        <tr>
          {labels.weekdays.map((label) => (
            <th
              key={label}
              scope="col"
              className="site-text-muted pb-1 text-center text-xs font-normal"
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: Math.ceil((leadingBlanks + days.length) / 7) }, (_, week) => (
          <tr key={week}>
            {Array.from({ length: 7 }, (_, column) => {
              const index = week * 7 + column - leadingBlanks;
              const day = index >= 0 && index < days.length ? days[index]! : null;
              if (day === null) {
                return <td key={column} className="p-0.5" aria-hidden="true" />;
              }

              const state = siteCalendarDayState(day, minDate, maxDate, dayUnits);
              const units = dayUnits ? dayUnits[day] : undefined;
              const selectable = state === "available";
              const isStart = day === start;
              const isEnd = day === end;
              const inRange = start !== null && end !== null && day > start && day < end;

              const description =
                state === "outOfRange"
                  ? labels.dayOutOfRange
                  : state === "unavailable"
                    ? labels.dayUnavailable
                    : units === undefined
                      ? ""
                      : interpolate(labels.dayAvailable, { units });

              return (
                <td key={column} className="p-0.5">
                  <button
                    type="button"
                    data-calendar-day={day}
                    data-calendar-day-state={state}
                    data-calendar-day-selected={
                      isStart || isEnd ? "edge" : inRange ? "middle" : undefined
                    }
                    disabled={!selectable}
                    // Pełna data w etykiecie: sama liczba („14") nie mówi
                    // czytnikowi ekranu, o który dzień chodzi, a to jedyna
                    // treść, jaką niesie przycisk.
                    aria-label={description === "" ? day : `${day} - ${description}`}
                    aria-pressed={isStart || isEnd || inRange}
                    onClick={() => onDay(day)}
                    className={cn(
                      "site-day flex w-full cursor-pointer flex-col items-center justify-center px-1 py-1.5 text-sm leading-tight",
                      "disabled:cursor-not-allowed disabled:opacity-40",
                      (isStart || isEnd) && "site-day-edge",
                      inRange && "site-day-middle",
                    )}
                  >
                    <span>{Number(day.slice(8, 10))}</span>
                    {/*
                      LICZBA WOLNYCH SZTUK POD DATĄ — wyłącznie tam, gdzie
                      wołający ją podał. Kalendarz powłoki nie ma kontekstu
                      sprzętu, więc nie ma czego tu napisać (ADR-179).
                    */}
                    {units !== undefined ? (
                      <span className="site-text-muted text-[0.625rem]" aria-hidden="true">
                        {units}
                      </span>
                    ) : null}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SiteDateRangeCalendar({
  month,
  onMonthChange,
  months = 1,
  start,
  end,
  onSelect,
  minDate,
  maxDate,
  dayUnits = null,
  labels,
  locale,
  className,
}: SiteDateRangeCalendarProps) {
  // Kotwica + pochodne: `month` jest jedynym stanem widoku, miesiące kolejne
  // liczą się z niej przy każdym renderze (ADR-194).
  const shownMonths = Array.from({ length: Math.max(1, months) }, (_, index) =>
    shiftSiteCalendarMonth(month, index),
  );

  // Nawigacja gaśnie na krańcach OKNA, a nie na krańcach roku: miesiąc, w
  // którym nie ma ani jednego wybieralnego dnia, byłby pustą siatką udającą
  // ofertę. Porównanie po miesiącu, nie po dniu — `minDate` bywa w środku
  // miesiąca i wtedy jego miesiąc wciąż ma dni do pokazania. Granice liczy
  // KOTWICA także przy kilku miesiącach — patrz `months` wyżej.
  const canGoBack = month > siteCalendarMonthOf(minDate);
  const canGoForward = month < siteCalendarMonthOf(maxDate);

  const monthLabelFormat = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const monthLabel = (value: string) =>
    monthLabelFormat.format(new Date(`${value}-01T00:00:00Z`));

  function handleDay(day: string): void {
    onSelect(nextSiteDateRange({ start, end }, day));
  }

  return (
    <div className={cn("site-card p-4", className)} data-site-calendar={month}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="site-cta-secondary cursor-pointer px-3 py-1 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={labels.previousMonth}
          disabled={!canGoBack}
          onClick={() => onMonthChange(shiftSiteCalendarMonth(month, -1))}
        >
          ‹
        </button>
        {/*
          `aria-live` na nagłówku, a nie na siatce: po przewinięciu miesiąca
          czytnik ma przeczytać JEDNO zdanie („czerwiec 2027"), a nie
          trzydzieści przycisków, które właśnie się wymieniły. Przy kilku
          miesiącach każdy grid ma własny nagłówek, chowany razem z nim.
        */}
        <div className="flex flex-1 items-center justify-around gap-2" aria-live="polite">
          {shownMonths.map((shown, index) => (
            <strong
              key={shown}
              className={cn("site-label text-sm", index > 0 && "max-sm:hidden")}
            >
              {monthLabel(shown)}
            </strong>
          ))}
        </div>
        <button
          type="button"
          className="site-cta-secondary cursor-pointer px-3 py-1 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={labels.nextMonth}
          disabled={!canGoForward}
          onClick={() => onMonthChange(shiftSiteCalendarMonth(month, 1))}
        >
          ›
        </button>
      </div>

      <div className="flex items-start gap-4">
        {shownMonths.map((shown, index) => (
          <SiteCalendarMonthGrid
            key={shown}
            month={shown}
            start={start}
            end={end}
            minDate={minDate}
            maxDate={maxDate}
            dayUnits={dayUnits}
            labels={labels}
            onDay={handleDay}
            className={index > 0 ? "max-sm:hidden" : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Ostatni dzień, który kalendarz ma sens pokazać przy zadanym zakresie —
 * używane przez wołających do ustawienia miesiąca startowego na termin, który
 * klient już wybrał, zamiast na „dziś".
 */
export function initialSiteCalendarMonth(
  start: string | null,
  today: string,
  minDate: string,
  maxDate: string,
): string {
  const anchor = start ?? today;
  const clamped = anchor < minDate ? minDate : anchor > maxDate ? maxDate : anchor;
  return siteCalendarMonthOf(clamped);
}

/** Dni zakresu INCLUSIVE — jedna arytmetyka dla wołających kalendarza. */
export function siteCalendarRangeDays(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}
