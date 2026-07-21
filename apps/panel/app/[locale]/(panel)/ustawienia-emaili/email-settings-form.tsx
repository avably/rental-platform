"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { FormState } from "@/lib/form-state";

import { saveEmailSenderAction } from "./email-settings-actions";

const initialState: FormState = {};

export interface EmailSenderDefaults {
  name: string;
  replyTo: string;
}

function FormMessages({ state, successText }: { state: FormState; successText: string }) {
  if (state.formError) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {state.formError}
      </p>
    );
  }
  if (state.fieldErrors) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {Object.values(state.fieldErrors)[0]}
      </p>
    );
  }
  if (state.success) {
    return <p className="text-sm text-green-700">{successText}</p>;
  }
  return null;
}

/**
 * Formularz nadawcy e-maili. Nazwa wymagana (pole From), reply_to opcjonalne.
 * Bramką ostateczną jest CHECK 0014 (kod 23514 mapowany w akcji); klient nie
 * udaje walidacji, której nie ma baza.
 */
export function EmailSenderForm({ defaults }: { defaults: EmailSenderDefaults | null }) {
  const t = useTranslations("emailSettings");
  const [state, formAction, pending] = useActionState(saveEmailSenderAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded border p-3 text-sm">
      <p className="font-medium">{t("formTitle")}</p>

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
      <p className="text-gray-500">{t("replyToHint")}</p>

      <Button type="submit" disabled={pending}>
        {t("saveCta")}
      </Button>
      <FormMessages state={state} successText={t("savedOk")} />
    </form>
  );
}
