"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { ScreenSection } from "@/components/screens/screen-header";
import { SecondaryStatusChip } from "@/lib/secondary-status";

import { enrollTotpAction, verifyTotpAction, type EnrollState, type VerifyState } from "./actions";

const enrollInitial: EnrollState = {};
const verifyInitial: VerifyState = {};

/**
 * Włączenie 2FA — dwa pierwsze stany osi `security` z mockupu P8.
 *
 * Stan 1 (`not-configured`) to karta ze stanem i jedną akcją. Stan 2
 * (`enrollment`) NIE jest kolejną sekcją tej samej strony, tylko jej
 * zastąpieniem: sekret pokazujemy JEDEN raz, w trakcie konfiguracji, i nie ma
 * on prawa zostać na ekranie jako ozdobna treść po jej zakończeniu. Dlatego
 * karta stanu 1 znika, gdy zaczyna się rejestracja czynnika.
 *
 * `next` przenosimy ukrytym polem — dokładnie jak w wyzwaniu MFA
 * (wyzwanie/form.tsx). Udana weryfikacja kończy się przekierowaniem po stronie
 * serwera, więc formularz nie ma już stanu „sukces" do wyrenderowania.
 */
export function TotpEnrollForm({
  next,
  initialState = enrollInitial,
}: {
  next?: string;
  /**
   * Szew jak w formularzu katalogu (P4): `useActionState` oddaje przy renderze
   * serwerowym WYŁĄCZNIE stan początkowy, więc drugiego stanu ekranu nie da się
   * inaczej obejrzeć w kontrakcie renderu. W produkcie zawsze pusty.
   */
  initialState?: EnrollState;
}) {
  const [enrollState, enrollFormAction, enrollPending] = useActionState(
    enrollTotpAction,
    initialState,
  );
  const [verifyState, verifyFormAction, verifyPending] = useActionState(
    verifyTotpAction,
    verifyInitial,
  );
  const t = useTranslations("security");

  if (!enrollState.factorId) {
    return (
      <ScreenSection
        data-security-state="not-configured"
        title={t("enrollTitle")}
        status={<SecondaryStatusChip axis="security" value="not_configured" />}
        description={t("enrollBody")}
      >
        <form action={enrollFormAction} className="flex flex-col gap-2 text-sm">
          {enrollState.error ? (
            <p role="alert" className="text-destructive">
              {enrollState.error}
            </p>
          ) : null}
          <div>
            <Button type="submit" loading={enrollPending} disabled={enrollPending}>
              {enrollPending ? t("enrollPending") : t("enrollSubmit")}
            </Button>
          </div>
        </form>
      </ScreenSection>
    );
  }

  return (
    <ScreenSection data-security-state="enrollment" title={t("enrollmentTitle")}>
      <div className="flex flex-col gap-3 text-sm">
        {enrollState.qrCode ? (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase zwraca gotowy data:image/svg+xml, bez optymalizacji next/image.
          <img
            src={enrollState.qrCode}
            alt={t("qrAlt")}
            width={160}
            height={160}
            className="border-border bg-secondary rounded-md border"
          />
        ) : null}
        <p className="text-muted-foreground">{t("scanHint")}</p>
        <code
          data-totp-secret
          className="border-border bg-secondary text-secondary-foreground rounded-md border p-3 font-sans text-[13px] leading-[18px] font-semibold break-all"
        >
          {enrollState.secret}
        </code>
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("secretOnceHint")}</p>
      </div>

      <form action={verifyFormAction} className="flex flex-col gap-2 text-sm">
        <input type="hidden" name="factorId" value={enrollState.factorId} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Label htmlFor="totp-verify">{t("codeLabel")}</Label>
        <Input
          id="totp-verify"
          type="text"
          name="code"
          required
          pattern="\d{6}"
          inputMode="numeric"
          autoComplete="one-time-code"
          className="tabular-nums"
        />
        {verifyState.error ? (
          <p role="alert" className="text-destructive">
            {verifyState.error}
          </p>
        ) : null}
        <div className="pt-2">
          <Button type="submit" loading={verifyPending} disabled={verifyPending}>
            {verifyPending ? t("verifyPending") : t("verifySubmit")}
          </Button>
        </div>
      </form>
    </ScreenSection>
  );
}
