"use client";

import { isValidNipChecksum } from "@avably/core";
import { Button, Input, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState, useTransition } from "react";

import { ScreenSection } from "@/components/screens/screen-header";
import type { ContractDocumentSettings } from "@/lib/contract-settings";
import type { FormState } from "@/lib/form-state";
import { lookupCompanyByNipAction } from "@/lib/registry/lookup-action";

import { saveContractSettingsAction } from "./actions";
import { composeAddress, parseAddress } from "./address-fields";

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
 * w całości przed zapisem, i miejsce, gdzie operator WKLEJA gotowy, już
 * opublikowany regulamin (uwaga właściciela #2).
 *
 * Wersja warunków jest polem STEROWANYM, żeby przycisk mógł WPISAĆ propozycję
 * (dzisiejszą datę) zamiast ją narzucić: wartość zostaje edytowalna, a najemca
 * z własnym schematem („1.2", „2026/Q3") nic nie traci. Data liczona jest
 * dopiero w obsłudze kliknięcia — policzona w trakcie renderu rozjechałaby się
 * między serwerem a przeglądarką na granicy doby i wywróciła hydrację.
 */
export function ContractSettingsForm({
  defaults,
  companyNip,
}: {
  defaults: ContractDocumentSettings | null;
  /** NIP z rejestru (tenants.nip, ADR-234) — domyślne źródło „Pobierz z GUS". */
  companyNip?: string | null;
}) {
  const t = useTranslations("contractSettings");
  const [state, action, pending] = useActionState(saveContractSettingsAction, {});
  const [termsVersion, setTermsVersion] = useState(defaults?.terms_version ?? "");

  /**
   * Adres jako TRZY pola (uwaga właściciela #1: „rozbite na pola, a nie
   * ogólnie adres"). Kanonem w bazie zostaje pojedynczy `address` (CHECK 0026
   * niezmieniony) — pola składamy w jedną linię do UKRYTEGO inputa `address`
   * przy zapisie i rozbijamy z zapisanego łańcucha przy wejściu. Pola są
   * STEROWANE, bo przycisk „Pobierz z GUS" musi móc je WPISAĆ, a ręcznie
   * wpisany adres i tak nic nie traci (zostają edytowalne).
   */
  const initialAddress = useMemo(() => parseAddress(defaults?.address ?? ""), [defaults?.address]);
  const [street, setStreet] = useState(initialAddress.street);
  const [zip, setZip] = useState(initialAddress.zip);
  const [city, setCity] = useState(initialAddress.city);
  const composedAddress = composeAddress({ street, zip, city });

  const [nip, setNip] = useState(defaults?.nip ?? "");
  const [nipLookup, setNipLookup] = useState<
    | { status: "idle" }
    | { status: "found"; legalName: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [isLookupPending, startLookupTransition] = useTransition();

  /**
   * BONUS (ADR-234) — „Pobierz z GUS" reużywa TĘ SAMĄ akcję serwerową co
   * onboarding (hybryda MF/GUS + cache, auth + rate-limit w środku). Domyślnie
   * pyta o zweryfikowany NIP organizacji (`companyNip`); gdy go brak
   * (organizacja sprzed ADR-234), spada na NIP wpisany w polu obok. TU nic nie
   * jest zablokowane — NIP w `contract_document` zostaje OPCJONALNY, przycisk
   * to wyłącznie wygoda (prefill rozbitego adresu).
   */
  const companyNipValid = typeof companyNip === "string" && isValidNipChecksum(companyNip);
  const effectiveNip = companyNipValid ? (companyNip as string) : nip.trim();
  const effectiveNipValid = isValidNipChecksum(effectiveNip);

  function handleNipChange(value: string) {
    setNip(value);
    if (nipLookup.status !== "idle") setNipLookup({ status: "idle" });
  }

  function handleLookupClick() {
    if (!effectiveNipValid || isLookupPending) return;
    startLookupTransition(async () => {
      const result = await lookupCompanyByNipAction(effectiveNip);
      if (result.ok) {
        setStreet(result.address.street ?? "");
        setZip(result.address.zip ?? "");
        setCity(result.address.city ?? "");
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
        {/*
          Adres kanoniczny idzie UKRYTYM polem złożonym z trzech widocznych
          pól — server action i CHECK 0026 dostają ten sam pojedynczy `address`
          co dotąd, bez zmiany schematu.
        */}
        <input type="hidden" name="address" value={composedAddress} />

        <Label htmlFor="contract-address-street">{t("addressStreet")}</Label>
        <div className="flex flex-wrap items-start gap-2">
          <Input
            id="contract-address-street"
            value={street}
            onChange={(event) => setStreet(event.target.value)}
            disabled={pending}
            maxLength={400}
            aria-describedby="contract-address-hint"
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!effectiveNipValid || isLookupPending}
            loading={isLookupPending}
            data-nip-lookup-button
            onClick={handleLookupClick}
          >
            {isLookupPending ? t("nipLookupPending") : t("nipLookupButton")}
          </Button>
        </div>

        {/*
          Kod obok miejscowości od sm w górę (kod wąski, miasto rozciągliwe),
          a na wąskim ekranie jedno pod drugim. Szerokość niesie szablon siatki
          (`grid-cols-[…]`, wzorem `ReadList`), NIE `w-[…]`/`min-w-[…]` — bramka
          spójności (ADR-060) pilnuje jednego zapisu szerokości ekranu.
        */}
        <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
          <div className="flex flex-col gap-2">
            <Label htmlFor="contract-address-zip">{t("addressZip")}</Label>
            <Input
              id="contract-address-zip"
              value={zip}
              onChange={(event) => setZip(event.target.value)}
              disabled={pending}
              maxLength={20}
              inputMode="numeric"
              autoComplete="postal-code"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="contract-address-city">{t("addressCity")}</Label>
            <Input
              id="contract-address-city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              disabled={pending}
              maxLength={200}
              autoComplete="address-level2"
            />
          </div>
        </div>

        <FieldHint id="contract-address-hint">{t("addressHint")}</FieldHint>
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

        <Label htmlFor="contract-nip">{t("nip")}</Label>
        <Input
          id="contract-nip"
          name="nip"
          maxLength={30}
          value={nip}
          onChange={(event) => handleNipChange(event.target.value)}
          disabled={pending}
          aria-describedby="contract-nip-hint"
        />
        <FieldHint id="contract-nip-hint">{t("nipHint")}</FieldHint>

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
