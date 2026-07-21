"use client";

import { useState } from "react";

import { DateRangeField } from "@/lib/fields/date-fields";

/**
 * Zakres terminu w filtrach listy — stan mieszka tu, bo formularz filtrów
 * jest server componentem, a kalendarz z natury potrzebuje klienta.
 *
 * Parametry zapytania zostają DWA (`od`, `do`) i niezależne: wybór samego
 * początku daje otwarty prawy koniec, dokładnie jak wypełnienie tylko pola
 * „Termin od" wcześniej. Filtr po stronie serwera nie zmienia się o znak.
 */
export function OrdersDateFilter({
  id,
  defaultFrom,
  defaultTo,
}: {
  id: string;
  defaultFrom: string;
  defaultTo: string;
}) {
  const [range, setRange] = useState({ from: defaultFrom, to: defaultTo });

  return (
    <DateRangeField
      id={id}
      fromName="od"
      toName="do"
      from={range.from}
      to={range.to}
      onChange={setRange}
      className="w-[248px]"
    />
  );
}
