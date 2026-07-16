"use client";

import { Button, Checkbox, Input, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

/** Wartości pól jako STRINGI — konwersję grosze↔pole robi wyłącznie strona
 * serwerowa (lib/money-input.ts), formularz niczego nie przelicza. */
export interface ProductFormValues {
  name: string;
  description: string;
  basePriceDay: string;
  deposit: string;
  autoIncrementMultiplier: string;
  bufferBeforeDays: string;
  bufferAfterDays: string;
  active: boolean;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-red-600">
      {message}
    </p>
  );
}

export function ProductForm({
  action,
  defaults,
  currencyCode,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  defaults: ProductFormValues;
  currencyCode: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("catalog.productForm");

  const errorId = (field: string) =>
    state.fieldErrors?.[field] ? `product-${field}-error` : undefined;

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-name">{t("name")}</Label>
        <Input
          id="product-name"
          name="name"
          required
          maxLength={200}
          defaultValue={defaults.name}
          aria-invalid={state.fieldErrors?.name ? true : undefined}
          aria-describedby={errorId("name")}
        />
        <FieldError id="product-name-error" message={state.fieldErrors?.name} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-description">{t("description")}</Label>
        <Textarea
          id="product-description"
          name="description"
          rows={4}
          defaultValue={defaults.description}
          aria-invalid={state.fieldErrors?.description ? true : undefined}
          aria-describedby={errorId("description")}
        />
        <FieldError id="product-description-error" message={state.fieldErrors?.description} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-base-price">
            {t("basePriceDay", { currency: currencyCode })}
          </Label>
          <Input
            id="product-base-price"
            name="basePriceDayGrosze"
            required
            inputMode="decimal"
            defaultValue={defaults.basePriceDay}
            aria-invalid={state.fieldErrors?.basePriceDayGrosze ? true : undefined}
            aria-describedby={
              errorId("basePriceDayGrosze") ?? "product-base-price-hint"
            }
          />
          <p id="product-base-price-hint" className="text-xs text-gray-500">
            {t("moneyHint")}
          </p>
          <FieldError
            id="product-basePriceDayGrosze-error"
            message={state.fieldErrors?.basePriceDayGrosze}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-deposit">{t("deposit", { currency: currencyCode })}</Label>
          <Input
            id="product-deposit"
            name="depositGrosze"
            inputMode="decimal"
            defaultValue={defaults.deposit}
            aria-invalid={state.fieldErrors?.depositGrosze ? true : undefined}
            aria-describedby={errorId("depositGrosze")}
          />
          <FieldError id="product-depositGrosze-error" message={state.fieldErrors?.depositGrosze} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-auto-increment">{t("autoIncrementMultiplier")}</Label>
        <Input
          id="product-auto-increment"
          name="autoIncrementMultiplier"
          required
          inputMode="decimal"
          defaultValue={defaults.autoIncrementMultiplier}
          aria-invalid={state.fieldErrors?.autoIncrementMultiplier ? true : undefined}
          aria-describedby={errorId("autoIncrementMultiplier") ?? "product-auto-increment-hint"}
        />
        <p id="product-auto-increment-hint" className="text-xs text-gray-500">
          {t("autoIncrementHint")}
        </p>
        <FieldError
          id="product-autoIncrementMultiplier-error"
          message={state.fieldErrors?.autoIncrementMultiplier}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-buffer-before">{t("bufferBefore")}</Label>
          <Input
            id="product-buffer-before"
            name="bufferBeforeDays"
            required
            type="number"
            min={0}
            step={1}
            defaultValue={defaults.bufferBeforeDays}
            aria-invalid={state.fieldErrors?.bufferBeforeDays ? true : undefined}
            aria-describedby={errorId("bufferBeforeDays")}
          />
          <FieldError
            id="product-bufferBeforeDays-error"
            message={state.fieldErrors?.bufferBeforeDays}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-buffer-after">{t("bufferAfter")}</Label>
          <Input
            id="product-buffer-after"
            name="bufferAfterDays"
            required
            type="number"
            min={0}
            step={1}
            defaultValue={defaults.bufferAfterDays}
            aria-invalid={state.fieldErrors?.bufferAfterDays ? true : undefined}
            aria-describedby={errorId("bufferAfterDays")}
          />
          <FieldError
            id="product-bufferAfterDays-error"
            message={state.fieldErrors?.bufferAfterDays}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="product-active" name="active" defaultChecked={defaults.active} />
        <Label htmlFor="product-active">{t("active")}</Label>
      </div>

      {state.formError ? (
        <p role="alert" className="text-sm text-red-600">
          {state.formError}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-sm text-green-700">
          {t("saved")}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
