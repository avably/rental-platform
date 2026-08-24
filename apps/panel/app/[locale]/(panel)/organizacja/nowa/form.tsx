"use client";

import { CANONICAL_SITE_URL, isValidNipChecksum, tenantSubdomainHost } from "@avably/core";
import { Button, Input } from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";

import { lookupCompanyByNipAction } from "@/lib/registry/lookup-action";
import type { CompanyLookupResult } from "@/lib/registry/types";

import { createTenantAction, type CreateTenantState } from "./actions";

const initialState: CreateTenantState = {};

/** Bieżąca obowiązująca wersja regulaminu platformy — null = nic nie obowiązuje. */
export interface CreateTenantFormTerms {
  versionId: string;
  versionLabel: string;
}

/**
 * NIP: WYMAGANY i WERYFIKOWANY przy zakładaniu organizacji (ADR-234, decyzja
 * właściciela — brief SPEC decyzja #2). Flow: wpisz NIP → suma kontrolna
 * (klient, natychmiast) → klik „Pobierz dane" → spinner → serwer sprawdza
 * MF Białą listę / GUS BIR1.1 i zapisuje dowód w app.nip_lookup_cache →
 * pokazujemy ZNALEZIONĄ firmę → „Załóż organizację" ODBLOKOWANE.
 *
 * TWARDY GATE: `verified` jest jedynym źródłem prawdy o tym, czy submit
 * wolno wcisnąć. Każda zmiana pola NIP PO udanej weryfikacji cofa `verified`
 * na `false` — inaczej user mógłby zweryfikować NIP A, potem wpisać NIP B
 * i wysłać formularz z „zieloną" etykietą, która nie dotyczy tego, co
 * faktycznie poszło do bazy. Serwer i tak re-weryfikuje przez cache
 * (app.create_tenant, 0098) — to pole jest o UX, nie o bezpieczeństwie
 * (bezpieczeństwo stoi w RPC, patrz actions.ts).
 */
type NipLookupFailureReason = Extract<CompanyLookupResult, { ok: false }>["reason"];

type NipLookupState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "found"; legalName: string; address: string }
  | { status: "error"; reason: NipLookupFailureReason };

export function CreateTenantForm({ terms }: { terms: CreateTenantFormTerms | null }) {
  const [state, formAction, pending] = useActionState(createTenantAction, initialState);
  const t = useTranslations("newOrganization");
  const locale = useLocale();

  const [slug, setSlug] = useState("");
  const previewSlug = slug.trim();

  const [nip, setNip] = useState("");
  const [nipLookup, setNipLookup] = useState<NipLookupState>({ status: "idle" });
  const [isLookupPending, startLookupTransition] = useTransition();
  const nipChecksumOk = isValidNipChecksum(nip);
  const verified = nipLookup.status === "found";

  function handleNipChange(value: string) {
    setNip(value);
    // Każda zmiana NIP-u PO weryfikacji unieważnia ją — patrz docblock typu.
    if (nipLookup.status !== "idle") setNipLookup({ status: "idle" });
  }

  function handleLookupClick() {
    if (!nipChecksumOk || isLookupPending) return;
    startLookupTransition(async () => {
      setNipLookup({ status: "pending" });
      const result = await lookupCompanyByNipAction(nip);
      if (result.ok) {
        const address = [result.address.street, [result.address.zip, result.address.city].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ");
        setNipLookup({ status: "found", legalName: result.legalName, address });
      } else {
        setNipLookup({ status: "error", reason: result.reason });
      }
    });
  }

  const nipErrorKey =
    nipLookup.status === "error"
      ? nipLookup.reason === "invalid_checksum"
        ? "nipErrorInvalidChecksum"
        : nipLookup.reason === "not_found"
          ? "nipErrorNotFound"
          : "nipErrorUnavailable"
      : null;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm" htmlFor="tenant-nip">
        {t("nip")}
      </label>
      <div className="flex flex-wrap items-start gap-2">
        <Input
          id="tenant-nip"
          type="text"
          name="nip"
          required
          inputMode="numeric"
          autoComplete="off"
          maxLength={20}
          value={nip}
          onChange={(event) => handleNipChange(event.target.value)}
          aria-describedby="tenant-nip-hint tenant-nip-result"
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
      <p id="tenant-nip-hint" className="text-muted-foreground text-sm">
        {t("nipHint")}
      </p>
      <div id="tenant-nip-result" aria-live="polite">
        {nipLookup.status === "found" ? (
          <p data-nip-lookup-found className="text-status-positive-fg text-sm">
            {t("nipLookupFound", { legalName: nipLookup.legalName, address: nipLookup.address })}
          </p>
        ) : null}
        {nipErrorKey ? (
          <p role="alert" data-nip-lookup-error className="text-destructive text-sm">
            {t(nipErrorKey)}
          </p>
        ) : null}
      </div>
      <label className="flex flex-col gap-1 text-sm">
        {t("name")}
        <Input type="text" name="name" required maxLength={200} />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor="tenant-slug">
        {t("slug")}
      </label>
      <Input
        id="tenant-slug"
        type="text"
        name="slug"
        required
        pattern="[a-z0-9][a-z0-9-]{2,38}"
        autoComplete="off"
        spellCheck={false}
        placeholder={t("slugPlaceholder")}
        value={slug}
        onChange={(event) => setSlug(event.target.value)}
        aria-describedby="tenant-slug-preview tenant-slug-note"
      />
      <p id="tenant-slug-preview" data-slug-preview className="text-muted-foreground text-sm">
        {previewSlug
          ? t("slugPreview", { host: tenantSubdomainHost(previewSlug) })
          : t("slugPreviewEmpty")}
      </p>
      {/*
        DECYZJA WŁAŚCICIELA (2026-08-12): adres BĘDZIE edytowalny, a stary
        zostanie przekierowany. Dlatego ekran świadomie NIE straszy „tego już
        nie zmienisz" — ostrzeżenie nieodwracalnością byłoby dziś kłamstwem
        w drugą stronę i zatrzymywałoby ludzi na polu, na którym nie ma się
        nad czym zastanawiać. Samą edycję dowozi osobne zadanie.

        UWAGA WŁAŚCICIELA (2026-08-19): nota mówi odtąd OBIE obietnice —
        zmianę adresu w panelu (z przekierowaniem starego) ORAZ możliwość
        podpięcia własnej domeny.
      */}
      <p id="tenant-slug-note" className="text-muted-foreground text-sm">
        {t("slugEditableNote")}
      </p>
      {terms ? (
        /*
         * AKCEPTACJA REGULAMINU (0070, ADR-141, D2). Checkbox DOMYŚLNIE
         * NIEZAZNACZONY i `required` (walidacja kliencka); serwer waliduje
         * ponownie, a ostatnie słowo ma `app.create_tenant` (D5 — twarde
         * wymuszenie w bazie). Ukryte pole niesie wersję, którą użytkownik
         * WIDZI — akceptacja wskazuje dokładnie ten tekst, nie „aktualną
         * wersję w chwili submitu".
         */
        <label className="flex items-start gap-2 text-sm" data-terms-checkbox>
          <input type="checkbox" name="termsAccepted" required className="mt-0.5" />
          <input type="hidden" name="termsVersionId" value={terms.versionId} />
          <span>
            {t("termsLabel")}{" "}
            <a
              href={`${CANONICAL_SITE_URL}/${locale}/terms`}
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline underline-offset-[3px]"
            >
              {t("termsLinkLabel", { version: terms.versionLabel })}
            </a>
          </span>
        </label>
      ) : null}
      {state.error ? (
        <p role="alert" data-create-tenant-error className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      {/*
        GATE TWARDY (ADR-234): bez udanej weryfikacji rejestrowej submit jest
        NIEAKTYWNY — brief SPEC D: „Bez udanej weryfikacji rejestrowej NIE
        przepuszczaj". `verified` pochodzi WYŁĄCZNIE z udanego
        `lookupCompanyByNipAction` i cofa się przy każdej zmianie pola NIP.
      */}
      <Button type="submit" loading={pending} disabled={pending || !verified} data-submit-create-tenant>
        {pending ? t("submitPending") : t("submit")}
      </Button>
      {!verified ? (
        <p className="text-muted-foreground text-sm">{t("submitNeedsNipNote")}</p>
      ) : null}
    </form>
  );
}
