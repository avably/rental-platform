"use client";

import { DropdownMenuItem } from "@avably/ui";
import { useActionState } from "react";

import type { OrderArchiveAction } from "./orders-table";

/**
 * Pozycja menu wiersza „Archiwizuj" / „Przywróć" (ADR-242).
 *
 * WYDZIELONA z OrderRowActions, bo tylko ona woła `useActionState` — dzięki
 * temu komponent renderuje się WYŁĄCZNIE, gdy akcja archiwum jest podana
 * (widok listy poza oknem domykania). Kontrakt renderu tabeli i okno
 * domykania nie podają akcji, więc hak nigdy nie wchodzi warunkowo.
 *
 * `orderId` jedzie ukrytym polem (akcja czyta go z FormData — ta sama reguła
 * tenant-scope niezależnie od miejsca), a `useActionState` adaptuje akcję
 * (prev, formData)→FormState do `formAction` formularza. Wynik nie jest
 * pokazywany W MENU (menu zamyka się po wyborze, a lista odświeża się przez
 * `revalidatePath`); `pending` blokuje przed podwójnym zgłoszeniem.
 */
export function OrderRowArchiveItem({
  orderId,
  action,
  label,
}: {
  orderId: string;
  action: OrderArchiveAction;
  label: string;
}) {
  const [, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <DropdownMenuItem asChild>
        <button
          type="submit"
          data-order-archive-item
          disabled={pending}
          aria-busy={pending}
          className="w-full cursor-pointer text-left"
        >
          {label}
        </button>
      </DropdownMenuItem>
    </form>
  );
}
