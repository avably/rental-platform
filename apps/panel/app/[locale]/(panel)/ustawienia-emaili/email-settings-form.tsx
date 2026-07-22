"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { ScreenSection } from "@/components/screens/screen-header";
import type { FormState } from "@/lib/form-state";
import { SecondaryStatusChip } from "@/lib/secondary-status";

import { saveEmailSenderAction } from "./email-settings-actions";

const initialState: FormState = {};

export interface EmailSenderDefaults {
  name: string;
  replyTo: string;
}

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
 * Formularz nadawcy e-maili. Nazwa wymagana (pole From), reply_to opcjonalne.
 * Bramką ostateczną jest CHECK 0014 (kod 23514 mapowany w akcji); klient nie
 * udaje walidacji, której nie ma baza.
 *
 * Kompletność konfiguracji nadawcy jest STANEM karty (oś `email-sender`), nie
 * osobnym zdaniem gdzieś nad formularzem: mockup P8 stawia chip w tytule tej
 * samej karty, którą operator zaraz edytuje — brak konfiguracji i miejsce jej
 * uzupełnienia są wtedy jedną rzeczą, a nie dwiema.
 */
export function EmailSenderForm({
  defaults,
  configured,
}: {
  defaults: EmailSenderDefaults | null;
  configured: boolean;
}) {
  const t = useTranslations("emailSettings");
  const [state, formAction, pending] = useActionState(saveEmailSenderAction, initialState);

  return (
    <ScreenSection
      data-email-sender-form
      title={t("formTitle")}
      status={
        <SecondaryStatusChip axis="email-sender" value={configured ? "configured" : "missing"} />
      }
      description={configured ? undefined : t("senderMissing")}
    >
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <Label htmlFor="email-sender-name">{t("nameLabel")}</Label>
        <Input
          id="email-sender-name"
          name="name"
          defaultValue={defaults?.name ?? ""}
          disabled={pending}
        />

        <Label htmlFor="email-sender-reply-to">{t("replyToLabel")}</Label>
        <Input
          id="email-sender-reply-to"
          name="replyTo"
          type="email"
          defaultValue={defaults?.replyTo ?? ""}
          disabled={pending}
        />
        <p className="text-muted-foreground">{t("replyToHint")}</p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" disabled={pending}>
            {t("saveCta")}
          </Button>
          <FormMessages state={state} successText={t("savedOk")} />
        </div>
      </form>
    </ScreenSection>
  );
}
