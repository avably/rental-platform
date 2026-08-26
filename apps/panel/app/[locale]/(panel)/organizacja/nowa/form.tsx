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
 * NIP: WYMAGANY przy zakładaniu organizacji (ADR-234). Flow: wpisz NIP →
 * suma kontrolna (klient, natychmiast) → klik „Pobierz dane" → spinner →
 * serwer sprawdza MF Białą listę / GUS BIR1.1 i zapisuje dowód w
 * app.nip_lookup_cache → pokazujemy ZNALEZIONĄ firmę → „Utwórz organizację"
 * ODBLOKOWANE.
 *
 * ══ DRUGA DROGA: DANE RĘCZNE (ADR-276, decyzja właściciela 2026-08-26) ══
 *
 * Do ADR-276 udana weryfikacja była JEDYNĄ drogą do aktywnego submitu — i
 * zamykała drzwi przed realnymi klientami: podatnik ZWOLNIONY z VAT nie
 * figuruje w wykazie MF, a fallback GUS jest dziś bez klucza, więc poprawny
 * NIP kończył się komunikatem „spróbuj ponownie", po którym nic się nie
 * zmieniało. Od ADR-276 każda odmowa rejestru INNA NIŻ zła suma kontrolna
 * otwiera sekcję ręczną: nazwa rejestrowa (wymagana) + REGON (opcjonalny),
 * a submit jest aktywny. Organizacja powstaje BEZ stempla
 * `registry_verified_at` i jest tak oznaczona w panelu.
 *
 * GATE: submit wolno wcisnąć, gdy `verified` ALBO `manualAllowed`. Każda
 * zmiana pola NIP cofa OBA — inaczej user mógłby zweryfikować (albo odblokować
 * ręcznie) NIP A, wpisać NIP B i wysłać formularz ze stanem, który tego
 * drugiego nie dotyczy. To jest o UX; bezpieczeństwo stoi w RPC (0114): przy
 * trafionym cache'u dane ręczne są IGNOROWANE, a stempla weryfikacji nie da
 * się podać parametrem.
 */
type NipLookupFailureReason = Extract<CompanyLookupResult, { ok: false }>["reason"];

type NipLookupState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "found"; legalName: string; address: string }
  | { status: "error"; reason: NipLookupFailureReason };

/**
 * Powody, po których oferujemy wpisanie danych RĘCZNIE (ADR-276).
 *
 * `invalid_checksum` świadomie POZA listą: to jedyna odmowa, którą użytkownik
 * naprawia sam i w miejscu — NIP jest formalnie zły, więc żadne dane firmowe
 * nie mają go czym uzupełnić (RPC odrzuci taki NIP niezależnie od reszty
 * formularza).
 */
const MANUAL_ENTRY_REASONS: readonly NipLookupFailureReason[] = [
  "not_found",
  "unavailable",
  "unconfigured",
  "rate_limited",
];

/**
 * Komunikat per powód — jedno zdanie mówiące CO SIĘ STAŁO i CO ZROBIĆ.
 * `satisfies` (a nie adnotacja typu) trzyma literalne klucze: dzięki temu
 * dodanie powodu bez etykiety jest błędem typów, a `t(klucz)` dalej sprawdza
 * istnienie klucza w słowniku.
 */
const NIP_ERROR_MESSAGE_KEYS = {
  invalid_checksum: "nipErrorInvalidChecksum",
  not_found: "nipErrorNotFound",
  unavailable: "nipErrorUnavailable",
  unconfigured: "nipErrorUnconfigured",
  rate_limited: "nipErrorRateLimited",
} as const satisfies Record<NipLookupFailureReason, string>;

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
  // ADR-276: rejestr odmówił z powodu, którego użytkownik nie naprawi
  // przepisaniem NIP-u → sekcja ręczna + aktywny submit.
  const manualAllowed =
    nipLookup.status === "error" && MANUAL_ENTRY_REASONS.includes(nipLookup.reason);

  function handleNipChange(value: string) {
    setNip(value);
    // Każda zmiana NIP-u PO weryfikacji (albo po odblokowaniu ręcznym)
    // unieważnia ją — patrz docblock typu.
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

  const nipErrorKey = nipLookup.status === "error" ? NIP_ERROR_MESSAGE_KEYS[nipLookup.reason] : null;

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
      {/*
        SEKCJA RĘCZNA (ADR-276). Renderowana WYŁĄCZNIE po odmowie rejestru,
        której użytkownik nie naprawi poprawieniem NIP-u. Pola są `required`
        dopiero tutaj — gdy sekcji nie ma, przeglądarka nie ma czego wymagać,
        a akcja serwerowa traktuje ich brak jako „ścieżka rejestrowa".

        NAZWA REJESTROWA I REGON, nie adres: adres firmy do umów edytuje się
        na ekranie ustawień umów (własne pola + własny zapis), a `contract_
        document` ma sztywny CHECK pięciu kluczy, którego ten formularz nie
        wypełni. Te dwa pola to DOKŁADNIE to, co karta „Dane firmowe" na
        ekranie umów czyta z `public.tenants` (legal_name, nip, regon) —
        czyli to, co przy udanej weryfikacji przyszłoby z rejestru.
      */}
      {manualAllowed ? (
        <div data-manual-company-section className="border-border flex flex-col gap-3 rounded-lg border p-4">
          <p className="text-sm font-semibold">{t("manualTitle")}</p>
          <p className="text-muted-foreground text-sm">{t("manualNote")}</p>
          <label className="flex flex-col gap-1 text-sm" htmlFor="tenant-legal-name">
            {t("manualLegalName")}
            <Input
              id="tenant-legal-name"
              type="text"
              name="legalName"
              required
              maxLength={200}
              autoComplete="organization"
              aria-describedby="tenant-legal-name-hint"
            />
          </label>
          <p id="tenant-legal-name-hint" className="text-muted-foreground text-sm">
            {t("manualLegalNameHint")}
          </p>
          <label className="flex flex-col gap-1 text-sm" htmlFor="tenant-regon">
            {t("manualRegon")}
            <Input
              id="tenant-regon"
              type="text"
              name="regon"
              inputMode="numeric"
              autoComplete="off"
              maxLength={20}
              aria-describedby="tenant-regon-hint"
            />
          </label>
          <p id="tenant-regon-hint" className="text-muted-foreground text-sm">
            {t("manualRegonHint")}
          </p>
        </div>
      ) : null}
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
        GATE (ADR-234 → ADR-276). Submit odblokowuje udana weryfikacja
        (`verified`) ALBO otwarta sekcja ręczna (`manualAllowed`). Oba stany
        pochodzą WYŁĄCZNIE z odpowiedzi `lookupCompanyByNipAction` i cofają
        się przy każdej zmianie pola NIP — dopóki nikt nie kliknął „Pobierz
        dane", przycisk jest nieaktywny tak samo jak przed ADR-276.
      */}
      <Button
        type="submit"
        loading={pending}
        disabled={pending || !(verified || manualAllowed)}
        data-submit-create-tenant
      >
        {pending ? t("submitPending") : t("submit")}
      </Button>
      {!(verified || manualAllowed) ? (
        <p className="text-muted-foreground text-sm">{t("submitNeedsNipNote")}</p>
      ) : null}
    </form>
  );
}
