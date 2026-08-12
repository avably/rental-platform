"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { AuthField, AuthInput, AuthNotice, AuthSubmit } from "../../auth-ui";
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
    <form action={formAction} className="flex flex-col gap-4">
      <AuthField id="resend-email" label={t("resendEmailLabel")}>
        <AuthInput
          id="resend-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          disabled={pending}
        />
      </AuthField>
      <AuthSubmit pending={pending} variant="outline">
        {pending ? t("resendPending") : t("resendCta")}
      </AuthSubmit>

      {state.error ? (
        <AuthNotice tone="problem" role="alert">
          {state.error}
        </AuthNotice>
      ) : null}
      {state.success ? (
        <AuthNotice tone="positive" role="status" data-resend-confirmation-done>
          {state.success}
        </AuthNotice>
      ) : null}
    </form>
  );
}
