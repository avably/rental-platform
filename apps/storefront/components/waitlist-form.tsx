"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

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

import type { MarketingCopy } from "./marketing/types";
import { TurnstileWidget } from "./turnstile-widget";

interface WaitlistFormProps {
  copy: MarketingCopy["form"];
  enabled: boolean;
  locale: "en" | "pl";
  /** Site key Turnstile; brak = widget i weryfikacja jawnie wyłączone (dev). */
  turnstileSiteKey?: string | undefined;
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

function fieldErrorMessage(
  copy: MarketingCopy["form"],
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
    <div className="text-small form-field-error" id={id}>
      {message}
    </div>
  );
}

/**
 * Formularz listy oczekujących w warstwie wizualnej przeniesionego szablonu
 * (ADR-068): klasy `.text-field`, `.cta-main`, `.label` pochodzą z jego
 * arkusza, logika i kontrakt danych zostają nasze. Identyfikatory pól oraz
 * `aria-describedby` są częścią kontraktu testów dostępności.
 */
export function WaitlistForm({ copy, enabled, locale, turnstileSiteKey }: WaitlistFormProps) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [view, setView] = useState<WaitlistViewState>(
    enabled ? { kind: "idle" } : { kind: "disabled" },
  );
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // Remount widgetu (key) po nieudanym submicie: token siteverify jest
  // jednorazowy, więc kolejna próba wymaga świeżego wyzwania.
  const [captchaEpoch, setCaptchaEpoch] = useState(0);
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
      captchaToken: captchaToken ?? undefined,
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
      // Token siteverify jest jednorazowy: każdy submit, który nie skończył
      // się sukcesem, zostawia zużyty token — wymuś świeże wyzwanie.
      if (turnstileSiteKey && mapped.kind !== "success" && mapped.kind !== "validation") {
        setCaptchaToken(null);
        setCaptchaEpoch((epoch) => epoch + 1);
      }
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
      if (mapped.kind === "captcha_error") {
        captureLandingEvent("waitlist_submit_error", { language: locale, error_type: "captcha" });
      }
    } catch {
      setView({ kind: "connection_error" });
      captureLandingEvent("waitlist_submit_error", { language: locale, error_type: "connection" });
    }
  }

  if (view.kind === "success") {
    return (
      <div className="form-result" ref={resultRef} role="status" tabIndex={-1}>
        <div className="text-h6">{copy.success.title}</div>
        <p className="text-dark-64">
          {copy.success.bodyBeforeEmail} <strong>{submittedEmail}</strong>
          {copy.success.bodyAfterEmail}
        </p>
        {submittedPilot ? <p className="text-dark-64">{copy.success.pilot}</p> : null}
        <button
          className="cta-main dark-outlined w-button"
          onClick={() => setView({ kind: "idle" })}
          type="button"
        >
          {copy.success.edit}
        </button>
      </div>
    );
  }

  return (
    <form
      className="waitlist-form"
      noValidate
      onFocusCapture={() => {
        if (startedRef.current || !enabled) return;
        startedRef.current = true;
        captureLandingEvent("waitlist_form_start", { language: locale });
      }}
      onSubmit={handleSubmit}
    >
      <div
        className={isWaitlistResultVisible(view.kind) ? "form-result" : "form-result-hidden"}
        ref={resultRef}
        role={
          view.kind === "server_error" ||
          view.kind === "connection_error" ||
          view.kind === "captcha_error" ||
          view.kind === "duplicate" ||
          view.kind === "validation"
            ? "alert"
            : "status"
        }
        tabIndex={-1}
      >
        {view.kind === "disabled" ? (
          <>
            <div className="text-h6">{copy.disabled.title}</div>
            <p className="text-dark-64">{copy.disabled.body}</p>
          </>
        ) : null}
        {messageKey === "duplicate" ? copy.errors.duplicate : null}
        {messageKey === "connection" ? copy.errors.connection : null}
        {messageKey === "captcha" ? copy.errors.captcha : null}
        {messageKey === "server" ? copy.errors.server : null}
        {messageKey === "validation" ? copy.errors.required : null}
      </div>

      <fieldset className="waitlist-fieldset" disabled={unavailable}>
        <div className="form-field">
          <label className="label" htmlFor="waitlist-email">
            {copy.emailLabel}
          </label>
          <input
            aria-describedby="waitlist-email-help waitlist-email-error"
            aria-invalid={Boolean(fields.email)}
            autoComplete="email"
            className="text-field w-input"
            id="waitlist-email"
            maxLength={320}
            name="email"
            onChange={(event) => update("email", event.target.value)}
            placeholder={copy.emailPlaceholder}
            type="email"
            value={values.email}
          />
          <div className="text-small text-dark-64" id="waitlist-email-help">
            {copy.emailHelp}
          </div>
          <FieldError id="waitlist-email-error" message={fieldErrorMessage(copy, "email", fields.email)} />
        </div>

        <div className="form-field">
          <label className="label" htmlFor="waitlist-rental-type">
            {copy.rentalTypeLabel}
          </label>
          <select
            aria-describedby="waitlist-rental-type-error"
            aria-invalid={Boolean(fields.rentalType)}
            className="text-field w-select"
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
          <div className="form-field">
            <label className="label" htmlFor="waitlist-other-equipment">
              {copy.otherEquipmentLabel}
            </label>
            <input
              aria-describedby="waitlist-other-equipment-error"
              aria-invalid={Boolean(fields.otherEquipment)}
              className="text-field w-input"
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

        <div className="form-field">
          <label className="label" htmlFor="waitlist-inventory">
            {copy.inventoryLabel}
          </label>
          <select
            aria-describedby="waitlist-inventory-error"
            aria-invalid={Boolean(fields.inventoryRange)}
            className="text-field w-select"
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

        <div className="form-field">
          <label className="label" htmlFor="waitlist-process">
            {copy.processLabel}
          </label>
          <select
            aria-describedby="waitlist-process-error"
            aria-invalid={Boolean(fields.currentProcess)}
            className="text-field w-select"
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

        <div className="form-field form-field-block">
          <div className="label">{copy.pilotHeading}</div>
          <label className="w-checkbox checkbox-field" htmlFor="waitlist-pilot">
            <input
              checked={values.pilotInterest}
              className="w-checkbox-input"
              id="waitlist-pilot"
              name="pilotInterest"
              onChange={(event) => {
                const selected = event.target.checked;
                update("pilotInterest", selected);
                captureLandingEvent(selected ? "pilot_interest_selected" : "pilot_interest_cleared", {
                  language: locale,
                });
              }}
              type="checkbox"
            />
            <span className="text-small">{copy.pilotLabel}</span>
          </label>
          {values.pilotInterest ? (
            <div className="form-field">
              <label className="label" htmlFor="waitlist-phone">
                {copy.phoneLabel}
              </label>
              <input
                aria-describedby="waitlist-phone-help waitlist-phone-error"
                aria-invalid={Boolean(fields.phone)}
                autoComplete="tel"
                className="text-field w-input"
                id="waitlist-phone"
                maxLength={32}
                name="phone"
                onChange={(event) => update("phone", event.target.value)}
                placeholder={copy.phonePlaceholder}
                type="tel"
                value={values.phone}
              />
              <div className="text-small text-dark-64" id="waitlist-phone-help">
                {copy.phoneHelp}
              </div>
              <FieldError id="waitlist-phone-error" message={fieldErrorMessage(copy, "phone", fields.phone)} />
            </div>
          ) : null}
        </div>

        <div className="form-field form-field-block">
          <label className="w-checkbox checkbox-field" htmlFor="waitlist-consent">
            <input
              aria-describedby="waitlist-consent-help waitlist-consent-error"
              aria-invalid={Boolean(fields.consent)}
              checked={values.consent}
              className="w-checkbox-input"
              id="waitlist-consent"
              name="consent"
              onChange={(event) => update("consent", event.target.checked)}
              type="checkbox"
            />
            <span className="text-small">{copy.consentLabel}</span>
          </label>
          <p className="text-small text-dark-64" id="waitlist-consent-help">
            {copy.privacyLeadIn}{" "}
            <a className="text-underline" href={`/${locale}/privacy`}>
              {copy.privacyLabel}
            </a>
            {copy.privacyAfter}
          </p>
          <FieldError id="waitlist-consent-error" message={fieldErrorMessage(copy, "consent", fields.consent)} />
        </div>

        {turnstileSiteKey ? (
          <TurnstileWidget
            key={captchaEpoch}
            locale={locale}
            onToken={setCaptchaToken}
            siteKey={turnstileSiteKey}
          />
        ) : null}

        <button className="cta-main accent w-button" disabled={unavailable} type="submit">
          {view.kind === "submitting" ? copy.submitting : copy.cta}
        </button>
      </fieldset>
      <p className="text-small text-dark-64">{copy.microcopy}</p>
    </form>
  );
}
