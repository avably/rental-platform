"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Link } from "@/i18n/navigation";

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
        {/* TODO(Task 3 infra): widżet Turnstile, gdy NEXT_PUBLIC_TURNSTILE_SITE_KEY ustawiony. */}
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
