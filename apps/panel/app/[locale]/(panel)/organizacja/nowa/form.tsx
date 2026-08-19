"use client";

import { CANONICAL_SITE_URL, tenantSubdomainHost } from "@avably/core";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { createTenantAction, type CreateTenantState } from "./actions";

const initialState: CreateTenantState = {};

/** Bieżąca obowiązująca wersja regulaminu platformy — null = nic nie obowiązuje. */
export interface CreateTenantFormTerms {
  versionId: string;
  versionLabel: string;
}

export function CreateTenantForm({ terms }: { terms: CreateTenantFormTerms | null }) {
  const [state, formAction, pending] = useActionState(createTenantAction, initialState);
  const t = useTranslations("newOrganization");
  const locale = useLocale();

  /**
   * PODGLĄD ADRESU NA ŻYWO (ADR-153, N5b). Pole nazywało się „Slug (adres,
   * np. moja-firma)" i było jedynym miejscem w panelu, gdzie operator musiał
   * znać żargon — a wpisuje tu adres, pod którym od pierwszej sekundy stanie
   * jego publiczny sklep. Podgląd pokazuje DOKŁADNIE tę wartość, którą
   * zbuduje serwer: `tenantSubdomainHost` to ta sama funkcja, z której
   * korzysta akcja przy rejestracji domeny, więc normalizacja (małe litery)
   * jest widoczna, zanim ktokolwiek kliknie przycisk.
   */
  const [slug, setSlug] = useState("");
  const previewSlug = slug.trim();

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {t("name")}
        <input type="text" name="name" required maxLength={200} className="rounded border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor="tenant-slug">
        {t("slug")}
      </label>
      <input
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
        className="rounded border px-3 py-2"
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
      <button
        type="submit"
        aria-busy={pending || undefined}
        disabled={pending}
        className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
      >
        {pending ? t("submitPending") : t("submit")}
      </button>
    </form>
  );
}
