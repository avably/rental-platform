"use client";

import { useActionState } from "react";

import { resetConfirmAction, type ResetConfirmState } from "./actions";

const initialState: ResetConfirmState = {};

export default function ResetConfirmPage() {
  const [state, formAction, pending] = useActionState(resetConfirmAction, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Ustaw nowe hasło</h1>
      <form action={formAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Nowe hasło
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="rounded border px-3 py-2"
          />
        </label>
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {pending ? "Zapisuję…" : "Ustaw hasło"}
        </button>
      </form>
    </main>
  );
}
