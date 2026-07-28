"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, type ReactNode } from "react";

import type { FormState } from "@/lib/form-state";

/**
 * Formularz edycji klienta z karty (R6a).
 *
 * Jedna karta, trzy grupy: dane kontaktowe (e-mail, imię i nazwisko, telefon),
 * dane do faktury (firma, NIP) i adres (ulica, kod, miasto) — dokładnie zakres
 * z uwagi właściciela. Zapis idzie przez Server Action pod RLS tenanta;
 * walidacja Zod (customer-validation.ts) lustrzy checkout, więc panel nie jest
 * surowszy niż formularz, z którego dane pochodzą.
 *
 * Stany ładowania wg konwencji R2: `loading={pending} disabled={pending}` na
 * przycisku zapisu.
 */
const initialState: FormState = {};

export interface CustomerEditValues {
  email: string;
  fullName: string;
  phone: string;
  companyName: string;
  nip: string;
  addressStreet: string;
  addressZip: string;
  addressCity: string;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-[13px] leading-[18px] font-medium">
      {message}
    </p>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
      {children}
    </h2>
  );
}

export function CustomerEditForm({
  action,
  defaults,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  defaults: CustomerEditValues;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("customers.card");

  const errorId = (field: string) =>
    state.fieldErrors?.[field] ? `customer-${field}-error` : undefined;

  const field = (
    name: keyof CustomerEditValues,
    label: string,
    options?: { type?: string; required?: boolean; maxLength?: number; hint?: string; inputMode?: "email" | "tel" | "text" },
  ) => (
    <div data-customer-edit-field={name} className="flex flex-col gap-1.5">
      <Label htmlFor={`customer-${name}`}>{label}</Label>
      <Input
        id={`customer-${name}`}
        name={name}
        type={options?.type ?? "text"}
        inputMode={options?.inputMode}
        required={options?.required}
        maxLength={options?.maxLength}
        defaultValue={defaults[name]}
        aria-invalid={state.fieldErrors?.[name] ? true : undefined}
        aria-describedby={errorId(name)}
      />
      {options?.hint ? <p className="text-muted-foreground text-[13px] leading-[18px]">{options.hint}</p> : null}
      <FieldError id={`customer-${name}-error`} message={state.fieldErrors?.[name]} />
    </div>
  );

  return (
    <form
      action={formAction}
      data-customer-edit-form
      data-form-line-measure
      className="border-border bg-card flex flex-col gap-6 rounded-md border p-5"
    >
      {/* Dane kontaktowe */}
      <div className="flex flex-col gap-4">
        <Eyebrow>{t("contactHeading")}</Eyebrow>
        {field("email", t("email"), { type: "email", required: true, maxLength: 320, inputMode: "email", hint: t("emailHint") })}
        {field("fullName", t("fullName"), { maxLength: 200 })}
        {field("phone", t("phone"), { type: "tel", maxLength: 32, inputMode: "tel" })}
      </div>

      {/* Dane do faktury */}
      <div className="flex flex-col gap-4">
        <Eyebrow>{t("invoiceHeading")}</Eyebrow>
        {field("companyName", t("companyName"), { maxLength: 200 })}
        {field("nip", t("nip"), { maxLength: 32, inputMode: "text" })}
      </div>

      {/* Adres */}
      <div className="flex flex-col gap-4">
        <Eyebrow>{t("addressHeading")}</Eyebrow>
        {field("addressStreet", t("addressStreet"), { maxLength: 200 })}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("addressZip", t("addressZip"), { maxLength: 20 })}
          {field("addressCity", t("addressCity"), { maxLength: 120 })}
        </div>
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
        <Button type="submit" data-customer-save loading={pending} disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
