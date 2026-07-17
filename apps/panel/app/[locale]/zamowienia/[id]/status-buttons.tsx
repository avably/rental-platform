"use client";

import { Button } from "@avably/ui";
import {
  BLOCKING_PAYMENT_STATUSES,
  canTransition,
  ORDER_STATUSES,
  type OrderStatus,
  type PaymentStatus,
} from "@avably/core";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { FormState } from "@/lib/form-state";

import { TEMPLATE_FOR_STATUS } from "./rental-email";

const initialState: FormState = {};

/**
 * Przyciski przejść statusu: pokazujemy WYŁĄCZNIE przejścia dozwolone przez
 * canTransition z bieżącego stanu (jedno źródło prawdy z @avably/core), a
 * anulowanie dodatkowo gasimy przy blokującym payment_status. To jest UI —
 * autorytatywnie odmawia trigger 0010; akcja niesie expectedFrom, więc
 * równoległa zmiana statusu kończy się czytelnym błędem, nie ślepym nadpisem.
 *
 * Przy przejściach, które mają wiadomość do klienta (TEMPLATE_FOR_STATUS),
 * operator decyduje JAWNIE, czy ją wysłać: checkbox jest domyślnie
 * zaznaczony, gdy konfiguracja jest kompletna, i wyłączony Z PODANYM POWODEM,
 * gdy nie (ADR-033). Wyłączony przełącznik bez wyjaśnienia wyglądałby jak
 * usterka — brak konfiguracji ma być widoczny, nie domyślny.
 */
export function StatusButtons({
  action,
  orderId,
  currentStatus,
  paymentStatus,
  emailAvailability,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  orderId: string;
  currentStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  emailAvailability: { available: boolean; reason?: string | undefined };
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("orders.detail");
  const tStatus = useTranslations("orders.status");

  const targets = ORDER_STATUSES.filter((status) => canTransition(currentStatus, status));
  const cancelBlocked = BLOCKING_PAYMENT_STATUSES.includes(paymentStatus);

  if (targets.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {targets.map((target) => {
          const blocked = target === "cancelled" && cancelBlocked;
          // Nie każde przejście ma wiadomość do klienta (np. → pending).
          const hasTemplate = TEMPLATE_FOR_STATUS[target] !== undefined;
          return (
            <form key={target} action={formAction} className="flex flex-col gap-1">
              <input type="hidden" name="orderId" value={orderId} />
              <input type="hidden" name="to" value={target} />
              <input type="hidden" name="expectedFrom" value={currentStatus} />
              <Button
                type="submit"
                variant={target === "cancelled" ? "outline" : "default"}
                disabled={pending || blocked}
                title={blocked ? t("cancelBlockedHint") : undefined}
              >
                {t("changeTo", { status: tStatus(target) })}
              </Button>
              {hasTemplate ? (
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    name="sendEmail"
                    defaultChecked={emailAvailability.available}
                    disabled={!emailAvailability.available || pending || blocked}
                  />
                  {t("sendEmail")}
                </label>
              ) : null}
            </form>
          );
        })}
      </div>
      {cancelBlocked && targets.includes("cancelled") ? (
        <p className="text-xs text-gray-500">{t("cancelBlockedHint")}</p>
      ) : null}
      {!emailAvailability.available && targets.some((s) => TEMPLATE_FOR_STATUS[s]) ? (
        <p className="text-xs text-amber-700">
          {emailAvailability.reason ?? t("sendEmailUnavailable")}
        </p>
      ) : null}
      {state.formError ? (
        <p role="alert" className="text-sm text-red-600">
          {state.formError}
        </p>
      ) : null}
    </div>
  );
}
