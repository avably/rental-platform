"use client";

import { isValidNipChecksum } from "@avably/core";
import { Button, Input, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";

import { ScreenSection } from "@/components/screens/screen-header";
import type { ContractDocumentSettings } from "@/lib/contract-settings";
import type { FormState } from "@/lib/form-state";
import { lookupCompanyByNipAction } from "@/lib/registry/lookup-action";

import { saveContractSettingsAction } from "./actions";

function Feedback({ state }: { state: FormState }) {
  const t = useTranslations("contractSettings");
  const message = state.formError ?? Object.values(state.fieldErrors ?? {})[0];
  if (message)
    return (
      <p role="alert" className="text-destructive text-sm">
        {message}
      </p>
    );
  return state.success ? (
    <span className="text-status-positive-fg text-sm">{t("saved")}</span>
  ) : null;
}

/**
 * Zdanie pod polem: CO ta wartość robi i gdzie ją widać (U10, ADR-151).
 *
 * Audyt UX (6.3) zmierzył na tym ekranie pola bez instrukcji — „Wersja
 * warunków" jako wolne pole tekstowe bez przykładu, „Treść warunków" bez
 * informacji, czym jest i kto to zobaczy. Podpowiedź jest związana z polem
 * przez `aria-describedby`, a nie tylko postawiona obok: czytnik ekranu ma
 * przeczytać ją razem z etykietą, bo inaczej instrukcja istnieje wyłącznie
 * dla osób widzących.
 */
function FieldHint({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-muted-foreground text-[13px] leading-[18px]">
      {children}
    </p>
  );
}

/** Dzisiejsza data w zapisie `RRRR-MM-DD` — sensowna propozycja wersji. */
function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Formularz ustawień umów w widoku właściciela (mockup P8:
 * `data-contract-mode="owner"`). Treść regulaminu dostaje pole o wysokości
 * długiego tekstu — to jedyne pole na tym ekranie, które ktoś naprawdę czyta
 * w całości przed zapisem.
 *
 * Wersja warunków jest polem STEROWANYM, żeby przycisk mógł WPISAĆ propozycję
 * (dzisiejszą datę) zamiast ją narzucić: wartość zostaje edytowalna, a najemca
 * z własnym schematem („1.2", „2026/Q3") nic nie traci. Data liczona jest
 * dopiero w obsłudze kliknięcia — policzona w trakcie renderu rozjechałaby się
 * między serwerem a przeglądarką na granicy doby i wywróciła hydrację.
 */
export function ContractSettingsForm({ defaults }: { defaults: ContractDocumentSettings | null }) {
  const t = useTranslations("contractSettings");
  const [state, action, pending] = useActionState(saveContractSettingsAction, {});
  const [termsVersion, setTermsVersion] = useState(defaults?.terms_version ?? "");

  /**
   * BONUS (ADR-234, brief SPEC D) — sam przycisk „Pobierz dane" co w
   * onboardingu, reużywa TĘ SAMĄ akcję serwerową (hybryda MF/GUS + cache).
   * Różnica wobec onboardingu: TU nic nie jest zablokowane — NIP w
   * `contract_document` jest i zostaje OPCJONALNY (CHECK 0026 niezmieniony),
   * więc przycisk to WYŁĄCZNIE wygoda (prefill adresu), nie bramka. Adres
   * staje się polem STEROWANYM z tego samego powodu co `termsVersion` niżej —
   * przycisk musi móc WPISAĆ wynik, a najemca z ręcznie wpisanym adresem
   * nic nie traci (pole zostaje edytowalne).
   */
  const [address, setAddress] = useState(defaults?.address ?? "");
  const [nip, setNip] = useState(defaults?.nip ?? "");
  const [nipLookup, setNipLookup] = useState<
    | { status: "idle" }
    | { status: "found"; legalName: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [isLookupPending, startLookupTransition] = useTransition();
  const nipChecksumOk = isValidNipChecksum(nip);

  function handleNipChange(value: string) {
    setNip(value);
    if (nipLookup.status !== "idle") setNipLookup({ status: "idle" });
  }

  function handleLookupClick() {
    if (!nipChecksumOk || isLookupPending) return;
    startLookupTransition(async () => {
      const result = await lookupCompanyByNipAction(nip);
      if (result.ok) {
        const formatted = [
          result.address.street,
          [result.address.zip, result.address.city].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ");
        if (formatted) setAddress(formatted);
        setNipLookup({ status: "found", legalName: result.legalName });
      } else {
        const key =
          result.reason === "invalid_checksum"
            ? "nipErrorInvalidChecksum"
            : result.reason === "not_found"
              ? "nipErrorNotFound"
              : "nipErrorUnavailable";
        setNipLookup({ status: "error", message: t(key) });
      }
    });
  }

  return (
    <ScreenSection data-contract-mode="owner">
      <form action={action} className="flex flex-col gap-2 text-sm">
        <Label htmlFor="contract-address">{t("address")}</Label>
        <Textarea
          id="contract-address"
          name="address"
          required
          maxLength={500}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          disabled={pending}
          aria-describedby="contract-address-hint"
          className="min-h-20"
        />
        <FieldHint id="contract-address-hint">{t("addressHint")}</FieldHint>

        <Label htmlFor="contract-nip">{t("nip")}</Label>
        <div className="flex flex-wrap items-start gap-2">
          <Input
            id="contract-nip"
            name="nip"
            maxLength={30}
            value={nip}
            onChange={(event) => handleNipChange(event.target.value)}
            disabled={pending}
            aria-describedby="contract-nip-hint"
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!nipChecksumOk || isLookupPending}
            loading={isLookupPending}
            data-nip-lookup-button
            onClick={handleLookupClick}
          >
            {isLookupPending ? t("nipLookupPending") : t("nipLookupButton")}
          </Button>
        </div>
        <FieldHint id="contract-nip-hint">{t("nipHint")}</FieldHint>
        <div id="contract-nip-result" aria-live="polite">
          {nipLookup.status === "found" ? (
            <p data-nip-lookup-found className="text-status-positive-fg text-sm">
              {t("nipLookupFound", { legalName: nipLookup.legalName })}
            </p>
          ) : null}
          {nipLookup.status === "error" ? (
            <p role="alert" data-nip-lookup-error className="text-destructive text-sm">
              {nipLookup.message}
            </p>
          ) : null}
        </div>

        <Label htmlFor="contract-email">{t("email")}</Label>
        <Input
          id="contract-email"
          name="email"
          type="email"
          required
          maxLength={320}
          defaultValue={defaults?.email ?? ""}
          disabled={pending}
          aria-describedby="contract-email-hint"
        />
        <FieldHint id="contract-email-hint">{t("emailHint")}</FieldHint>

        <Label htmlFor="contract-terms-version">{t("termsVersion")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="contract-terms-version"
            name="terms_version"
            required
            maxLength={100}
            value={termsVersion}
            onChange={(event) => setTermsVersion(event.target.value)}
            disabled={pending}
            aria-describedby="contract-terms-version-hint"
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            data-contract-version-suggest
            onClick={() => setTermsVersion(todayIsoDate())}
          >
            {t("termsVersionSuggest")}
          </Button>
        </div>
        <FieldHint id="contract-terms-version-hint">{t("termsVersionHint")}</FieldHint>

        <Label htmlFor="contract-terms-body">{t("termsBody")}</Label>
        <Textarea
          id="contract-terms-body"
          name="terms_body"
          required
          maxLength={50_000}
          defaultValue={defaults?.terms_body ?? ""}
          disabled={pending}
          aria-describedby="contract-terms-body-hint"
          className="min-h-64"
        />
        <FieldHint id="contract-terms-body-hint">{t("termsBodyHint")}</FieldHint>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" loading={pending} disabled={pending}>
            {t("save")}
          </Button>
          <Feedback state={state} />
        </div>
      </form>
    </ScreenSection>
  );
}
