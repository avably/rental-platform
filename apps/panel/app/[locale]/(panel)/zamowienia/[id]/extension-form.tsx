"use client";

import { Button, Input, Label } from "@avably/ui";
import { addDays, formatMoney, type CurrencyCode } from "@avably/core";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";

import type { FormState } from "@/lib/form-state";

import {
  quoteOrderExtension,
  type ExtensionItemPricing,
  type OrderExtensionQuote,
} from "./extension-pricing";

const initialState: FormState = {};

/**
 * Formularz przedłużenia: wybór nowej daty końca + podgląd dopłaty NA ŻYWO.
 * Podgląd liczy quoteOrderExtension — ten sam czysty moduł, którego używa
 * akcja na autorytatywnym odczycie, więc liczby nie mają jak się rozjechać;
 * autorytatywna jest mimo to akcja (re-odczyt cennika) i bramka 0010.
 * Hidden expectedEndDate = optymistyczna współbieżność (wzorzec expectedFrom).
 */
export function ExtensionForm({
  orderId,
  startDate,
  endDate,
  items,
  currency,
  locale,
  action,
}: {
  orderId: string;
  startDate: string;
  endDate: string;
  items: ExtensionItemPricing[];
  currency: CurrencyCode;
  locale: string;
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("orders.extension");
  const [state, formAction, pending] = useActionState(action, initialState);
  const [newEndDate, setNewEndDate] = useState("");

  const quote: OrderExtensionQuote | null = useMemo(() => {
    if (!newEndDate) return null;
    try {
      return quoteOrderExtension({ startDate, endDate }, newEndDate, items);
    } catch {
      return null; // data nie-po-końcu albo niekompletna — podgląd milczy, submit zablokowany
    }
  }, [startDate, endDate, newEndDate, items]);

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-2 rounded border p-3 text-sm">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedEndDate" value={endDate} />
      <Label htmlFor="extension-new-end">{t("newEndLabel")}</Label>
      <Input
        id="extension-new-end"
        name="newEndDate"
        type="date"
        min={addDays(endDate, 1)}
        value={newEndDate}
        onChange={(event) => setNewEndDate(event.target.value)}
      />
      {quote ? (
        <p>
          {t("quoteDays", { days: quote.additionalDays })}
          {" · "}
          <span className="font-semibold">
            {t("quoteSurcharge", {
              amount: formatMoney(quote.additionalRentalGrosze, currency, locale),
            })}
          </span>
        </p>
      ) : (
        <p className="text-muted-foreground">{t("pickDateHint")}</p>
      )}
      <Button type="submit" disabled={pending || !quote}>
        {t("cta")}
      </Button>
      {state.formError ? (
        <p role="alert" className="text-destructive">
          {state.formError}
        </p>
      ) : null}
      {state.fieldErrors ? (
        <p role="alert" className="text-destructive">
          {Object.values(state.fieldErrors)[0]}
        </p>
      ) : null}
    </form>
  );
}
