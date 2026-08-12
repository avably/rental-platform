"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Link } from "@/i18n/navigation";

import { AuthShell } from "../auth-shell";
import {
  AuthCaptchaSlot,
  AuthField,
  AuthHeading,
  AuthInput,
  AuthNotice,
  AuthSubmit,
} from "../auth-ui";
import { AuthCaptchaField } from "../captcha-field";
import { resetRequestAction, type ResetRequestState } from "./actions";

const initialState: ResetRequestState = {};

export default function ResetRequestPage() {
  const [state, formAction, pending] = useActionState(resetRequestAction, initialState);
  const t = useTranslations("resetRequest");
  const tCommon = useTranslations("common");
  const tShell = useTranslations("authShell");

  return (
    <AuthShell band="signin">
      <AuthHeading subtitle={t("subtitle")}>{t("title")}</AuthHeading>
      <form action={formAction} className="flex flex-col gap-4">
        <AuthField id="reset-email" label={tCommon("email")}>
          <AuthInput
            id="reset-email"
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder={tShell("emailPlaceholder")}
          />
        </AuthField>
        {/* Widżet + ukryty input turnstileToken; bez site key renderuje nic
            (semantyka włączenia — L2/ADR-106). Miejsce trzyma SLOT, nie
            widżet: patrz komentarz przy AuthCaptchaSlot. */}
        <AuthCaptchaSlot>
          <AuthCaptchaField resetSignal={state} />
        </AuthCaptchaSlot>
        {state.error ? (
          <AuthNotice tone="problem" role="alert">
            {state.error}
          </AuthNotice>
        ) : null}
        {/*
          ODPOWIEDŹ NEUTRALNA. Ten komunikat brzmi tak samo niezależnie od
          tego, czy konto istnieje — dlatego jest „positive", a nie
          „potwierdzenie wysyłki": mówi o warunku, nie o fakcie.
        */}
        {state.success ? (
          <AuthNotice tone="positive" role="status">
            {state.success}
          </AuthNotice>
        ) : null}
        <AuthSubmit pending={pending}>{pending ? t("submitPending") : t("submit")}</AuthSubmit>
      </form>
      {/* WYJŚCIE Z EKRANU (ADR-153, N7): trasa resetu nie miała ANI JEDNEGO
          odnośnika — kto tu trafił przez pomyłkę albo kto przypomniał sobie
          hasło, zostawał z samym przyciskiem „wstecz" przeglądarki. */}
      <p className="text-sm">
        <Link
          href="/login"
          className="text-foreground font-medium underline underline-offset-[3px]"
        >
          {t("backToLogin")}
        </Link>
      </p>
    </AuthShell>
  );
}
