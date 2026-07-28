"use client";

import { Button, Label } from "@avably/ui";
import { addDays, formatMoney, type CurrencyCode } from "@avably/core";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";

import type { FormState } from "@/lib/form-state";
import { DateField } from "@/lib/fields/date-fields";

import {
  quoteOrderExtension,
  type ExtensionItemPricing,
  type OrderExtensionQuote,
} from "./extension-pricing";

const initialState: FormState = {};

/**
 * Wejście w przedłużenie PRZY TERMINIE (R4): przycisk „Przedłuż" przy dacie
 * końca w karcie podsumowania odsłania wybór NOWEJ DATY KOŃCA z dopłatą
 * liczoną NA ŻYWO. To RELOKACJA UI — mechanika (akcja, wycena, bramka 0010,
 * maile, ślady w historii) bez zmian; zmieniło się wejście w przepływ i jego
 * miejsce, a osobna sekcja przedłużenia zniknęła (uwaga właściciela).
 *
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
  const [open, setOpen] = useState(false);
  const [newEndDate, setNewEndDate] = useState("");

  // Domknięcie po sukcesie NIE jest efektem: udany submit zmienia end_date,
  // revalidatePath odświeża RSC, a `ExtensionSection` kluczuje ten formularz
  // po `endDate` (`key`), więc przy nowym terminie komponent montuje się od nowa
  // — zwinięty i z pustym wyborem. Potwierdzeniem jest NOWY termin tuż nad
  // przyciskiem, nie druga linia „gotowe". (Efekt z setState pod tę samą rzecz
  // pali react-hooks/set-state-in-effect i robi kaskadę renderów.)
  const quote: OrderExtensionQuote | null = useMemo(() => {
    if (!newEndDate) return null;
    try {
      return quoteOrderExtension({ startDate, endDate }, newEndDate, items);
    } catch {
      return null; // data nie-po-końcu albo niekompletna — podgląd milczy, submit zablokowany
    }
  }, [startDate, endDate, newEndDate, items]);

  // Wejście zwinięte: sam przycisk „Przedłuż" przy terminie. Kalendarz i dopłata
  // wchodzą dopiero po kliknięciu, więc karta podsumowania nie puchnie o formularz
  // przy każdym otwarciu zamówienia.
  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-extension-trigger
        className="self-start"
        onClick={() => setOpen(true)}
      >
        {t("trigger")}
      </Button>
    );
  }

  return (
    <form
      action={formAction}
      data-form-line-measure
      data-extension-form
      className="flex flex-col gap-2 rounded border p-3 text-sm"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedEndDate" value={endDate} />
      <Label htmlFor="extension-new-end">{t("newEndLabel")}</Label>
      {/* Dni przed końcem najmu są w kalendarzu WYŁĄCZONE — odpowiednik
          dawnego `min`, tyle że widoczny od razu, a nie dopiero po odrzuceniu
          wyboru. Do akcji jedzie ten sam string ISO pod tą samą nazwą. */}
      <DateField
        id="extension-new-end"
        name="newEndDate"
        min={addDays(endDate, 1)}
        value={newEndDate}
        onChange={setNewEndDate}
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
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || !quote}>
          {t("cta")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setNewEndDate("");
          }}
        >
          {t("cancel")}
        </Button>
      </div>
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
