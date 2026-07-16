"use client";

import { Button, Checkbox, Input, Label } from "@avably/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Link } from "@/i18n/navigation";
import { joinWaitlist } from "@/lib/actions/waitlist";
import { captureLandingEvent } from "@/lib/analytics";
import {
  getWaitlistMessageKey,
  isWaitlistResultVisible,
  mapWaitlistResult,
  submitWaitlistInput,
  type WaitlistViewState,
} from "@/lib/waitlist-form-ui";
import type {
  CurrentProcess,
  InventoryRange,
  RentalType,
  WaitlistField,
  WaitlistFieldError,
  WaitlistFieldErrors,
  WaitlistInput,
} from "@/lib/waitlist/contract";

import type { LandingCopy } from "./landing-page";

interface WaitlistFormProps {
  copy: LandingCopy["form"];
  enabled: boolean;
  locale: "en" | "pl";
}

interface FormValues {
  consent: boolean;
  currentProcess: "" | CurrentProcess;
  email: string;
  inventoryRange: "" | InventoryRange;
  otherEquipment: string;
  phone: string;
  pilotInterest: boolean;
  rentalType: "" | RentalType;
}

const initialValues: FormValues = {
  consent: false,
  currentProcess: "",
  email: "",
  inventoryRange: "",
  otherEquipment: "",
  phone: "",
  pilotInterest: false,
  rentalType: "",
};

const selectClassName =
  "border-input dark:bg-input/30 h-10 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

function fieldErrorMessage(
  copy: LandingCopy["form"],
  field: WaitlistField,
  error: WaitlistFieldError | undefined,
): string | undefined {
  if (!error) return undefined;
  if (field === "consent") return copy.errors.consent;
  if (field === "email" && error !== "required") return copy.errors.invalidEmail;
  if (field === "rentalType" || field === "inventoryRange" || field === "currentProcess") {
    return copy.errors.selection;
  }
  return copy.errors.required;
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return (
    <p className="min-h-5 text-sm text-destructive" id={id}>
      {message}
    </p>
  );
}

export function WaitlistForm({ copy, enabled, locale }: WaitlistFormProps) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [view, setView] = useState<WaitlistViewState>(
    enabled ? { kind: "idle" } : { kind: "disabled" },
  );
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [submittedPilot, setSubmittedPilot] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const resultFocusArmedRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!resultFocusArmedRef.current || !isWaitlistResultVisible(view.kind)) return;
    resultFocusArmedRef.current = false;
    resultRef.current?.focus();
  }, [view]);

  const fields: WaitlistFieldErrors = view.kind === "validation" ? view.fields : {};
  const messageKey = getWaitlistMessageKey(view);
  const unavailable = !enabled || view.kind === "submitting";

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (view.kind === "validation") {
      const next = { ...view.fields };
      delete next[key as WaitlistField];
      setView(Object.keys(next).length > 0 ? { kind: "validation", fields: next } : { kind: "idle" });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resultFocusArmedRef.current = true;
    if (!enabled) {
      setView({ kind: "disabled" });
      return;
    }

    const search = new URLSearchParams(window.location.search);
    const input: WaitlistInput = {
      email: values.email,
      rentalType: values.rentalType as RentalType,
      inventoryRange: values.inventoryRange as InventoryRange,
      currentProcess: values.currentProcess as CurrentProcess,
      consent: values.consent,
      otherEquipment: values.rentalType === "other" ? values.otherEquipment : undefined,
      pilotInterest: values.pilotInterest,
      phone: values.pilotInterest && values.phone ? values.phone : undefined,
      locale,
      source: search.get("utm_source") ?? undefined,
      campaign: search.get("utm_campaign") ?? undefined,
    };

    captureLandingEvent("waitlist_submit_attempt", {
      language: locale,
      pilot_selected: values.pilotInterest,
    });
    setView({ kind: "submitting" });
    try {
      const result = await submitWaitlistInput(input, joinWaitlist);
      const mapped = mapWaitlistResult(result);
      setView(mapped);
      if (mapped.kind === "validation") {
        for (const [field, errorType] of Object.entries(mapped.fields)) {
          if (!errorType) continue;
          captureLandingEvent("waitlist_validation_error", {
            language: locale,
            field: field as WaitlistField,
            error_type: errorType,
          });
        }
      }
      if (mapped.kind === "success") {
        setSubmittedEmail(values.email);
        setSubmittedPilot(values.pilotInterest);
        captureLandingEvent("waitlist_signup_success", {
          language: locale,
          rental_type: input.rentalType,
          inventory_range: input.inventoryRange,
          current_process: input.currentProcess,
          pilot_selected: values.pilotInterest,
        });
        if (values.pilotInterest) {
          captureLandingEvent("pilot_declaration_success", {
            language: locale,
            rental_type: input.rentalType,
            inventory_range: input.inventoryRange,
            current_process: input.currentProcess,
          });
        }
      }
      if (mapped.kind === "duplicate") {
        captureLandingEvent("waitlist_duplicate", { language: locale });
      }
      if (mapped.kind === "server_error") {
        captureLandingEvent("waitlist_submit_error", { language: locale, error_type: "server" });
      }
    } catch {
      setView({ kind: "connection_error" });
      captureLandingEvent("waitlist_submit_error", { language: locale, error_type: "connection" });
    }
  }

  if (view.kind === "success") {
    return (
      <div
        className="mt-8 rounded-lg border border-border bg-card p-6 shadow-sm"
        ref={resultRef}
        role="status"
        tabIndex={-1}
      >
        <h3 className="text-xl font-semibold">{copy.success.title}</h3>
        <p className="mt-3 leading-7 text-muted-foreground">
          {copy.success.bodyBeforeEmail} <strong className="text-foreground">{submittedEmail}</strong>
          {copy.success.bodyAfterEmail}
        </p>
        {submittedPilot ? <p className="mt-3 leading-7 text-muted-foreground">{copy.success.pilot}</p> : null}
        <Button
          className="landing-pill landing-ghost-pill mt-6 px-6"
          onClick={() => setView({ kind: "idle" })}
          type="button"
          variant="outline"
        >
          {copy.success.edit}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="mt-8 grid gap-6"
      noValidate
      onFocusCapture={() => {
        if (startedRef.current || !enabled) return;
        startedRef.current = true;
        captureLandingEvent("waitlist_form_start", { language: locale });
      }}
      onSubmit={handleSubmit}
    >
      <div
        className={
          isWaitlistResultVisible(view.kind)
            ? "rounded-lg border border-border bg-muted p-5"
            : "sr-only"
        }
        ref={resultRef}
        role={
          view.kind === "server_error" ||
          view.kind === "connection_error" ||
          view.kind === "duplicate" ||
          view.kind === "validation"
            ? "alert"
            : "status"
        }
        tabIndex={-1}
      >
        {view.kind === "disabled" ? (
          <>
            <h3 className="font-semibold">{copy.disabled.title}</h3>
            <p className="mt-2 leading-7 text-muted-foreground">{copy.disabled.body}</p>
          </>
        ) : null}
        {messageKey === "duplicate" ? copy.errors.duplicate : null}
        {messageKey === "connection" ? copy.errors.connection : null}
        {messageKey === "server" ? copy.errors.server : null}
        {messageKey === "validation" ? copy.errors.required : null}
      </div>

      <fieldset className="grid gap-6" disabled={unavailable}>
        <div className="grid gap-2">
          <Label htmlFor="waitlist-email">{copy.emailLabel}</Label>
          <Input
            aria-describedby="waitlist-email-help waitlist-email-error"
            aria-invalid={Boolean(fields.email)}
            autoComplete="email"
            id="waitlist-email"
            maxLength={320}
            name="email"
            onChange={(event) => update("email", event.target.value)}
            placeholder={copy.emailPlaceholder}
            type="email"
            value={values.email}
          />
          <p className="text-sm text-muted-foreground" id="waitlist-email-help">
            {copy.emailHelp}
          </p>
          <FieldError id="waitlist-email-error" message={fieldErrorMessage(copy, "email", fields.email)} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="waitlist-rental-type">{copy.rentalTypeLabel}</Label>
          <select
            aria-describedby="waitlist-rental-type-error"
            aria-invalid={Boolean(fields.rentalType)}
            className={selectClassName}
            id="waitlist-rental-type"
            name="rentalType"
            onChange={(event) => update("rentalType", event.target.value as FormValues["rentalType"])}
            value={values.rentalType}
          >
            <option value="">{copy.selectPlaceholder}</option>
            {Object.entries(copy.rentalTypes).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <FieldError
            id="waitlist-rental-type-error"
            message={fieldErrorMessage(copy, "rentalType", fields.rentalType)}
          />
        </div>

        {values.rentalType === "other" ? (
          <div className="grid gap-2">
            <Label htmlFor="waitlist-other-equipment">{copy.otherEquipmentLabel}</Label>
            <Input
              aria-describedby="waitlist-other-equipment-error"
              aria-invalid={Boolean(fields.otherEquipment)}
              id="waitlist-other-equipment"
              maxLength={500}
              name="otherEquipment"
              onChange={(event) => update("otherEquipment", event.target.value)}
              placeholder={copy.otherEquipmentPlaceholder}
              value={values.otherEquipment}
            />
            <FieldError
              id="waitlist-other-equipment-error"
              message={fieldErrorMessage(copy, "otherEquipment", fields.otherEquipment)}
            />
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="waitlist-inventory">{copy.inventoryLabel}</Label>
          <select
            aria-describedby="waitlist-inventory-error"
            aria-invalid={Boolean(fields.inventoryRange)}
            className={selectClassName}
            id="waitlist-inventory"
            name="inventoryRange"
            onChange={(event) => update("inventoryRange", event.target.value as FormValues["inventoryRange"])}
            value={values.inventoryRange}
          >
            <option value="">{copy.selectPlaceholder}</option>
            {Object.entries(copy.inventoryRanges).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <FieldError
            id="waitlist-inventory-error"
            message={fieldErrorMessage(copy, "inventoryRange", fields.inventoryRange)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="waitlist-process">{copy.processLabel}</Label>
          <select
            aria-describedby="waitlist-process-error"
            aria-invalid={Boolean(fields.currentProcess)}
            className={selectClassName}
            id="waitlist-process"
            name="currentProcess"
            onChange={(event) => update("currentProcess", event.target.value as FormValues["currentProcess"])}
            value={values.currentProcess}
          >
            <option value="">{copy.selectPlaceholder}</option>
            {Object.entries(copy.currentProcesses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <FieldError
            id="waitlist-process-error"
            message={fieldErrorMessage(copy, "currentProcess", fields.currentProcess)}
          />
        </div>

        <div className="border-y border-border py-5">
          <p className="font-semibold">{copy.pilotHeading}</p>
          <div className="mt-4 flex items-start gap-3">
            <Checkbox
              checked={values.pilotInterest}
              id="waitlist-pilot"
              name="pilotInterest"
              onCheckedChange={(checked) => {
                const selected = checked === true;
                update("pilotInterest", selected);
                captureLandingEvent(selected ? "pilot_interest_selected" : "pilot_interest_cleared", {
                  language: locale,
                });
              }}
            />
            <Label className="leading-6 font-normal" htmlFor="waitlist-pilot">
              {copy.pilotLabel}
            </Label>
          </div>
          {values.pilotInterest ? (
            <div className="mt-5 grid gap-2">
              <Label htmlFor="waitlist-phone">{copy.phoneLabel}</Label>
              <Input
                aria-describedby="waitlist-phone-help waitlist-phone-error"
                aria-invalid={Boolean(fields.phone)}
                autoComplete="tel"
                id="waitlist-phone"
                maxLength={32}
                name="phone"
                onChange={(event) => update("phone", event.target.value)}
                placeholder={copy.phonePlaceholder}
                type="tel"
                value={values.phone}
              />
              <p className="text-sm text-muted-foreground" id="waitlist-phone-help">
                {copy.phoneHelp}
              </p>
              <FieldError id="waitlist-phone-error" message={fieldErrorMessage(copy, "phone", fields.phone)} />
            </div>
          ) : null}
        </div>

        <div>
          <div className="flex items-start gap-3">
            <Checkbox
              aria-describedby="waitlist-consent-error"
              aria-invalid={Boolean(fields.consent)}
              checked={values.consent}
              id="waitlist-consent"
              name="consent"
              onCheckedChange={(checked) => update("consent", checked === true)}
            />
            <div className="text-sm leading-6">
              <Label className="inline leading-6 font-normal" htmlFor="waitlist-consent">
                {copy.consentBefore}
              </Label>{" "}
              <Link className="font-medium underline underline-offset-4" href="/privacy">
                {copy.privacyLabel}
              </Link>
              {copy.consentAfter}
            </div>
          </div>
          <FieldError id="waitlist-consent-error" message={fieldErrorMessage(copy, "consent", fields.consent)} />
        </div>

        <Button className="landing-pill min-h-12 w-full" disabled={unavailable} size="lg" type="submit">
          {view.kind === "submitting" ? copy.submitting : copy.cta}
        </Button>
      </fieldset>
      <p className="text-sm leading-6 text-muted-foreground">{copy.microcopy}</p>
    </form>
  );
}
