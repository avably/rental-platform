"use client";

import { Badge, Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { FormState } from "@/lib/form-state";
import { groszeToInputValue } from "@/lib/money-input";

const initialState: FormState = {};

type SettingsAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

function FormMessages({ state, successText }: { state: FormState; successText: string }) {
  if (state.formError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.formError}
      </p>
    );
  }
  if (state.fieldErrors) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {Object.values(state.fieldErrors)[0]}
      </p>
    );
  }
  if (state.success) {
    return <p className="text-sm text-status-positive-fg">{successText}</p>;
  }
  return null;
}

/**
 * Credentiale GlobKurier. Zapisane hasło NIGDY nie wraca do formularza —
 * strona pokazuje jedynie znacznik „skonfigurowane"; ponowny zapis wymaga
 * wpisania hasła od nowa.
 */
export function CredentialsForm({
  action,
  configured,
  defaults,
}: {
  action: SettingsAction;
  configured: boolean;
  defaults: { email: string; environment: string } | null;
}) {
  const t = useTranslations("orders.delivery.settings");
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded border p-3 text-sm">
      <div className="flex items-center gap-2">
        <p className="font-medium">{t("credentialsTitle")}</p>
        {configured ? <Badge variant="outline">{t("credentialsConfigured")}</Badge> : null}
      </div>
      <Label htmlFor="cred-email">{t("emailLabel")}</Label>
      <Input
        id="cred-email"
        name="email"
        type="email"
        defaultValue={defaults?.email ?? ""}
        disabled={pending}
      />
      <Label htmlFor="cred-password">{t("passwordLabel")}</Label>
      <Input id="cred-password" name="password" type="password" disabled={pending} />
      <Label htmlFor="cred-environment">{t("environmentLabel")}</Label>
      <select
        id="cred-environment"
        name="environment"
        defaultValue={defaults?.environment ?? "test"}
        disabled={pending}
        className="rounded border px-3 py-2"
      >
        <option value="test">{t("environmentTest")}</option>
        <option value="production">{t("environmentProduction")}</option>
      </select>
      <Button type="submit" disabled={pending}>
        {t("saveCta")}
      </Button>
      <FormMessages state={state} successText={t("savedOk")} />
    </form>
  );
}

export interface SenderDefaults {
  name: string;
  street: string;
  houseNumber: string;
  apartmentNumber: string;
  postCode: string;
  city: string;
  phone: string;
  email: string;
}

export function SenderForm({
  action,
  defaults,
}: {
  action: SettingsAction;
  defaults: SenderDefaults | null;
}) {
  const t = useTranslations("orders.delivery.settings");
  const [state, formAction, pending] = useActionState(action, initialState);

  const fields = [
    ["name", "senderName"],
    ["street", "senderStreet"],
    ["houseNumber", "senderHouseNumber"],
    ["apartmentNumber", "senderApartmentNumber"],
    ["postCode", "senderPostCode"],
    ["city", "senderCity"],
    ["phone", "senderPhone"],
    ["email", "senderEmail"],
  ] as const;

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded border p-3 text-sm">
      <p className="font-medium">{t("senderTitle")}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {fields.map(([name, label]) => (
          <div key={name} className="flex flex-col gap-1">
            <Label htmlFor={`sender-${name}`}>{t(label)}</Label>
            <Input
              id={`sender-${name}`}
              name={name}
              defaultValue={defaults?.[name] ?? ""}
              disabled={pending}
            />
          </div>
        ))}
      </div>
      <Button type="submit" disabled={pending}>
        {t("saveCta")}
      </Button>
      <FormMessages state={state} successText={t("savedOk")} />
    </form>
  );
}

export function ParcelForm({
  action,
  defaults,
}: {
  action: SettingsAction;
  defaults: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number } | null;
}) {
  const t = useTranslations("orders.delivery.settings");
  const [state, formAction, pending] = useActionState(action, initialState);

  const fields = [
    ["lengthCm", "parcelLength", defaults?.lengthCm],
    ["widthCm", "parcelWidth", defaults?.widthCm],
    ["heightCm", "parcelHeight", defaults?.heightCm],
    ["weightKg", "parcelWeight", defaults?.weightKg],
  ] as const;

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded border p-3 text-sm">
      <p className="font-medium">{t("parcelTitle")}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fields.map(([name, label, defaultValue]) => (
          <div key={name} className="flex flex-col gap-1">
            <Label htmlFor={`parcel-${name}`}>{t(label)}</Label>
            <Input
              id={`parcel-${name}`}
              name={name}
              type="number"
              step="0.1"
              min="0"
              defaultValue={defaultValue ?? ""}
              disabled={pending}
            />
          </div>
        ))}
      </div>
      <Button type="submit" disabled={pending}>
        {t("saveCta")}
      </Button>
      <FormMessages state={state} successText={t("savedOk")} />
    </form>
  );
}

export interface PricingDefaults {
  courier?: { priceGrosze: number; freeAboveGrosze?: number };
  parcel_locker?: { priceGrosze: number; freeAboveGrosze?: number };
  own_delivery?: { priceGrosze: number; freeAboveGrosze?: number };
}

export function PricingForm({
  action,
  defaults,
}: {
  action: SettingsAction;
  defaults: PricingDefaults | null;
}) {
  const t = useTranslations("orders.delivery.settings");
  const [state, formAction, pending] = useActionState(action, initialState);

  const methods = [
    ["courier", "methodCourier", "courierPrice", "courierFreeAbove"],
    ["parcel_locker", "methodParcelLocker", "parcelLockerPrice", "parcelLockerFreeAbove"],
    ["own_delivery", "methodOwnDelivery", "ownDeliveryPrice", "ownDeliveryFreeAbove"],
  ] as const;

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded border p-3 text-sm">
      <p className="font-medium">{t("pricingTitle")}</p>
      <p className="text-muted-foreground">{t("pricingIntro")}</p>
      {methods.map(([method, methodLabel, priceName, freeAboveName]) => {
        const entry = defaults?.[method];
        return (
          <div key={method} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
            <p className="font-medium">{t(methodLabel)}</p>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`pricing-${priceName}`}>{t("priceLabel")}</Label>
              <Input
                id={`pricing-${priceName}`}
                name={priceName}
                inputMode="decimal"
                placeholder="0,00"
                defaultValue={entry ? groszeToInputValue(entry.priceGrosze) : ""}
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`pricing-${freeAboveName}`}>{t("freeAboveLabel")}</Label>
              <Input
                id={`pricing-${freeAboveName}`}
                name={freeAboveName}
                inputMode="decimal"
                placeholder=""
                defaultValue={
                  entry?.freeAboveGrosze !== undefined
                    ? groszeToInputValue(entry.freeAboveGrosze)
                    : ""
                }
                disabled={pending}
              />
            </div>
          </div>
        );
      })}
      <Button type="submit" disabled={pending}>
        {t("saveCta")}
      </Button>
      <FormMessages state={state} successText={t("savedOk")} />
    </form>
  );
}
