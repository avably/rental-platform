"use client";

/**
 * Notatki zamówienia (uwaga właściciela N6) — stan sprzętu, uwagi o zwrocie
 * kaucji, ustalenia z klientem.
 *
 * TREŚĆ JEST STANEM KOMPONENTU, NIE `defaultValue` FORMULARZA, i to jest
 * całe zabezpieczenie tej sekcji: akcja serwerowa kończy się `revalidatePath`,
 * więc po nieudanym zapisie strona przerysowuje się z WERSJĄ Z BAZY. Pole
 * niekontrolowane pokazałoby wtedy starą notatkę, a operator zobaczyłby, jak
 * jego akapit znika razem z komunikatem błędu — czyli utratę pracy w chwili,
 * w której system i tak już zawiódł.
 *
 * Przycisk zapisu jest wygaszony, dopóki nic się nie zmieniło: „zapisz" bez
 * zmiany to żądanie do bazy, które niczego nie robi, i sekunda niepewności,
 * czy aby na pewno.
 */
import { Button, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import type { FormState } from "@/lib/form-state";

type NotesAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

export function OrderNotes({
  orderId,
  notes,
  action,
}: {
  orderId: string;
  notes: string | null;
  action: NotesAction;
}) {
  const t = useTranslations("orders.notes");
  const [value, setValue] = useState(notes ?? "");
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, formData) => action(prev, formData),
    {},
  );

  const unchanged = value.trim() === (notes ?? "").trim();
  const fieldError = state.fieldErrors?.notes;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <Label htmlFor="order-notes">{t("label")}</Label>
      <Textarea
        id="order-notes"
        name="notes"
        rows={4}
        maxLength={2000}
        placeholder={t("placeholder")}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={pending}
        aria-invalid={fieldError ? true : undefined}
      />
      {fieldError ? (
        <p role="alert" className="text-destructive text-sm">
          {fieldError}
        </p>
      ) : null}
      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}
      {state.success && unchanged ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("saved")}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending || unchanged}>
          {t("saveCta")}
        </Button>
      </div>
    </form>
  );
}
