"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

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
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        {state.success ? <p className="text-sm text-green-700">{state.success}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {pending ? t("submitPending") : t("submit")}
        </button>
      </form>
    </main>
  );
}
