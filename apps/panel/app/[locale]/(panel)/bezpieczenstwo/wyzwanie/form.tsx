"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { ScreenSection } from "@/components/screens/screen-header";
import { SecondaryStatusChip } from "@/lib/secondary-status";

import { challengeTotpAction, type ChallengeState } from "./actions";

const initialState: ChallengeState = {};

/**
 * Stan 3 osi `security` z mockupu P8: sesja ma pierwszy poziom
 * uwierzytelnienia, czynnik JEST skonfigurowany — stąd chip `configured` przy
 * tytule. To jedyne miejsce tego przepływu, w którym stan „skonfigurowane"
 * mówi coś użytecznego: potwierdza, że kod jest gdzie sprawdzić.
 */
export function TotpChallengeForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(challengeTotpAction, initialState);
  const t = useTranslations("mfaChallenge");

  return (
    <ScreenSection
      data-security-state="challenge"
      title={t("title")}
      status={<SecondaryStatusChip axis="security" value="configured" />}
      description={t("body")}
    >
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Label htmlFor="totp-challenge">{t("codeLabel")}</Label>
        <Input
          id="totp-challenge"
          autoComplete="one-time-code"
          autoFocus
          className="tabular-nums"
          inputMode="numeric"
          name="code"
          pattern="\d{6}"
          required
          type="text"
        />
        {state.error ? (
          <p role="alert" className="text-destructive">
            {state.error}
          </p>
        ) : null}
        <div className="pt-2">
          <Button type="submit" loading={pending} disabled={pending}>
            {pending ? t("submitPending") : t("submit")}
          </Button>
        </div>
      </form>
    </ScreenSection>
  );
}
