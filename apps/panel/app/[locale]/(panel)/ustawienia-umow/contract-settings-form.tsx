"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { ContractDocumentSettings } from "@/lib/contract-settings";
import type { FormState } from "@/lib/form-state";

import { saveContractSettingsAction } from "./actions";

function Feedback({ state }: { state: FormState }) {
  const t = useTranslations("contractSettings");
  const message = state.formError ?? Object.values(state.fieldErrors ?? {})[0];
  if (message) return <p role="alert" className="text-sm text-destructive">{message}</p>;
  return state.success ? <p className="text-sm text-status-positive-fg">{t("saved")}</p> : null;
}

export function ContractSettingsForm({ defaults }: { defaults: ContractDocumentSettings | null }) {
  const t = useTranslations("contractSettings");
  const [state, action, pending] = useActionState(saveContractSettingsAction, {});
  return (
    <form action={action} className="flex flex-col gap-3 rounded border p-4">
      <Label htmlFor="contract-address">{t("address")}</Label>
      <textarea id="contract-address" name="address" required maxLength={500} defaultValue={defaults?.address ?? ""} disabled={pending} className="min-h-20 rounded border bg-background px-3 py-2 text-sm" />
      <Label htmlFor="contract-nip">{t("nip")}</Label>
      <Input id="contract-nip" name="nip" maxLength={30} defaultValue={defaults?.nip ?? ""} disabled={pending} />
      <Label htmlFor="contract-email">{t("email")}</Label>
      <Input id="contract-email" name="email" type="email" required maxLength={320} defaultValue={defaults?.email ?? ""} disabled={pending} />
      <Label htmlFor="contract-terms-version">{t("termsVersion")}</Label>
      <Input id="contract-terms-version" name="terms_version" required maxLength={100} defaultValue={defaults?.terms_version ?? ""} disabled={pending} />
      <Label htmlFor="contract-terms-body">{t("termsBody")}</Label>
      <textarea id="contract-terms-body" name="terms_body" required maxLength={50_000} defaultValue={defaults?.terms_body ?? ""} disabled={pending} className="min-h-64 rounded border bg-background px-3 py-2 text-sm" />
      <Button type="submit" disabled={pending}>{t("save")}</Button>
      <Feedback state={state} />
    </form>
  );
}
