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
 * Formularz nadawcy e-maili. Nazwa (pole From) i adres odpowiedzi WYMAGANE
 * przy zapisie z panelu (ADR-241): bez adresu odpowiedzi wiadomości od klientów
 * wracają na ogólny adres platformy i mogą ginąć. Bramką ostateczną w bazie
 * pozostaje CHECK 0014 (kod 23514 mapowany w akcji), gdzie reply_to jest wciąż
 * technicznie opcjonalny — panel jest tu ŚWIADOMIE surowszy niż baza.
 *
 * Kompletność konfiguracji nadawcy jest STANEM karty (oś `email-sender`), nie
 * osobnym zdaniem gdzieś nad formularzem: mockup P8 stawia chip w tytule tej
 * samej karty, którą operator zaraz edytuje — brak konfiguracji i miejsce jej
 * uzupełnienia są wtedy jedną rzeczą, a nie dwiema. Gdy adres odpowiedzi nie
 * jest jeszcze ustawiony, ta sama karta niesie WYRAŹNY bloker przy polu i
 * PODPOWIADA adres z konta operatora (prefill, edytowalny).
 */
export function EmailSenderForm({
  defaults,
  configured,
  accountEmail,
}: {
  defaults: EmailSenderDefaults | null;
  configured: boolean;
  /**
   * Adres z konta operatora (z sesji, self-scope) do PODPOWIEDZI w polu adresu
   * odpowiedzi, gdy nic jeszcze nie zapisano. Opcjonalny: sesja bez e-maila
   * (rzadkie) zostawia pole puste, a bramka wymaga wpisania adresu ręcznie.
   */
  accountEmail?: string | null;
}) {
  const t = useTranslations("emailSettings");
  const [state, formAction, pending] = useActionState(saveEmailSenderAction, initialState);

  const replyToSaved = defaults?.replyTo ?? "";
  const replyToSet = replyToSaved.length > 0;
  // Prefill TYLKO gdy brak zapisanego adresu: nie nadpisujemy świadomego wyboru
  // operatora adresem z konta. Wartość zostaje edytowalna.
  const prefill = accountEmail?.trim() ?? "";
  const replyToDefault = replyToSet ? replyToSaved : prefill;
  const showPrefillNote = !replyToSet && prefill.length > 0;

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

        {replyToSet ? null : (
          <div
            data-reply-to-blocker
            role="note"
            className="border-status-attention-border bg-status-attention-bg mt-2 rounded-lg border px-4 py-3"
          >
            <p className="text-status-attention-fg text-sm font-medium">
              {t("replyToBlockerHeading")}
            </p>
            <p className="text-status-attention-fg/90 mt-1 text-[13px] leading-[18px]">
              {t("replyToBlockerBody")}
            </p>
          </div>
        )}

        <Label htmlFor="email-sender-reply-to" className="mt-2">
          {t("replyToLabel")}
        </Label>
        <Input
          id="email-sender-reply-to"
          name="replyTo"
          type="email"
          defaultValue={replyToDefault}
          disabled={pending}
          aria-describedby="email-sender-reply-to-hint"
        />
        <p id="email-sender-reply-to-hint" className="text-muted-foreground">
          {t("replyToHint")}
        </p>
        {showPrefillNote ? (
          <p data-reply-to-prefill-note className="text-muted-foreground">
            {t("replyToPrefillNote")}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" loading={pending} disabled={pending}>
            {t("saveCta")}
          </Button>
          <FormMessages state={state} successText={t("savedOk")} />
        </div>
      </form>
    </ScreenSection>
  );
}
