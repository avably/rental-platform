"use client";

import { Button, Input, Label } from "@avably/ui";
import { formatMoney, type CurrencyCode } from "@avably/core";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import type { FormState } from "@/lib/form-state";
import { groszeToInputValue } from "@/lib/money-input";
import { DEDUCTION_REASON_CODES } from "@/lib/order-validation";

const initialState: FormState = {};

type DepositAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

function FormMessages({ state }: { state: FormState }) {
  if (state.formError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {state.formError}
      </p>
    );
  }
  if (state.fieldErrors) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {Object.values(state.fieldErrors)[0]}
      </p>
    );
  }
  // Stan pośredni (zwrot przyjęty, jeszcze niepotwierdzony) — `status`,
  // nie `alert`: czytnik ekranu ma przeczytać to jako informację, bo
  // operator nie ma tu czego naprawiać (Z5, ADR-068).
  if (state.notice) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {state.notice}
      </p>
    );
  }
  return null;
}

/**
 * Formularze rozliczeń kaucji: pobranie, zwrot pełny/częściowy, potrącenie
 * ze strukturalnym powodem. To jest UI — autorytatywnie odmawia trigger
 * 0011 (saldo) i CHECK (kształt powodu); zwrot pełny niesie kwotę salda
 * WIDZIANEGO przez operatora (optymistyczna współbieżność — nadmiar
 * odrzuci baza, nie ślepy re-odczyt po stronie serwera).
 */
export function DepositForms({
  orderId,
  balanceGrosze,
  suggestedCollectGrosze,
  currency,
  locale,
  online,
  refundInFlight,
  actions,
}: {
  orderId: string;
  balanceGrosze: number;
  suggestedCollectGrosze: number;
  currency: CurrencyCode;
  locale: string;
  /** Zamówienie w obiegu dostawcy — zwrot idzie realnym refundem (ADR-068). */
  online: boolean;
  /** Jest już zwrot zlecony i niepotwierdzony — drugi byłby drugą wypłatą. */
  refundInFlight: boolean;
  actions: {
    collect: DepositAction;
    refund: DepositAction;
    deduct: DepositAction;
  };
}) {
  const t = useTranslations("orders.deposit");
  const [collectState, collectAction, collectPending] = useActionState(actions.collect, initialState);
  const [refundState, refundAction, refundPending] = useActionState(actions.refund, initialState);
  const [deductState, deductAction, deductPending] = useActionState(actions.deduct, initialState);

  const pending = collectPending || refundPending || deductPending;
  const settleDisabled = pending || balanceGrosze <= 0;
  // Blokada zwrotu przy zwrocie w toku jest tu WYGODĄ, nie bramką: przycisk
  // wyłączony w przeglądarce nie broni przed drugą kartą ani powtórzonym
  // żądaniem. Autorytatywnie odmawia `requestDepositRefund` (lib/deposit-refund.ts).
  const refundDisabled = settleDisabled || (online && refundInFlight);

  return (
    <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
      <form action={collectAction} className="flex flex-col gap-2 rounded border p-3">
        <p className="font-medium">{t("collectTitle")}</p>
        <input type="hidden" name="orderId" value={orderId} />
        <Label htmlFor="deposit-collect-amount">{t("amountLabel")}</Label>
        <Input
          id="deposit-collect-amount"
          name="amount"
          inputMode="decimal"
          defaultValue={suggestedCollectGrosze > 0 ? groszeToInputValue(suggestedCollectGrosze) : ""}
          placeholder="0,00"
        />
        <Button type="submit" disabled={pending}>
          {t("collectCta")}
        </Button>
        <FormMessages state={collectState} />
      </form>

      <div className="flex flex-col gap-2 rounded border p-3">
        <p className="font-medium">{t("refundTitle")}</p>
        {/* Operator musi wiedzieć, czy klika „zapisz, że oddałem", czy
            „przelej pieniądze klientowi" — to dwie różne odpowiedzialności. */}
        <p className="text-muted-foreground text-xs">
          {online ? t("refundOnlineHint") : t("refundManualHint")}
        </p>
        <form action={refundAction} className="flex flex-col gap-2">
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="amount" value={groszeToInputValue(Math.max(balanceGrosze, 0))} />
          <Button type="submit" variant="outline" disabled={refundDisabled}>
            {t("refundFullCta", { amount: formatMoney(Math.max(balanceGrosze, 0), currency, locale) })}
          </Button>
        </form>
        <form action={refundAction} className="flex flex-col gap-2">
          <input type="hidden" name="orderId" value={orderId} />
          <Label htmlFor="deposit-refund-amount">{t("amountLabel")}</Label>
          <Input
            id="deposit-refund-amount"
            name="amount"
            inputMode="decimal"
            placeholder="0,00"
            disabled={refundDisabled}
          />
          <Button type="submit" disabled={refundDisabled}>
            {t("refundPartialCta")}
          </Button>
        </form>
        {online && refundInFlight ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t("refundInFlightBlocked")}
          </p>
        ) : null}
        <FormMessages state={refundState} />
      </div>

      <form action={deductAction} className="flex flex-col gap-2 rounded border p-3">
        <p className="font-medium">{t("deductTitle")}</p>
        <input type="hidden" name="orderId" value={orderId} />
        <Label htmlFor="deposit-deduct-amount">{t("amountLabel")}</Label>
        <Input
          id="deposit-deduct-amount"
          name="amount"
          inputMode="decimal"
          placeholder="0,00"
          disabled={settleDisabled}
        />
        <Label htmlFor="deposit-deduct-reason-code">{t("reasonCodeLabel")}</Label>
        <PanelSelect
          id="deposit-deduct-reason-code"
          name="reasonCode"
          defaultValue="damage"
          disabled={settleDisabled}
          className="rounded border px-3 py-2"
          options={DEDUCTION_REASON_CODES.map((code) => ({
            value: code,
            label: t(`reasonCodes.${code}`),
          }))}
        />
        <Label htmlFor="deposit-deduct-reason">{t("reasonLabel")}</Label>
        <Input
          id="deposit-deduct-reason"
          name="reason"
          placeholder={t("reasonPlaceholder")}
          disabled={settleDisabled}
        />
        <Button type="submit" variant="outline" disabled={settleDisabled}>
          {t("deductCta")}
        </Button>
        <FormMessages state={deductState} />
      </form>
    </div>
  );
}
