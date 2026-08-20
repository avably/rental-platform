"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import { ReadList } from "@/components/screens/read-list";
import { ScreenSection } from "@/components/screens/screen-header";
import type { FormState } from "@/lib/form-state";
import { SecondaryStatusChip } from "@/lib/secondary-status";

import { updateOrganizationAction } from "./organization-actions";

const initialState: FormState = {};

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

/**
 * Karta organizacji dla WŁAŚCICIELA (U12, ADR-225) — edycja NAZWY i JĘZYKA.
 *
 * To NIE jest wyłączony formularz z ADR-059: właściciel MA teraz ścieżkę zapisu
 * (RPC app.update_organization, 0093), więc kontrolki są realne. Staff dostaje
 * osobną, odczytową `OrganizationCard` — bez tego komponentu i bez akcji.
 *
 * Pola NIEKONTROLOWANE (defaultValue z bazy) + ECHO ze stanu akcji (U9): po
 * nieudanym zapisie i pełnym obiegu dokumentu (brak hydracji) formularz wraca
 * z wpisanymi wartościami, a nie ze stanem bazy. Tenant i bramka właściciela
 * są w bazie — formularz nie niesie ani id tenanta, ani roli.
 *
 * Slug, plan, status i data założenia zostają WIERSZAMI ODCZYTOWYMI: to
 * kontekst konta, którego tą ścieżką się NIE zmienia (RPC pisze wyłącznie
 * name+locale). Nazwa jest tytułem karty i jednocześnie polem — po zapisie
 * i odświeżeniu tytuł pokazuje nową wartość.
 */
export function OrganizationEditForm({
  defaults,
  status,
  rows,
}: {
  defaults: { name: string; locale: string };
  status: string;
  rows: readonly { label: string; value: string; numeric?: boolean }[];
}) {
  const t = useTranslations("organization");
  const [state, formAction, pending] = useActionState(updateOrganizationAction, initialState);

  return (
    <ScreenSection
      data-organization-details
      data-access-mode="editable"
      title={defaults.name}
      status={
        status === "active" ? (
          <SecondaryStatusChip axis="organization" value="active" />
        ) : undefined
      }
      description={t("description")}
    >
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <Label htmlFor="organization-name">{t("name")}</Label>
        <Input
          id="organization-name"
          name="name"
          defaultValue={state.values?.name ?? defaults.name}
          maxLength={200}
          required
          disabled={pending}
        />

        <Label htmlFor="organization-locale">{t("locale")}</Label>
        <PanelSelect
          id="organization-locale"
          name="locale"
          defaultValue={state.values?.locale ?? defaults.locale}
          disabled={pending}
          options={[
            { value: "pl", label: t("localeValue.pl") },
            { value: "en", label: t("localeValue.en") },
          ]}
        />
        <p className="text-muted-foreground">{t("localeHint")}</p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" loading={pending} disabled={pending}>
            {t("saveCta")}
          </Button>
          <FormMessages state={state} successText={t("savedOk")} />
        </div>
      </form>

      <ReadList rows={rows} />
    </ScreenSection>
  );
}
