"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { challengeTotpAction, type ChallengeState } from "./actions";

const initialState: ChallengeState = {};

export function TotpChallengeForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(challengeTotpAction, initialState);
  const t = useTranslations("mfaChallenge");

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <label className="flex flex-col gap-1 text-sm">
        {t("codeLabel")}
        <input
          autoComplete="one-time-code"
          autoFocus
          className="rounded border px-3 py-2"
          inputMode="numeric"
          name="code"
          pattern="\d{6}"
          required
          type="text"
        />
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <button
        className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        {pending ? t("submitPending") : t("submit")}
      </button>
    </form>
  );
}
