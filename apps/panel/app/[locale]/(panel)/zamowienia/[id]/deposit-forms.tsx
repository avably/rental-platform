"use client";

/**
 * Powierzchnia działania na kaucji (uproszczenie D7/N5).
 *
 * ================== CO ZOSTAŁO NA WIERZCHU I DLACZEGO ==================
 *
 * Trzy równorzędne kafle formularzy zeszły do JEDNEJ liczby, JEDNEGO zdania
 * o obiegu i JEDNEGO przycisku. Powód nie jest estetyczny: poprzedni układ
 * pytał operatora o trzy rzeczy naraz w chwili, w której ten podjął jedną
 * decyzję („klient oddał sprzęt, rozliczamy kaucję"), a najczęstsza ścieżka —
 * oddaj wszystko — wymagała przeczytania wszystkich trzech, żeby zrozumieć,
 * że dwa go nie dotyczą.
 *
 * Saldo jest tu jedyną liczbą pierwszego planu, bo jest jedyną odpowiedzią,
 * po którą operator przychodzi: „ile trzymamy pieniędzy klienta". Rozbicie
 * (pobrano / rozliczono) i chronologia zdarzeń są DOWODEM w sporze — czyta
 * się je wtedy, gdy spór jest, więc mieszkają w rozwijanych szczegółach.
 *
 * ================== ROZDZIAŁ OBIEGÓW JEST TU BRAMKĄ, NIE ETYKIETĄ ==========
 *
 * W obiegu dostawcy NIE MA formularza pobrania i to nie jest uproszczenie
 * widoku. Kaucja jedzie tam w tym samym `PaymentIntent` co najem (D1/D4,
 * 0029) i księguje się SAMA przy potwierdzeniu płatności — z odnośnikiem
 * intentu jako dowodem (lib/stripe-webhook.ts). Ręczny wiersz `manual`
 * dołożony obok podwoiłby saldo w rejestrze i pozwolił zlecić dostawcy zwrot
 * kwoty, której ten nigdy nie pobrał.
 *
 * Obieg ręczny zostaje BEZ ZMIAN (ADR-035): tam pobranie rejestruje człowiek,
 * bo nie ma dostawcy, którego można zapytać o potwierdzenie.
 */
import { formatMoney, type CurrencyCode } from "@avably/core";
import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { FormState } from "@/lib/form-state";
import { groszeToInputValue } from "@/lib/money-input";

import { DepositRefundModal } from "./deposit-refund-modal";

const initialState: FormState = {};

type DepositAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

/**
 * Pobranie kaucji „z ręki" — WYŁĄCZNIE obieg ręczny (uzasadnienie w nagłówku).
 */
function ManualCollectForm({
  orderId,
  suggestedCollectGrosze,
  action,
}: {
  orderId: string;
  suggestedCollectGrosze: number;
  action: DepositAction;
}) {
  const t = useTranslations("orders.deposit");
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="border-border flex flex-wrap items-end gap-2 rounded-md border p-3">
      <input type="hidden" name="orderId" value={orderId} />
      <div className="flex min-w-40 flex-1 flex-col gap-1">
        <Label htmlFor="deposit-collect-amount">{t("collectTitle")}</Label>
        <Input
          id="deposit-collect-amount"
          name="amount"
          inputMode="decimal"
          defaultValue={suggestedCollectGrosze > 0 ? groszeToInputValue(suggestedCollectGrosze) : ""}
          placeholder="0,00"
        />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {t("collectCta")}
      </Button>
      {state.formError ? (
        <p role="alert" className="text-destructive w-full text-sm">
          {state.formError}
        </p>
      ) : null}
      {state.fieldErrors ? (
        <p role="alert" className="text-destructive w-full text-sm">
          {Object.values(state.fieldErrors)[0]}
        </p>
      ) : null}
    </form>
  );
}

export function DepositForms({
  orderId,
  balanceGrosze,
  collectedGrosze,
  suggestedCollectGrosze,
  currency,
  locale,
  online,
  refundInFlight,
  actions,
}: {
  orderId: string;
  balanceGrosze: number;
  /** Ile już pobrano — rozstrzyga, czy tor automatyczny zdążył zadziałać. */
  collectedGrosze: number;
  suggestedCollectGrosze: number;
  currency: CurrencyCode;
  locale: string;
  /** Zamówienie w obiegu dostawcy — zwrot idzie realnym refundem (ADR-069). */
  online: boolean;
  /** Jest już zwrot zlecony i niepotwierdzony — drugi byłby drugą wypłatą. */
  refundInFlight: boolean;
  actions: {
    collect: DepositAction;
    settle: DepositAction;
  };
}) {
  const t = useTranslations("orders.deposit");

  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
            {t("balance")}
          </span>
          <span className="text-2xl leading-7 font-semibold tabular-nums tracking-[-0.01em]">
            {formatMoney(Math.max(balanceGrosze, 0), currency, locale)}
          </span>
          {/* Jedno zdanie o obiegu. Operator ma wiedzieć, czy pieniądze
              ruszają się same, czy dopiero wtedy, gdy on je policzy. */}
          <span className="text-muted-foreground text-sm">
            {online ? t("trackOnline") : t("trackManual")}
          </span>
        </div>
        <DepositRefundModal
          orderId={orderId}
          balanceGrosze={balanceGrosze}
          currency={currency}
          locale={locale}
          online={online}
          refundInFlight={refundInFlight}
          action={actions.settle}
        />
      </div>

      {/* Tor automatyczny, kaucja jeszcze nieksięgowana: nie ma tu nic do
          zrobienia i to jest informacja, a nie brak. */}
      {online && collectedGrosze === 0 && suggestedCollectGrosze > 0 ? (
        <p className="text-muted-foreground text-sm">{t("awaitingAutoCollect")}</p>
      ) : null}

      {online && refundInFlight ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("refundInFlightBlocked")}
        </p>
      ) : null}

      {!online ? (
        <ManualCollectForm
          orderId={orderId}
          suggestedCollectGrosze={suggestedCollectGrosze}
          action={actions.collect}
        />
      ) : null}
    </div>
  );
}
