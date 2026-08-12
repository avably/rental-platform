"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Link } from "@/i18n/navigation";

import { resetConfirmAction, type ResetConfirmState } from "./actions";

const initialState: ResetConfirmState = {};

/**
 * Formularz nowego hasła (ADR-153, N7).
 *
 * Renderowany WYŁĄCZNIE, gdy serwer potwierdził świeży dowód recovery
 * (patrz page.tsx) — do tej naprawy stał na ekranie zawsze, także bez sesji,
 * i odrzucał człowieka dopiero PO wymyśleniu i wpisaniu hasła.
 *
 * Bramka serwerowa nie znika przez to z akcji: sesja może wygasnąć MIĘDZY
 * renderem a wysłaniem, a formularz da się wywołać bez tej strony. Dlatego
 * odmowa akcji zostaje w mocy, a tutaj dostaje to, czego jej brakowało —
 * DZIAŁAJĄCY odnośnik po nowy link. „Poproś o nowy link" było dotąd zdaniem
 * w komunikacie, a nie drogą wyjścia.
 */
export function ResetConfirmForm() {
  const [state, formAction, pending] = useActionState(resetConfirmAction, initialState);
  const t = useTranslations("resetConfirm");

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {t("newPassword")}
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="rounded border px-3 py-2"
        />
      </label>
      {state.error ? (
        <div data-reset-confirm-error className="flex flex-col gap-1">
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
          <p className="text-sm">
            <Link href="/reset" className="underline">
              {t("requestNewLink")}
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
  );
}
