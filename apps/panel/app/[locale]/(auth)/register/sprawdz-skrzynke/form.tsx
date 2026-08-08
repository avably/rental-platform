"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { resendConfirmationAction, type ResendConfirmationState } from "./actions";

const initialState: ResendConfirmationState = {};

/**
 * „Wyślij ponownie e-mail potwierdzający" (L4, ADR-105).
 *
 * Adres jest polem, a nie wartością odziedziczoną z rejestracji, i to jest
 * świadomy wybór: strona bywa otwierana z linku albo po odświeżeniu, kiedy
 * żaden kontekst rejestracji już nie żyje. Przeniesienie adresu w URL-u
 * odpada (dane osobowe w adresie strony, w historii przeglądarki i w logach
 * serwera), a chowanie go w ciasteczku dokładałoby stan do trasy, która
 * niczego nie musi pamiętać.
 *
 * Komunikat sukcesu jest CELOWO nieinformacyjny o istnieniu konta — jego
 * treść jest ta sama niezależnie od tego, co zastał serwer.
 */
export function ResendConfirmationForm() {
  const t = useTranslations("checkInbox");
  const [state, formAction, pending] = useActionState(resendConfirmationAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 text-left text-sm">
      <Label htmlFor="resend-email">{t("resendEmailLabel")}</Label>
      <Input
        id="resend-email"
        type="email"
        name="email"
        autoComplete="email"
        required
        disabled={pending}
      />
      <Button type="submit" variant="outline" loading={pending} disabled={pending}>
        {pending ? t("resendPending") : t("resendCta")}
      </Button>

      {state.error ? (
        <p role="alert" className="text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" data-resend-confirmation-done className="text-status-positive-fg">
          {state.success}
        </p>
      ) : null}
    </form>
  );
}
