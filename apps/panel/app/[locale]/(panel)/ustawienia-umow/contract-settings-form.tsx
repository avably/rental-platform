"use client";

import { Button, Input, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { ScreenSection } from "@/components/screens/screen-header";
import type { ContractDocumentSettings } from "@/lib/contract-settings";
import type { FormState } from "@/lib/form-state";

import { saveContractSettingsAction } from "./actions";

function Feedback({ state }: { state: FormState }) {
  const t = useTranslations("contractSettings");
  const message = state.formError ?? Object.values(state.fieldErrors ?? {})[0];
  if (message)
    return (
      <p role="alert" className="text-destructive text-sm">
        {message}
      </p>
    );
  return state.success ? (
    <span className="text-status-positive-fg text-sm">{t("saved")}</span>
  ) : null;
}

/**
 * Formularz ustawień umów w widoku właściciela (mockup P8:
 * `data-contract-mode="owner"`). Treść regulaminu dostaje pole o wysokości
 * długiego tekstu — to jedyne pole na tym ekranie, które ktoś naprawdę czyta
 * w całości przed zapisem.
 */
export function ContractSettingsForm({ defaults }: { defaults: ContractDocumentSettings | null }) {
  const t = useTranslations("contractSettings");
  const [state, action, pending] = useActionState(saveContractSettingsAction, {});
  return (
    <ScreenSection data-contract-mode="owner">
      <form action={action} className="flex flex-col gap-2 text-sm">
        <Label htmlFor="contract-address">{t("address")}</Label>
        <Textarea
          id="contract-address"
          name="address"
          required
          maxLength={500}
          defaultValue={defaults?.address ?? ""}
          disabled={pending}
          className="min-h-20"
        />
        <Label htmlFor="contract-nip">{t("nip")}</Label>
        <Input
          id="contract-nip"
          name="nip"
          maxLength={30}
          defaultValue={defaults?.nip ?? ""}
          disabled={pending}
        />
        <Label htmlFor="contract-email">{t("email")}</Label>
        <Input
          id="contract-email"
          name="email"
          type="email"
          required
          maxLength={320}
          defaultValue={defaults?.email ?? ""}
          disabled={pending}
        />
        <Label htmlFor="contract-terms-version">{t("termsVersion")}</Label>
        <Input
          id="contract-terms-version"
          name="terms_version"
          required
          maxLength={100}
          defaultValue={defaults?.terms_version ?? ""}
          disabled={pending}
        />
        <Label htmlFor="contract-terms-body">{t("termsBody")}</Label>
        <Textarea
          id="contract-terms-body"
          name="terms_body"
          required
          maxLength={50_000}
          defaultValue={defaults?.terms_body ?? ""}
          disabled={pending}
          className="min-h-64"
        />
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
          <Feedback state={state} />
        </div>
      </form>
    </ScreenSection>
  );
}
