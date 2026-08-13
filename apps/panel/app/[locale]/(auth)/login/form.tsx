"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Link } from "@/i18n/navigation";

import { AuthField, AuthInput, AuthLinks, AuthNotice, AuthSubmit } from "../auth-ui";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const t = useTranslations("login");
  const tCommon = useTranslations("common");
  const tShell = useTranslations("authShell");

  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : "/register";

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <AuthField id="login-email" label={tCommon("email")}>
          <AuthInput
            id="login-email"
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder={tShell("emailPlaceholder")}
          />
        </AuthField>
        <AuthField
          id="login-password"
          label={tCommon("password")}
          aux={
            <Link
              href="/reset"
              className="text-foreground rounded-sm text-[0.8125rem] underline underline-offset-[3px] outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
            >
              {t("forgotPassword")}
            </Link>
          }
        >
          <AuthInput
            id="login-password"
            type="password"
            name="password"
            required
            autoComplete="current-password"
          />
        </AuthField>
        {/* BEZ CAPTCHY I BEZ SLOTU NA NIĄ (ADR-164). Slot z ADR-156 trzymał
            72 px zawsze — także bez site key — więc samo usunięcie widżetu
            zostawiłoby na ekranie pustą lukę wysokości widżetu. Rezerwacja
            schodzi razem z tym, co rezerwowała; rejestracja i reset trzymają
            slot i widżet dalej. */}
        {/*
          DWA WYJŚCIA PRZY BŁĘDZIE (ADR-153, N3). Komunikat jest z konieczności
          generyczny — nie wolno mu zdradzić, czy konto istnieje — więc sam
          nie mówi, co dalej. Obie realne przyczyny („nie potwierdziłem
          adresu" i „nie pamiętam hasła") dostają tu drogę wyjścia, bez
          klasyfikowania czegokolwiek po stronie serwera. Do ADR-153 człowiek
          z poprawnym hasłem i niepotwierdzonym adresem czytał „nieprawidłowe
          hasło" i szedł w reset hasła, który nie pomaga.

          Restyling (ADR-156) zmienia wyłącznie pudełko: komunikat dalej
          przychodzi z akcji gotowy i trafia na ekran bez rozgałęzień.
        */}
        {state.error ? (
          <AuthNotice
            data-login-error
            tone="problem"
            role="alert"
            actions={
              <>
                <Link href="/register/sprawdz-skrzynke" className="underline underline-offset-[3px]">
                  {t("resendConfirmation")}
                </Link>
                <Link href="/reset" className="underline underline-offset-[3px]">
                  {t("forgotPassword")}
                </Link>
              </>
            }
          >
            {state.error}
          </AuthNotice>
        ) : null}
        <AuthSubmit pending={pending}>{pending ? t("submitPending") : t("submit")}</AuthSubmit>
      </form>
      {/* TODO(Task 3 infra): przycisk „Zaloguj przez Google" — wymaga
          skonfigurowanego OAuth clienta (brak credentiali). */}
      {/* JEDNO STAŁE WYJŚCIE, NIE DWA (ADR-164, decyzja właściciela). Stało tu
          jeszcze „Nie dostałeś maila potwierdzającego?" — pytanie, które ma
          sens po REJESTRACJI, a nie na ekranie, na który przychodzi się
          wpisać hasło. Droga do `/register/sprawdz-skrzynke` nie zniknęła:
          prowadzi tam ekran rejestracji (odnośnik stały), przekierowanie po
          udanym założeniu konta oraz wyjście przy błędzie logowania wyżej
          (ADR-153, N3) — czyli dokładnie te miejsca, w których człowiek
          faktycznie czeka na maila. */}
      <AuthLinks>
        <span>
          {t("noAccount")}{" "}
          <Link
            href={registerHref}
            className="text-foreground font-medium underline underline-offset-[3px]"
          >
            {t("register")}
          </Link>
        </span>
      </AuthLinks>
    </>
  );
}
