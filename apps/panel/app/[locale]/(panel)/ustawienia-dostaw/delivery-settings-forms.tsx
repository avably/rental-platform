"use client";

/**
 * Formularze ustawień dostaw (Zadanie 7, ADR-030/031; układ P8 wg artefaktu
 * Fazy 2, sekcja `secondary-delivery`).
 *
 * Dwadzieścia jeden pól w CZTERECH kartach, każda z własnym przyciskiem
 * i własną akcją serwerową — ten podział istniał od początku i mockup go
 * potwierdza. Jeden zbiorczy „Zapisz" na dole ekranu wymuszałby komplet
 * poprawnych credentiali po to, żeby poprawić literówkę w kodzie pocztowym.
 *
 * Zapis należy WYŁĄCZNIE do właściciela (RLS 0024). Ostateczną bramką zostaje
 * baza — tu wyłącznie nie udajemy, że członek zespołu ma co kliknąć.
 */
import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import { ScreenSection } from "@/components/screens/screen-header";
import type { FormState } from "@/lib/form-state";
import { groszeToInputValue } from "@/lib/money-input";
import { SecondaryStatusChip } from "@/lib/secondary-status";

const initialState: FormState = {};

type SettingsAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

function FormMessages({ state, successText }: { state: FormState; successText: string }) {
  if (state.formError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {state.formError}
      </p>
    );
  }
  if (state.fieldErrors) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {Object.values(state.fieldErrors)[0]}
      </p>
    );
  }
  if (state.success) {
    return <span className="text-status-positive-fg text-sm">{successText}</span>;
  }
  return null;
}

/** Stopka karty: zapis + komunikat, jeden rytm dla wszystkich czterech kart. */
function SaveRow({
  canWrite,
  pending,
  state,
  label,
  successText,
}: {
  canWrite: boolean;
  pending: boolean;
  state: FormState;
  label: string;
  successText: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      {canWrite ? (
        <Button type="submit" disabled={pending}>
          {label}
        </Button>
      ) : null}
      <FormMessages state={state} successText={successText} />
    </div>
  );
}

/**
 * Credentiale dostawcy. Zapisane hasło NIGDY nie wraca do formularza —
 * karta pokazuje wyłącznie STAN sekretu (oś `delivery-secret`); ponowny zapis
 * wymaga wpisania hasła od nowa (ADR-052, pole tylko do zapisu).
 */
export function CredentialsForm({
  action,
  configured,
  canWrite,
  defaults,
}: {
  action: SettingsAction;
  configured: boolean;
  canWrite: boolean;
  defaults: { email: string; environment: string } | null;
}) {
  const t = useTranslations("orders.delivery.settings");
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <ScreenSection
      data-settings-form="credentials"
      title={t("credentialsTitle")}
      status={
        <SecondaryStatusChip
          axis="delivery-secret"
          value={configured ? "configured" : "missing"}
        />
      }
      description={t("secretWriteOnly")}
    >
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <Label htmlFor="cred-email">{t("emailLabel")}</Label>
        <Input
          id="cred-email"
          name="email"
          type="email"
          defaultValue={defaults?.email ?? ""}
          disabled={pending || !canWrite}
        />
        {canWrite ? (
          <>
            <Label htmlFor="cred-password">{t("passwordLabel")}</Label>
            <Input id="cred-password" name="password" type="password" disabled={pending} />
          </>
        ) : null}
        <Label htmlFor="cred-environment">{t("environmentLabel")}</Label>
        <PanelSelect
          id="cred-environment"
          name="environment"
          defaultValue={defaults?.environment ?? "test"}
          disabled={pending || !canWrite}
          options={[
            { value: "test", label: t("environmentTest") },
            { value: "production", label: t("environmentProduction") },
          ]}
        />
        <SaveRow
          canWrite={canWrite}
          pending={pending}
          state={state}
          label={t("saveCredentialsCta")}
          successText={t("savedOk")}
        />
      </form>
    </ScreenSection>
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
  canWrite,
  defaults,
}: {
  action: SettingsAction;
  canWrite: boolean;
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
    <ScreenSection data-settings-form="sender" title={t("senderTitle")}>
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(([name, label]) => (
            <div key={name} className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={`sender-${name}`}>{t(label)}</Label>
              <Input
                id={`sender-${name}`}
                name={name}
                defaultValue={defaults?.[name] ?? ""}
                disabled={pending || !canWrite}
              />
            </div>
          ))}
        </div>
        <SaveRow
          canWrite={canWrite}
          pending={pending}
          state={state}
          label={t("saveSenderCta")}
          successText={t("savedOk")}
        />
      </form>
    </ScreenSection>
  );
}

export function ParcelForm({
  action,
  canWrite,
  defaults,
}: {
  action: SettingsAction;
  canWrite: boolean;
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
    <ScreenSection data-settings-form="parcel" title={t("parcelTitle")}>
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(([name, label, defaultValue]) => (
            <div key={name} className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={`parcel-${name}`}>{t(label)}</Label>
              <Input
                id={`parcel-${name}`}
                name={name}
                type="number"
                step="0.1"
                min="0"
                className="tabular-nums"
                defaultValue={defaultValue ?? ""}
                disabled={pending || !canWrite}
              />
            </div>
          ))}
        </div>
        <SaveRow
          canWrite={canWrite}
          pending={pending}
          state={state}
          label={t("saveParcelCta")}
          successText={t("savedOk")}
        />
      </form>
    </ScreenSection>
  );
}

export interface PricingDefaults {
  courier?: { priceGrosze: number; freeAboveGrosze?: number };
  parcel_locker?: { priceGrosze: number; freeAboveGrosze?: number };
  own_delivery?: { priceGrosze: number; freeAboveGrosze?: number };
}

export function PricingForm({
  action,
  canWrite,
  defaults,
}: {
  action: SettingsAction;
  canWrite: boolean;
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
    <ScreenSection
      data-settings-form="pricing"
      title={t("pricingTitle")}
      description={t("pricingIntro")}
    >
      <form action={formAction} className="flex flex-col gap-4 text-sm">
        {methods.map(([method, methodLabel, priceName, freeAboveName]) => {
          const entry = defaults?.[method];
          return (
            <div key={method} className="flex flex-col gap-2" data-pricing-method={method}>
              <p className="font-medium">{t(methodLabel)}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <Label htmlFor={`pricing-${priceName}`}>{t("priceLabel")}</Label>
                  <Input
                    id={`pricing-${priceName}`}
                    name={priceName}
                    inputMode="decimal"
                    placeholder="0,00"
                    className="tabular-nums"
                    defaultValue={entry ? groszeToInputValue(entry.priceGrosze) : ""}
                    disabled={pending || !canWrite}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <Label htmlFor={`pricing-${freeAboveName}`}>{t("freeAboveLabel")}</Label>
                  <Input
                    id={`pricing-${freeAboveName}`}
                    name={freeAboveName}
                    inputMode="decimal"
                    className="tabular-nums"
                    defaultValue={
                      entry?.freeAboveGrosze !== undefined
                        ? groszeToInputValue(entry.freeAboveGrosze)
                        : ""
                    }
                    disabled={pending || !canWrite}
                  />
                </div>
              </div>
            </div>
          );
        })}
        <SaveRow
          canWrite={canWrite}
          pending={pending}
          state={state}
          label={t("savePricingCta")}
          successText={t("savedOk")}
        />
      </form>
    </ScreenSection>
  );
}
