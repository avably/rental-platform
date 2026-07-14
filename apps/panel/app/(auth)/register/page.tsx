"use client";

import Link from "next/link";
import { useActionState } from "react";

import { registerAction, type RegisterState } from "./actions";

// Warstwa wizualna (stylowanie @rental/ui) — pas GPT (docs/DOKUMENTACJA.md
// §2). Tu wyłącznie funkcjonalny szkielet: formularz + akcja serwerowa.
const initialState: RegisterState = {};

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(registerAction, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Załóż konto</h1>
      <form action={formAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          E-mail
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="rounded border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Hasło
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="rounded border px-3 py-2"
          />
        </label>
        {/* TODO(Task 3 infra): widżet Turnstile, gdy NEXT_PUBLIC_TURNSTILE_SITE_KEY ustawiony (patrz lib/turnstile.ts). */}
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {pending ? "Rejestruję…" : "Zarejestruj się"}
        </button>
      </form>
      <p className="text-sm">
        Masz już konto?{" "}
        <Link href="/login" className="underline">
          Zaloguj się
        </Link>
      </p>
    </main>
  );
}
