"use client";

/**
 * Sekcja pól własnych na karcie zamówienia (C6-A2, ADR-119).
 *
 * Sekcja jest EDYTOWALNA, a nie tylko do odczytu, bo inaczej wartość dałoby się
 * wpisać wyłącznie w chwili zakładania zamówienia — a numer uprawnień czy stan
 * licznika operator zna zwykle później, przy wydaniu sprzętu.
 */
import type { CustomFieldDefinition, CustomFieldValues } from "@avably/core";
import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { CustomFieldsFieldset } from "@/components/fields/custom-fields-fieldset";
import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

export function OrderCustomFieldsSection({
  action,
  fields,
  values,
  /**
   * Zamówienie powstało, ale dopisanie pól własnych nie doszło do skutku.
   * Ostrzeżenie stoi TU, nad pustymi polami, bo tu jest jedyne miejsce, gdzie
   * operator może to naprawić jednym kliknięciem — komunikat na kreatorze
   * kazałby mu założyć zamówienie drugi raz.
   */
  notSaved = false,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  fields: readonly CustomFieldDefinition[];
  values: CustomFieldValues;
  notSaved?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("customFields");

  if (fields.length === 0) return null;

  return (
    <section
      aria-labelledby="order-custom-fields-heading"
      data-order-custom-fields
      className="border-border bg-card flex flex-col gap-3 rounded-md border p-5"
    >
      <h2
        id="order-custom-fields-heading"
        className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase"
      >
        {t("values.section")}
      </h2>

      {notSaved ? (
        <p role="alert" className="text-destructive text-sm">
          {t("values.notSaved")}
        </p>
      ) : null}

      <form action={formAction} data-form-line-measure className="flex flex-col gap-5">
        <CustomFieldsFieldset
          fields={fields}
          values={values}
          errors={state.fieldErrors}
          idPrefix="order-detail-cf"
          labelledBy="order-custom-fields-heading"
        />

        {state.formError ? (
          <p role="alert" className="text-destructive text-sm">
            {state.formError}
          </p>
        ) : null}
        {state.success ? (
          <p role="status" className="text-status-positive-fg text-sm">
            {t("values.saved")}
          </p>
        ) : null}

        <div>
          <Button type="submit" loading={pending} disabled={pending}>
            {t("values.save")}
          </Button>
        </div>
      </form>
    </section>
  );
}
