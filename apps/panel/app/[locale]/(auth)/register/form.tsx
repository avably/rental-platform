"use client";

import { CANONICAL_SITE_URL } from "@avably/core";
import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";

import { Link } from "@/i18n/navigation";

import {
  AuthCaptchaSlot,
  AuthField,
  AuthInput,
  AuthLinks,
  AuthNotice,
  AuthSubmit,
} from "../auth-ui";
import { AuthCaptchaField } from "../captcha-field";
import { AuthPasswordField } from "../password-field";
import { registerAction, type RegisterState } from "./actions";

const initialState: RegisterState = {};

export function RegisterForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(registerAction, initialState);
  const t = useTranslations("register");
  const tCommon = useTranslations("common");
  const tShell = useTranslations("authShell");
  const locale = useLocale();

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <AuthField id="register-email" label={tCommon("email")}>
          <AuthInput
            id="register-email"
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder={tShell("emailPlaceholder")}
          />
        </AuthField>
        <AuthPasswordField
          id="register-password"
          label={tCommon("password")}
          hint={t("passwordHint")}
          minLength={8}
        />
        {/* Widżet + ukryty input turnstileToken; bez site key renderuje nic
            (semantyka włączenia — L2/ADR-106). Miejsce trzyma SLOT, nie
            widżet: patrz komentarz przy AuthCaptchaSlot. */}
        <AuthCaptchaSlot>
          <AuthCaptchaField resetSignal={state} />
        </AuthCaptchaSlot>
        {state.error ? (
          <AuthNotice data-register-error tone="problem" role="alert">
            {state.error}
          </AuthNotice>
        ) : null}
        <AuthSubmit pending={pending}>{pending ? t("submitPending") : t("submit")}</AuthSubmit>
        <p className="text-muted-foreground -mt-1 text-center text-[0.8125rem] leading-[18px]">
          {t("afterCta")}
        </p>
      </form>

      {/*
        MIEJSCE NOTY INFORMACYJNEJ (art. 13 RODO). Stoją tu SAME ODNOŚNIKI do
        dokumentów, które istnieją — bez zdania o akceptacji czegokolwiek.
        Umowę zawiera ORGANIZACJA, nie adres e-mail: zgoda na regulamin jest
        pobierana przy zakładaniu organizacji i ma tam dowód z kluczem obcym.
        Wpisanie tu „zakładając konto akceptujesz…" byłoby zmianą momentu
        zawarcia umowy zrobioną w warstwie widoku.
      */}
      <p className="border-border text-muted-foreground border-t pt-4 text-[0.8125rem]">
        <a
          href={`${CANONICAL_SITE_URL}/${locale}/privacy`}
          className="text-foreground font-medium underline underline-offset-[3px]"
        >
          {tShell("privacy")}
        </a>
        {" · "}
        <a
          href={`${CANONICAL_SITE_URL}/${locale}/terms`}
          className="text-foreground font-medium underline underline-offset-[3px]"
        >
          {tShell("terms")}
        </a>
      </p>

      <AuthLinks>
        <span>
          {t("haveAccount")}{" "}
          <Link
            href={loginHref}
            className="text-foreground font-medium underline underline-offset-[3px]"
          >
            {t("login")}
          </Link>
        </span>
        <Link
          href="/register/sprawdz-skrzynke"
          className="text-foreground w-fit font-medium underline underline-offset-[3px]"
        >
          {t("noConfirmationMail")}
        </Link>
      </AuthLinks>
    </>
  );
}
