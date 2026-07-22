"use client";

import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { FormState } from "@/lib/form-state";

import { generateContractAction, sendContractAction } from "./contract-actions";

function Result({ state }: { state: FormState }) {
  if (state.formError) return <p role="alert" className="text-sm text-destructive">{state.formError}</p>;
  return state.success ? <p className="text-sm text-status-positive-fg">{state.success}</p> : null;
}

export function GenerateContractForm({ orderId }: { orderId: string }) {
  const t = useTranslations("orders.contract");
  const [state, action, pending] = useActionState(generateContractAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" disabled={pending}>{pending ? t("generating") : t("generate")}</Button>
      <Result state={state} />
    </form>
  );
}

export function SendContractForm({ orderId, documentId, attemptId, retry }: { orderId: string; documentId: string; attemptId: string; retry: boolean }) {
  const t = useTranslations("orders.contract");
  const [state, action, pending] = useActionState(sendContractAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="attemptId" value={attemptId} />
      <Button type="submit" variant="outline" disabled={pending}>{pending ? t("sending") : retry ? t("retry") : t("send")}</Button>
      <Result state={state} />
    </form>
  );
}
