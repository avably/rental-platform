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
  actions,
}: {
  orderId: string;
  balanceGrosze: number;
  suggestedCollectGrosze: number;
  currency: CurrencyCode;
  locale: string;
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
        <form action={refundAction} className="flex flex-col gap-2">
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="amount" value={groszeToInputValue(Math.max(balanceGrosze, 0))} />
          <Button type="submit" variant="outline" disabled={settleDisabled}>
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
            disabled={settleDisabled}
          />
          <Button type="submit" disabled={settleDisabled}>
            {t("refundPartialCta")}
          </Button>
        </form>
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
