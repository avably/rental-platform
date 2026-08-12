"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Link } from "@/i18n/navigation";

import { AuthCaptchaField } from "../captcha-field";
import { resetRequestAction, type ResetRequestState } from "./actions";

const initialState: ResetRequestState = {};

export default function ResetRequestPage() {
  const [state, formAction, pending] = useActionState(resetRequestAction, initialState);
  const t = useTranslations("resetRequest");
  const tCommon = useTranslations("common");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <form action={formAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {tCommon("email")}
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="rounded border px-3 py-2"
          />
        </label>
        {/* Widżet + ukryty input turnstileToken; bez site key renderuje nic
            (semantyka włączenia — L2/ADR-106). */}
        <AuthCaptchaField resetSignal={state} />
        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
        {state.success ? (
          <p role="status" className="text-status-positive-fg text-sm">
            {state.success}
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
      {/* WYJŚCIE Z EKRANU (ADR-153, N7): trasa resetu nie miała ANI JEDNEGO
          odnośnika — kto tu trafił przez pomyłkę albo kto przypomniał sobie
          hasło, zostawał z samym przyciskiem „wstecz" przeglądarki. */}
      <p className="text-sm">
        <Link href="/login" className="underline">
          {t("backToLogin")}
        </Link>
      </p>
    </main>
  );
}
