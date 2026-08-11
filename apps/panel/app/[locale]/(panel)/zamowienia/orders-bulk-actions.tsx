"use client";

import { Button } from "@avably/ui";
import { ORDER_STATUSES, type OrderStatus } from "@avably/core";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import {
  bulkStatusOutcome,
  type BulkRejectReason,
  type BulkStatusReport,
} from "@/lib/orders/bulk-status";

import { changeOrderStatusBulkAction, type BulkStatusState } from "./actions";

/**
 * Pasek akcji masowych listy zamówień (uwaga przeglądu U4).
 *
 * Pokazuje się dopiero, gdy coś jest zaznaczone, i mówi WPROST, czego dotyczy
 * zaznaczenie: „N z M na tej stronie". Lista czyta najwyżej 100 zamówień
 * (page.tsx), więc sugerowanie, że akcja obejmuje całą tabelę tenanta, byłoby
 * kłamstwem o zasięgu operacji.
 *
 * PIERWSZĄ akcją jest zmiana statusu; kolejne (archiwizacja, eksport) dokłada
 * się jako następne pola tego samego paska — stąd `<form>` per akcja, a nie
 * jeden formularz z ukrytym „co robimy".
 *
 * WYNIK JEST RAPORTEM, NIE KOMUNIKATEM SUKCESU. Bramka bazy (trigger 0010)
 * odrzuca nielegalne przejścia per wiersz, więc operacja masowa bywa częściowo
 * nieudana i musi to pokazać: ile zmienione, KTÓRE odrzucone i DLACZEGO.
 * Nagłówek liczy `bulkStatusOutcome` z faktycznych list — nie da się go
 * przestawić na „gotowe" bez zapalenia testu.
 *
 * Pasek jest `sticky` do dołu okna (nie do `<tr>`, nie przez nakładkę): to
 * zwykły blok w normalnym przepływie, więc zachowuje się poprawnie także tam,
 * gdzie pozycjonowanie elementów tabeli jest niespójne (lekcja #117).
 */

const REASON_LABEL_KEY: Record<BulkRejectReason, string> = {
  "illegal-transition": "bulkReasonIllegalTransition",
  "cancel-blocked": "bulkReasonCancelBlocked",
  "unit-conflict": "bulkReasonUnitConflict",
  "already-in-target": "bulkReasonAlreadyInTarget",
  "changed-meanwhile": "bulkReasonChangedMeanwhile",
  "not-found": "bulkReasonNotFound",
  "closing-window": "bulkReasonClosingWindow",
  unknown: "bulkReasonUnknown",
};

const initialState: BulkStatusState = {};

export function OrdersBulkActions({
  selectedIds,
  pageCount,
  onClear,
}: {
  selectedIds: readonly string[];
  /** Ile wierszy jest na wczytanej stronie — licznik mówi „N z M". */
  pageCount: number;
  onClear: () => void;
}) {
  const t = useTranslations("orders.list");
  const tStatus = useTranslations("orders.statusLabels.order");
  const [state, formAction, pending] = useActionState(changeOrderStatusBulkAction, initialState);
  const [target, setTarget] = useState("");

  if (selectedIds.length === 0) return null;

  return (
    <div
      data-orders-bulk-bar
      className="border-border bg-card sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-3 rounded-lg border p-3 shadow-lg md:bottom-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span data-orders-selected-count className="text-foreground text-sm font-medium tabular-nums">
          {t("bulkSelected", { count: selectedIds.length, total: pageCount })}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          {t("bulkClear")}
        </Button>

        <form action={formAction} className="ml-auto flex flex-wrap items-center gap-2">
          {selectedIds.map((id) => (
            <input key={id} type="hidden" name="orderId" value={id} />
          ))}
          <label htmlFor="bulk-status" className="text-muted-foreground text-sm">
            {t("bulkChangeStatusLabel")}
          </label>
          <PanelSelect
            id="bulk-status"
            name="to"
            value={target}
            onValueChange={setTarget}
            className="h-9 w-52"
            options={[
              { value: "", label: t("bulkPickStatus") },
              ...ORDER_STATUSES.map((status: OrderStatus) => ({
                value: status,
                label: tStatus(status),
              })),
            ]}
          />
          <Button type="submit" size="sm" disabled={pending || target === ""} loading={pending}>
            {t("bulkApply")}
          </Button>
        </form>
      </div>

      {/* Masowa zmiana nie wysyła wiadomości — mówimy to, zanim operator
          założy, że klient dostał powiadomienie (ADR-033: decyzja o wysyłce
          jest zawsze jawna). */}
      <p className="text-muted-foreground text-xs">{t("bulkNoEmailHint")}</p>

      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}

      {state.report ? <BulkReport report={state.report} /> : null}
    </div>
  );
}

function BulkReport({ report }: { report: BulkStatusReport }) {
  const t = useTranslations("orders.list");
  const tStatus = useTranslations("orders.statusLabels.order");
  const outcome = bulkStatusOutcome(report);
  const toLabel = tStatus(report.to);

  return (
    <div
      data-orders-bulk-report={outcome}
      role="status"
      aria-live="polite"
      className="border-border flex flex-col gap-2 rounded-md border p-3 text-sm"
    >
      <p className="font-medium">
        {outcome === "all"
          ? t("bulkResultAll", { count: report.changed.length, status: toLabel })
          : outcome === "none"
            ? t("bulkResultNone", { count: report.rejected.length, status: toLabel })
            : t("bulkResultPartial", {
                changed: report.changed.length,
                rejected: report.rejected.length,
                status: toLabel,
              })}
      </p>

      {/* Odrzucone WYMIENIONE Z NAZWY I POWODU — zbiorcza liczba kazałaby
          operatorowi zgadywać, które zamówienie zostało tam, gdzie było. */}
      {report.rejected.length > 0 ? (
        <ul data-orders-bulk-rejected className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {report.rejected.map((entry) => (
            <li key={entry.orderId} className="text-muted-foreground flex flex-wrap gap-x-2">
              <span className="text-foreground font-medium tabular-nums">{entry.orderNumber}</span>
              <span>
                {t(REASON_LABEL_KEY[entry.reason ?? "unknown"], {
                  from: entry.from ? tStatus(entry.from) : "—",
                  to: toLabel,
                  // `detail` niesie surowy komunikat bazy tylko przy odmowie,
                  // której nie umiemy nazwać — lepszy techniczny tekst niż
                  // „coś poszło nie tak".
                  detail: entry.detail ?? "",
                })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {report.changed.length > 0 ? (
        <p data-orders-bulk-changed className="text-muted-foreground">
          {t("bulkChangedList", {
            numbers: report.changed.map((entry) => entry.orderNumber).join(", "),
          })}
        </p>
      ) : null}
    </div>
  );
}
