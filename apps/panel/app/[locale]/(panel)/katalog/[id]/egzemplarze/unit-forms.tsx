"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";

import { DateRangeField } from "@/lib/fields/date-fields";
import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

export interface UnitValues {
  id: string;
  serialNumber: string;
  unavailableFrom: string;
  unavailableTo: string;
  unavailableReason: string;
}

type UnitAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

/**
 * Błąd POD polem — wzorzec sekcji 06 artefaktu (ADR-058), ten sam co
 * w formularzu produktu i kreatorze zamówień.
 */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-[13px] leading-[18px] font-medium">
      {message}
    </p>
  );
}

/**
 * Pola egzemplarza — wspólne dla dodawania i edycji wiersza. `idPrefix`
 * z useId(): na stronie żyje wiele formularzy z tymi samymi polami, a pary
 * label/for i aria-describedby wymagają identyfikatorów unikalnych w dokumencie.
 *
 * OKNO SERWISOWE JEST ZAKRESEM, nie dwoma polami: baza wymaga OBU dat albo
 * żadnej (CHECK `product_units_unavailable_range_complete`), więc jeden
 * `DateRangeField` odwzorowuje tę regułę wprost, zamiast zostawiać możliwość
 * wpisania połowy, którą i tak odrzuci walidacja. KONTRAKT WYSYŁKI BEZ ZMIAN:
 * dwa ukryte pola `unavailableFrom` / `unavailableTo` ze stringiem
 * `YYYY-MM-DD`, dokładnie jak przy polach natywnych — server action, schemat
 * walidacji i CHECK bazy nie widzą różnicy.
 */
function UnitFields({
  idPrefix,
  state,
  defaults,
}: {
  idPrefix: string;
  state: FormState;
  defaults: Omit<UnitValues, "id">;
}) {
  const t = useTranslations("catalog.units");
  const [serviceWindow, setServiceWindow] = useState({
    from: defaults.unavailableFrom,
    to: defaults.unavailableTo,
  });
  const errorId = (field: string) =>
    state.fieldErrors?.[field] ? `${idPrefix}-${field}-error` : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-serial`}>{t("serial")}</Label>
        <Input
          id={`${idPrefix}-serial`}
          name="serialNumber"
          maxLength={100}
          defaultValue={defaults.serialNumber}
          aria-invalid={state.fieldErrors?.serialNumber ? true : undefined}
          aria-describedby={errorId("serialNumber")}
        />
        <FieldError
          id={`${idPrefix}-serialNumber-error`}
          message={state.fieldErrors?.serialNumber}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-window`}>{t("unavailableWindow")}</Label>
        <DateRangeField
          id={`${idPrefix}-window`}
          fromName="unavailableFrom"
          toName="unavailableTo"
          from={serviceWindow.from}
          to={serviceWindow.to}
          onChange={setServiceWindow}
          invalid={Boolean(state.fieldErrors?.unavailableFrom ?? state.fieldErrors?.unavailableTo)}
          describedBy={
            errorId("unavailableFrom") ?? errorId("unavailableTo") ?? `${idPrefix}-window-hint`
          }
        />
        <FieldError
          id={`${idPrefix}-unavailableFrom-error`}
          message={state.fieldErrors?.unavailableFrom}
        />
        <FieldError
          id={`${idPrefix}-unavailableTo-error`}
          message={state.fieldErrors?.unavailableTo}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-reason`}>{t("reason")}</Label>
        <Input
          id={`${idPrefix}-reason`}
          name="unavailableReason"
          maxLength={500}
          defaultValue={defaults.unavailableReason}
          aria-invalid={state.fieldErrors?.unavailableReason ? true : undefined}
          aria-describedby={errorId("unavailableReason")}
        />
        <FieldError
          id={`${idPrefix}-unavailableReason-error`}
          message={state.fieldErrors?.unavailableReason}
        />
      </div>

      <p
        id={`${idPrefix}-window-hint`}
        className="text-muted-foreground text-[13px] leading-[18px] sm:col-span-2 lg:col-span-3"
      >
        {t("windowHint")}
      </p>
    </div>
  );
}

export function AddUnitForm({ action }: { action: UnitAction }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("catalog.units");
  const idPrefix = useId();

  return (
    <form
      action={formAction}
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-5"
    >
      <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("addTitle")}</h2>
      <UnitFields
        idPrefix={idPrefix}
        state={state}
        defaults={{
          serialNumber: "",
          unavailableFrom: "",
          unavailableTo: "",
          unavailableReason: "",
        }}
      />
      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-status-positive-fg text-sm">
          {t("added")}
        </p>
      ) : null}
      <div>
        <Button type="submit" loading={pending} disabled={pending}>
          {t("add")}
        </Button>
      </div>
    </form>
  );
}

export function UnitRowForm({ action, unit }: { action: UnitAction; unit: UnitValues }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("catalog.units");
  const idPrefix = useId();

  return (
    <form
      action={formAction}
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-5"
    >
      <input type="hidden" name="unitId" value={unit.id} />
      <UnitFields idPrefix={idPrefix} state={state} defaults={unit} />
      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-status-positive-fg text-sm">
          {state.success === "deleted" ? t("deletedInfo") : t("saved")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="save" loading={pending} disabled={pending}>
          {t("save")}
        </Button>
        <Button type="submit" name="intent" value="delete" variant="destructive" disabled={pending}>
          {t("delete")}
        </Button>
      </div>
    </form>
  );
}
