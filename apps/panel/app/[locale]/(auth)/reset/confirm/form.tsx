"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Link } from "@/i18n/navigation";

import { AuthNotice, AuthSubmit } from "../../auth-ui";
import { AuthPasswordField } from "../../password-field";
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
 *
 * BEZ BŁĘDU NIE MA TU ANI JEDNEGO ODNOŚNIKA i tak ma zostać: wyjścia ekranu
 * („wróć do logowania") niesie strona, a nie formularz — inaczej wyglądałyby
 * jak część kroku, który człowiek właśnie wykonuje.
 */
export function ResetConfirmForm() {
  const [state, formAction, pending] = useActionState(resetConfirmAction, initialState);
  const t = useTranslations("resetConfirm");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <AuthPasswordField
        id="reset-confirm-password"
        label={t("newPassword")}
        hint={t("passwordHint")}
        minLength={8}
      />
      {state.error ? (
        <AuthNotice
          data-reset-confirm-error
          tone="problem"
          role="alert"
          actions={
            <Link href="/reset" className="underline underline-offset-[3px]">
              {t("requestNewLink")}
            </Link>
          }
        >
          {state.error}
        </AuthNotice>
      ) : null}
      <AuthSubmit pending={pending}>{pending ? t("submitPending") : t("submit")}</AuthSubmit>
    </form>
  );
}
