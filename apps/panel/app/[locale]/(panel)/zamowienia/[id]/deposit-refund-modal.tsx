"use client";

/**
 * Modal „Zwróć kaucję" — JEDNA decyzja operatora w jednym oknie
 * (uwagi właściciela D7 i N5).
 *
 * ================== CO JEST NA WIERZCHU, A CO TUTAJ ==================
 *
 * Na ekranie zamówienia zostaje jedna liczba (saldo kaucji), jedno zdanie
 * o obiegu i JEDEN przycisk. Wszystko, co jest ROZSTRZYGNIĘCIEM — kwota,
 * potrącenie, powód, potwierdzenie — mieszka tutaj, bo pytania zadaje się
 * wtedy, gdy ktoś podjął decyzję, a nie zamiast niej. Chronologia rejestru
 * jest DOWODEM (spór z klientem), a dowód czyta się, kiedy jest sporny —
 * dlatego zjechała do rozwijanych szczegółów, nie na pierwszy plan.
 *
 * ================== ARYTMETYKA WYŁĄCZNIE W GROSZACH ==================
 *
 * „Klient dostanie X" liczy się jako `saldo − potrącenie` na liczbach
 * całkowitych (grosze), nigdy na złotówkach: odejmowanie zmiennoprzecinkowe
 * potrafi rozminąć się z saldem o grosz, a wtedy „zwróć resztę" zostawia
 * w rejestrze resztę nie do rozliczenia. Kwota zwrotu jest polem —
 * podpowiadanym z tego odejmowania, ale EDYTOWALNYM, bo zwrot w ratach jest
 * legalny (0031/0032 celowo dopuszczają kolejne zwroty częściowe w czasie).
 * Gdy operator dotknie pola, podpowiadanie milknie: liczba wpisana ręcznie
 * nie ma prawa zmienić się pod palcami.
 *
 * PODGLĄD TO NIE BRAMKA. Nadmiarowe potrącenie i nadmiarowy zwrot odrzuca
 * trigger `deposit_events_gate` z 0011, a przy obiegu dostawcy dodatkowo
 * sam dostawca. Ten komponent ma nie kłamać, a nie orzekać.
 */
import { formatMoney, type CurrencyCode } from "@avably/core";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Textarea,
} from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import type { FormState } from "@/lib/form-state";
import { groszeToInputValue, parseMajorToGrosze } from "@/lib/money-input";
import { DEDUCTION_REASON_CODES } from "@/lib/order-validation";

import { refundAfterDeduction } from "./deposit-settle";

type SettleAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

export function DepositRefundModal({
  orderId,
  balanceGrosze,
  currency,
  locale,
  online,
  refundInFlight,
  action,
}: {
  orderId: string;
  balanceGrosze: number;
  currency: CurrencyCode;
  locale: string;
  /** Zamówienie w obiegu dostawcy — zwrot idzie realnym refundem (ADR-069). */
  online: boolean;
  /** Jest już zwrot zlecony i niepotwierdzony — drugi byłby drugą wypłatą. */
  refundInFlight: boolean;
  action: SettleAction;
}) {
  const t = useTranslations("orders.deposit");
  const [open, setOpen] = useState(false);

  const [deductInput, setDeductInput] = useState("");
  const [deductOn, setDeductOn] = useState(false);
  const [refundInput, setRefundInput] = useState(() => groszeToInputValue(Math.max(balanceGrosze, 0)));
  const [refundTouched, setRefundTouched] = useState(false);

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData);
      // Zamykamy WYŁĄCZNIE na potwierdzonym sukcesie. „Zwrot w toku"
      // (`notice`) zostaje na ekranie modalu: to jest zdanie, które operator
      // ma przeczytać, zanim sięgnie po przycisk drugi raz.
      if (result.success) setOpen(false);
      return result;
    },
    {},
  );

  const deductGrosze = deductOn ? (parseMajorToGrosze(deductInput) ?? 0) : 0;
  const suggestedRefund = refundAfterDeduction(Math.max(balanceGrosze, 0), deductGrosze);
  const refundValue = refundTouched ? refundInput : groszeToInputValue(suggestedRefund);
  const refundGrosze = parseMajorToGrosze(refundValue) ?? 0;

  const blocked = balanceGrosze <= 0 || (online && refundInFlight);
  const fieldError = (name: string) => state.fieldErrors?.[name];

  function reset() {
    setDeductOn(false);
    setDeductInput("");
    setRefundTouched(false);
    setRefundInput(groszeToInputValue(Math.max(balanceGrosze, 0)));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" disabled={blocked}>
          {t("refundCta")}
        </Button>
      </DialogTrigger>
      {/* Szerokość zostaje domyślna z `DialogContent` (@avably/ui) — okno
          dialogowe nie jest ekranem i nie definiuje własnego kontenera
          (kontrakt spójności, ADR-060). */}
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("refundModalTitle")}</DialogTitle>
          {/* Operator musi wiedzieć, czy klika „zapisz, że oddałem", czy
              „przelej pieniądze klientowi" — to dwie różne odpowiedzialności. */}
          <DialogDescription>
            {online ? t("refundOnlineHint") : t("refundManualHint")}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4 text-sm">
          <input type="hidden" name="orderId" value={orderId} />

          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">{t("balance")}</span>
            <span className="font-semibold tabular-nums tracking-[0.01em]">
              {formatMoney(Math.max(balanceGrosze, 0), currency, locale)}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {/* Checkbox natywny, nie komponent overlaya: Radix Checkbox nie
                wysyła wartości w FormData bez ukrytego pola, a tu i tak
                sterujemy widocznością sekcji stanem Reacta. */}
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={deductOn}
                onChange={(event) => setDeductOn(event.target.checked)}
                disabled={pending}
                className="size-4"
              />
              {t("deductToggle")}
            </label>

            {deductOn ? (
              <div className="border-border flex flex-col gap-2 rounded-md border p-3">
                <Label htmlFor="deposit-deduct-amount">{t("deductAmountLabel")}</Label>
                <Input
                  id="deposit-deduct-amount"
                  name="deductAmount"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={deductInput}
                  onChange={(event) => setDeductInput(event.target.value)}
                  disabled={pending}
                  aria-invalid={fieldError("deductAmount") ? true : undefined}
                />
                {fieldError("deductAmount") ? (
                  <p className="text-destructive text-sm">{fieldError("deductAmount")}</p>
                ) : null}

                <Label htmlFor="deposit-deduct-reason-code">{t("reasonCodeLabel")}</Label>
                <PanelSelect
                  id="deposit-deduct-reason-code"
                  name="deductReasonCode"
                  defaultValue="damage"
                  disabled={pending}
                  className="rounded border px-3 py-2"
                  options={DEDUCTION_REASON_CODES.map((code) => ({
                    value: code,
                    label: t(`reasonCodes.${code}`),
                  }))}
                />
                {fieldError("deductReasonCode") ? (
                  <p className="text-destructive text-sm">{fieldError("deductReasonCode")}</p>
                ) : null}

                <Label htmlFor="deposit-deduct-reason">{t("reasonLabel")}</Label>
                <Input
                  id="deposit-deduct-reason"
                  name="deductReason"
                  placeholder={t("reasonPlaceholder")}
                  disabled={pending}
                  aria-invalid={fieldError("deductReason") ? true : undefined}
                />
                {fieldError("deductReason") ? (
                  <p className="text-destructive text-sm">{fieldError("deductReason")}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="deposit-refund-amount">{t("refundAmountLabel")}</Label>
            <Input
              id="deposit-refund-amount"
              name="refundAmount"
              inputMode="decimal"
              placeholder="0,00"
              value={refundValue}
              onChange={(event) => {
                setRefundTouched(true);
                setRefundInput(event.target.value);
              }}
              disabled={pending}
              aria-invalid={fieldError("refundAmount") ? true : undefined}
            />
            {fieldError("refundAmount") ? (
              <p className="text-destructive text-sm">{fieldError("refundAmount")}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="deposit-refund-note">{t("refundNoteLabel")}</Label>
            <Textarea
              id="deposit-refund-note"
              name="refundNote"
              rows={2}
              placeholder={t("refundNotePlaceholder")}
              disabled={pending}
            />
          </div>

          {/* PODSUMOWANIE PRZED POTWIERDZENIEM. Zdanie, które operator ma
              porównać z tym, co zamierzał — nie druga kopia pól wyżej. */}
          <div className="border-border bg-muted/40 flex flex-col gap-1 rounded-md border p-3">
            {deductGrosze > 0 ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{t("summaryKept")}</span>
                <span className="tabular-nums tracking-[0.01em]">
                  {formatMoney(deductGrosze, currency, locale)}
                </span>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-3 font-semibold">
              <span>{online ? t("summaryPaidOut") : t("summaryPaidOutManual")}</span>
              <span className="tabular-nums tracking-[0.01em]">
                {formatMoney(refundGrosze, currency, locale)}
              </span>
            </div>
          </div>

          {state.formError ? (
            <p role="alert" className="text-destructive text-sm">
              {state.formError}
            </p>
          ) : null}
          {/* Stan pośredni (zwrot przyjęty, jeszcze niepotwierdzony) —
              `status`, nie `alert`: operator nie ma tu czego naprawiać. */}
          {state.notice ? (
            <p role="status" className="text-muted-foreground text-sm">
              {state.notice}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || blocked}>
              {t("refundConfirmCta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
