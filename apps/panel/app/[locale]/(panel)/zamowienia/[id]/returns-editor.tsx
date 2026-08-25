"use client";

import { Checkbox } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import type { ReturnActionState } from "./return-actions";

/**
 * ZWROT CZĘŚCIOWY (ADR-272): lista pozycji wydanego zamówienia z checkboxami
 * „zwrócono". Przełączenie woła `app.return_order_items` (przez akcję), która
 * natychmiast zwalnia egzemplarz do dostępności (albo — przy odznaczeniu —
 * odmawia, gdy sztukę zajęto w międzyczasie).
 *
 * OPTYMISTYCZNIE, ALE Z COFNIĘCIEM: checkbox przeskakuje od razu, ale odmowa
 * bramki (23P01 przy odwróceniu) wraca stan do poprzedniego i pokazuje powód —
 * inaczej operator myślałby, że egzemplarz wrócił do najmu, a nie wrócił.
 * Postęp „X z Y zwrócone" liczy się z faktycznego stanu po odpowiedzi RPC.
 */

export interface ReturnItemView {
  id: string;
  productName: string;
  serialNumber: string | null;
  returned: boolean;
}

export function ReturnsEditor({
  orderId,
  items,
  action,
}: {
  orderId: string;
  items: ReturnItemView[];
  action: (input: {
    orderId: string;
    itemId: string;
    returned: boolean;
  }) => Promise<ReturnActionState>;
}) {
  const t = useTranslations("orders.returns");

  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((item) => [item.id, item.returned])),
  );
  const [error, setError] = useState<string>();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const total = items.length;
  const returnedCount = Object.values(state).filter(Boolean).length;
  const allReturned = total > 0 && returnedCount === total;

  function toggle(itemId: string, next: boolean) {
    const previous = state[itemId];
    setError(undefined);
    setPendingId(itemId);
    // Optymistyczny przeskok — cofany, jeśli bramka odmówi.
    setState((prev) => ({ ...prev, [itemId]: next }));

    startTransition(async () => {
      const result = await action({ orderId, itemId, returned: next });
      setPendingId(null);
      if (result.error) {
        setError(result.error);
        setState((prev) => ({ ...prev, [itemId]: previous }));
      }
    });
  }

  return (
    <section id="zwroty" className="flex scroll-mt-6 flex-col gap-3" data-partial-returns>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("title")}</h2>
        <p
          className="text-muted-foreground text-sm tabular-nums"
          data-returns-progress
          role="status"
          aria-live="polite"
        >
          {t("progress", { returned: returnedCount, total })}
        </p>
      </div>

      <p className="text-muted-foreground text-sm">{t("hint")}</p>

      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const checked = state[item.id] ?? false;
          return (
            <li
              key={item.id}
              className="border-border bg-card flex flex-wrap items-center gap-3 rounded-md border px-3.5 py-3"
              data-return-item={item.id}
              data-returned={checked ? "true" : "false"}
            >
              <Checkbox
                id={`return-${item.id}`}
                checked={checked}
                disabled={pendingId === item.id}
                onCheckedChange={(value) => toggle(item.id, value === true)}
                aria-label={t("markLabel", { product: item.productName })}
              />
              <label
                htmlFor={`return-${item.id}`}
                className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-2 text-sm"
              >
                <span className="font-medium">{item.productName}</span>
                {item.serialNumber ? (
                  <span className="text-muted-foreground font-normal">{item.serialNumber}</span>
                ) : null}
              </label>
              {checked ? (
                <span className="text-status-positive-fg text-xs font-medium">
                  {t("statusReturned")}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">{t("statusOut")}</span>
              )}
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {allReturned ? (
        <p className="text-status-positive-fg text-sm" data-returns-all>
          {t("allReturnedHint")}
        </p>
      ) : null}
    </section>
  );
}
