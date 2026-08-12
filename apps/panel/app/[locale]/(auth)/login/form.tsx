"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Link } from "@/i18n/navigation";

import { AuthCaptchaField } from "../captcha-field";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const t = useTranslations("login");
  const tCommon = useTranslations("common");

  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : "/register";

  return (
    <>
      <form action={formAction} className="flex flex-col gap-3">
        {next ? <input type="hidden" name="next" value={next} /> : null}
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
        <label className="flex flex-col gap-1 text-sm">
          {tCommon("password")}
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="rounded border px-3 py-2"
          />
        </label>
        {/* Widżet + ukryty input turnstileToken; bez site key renderuje nic
            (semantyka włączenia — L2/ADR-106). */}
        <AuthCaptchaField resetSignal={state} />
        {/*
          DWA WYJŚCIA PRZY BŁĘDZIE (ADR-153, N3). Komunikat jest z konieczności
          generyczny — nie wolno mu zdradzić, czy konto istnieje — więc sam
          nie mówi, co dalej. Obie realne przyczyny („nie potwierdziłem
          adresu" i „nie pamiętam hasła") dostają tu drogę wyjścia, bez
          klasyfikowania czegokolwiek po stronie serwera. Do ADR-153 człowiek
          z poprawnym hasłem i niepotwierdzonym adresem czytał „nieprawidłowe
          hasło" i szedł w reset hasła, który nie pomaga.
        */}
        {state.error ? (
          <div data-login-error className="flex flex-col gap-1">
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link href="/register/sprawdz-skrzynke" className="underline">
                {t("resendConfirmation")}
              </Link>
              <Link href="/reset" className="underline">
                {t("forgotPassword")}
              </Link>
            </p>
          </div>
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
      {/* TODO(Task 3 infra): przycisk „Zaloguj przez Google" — wymaga
          skonfigurowanego OAuth clienta (brak credentiali). */}
      <p className="flex justify-between text-sm">
        <Link href={registerHref} className="underline">
          {t("register")}
        </Link>
        <Link href="/reset" className="underline">
          {t("forgotPassword")}
        </Link>
      </p>
    </>
  );
}
