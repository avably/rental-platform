"use client";

import {
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

/**
 * Pola dat ekranów zamówień (decyzja właściciela 2026-07-21): daty wybiera się
 * WYŁĄCZNIE naszym `Calendar` w `Popover`, nigdy natywnym `input type="date"`.
 * Natywny widżet maluje się chromem systemu — nie ma na nim ani tokenów Fazy 2,
 * ani stanów sekcji 07, a jego wygląd zmienia się między przeglądarkami.
 * Zakazu pilnuje `order-date-fields-contract.test.ts`.
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
  "border-input bg-background text-foreground flex h-9 w-full min-w-0 cursor-pointer items-center rounded-md border px-3 text-left text-sm outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring disabled:cursor-not-allowed disabled:border-dashed aria-invalid:border-destructive";

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
  const t = useTranslations("orders.dateField");
  const format = useDayFormat();
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
  const t = useTranslations("orders.dateField");
  const format = useDayFormat();
  const [open, setOpen] = React.useState(false);

  const selected: CalendarRange | undefined = isoToDate(from)
    ? { from: isoToDate(from), to: isoToDate(to) }
    : undefined;

  const label = isoToDate(from)
    ? isoToDate(to)
      ? `${format(from)} — ${format(to)}`
      : `${format(from)} —`
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
            numberOfMonths={2}
            defaultMonth={isoToDate(from)}
            selected={selected}
            onSelect={(next) => {
              onChange({ from: dateToIso(next?.from), to: dateToIso(next?.to) });
              // Zamykamy dopiero po domknięciu zakresu — inaczej drugi klik
              // musiałby otwierać kalendarz od nowa.
              if (next?.from && next.to) setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
