"use client";

import { Button, Checkbox, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

export interface LocationFormValues {
  name: string;
  addressStreet: string;
  addressZip: string;
  addressCity: string;
  active: boolean;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-[13px] leading-[18px] font-medium">
      {message}
    </p>
  );
}

export function LocationForm({
  action,
  defaults,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  defaults: LocationFormValues;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("catalog.locations");

  const errorId = (field: string) =>
    state.fieldErrors?.[field] ? `location-${field}-error` : undefined;

  return (
    <form action={formAction} data-form-line-measure className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="location-name">{t("name")}</Label>
        <Input
          id="location-name"
          name="name"
          required
          maxLength={200}
          defaultValue={defaults.name}
          aria-invalid={state.fieldErrors?.name ? true : undefined}
          aria-describedby={errorId("name")}
        />
        <FieldError id="location-name-error" message={state.fieldErrors?.name} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="location-street">{t("street")}</Label>
        <Input
          id="location-street"
          name="addressStreet"
          maxLength={300}
          defaultValue={defaults.addressStreet}
          aria-invalid={state.fieldErrors?.addressStreet ? true : undefined}
          aria-describedby={errorId("addressStreet")}
        />
        <FieldError id="location-addressStreet-error" message={state.fieldErrors?.addressStreet} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location-zip">{t("zip")}</Label>
          <Input
            id="location-zip"
            name="addressZip"
            maxLength={20}
            defaultValue={defaults.addressZip}
            aria-invalid={state.fieldErrors?.addressZip ? true : undefined}
            aria-describedby={errorId("addressZip")}
          />
          <FieldError id="location-addressZip-error" message={state.fieldErrors?.addressZip} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location-city">{t("city")}</Label>
          <Input
            id="location-city"
            name="addressCity"
            maxLength={120}
            defaultValue={defaults.addressCity}
            aria-invalid={state.fieldErrors?.addressCity ? true : undefined}
            aria-describedby={errorId("addressCity")}
          />
          <FieldError id="location-addressCity-error" message={state.fieldErrors?.addressCity} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="location-active" name="active" defaultChecked={defaults.active} />
        <Label htmlFor="location-active">{t("active")}</Label>
      </div>

      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-status-positive-fg text-sm">
          {t("saved")}
        </p>
      ) : null}

      <div>
        <Button type="submit" loading={pending} disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
