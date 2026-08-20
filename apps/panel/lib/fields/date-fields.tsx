"use client";

import {
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  dayPickerLocale,
} from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

/**
 * Pola dat CAŁEGO panelu (decyzja właściciela 2026-07-21): daty wybiera się
 * WYŁĄCZNIE naszym `Calendar` w `Popover`, nigdy natywnym `input type="date"`.
 *
 * Moduł mieszkał w `lib/orders/` (P4 był pierwszym konsumentem). P5 rozszerza
 * zakaz na wszystkie trasy `(panel)/**`, więc pola przeniosły się do
 * neutralnego `lib/fields/`, a ich etykiety do przestrzeni `common.dateField`:
 * ekran katalogu importujący coś z „orders" byłby zależnością, której nie
 * da się wytłumaczyć niczym poza historią.
 * Natywny widżet maluje się chromem systemu — nie ma na nim ani tokenów Fazy 2,
 * ani stanów sekcji 07, a jego wygląd zmienia się między przeglądarkami.
 * Zakazu pilnuje `panel-date-fields-contract.test.ts`.
 *
 * KONTRAKT WYSYŁKI JEST NIETKNIĘTY: wartość jedzie do server action ukrytym
 * polem jako string `YYYY-MM-DD`, dokładnie jak przy natywnym polu. Walidacja,
 * akcje i przepływy statusów nie widzą różnicy.
 *
 * Daty czytamy i piszemy w czasie LOKALNYM (`new Date(rok, miesiąc, dzień)`).
 * Parsowanie `YYYY-MM-DD` konstruktorem Date daje północ UTC, co w Europe/Warsaw
 * potrafi cofnąć dzień o jeden — a dzień to tu cała jednostka najmu.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function subscribeDesktopCalendar(onChange: () => void): () => void {
  const media = window.matchMedia("(min-width: 768px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function readDesktopCalendar(): boolean {
  return window.matchMedia("(min-width: 768px)").matches;
}

function readDesktopCalendarOnServer(): boolean {
  return false;
}

function useDesktopCalendar(): boolean {
  return React.useSyncExternalStore(
    subscribeDesktopCalendar,
    readDesktopCalendar,
    readDesktopCalendarOnServer,
  );
}

/**
 * Kształt zakresu przyjmowany przez `Calendar` w trybie `range`. Typ jest
 * odtworzony STRUKTURALNIE, a nie zaimportowany z `react-day-picker`: ten
 * pakiet jest zależnością `@avably/ui`, nie panelu, a P4 nie ma zgody na nowe
 * zależności. Gdyby biblioteka zmieniła kształt, typecheck pokaże to na
 * `selected` przy `Calendar`.
 */
type CalendarRange = { from: Date | undefined; to?: Date | undefined };

export function isoToDate(value: string): Date | undefined {
  if (!ISO_DAY.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

export function dateToIso(date: Date | undefined): string {
  if (!date) return "";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Wyzwalacz wygląda i zachowuje się jak pole z P2 (ten sam obrys i focus). */
const TRIGGER_CLASS =
  "border-input bg-background text-foreground flex h-9 w-full min-w-0 cursor-pointer items-center rounded-md border px-3 text-left text-sm outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

/**
 * Język kalendarza = język interfejsu (R3-1c, uwaga 5).
 *
 * Ten moduł jest JEDYNYM wejściem do dat w panelu (zakazu natywnego pola
 * pilnuje `panel-date-fields-contract`), więc jest też jedynym miejscem,
 * w którym locale next-intl spotyka się z kalendarzem. Wcześniej `Calendar`
 * miał polski wpisany na sztywno i w interfejsie EN wychodziło „sierpień
 * 2026" nad angielskim formularzem — wyciek dotyczył KAŻDEGO ekranu z datą.
 */
function useCalendarLocale() {
  const locale = useLocale();
  return React.useMemo(() => dayPickerLocale(locale), [locale]);
}

function useDayFormat(): (value: string) => string {
  const locale = useLocale();
  return React.useCallback(
    (value: string) => {
      const date = isoToDate(value);
      if (!date) return "";
      return new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(date);
    },
    [locale],
  );
}

/** Wybór POJEDYNCZEJ daty (przedłużenie najmu). */
export function DateField({
  id,
  name,
  value,
  onChange,
  min,
  invalid,
  describedBy,
  className,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  /** Najwcześniejszy dopuszczalny dzień (ISO) — odpowiednik atrybutu `min`. */
  min?: string;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const t = useTranslations("common.dateField");
  const format = useDayFormat();
  const calendarLocale = useCalendarLocale();
  const [open, setOpen] = React.useState(false);
  const selected = isoToDate(value);
  const before = min ? isoToDate(min) : undefined;

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          type="button"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(TRIGGER_CLASS, className)}
        >
          <span className={selected ? "tabular-nums" : "text-muted-foreground"}>
            {selected ? format(value) : t("placeholder")}
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            autoFocus
            locale={calendarLocale}
            defaultMonth={selected ?? before}
            selected={selected}
            disabled={before ? { before } : undefined}
            onSelect={(next) => {
              onChange(dateToIso(next));
              // Wybór pojedynczej daty kończy zadanie — kalendarz się zamyka.
              if (next) setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

/**
 * Wybór ZAKRESU (filtry listy, termin najmu w kreatorze).
 *
 * Sam początek bez końca jest DOPUSZCZALNY: filtry mają wtedy otwarty prawy
 * koniec, a kreator po prostu czeka na drugi klik. Dlatego pola ukryte są
 * dwa, niezależne, i puste pole = brak parametru, jak przy dwóch osobnych
 * polach natywnych.
 */
export function DateRangeField({
  id,
  fromName,
  toName,
  from,
  to,
  onChange,
  invalid,
  describedBy,
  className,
}: {
  id: string;
  fromName: string;
  toName: string;
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const t = useTranslations("common.dateField");
  const format = useDayFormat();
  const calendarLocale = useCalendarLocale();
  const [open, setOpen] = React.useState(false);
  const isDesktop = useDesktopCalendar();

  const selected: CalendarRange | undefined = isoToDate(from)
    ? { from: isoToDate(from), to: isoToDate(to) }
    : undefined;

  const label = isoToDate(from)
    ? isoToDate(to)
      ? `${format(from)} - ${format(to)}`
      : `${format(from)} -`
    : t("rangePlaceholder");

  return (
    <>
      <input type="hidden" name={fromName} value={from} />
      <input type="hidden" name={toName} value={to} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          type="button"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(TRIGGER_CLASS, className)}
        >
          <span className={isoToDate(from) ? "tabular-nums" : "text-muted-foreground"}>
            {label}
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="range"
            autoFocus
            locale={calendarLocale}
            numberOfMonths={isDesktop ? 2 : 1}
            defaultMonth={isoToDate(from)}
            selected={selected}
            onSelect={(next) => {
              const nextFrom = dateToIso(next?.from);
              onChange({ from: nextFrom, to: dateToIso(next?.to) });

              /*
                Zakres jest domknięty, gdy użytkownik dobrał KONIEC do początku,
                który już miał. Sama obecność `to` nie wystarcza: react-day-picker
                po PIERWSZYM kliknięciu oddaje `{from: d, to: d}`, więc warunek
                „from && to" zamykał kalendarz od razu i drugi klik wymagał
                otwierania go od nowa. Gdy drugie kliknięcie przestawia POCZĄTEK
                (dzień wcześniejszy), `from` się zmienia — kalendarz zostaje
                otwarty i czeka na koniec.
              */
              if (next?.to && nextFrom === from) setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

/**
 * Wybór ZAKRESU bez popovera — kalendarz stoi OTWARTY na ekranie (R3,
 * pinezka „termin powinien być gdzieś pod klientem albo po prawej i w formie
 * kalendarza").
 *
 * To WARIANT OPRAWY `DateRangeField`, a nie drugi widżet dat: ten sam
 * `Calendar` i ten sam kontrakt wysyłki (dwa ukryte pola ze stringiem ISO).
 * Różnica jest w tym, czym kalendarz JEST na ekranie — przy wybieraniu
 * terminu najmu to główna treść kolumny, a nie coś, co trzeba najpierw
 * wywołać kliknięciem. Dlatego nie ma tu ani wyzwalacza, ani logiki
 * domykania popovera: nie ma czego domykać.
 *
 * JEDEN miesiąc niezależnie od szerokości — pole żyje w wąskiej kolumnie
 * obok formularza, a nie na całej szerokości jak popover filtrów listy.
 *
 * Dni ZAJĘTE przychodzą z zewnątrz jako gotowa lista (silnik dostępności) i
 * są tu tylko MALOWANE — modułowi dat nie wolno liczyć zajętości. Zajęty
 * dzień zostaje KLIKALNY świadomie: odmowa i tak przychodzi z podglądu
 * braków i z bramek bazy, a kalendarz ma informować, nie decydować za
 * operatora, który bywa uprawniony sięgnąć po termin zwalniający się lada
 * moment.
 */
export function InlineDateRangeField({
  id,
  fromName,
  toName,
  from,
  to,
  onChange,
  occupiedDays = [],
  invalid,
  describedBy,
  className,
}: {
  id: string;
  fromName: string;
  toName: string;
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  /** Dni zajęte jako stringi `YYYY-MM-DD`; źródłem jest silnik dostępności. */
  occupiedDays?: readonly string[];
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const calendarLocale = useCalendarLocale();

  const selected: CalendarRange | undefined = isoToDate(from)
    ? { from: isoToDate(from), to: isoToDate(to) }
    : undefined;

  const occupied = React.useMemo(
    () => occupiedDays.map(isoToDate).filter((date): date is Date => date !== undefined),
    [occupiedDays],
  );

  return (
    <div
      id={id}
      data-inline-date-range
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn("flex justify-center", className)}
    >
      <input type="hidden" name={fromName} value={from} />
      <input type="hidden" name={toName} value={to} />
      <Calendar
        mode="range"
        locale={calendarLocale}
        defaultMonth={isoToDate(from)}
        selected={selected}
        modifiers={{ occupied }}
        // Modyfikator ląduje na KOMÓRCE dnia, a tło maluje przycisk w środku —
        // stąd wariant zstępujący, a nie klasa na samej komórce (tę zasłoniłoby
        // własne tło przycisku).
        modifiersClassNames={{ occupied: "[&_button]:bg-status-problem-bg" }}
        onSelect={(next) => {
          onChange({ from: dateToIso(next?.from), to: dateToIso(next?.to) });
        }}
        className="p-0"
      />
    </div>
  );
}
