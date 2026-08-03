"use client";

/**
 * Termin najmu jako KALENDARZ (R3, pinezka 00aa35ca: „termin powinien być
 * gdzieś pod klientem albo po prawej stronie i w formie kalendarza").
 *
 * STAN PRZED: pole zakresu otwierające kalendarz w popoverze plus pasek
 * dostępności PER PRODUKT — tyle pasków, ile produktów w koszyku. Operator
 * musiał zestawić je w głowie, żeby odpowiedzieć na jedyne pytanie, które
 * zadaje: „czy w tym terminie da się wydać CAŁE to zamówienie".
 *
 * PO: jeden kalendarz stojący otwarty w prawej kolumnie, malowany JEDNĄ mapą
 * dostępności koszyka (`mergeDayMaps` — koniunkcja produktów, patrz
 * `basket-availability.ts`). Pod nim podsumowanie: wybrany zakres i liczba
 * dób liczona przez silnik (`rentalDaysInclusive`), nie odejmowaniem dat
 * w komponencie.
 */
import { rentalDaysInclusive, type IsoDate } from "@avably/core";
import { useLocale, useTranslations } from "next-intl";

import { InlineDateRangeField } from "@/lib/fields/date-fields";

export function TermCalendar({
  from,
  to,
  onChange,
  occupiedDays,
  hasBasket,
  invalid,
  errorSlot,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  occupiedDays: readonly string[];
  /** Czy w koszyku jest cokolwiek — bez tego zajętość jest NIEZNANA, nie zerowa. */
  hasBasket: boolean;
  invalid: boolean;
  errorSlot: (field: string) => React.ReactNode;
}) {
  const t = useTranslations("orders.form");
  const locale = useLocale();

  const complete = from !== "" && to !== "" && to >= from;
  const days = complete ? rentalDaysInclusive(from as IsoDate, to as IsoDate) : 0;

  const formatDay = (value: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(
      // Bezpieczne: `complete` gwarantuje kształt ISO, a rozbicie na części
      // trzyma dzień w czasie LOKALNYM (północ UTC potrafi cofnąć dobę).
      new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))),
    );

  return (
    <div className="flex flex-col gap-3">
      <InlineDateRangeField
        id="order-term"
        fromName="startDate"
        toName="endDate"
        from={from}
        to={to}
        onChange={onChange}
        occupiedDays={occupiedDays}
        invalid={invalid}
      />

      <ul className="text-muted-foreground flex flex-wrap gap-4 text-xs">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="bg-status-problem-bg inline-block size-3 rounded-sm" />
          {t("legendBlocked")}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="bg-primary inline-block size-3 rounded-sm" />
          {t("legendSelected")}
        </li>
      </ul>

      {hasBasket ? null : <p className="text-muted-foreground text-xs">{t("termNoBasket")}</p>}

      <div className="border-border bg-card rounded-lg border p-3" role="status" data-term-summary>
        {complete ? (
          <>
            <p className="text-sm font-semibold tabular-nums">
              {formatDay(from)} → {formatDay(to)}
            </p>
            <p className="text-muted-foreground text-xs">{t("termDays", { days })}</p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t("termEmpty")}</p>
        )}
      </div>

      {errorSlot("startDate")}
      {errorSlot("endDate")}
    </div>
  );
}
