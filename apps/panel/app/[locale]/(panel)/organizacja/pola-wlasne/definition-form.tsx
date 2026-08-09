"use client";

import { CUSTOM_FIELD_LIMITS, type CustomFieldEntity, type CustomFieldType } from "@avably/core";
import { Button, Checkbox, Input, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

export interface DefinitionFormValues {
  entity: CustomFieldEntity;
  fieldType: CustomFieldType;
  label: string;
  helpText: string;
  optionsText: string;
  required: boolean;
  showInPanel: boolean;
  showInCheckout: boolean;
  showInContract: boolean;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-[13px] leading-[18px] font-medium">
      {message}
    </p>
  );
}

/**
 * Formularz definicji pola własnego.
 *
 * Dwie rzeczy, które muszą być tu widoczne, a nie ukryte:
 *   * gdy pole ma już zapisane wartości, wybór rodzaju i encji jest WYGASZONY
 *     wraz ze zdaniem dlaczego (baza i tak odmówi — ekran ma powiedzieć to
 *     wcześniej i po ludzku, zamiast oddawać surowy błąd bazy);
 *   * lista wyboru pokazuje pole opcji WYŁĄCZNIE dla rodzaju „lista" —
 *     opcje przy innym rodzaju i tak nie wejdą do bazy.
 */
export function DefinitionForm({
  action,
  defaults,
  locked,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  defaults: DefinitionFormValues;
  /** Pole ma zapisane wartości — rodzaj i encja są zamrożone. */
  locked?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [fieldType, setFieldType] = useState<string>(defaults.fieldType);
  const t = useTranslations("customFields");

  const errorId = (field: string) => (state.fieldErrors?.[field] ? `cf-${field}-error` : undefined);

  const entityOptions = (["customer", "order", "product"] as const).map((value) => ({
    value,
    label: t(`entity.${value}`),
  }));
  const typeOptions = (
    ["text", "textarea", "number", "date", "select", "checkbox", "phone"] as const
  ).map((value) => ({ value, label: t(`type.${value}`) }));

  return (
    <form action={formAction} data-form-line-measure className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cf-label">{t("form.label")}</Label>
        <Input
          id="cf-label"
          name="label"
          required
          maxLength={CUSTOM_FIELD_LIMITS.labelMax}
          defaultValue={defaults.label}
          aria-invalid={state.fieldErrors?.label ? true : undefined}
          aria-describedby={errorId("label")}
        />
        <FieldError id="cf-label-error" message={state.fieldErrors?.label} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-entity">{t("form.entity")}</Label>
          <PanelSelect
            id="cf-entity"
            name="entity"
            defaultValue={defaults.entity}
            options={entityOptions}
            disabled={locked}
            invalid={Boolean(state.fieldErrors?.entity)}
            describedBy={errorId("entity")}
          />
          {locked ? <input type="hidden" name="entity" value={defaults.entity} /> : null}
          <FieldError id="cf-entity-error" message={state.fieldErrors?.entity} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-fieldType">{t("form.type")}</Label>
          <PanelSelect
            id="cf-fieldType"
            name="fieldType"
            defaultValue={defaults.fieldType}
            options={typeOptions}
            disabled={locked}
            onValueChange={setFieldType}
            invalid={Boolean(state.fieldErrors?.fieldType)}
            describedBy={errorId("fieldType")}
          />
          {locked ? <input type="hidden" name="fieldType" value={defaults.fieldType} /> : null}
          <FieldError id="cf-fieldType-error" message={state.fieldErrors?.fieldType} />
        </div>
      </div>

      {locked ? (
        <p className="text-muted-foreground text-sm">{t("form.lockedHint")}</p>
      ) : null}

      {fieldType === "select" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-optionsText">{t("form.options")}</Label>
          <Textarea
            id="cf-optionsText"
            name="optionsText"
            rows={5}
            defaultValue={defaults.optionsText}
            aria-invalid={state.fieldErrors?.optionsText ? true : undefined}
            aria-describedby={errorId("optionsText")}
          />
          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {t("form.optionsHint")}
          </p>
          <FieldError id="cf-optionsText-error" message={state.fieldErrors?.optionsText} />
        </div>
      ) : (
        <input type="hidden" name="optionsText" value="" />
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cf-helpText">{t("form.helpText")}</Label>
        <Input
          id="cf-helpText"
          name="helpText"
          maxLength={CUSTOM_FIELD_LIMITS.helpTextMax}
          defaultValue={defaults.helpText}
          aria-invalid={state.fieldErrors?.helpText ? true : undefined}
          aria-describedby={errorId("helpText")}
        />
        <FieldError id="cf-helpText-error" message={state.fieldErrors?.helpText} />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">{t("form.visibility")}</legend>
        <div className="flex items-center gap-2">
          <Checkbox id="cf-showInPanel" name="showInPanel" defaultChecked={defaults.showInPanel} />
          <Label htmlFor="cf-showInPanel">{t("form.showInPanel")}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="cf-showInCheckout"
            name="showInCheckout"
            defaultChecked={defaults.showInCheckout}
          />
          <Label htmlFor="cf-showInCheckout">{t("form.showInCheckout")}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="cf-showInContract"
            name="showInContract"
            defaultChecked={defaults.showInContract}
          />
          <Label htmlFor="cf-showInContract">{t("form.showInContract")}</Label>
        </div>
        <FieldError id="cf-showInPanel-error" message={state.fieldErrors?.showInPanel} />
      </fieldset>

      <div className="flex items-center gap-2">
        <Checkbox id="cf-required" name="required" defaultChecked={defaults.required} />
        <Label htmlFor="cf-required">{t("form.required")}</Label>
      </div>

      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-status-positive-fg text-sm">
          {t("form.saved")}
        </p>
      ) : null}

      <div>
        <Button type="submit" loading={pending} disabled={pending}>
          {t("form.save")}
        </Button>
      </div>
    </form>
  );
}
