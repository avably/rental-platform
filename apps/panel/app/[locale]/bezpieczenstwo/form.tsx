"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { enrollTotpAction, verifyTotpAction, type EnrollState, type VerifyState } from "./actions";

const enrollInitial: EnrollState = {};
const verifyInitial: VerifyState = {};

/**
 * `next` przenosimy ukrytym polem — dokładnie jak w wyzwaniu MFA
 * (wyzwanie/form.tsx). Udana weryfikacja kończy się przekierowaniem po stronie
 * serwera, więc formularz nie ma już stanu „sukces" do wyrenderowania.
 */
export function TotpEnrollForm({ next }: { next?: string }) {
  const [enrollState, enrollFormAction, enrollPending] = useActionState(
    enrollTotpAction,
    enrollInitial,
  );
  const [verifyState, verifyFormAction, verifyPending] = useActionState(
    verifyTotpAction,
    verifyInitial,
  );
  const t = useTranslations("security");

  if (!enrollState.factorId) {
    return (
      <form action={enrollFormAction} className="flex flex-col gap-3">
        {enrollState.error ? <p className="text-sm text-red-600">{enrollState.error}</p> : null}
        <button
          type="submit"
          disabled={enrollPending}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {enrollPending ? t("enrollPending") : t("enrollSubmit")}
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600">
        {t("scanHint")} <code className="break-all">{enrollState.secret}</code>
      </p>
      {enrollState.qrCode ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase zwraca gotowy data:image/svg+xml, bez optymalizacji next/image.
        <img src={enrollState.qrCode} alt={t("qrAlt")} width={200} height={200} />
      ) : null}
      <form action={verifyFormAction} className="flex flex-col gap-3">
        <input type="hidden" name="factorId" value={enrollState.factorId} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <label className="flex flex-col gap-1 text-sm">
          {t("codeLabel")}
          <input
            type="text"
            name="code"
            required
            pattern="\d{6}"
            inputMode="numeric"
            className="rounded border px-3 py-2"
          />
        </label>
        {verifyState.error ? <p className="text-sm text-red-600">{verifyState.error}</p> : null}
        <button
          type="submit"
          disabled={verifyPending}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {verifyPending ? t("verifyPending") : t("verifySubmit")}
        </button>
      </form>
    </div>
  );
}
