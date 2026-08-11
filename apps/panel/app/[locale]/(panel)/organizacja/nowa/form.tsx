"use client";

import { CANONICAL_SITE_URL } from "@avably/core";
import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";

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

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {t("name")}
        <input type="text" name="name" required maxLength={200} className="rounded border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("slug")}
        <input
          type="text"
          name="slug"
          required
          pattern="[a-z0-9][a-z0-9-]{2,38}"
          className="rounded border px-3 py-2"
        />
      </label>
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
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
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
