"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";

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

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-red-600">
      {message}
    </p>
  );
}

/**
 * Pola egzemplarza — wspólne dla dodawania i edycji wiersza. `idPrefix`
 * z useId(): na stronie żyje wiele formularzy z tymi samymi polami, a pary
 * label/for i aria-describedby wymagają identyfikatorów unikalnych w dokumencie.
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
  const errorId = (field: string) =>
    state.fieldErrors?.[field] ? `${idPrefix}-${field}-error` : undefined;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <FieldError id={`${idPrefix}-serialNumber-error`} message={state.fieldErrors?.serialNumber} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-from`}>{t("unavailableFrom")}</Label>
        <Input
          id={`${idPrefix}-from`}
          name="unavailableFrom"
          type="date"
          defaultValue={defaults.unavailableFrom}
          aria-invalid={state.fieldErrors?.unavailableFrom ? true : undefined}
          aria-describedby={errorId("unavailableFrom") ?? `${idPrefix}-window-hint`}
        />
        <FieldError
          id={`${idPrefix}-unavailableFrom-error`}
          message={state.fieldErrors?.unavailableFrom}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-to`}>{t("unavailableTo")}</Label>
        <Input
          id={`${idPrefix}-to`}
          name="unavailableTo"
          type="date"
          defaultValue={defaults.unavailableTo}
          aria-invalid={state.fieldErrors?.unavailableTo ? true : undefined}
          aria-describedby={errorId("unavailableTo") ?? `${idPrefix}-window-hint`}
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

      <p id={`${idPrefix}-window-hint`} className="text-xs text-gray-500 sm:col-span-2 lg:col-span-4">
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
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold">{t("addTitle")}</h2>
      <UnitFields
        idPrefix={idPrefix}
        state={state}
        defaults={{ serialNumber: "", unavailableFrom: "", unavailableTo: "", unavailableReason: "" }}
      />
      {state.formError ? (
        <p role="alert" className="text-sm text-red-600">
          {state.formError}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-sm text-green-700">
          {t("added")}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("adding") : t("add")}
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
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
      <input type="hidden" name="unitId" value={unit.id} />
      <UnitFields idPrefix={idPrefix} state={state} defaults={unit} />
      {state.formError ? (
        <p role="alert" className="text-sm text-red-600">
          {state.formError}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-sm text-green-700">
          {state.success === "deleted" ? t("deletedInfo") : t("saved")}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" name="intent" value="save" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <Button type="submit" name="intent" value="delete" variant="destructive" disabled={pending}>
          {t("delete")}
        </Button>
      </div>
    </form>
  );
}
