"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Link } from "@/i18n/navigation";

import { AuthCaptchaField } from "../captcha-field";
import { registerAction, type RegisterState } from "./actions";

// Warstwa wizualna (stylowanie @avably/ui) — pas GPT (docs/DOKUMENTACJA.md
// §2). Tu wyłącznie funkcjonalny szkielet: formularz + akcja serwerowa.
const initialState: RegisterState = {};

export function RegisterForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(registerAction, initialState);
  const t = useTranslations("register");
  const tCommon = useTranslations("common");

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

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
            minLength={8}
            autoComplete="new-password"
            className="rounded border px-3 py-2"
          />
        </label>
        {/* Widżet + ukryty input turnstileToken; bez site key renderuje nic
            (semantyka włączenia — L2/ADR-106). */}
        <AuthCaptchaField resetSignal={state} />
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <button
          type="submit"
          aria-busy={pending || undefined}
          disabled={pending}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {pending ? t("submitPending") : t("submit")}
        </button>
      </form>
      <p className="text-sm">
        {t("haveAccount")}{" "}
        <Link href={loginHref} className="underline">
          {t("login")}
        </Link>
      </p>
    </>
  );
}
