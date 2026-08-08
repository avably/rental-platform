"use client";

/**
 * Przycisk „Sprawdź status płatności" (L11, ADR-104).
 *
 * Wąska powierzchnia z rozmysłu: JEDEN przycisk i JEDNO zdanie wyniku.
 * Operator przychodzi tu z jednym pytaniem („czy klient zapłacił"), a
 * odpowiedź ma trzy odcienie, nie dwa — i wszystkie trzy są tu widoczne:
 *
 *   - sukces: stan się zmienił, pokazujemy NA CO (etykieta statusu),
 *   - neutralny: odczyt się udał, ale nie było co zmieniać (płatność w toku,
 *     klient nie dokończył) — świadomie NIE zielony, bo nic się nie stało,
 *   - błąd: nie udało się zapytać albo zapisać.
 *
 * Zdanie neutralne przyjeżdża z serwera gotowe, bo niesie POWÓD ustalony
 * przy odczycie u dostawcy; przetłumaczone są etykiety stałe.
 */
import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { PaymentCheckState } from "./payment-actions";

const initialState: PaymentCheckState = {};

export function PaymentCheck({
  orderId,
  action,
}: {
  orderId: string;
  action: (prevState: PaymentCheckState, formData: FormData) => Promise<PaymentCheckState>;
}) {
  const t = useTranslations("orders.payment");
  const tStatus = useTranslations("orders.statusLabels.payment");
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline" loading={pending} disabled={pending}>
          {t("checkCta")}
        </Button>
        <span className="text-muted-foreground text-sm">{t("checkHint")}</span>
      </div>

      {state.success ? (
        <p className="text-sm">
          {t("checkDone")}
          {state.paymentStatus ? ` ${tStatus(state.paymentStatus)}` : null}
        </p>
      ) : null}
      {state.notice ? <p className="text-muted-foreground text-sm">{state.notice}</p> : null}
      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}
      {state.fieldErrors ? (
        <p role="alert" className="text-destructive text-sm">
          {Object.values(state.fieldErrors)[0]}
        </p>
      ) : null}
    </form>
  );
}
