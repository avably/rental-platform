"use client";

import { Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import * as React from "react";

import { DateRangeField } from "@/lib/fields/date-fields";

/**
 * Zakres dat eksportu zamówień (C2, ADR-111) — jedyny stan klienta na
 * ekranie eksportu. Daty wybiera `DateRangeField` z `lib/fields` (kontrakt
 * panel-date-fields: ŻADNYCH natywnych `input type="date"` na trasach
 * `(panel)/**`), a do route handlera lecą jego ukryte pola `date_from` /
 * `date_to` w ciele POST — puste pole = brak filtra, spójnie z filtrami
 * listy zamówień.
 */
export function ExportOrdersRange() {
  const t = useTranslations("dataExport.orders");
  const [range, setRange] = React.useState({ from: "", to: "" });

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="export-orders-range">{t("rangeLabel")}</Label>
      <DateRangeField
        id="export-orders-range"
        fromName="date_from"
        toName="date_to"
        from={range.from}
        to={range.to}
        onChange={setRange}
        className="w-fit"
      />
    </div>
  );
}
