"use client";

import { Button } from "@avably/ui";
import { useActionState } from "react";

import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

/**
 * Jeden przycisk = jedna akcja wiersza (przesunięcie, usunięcie, archiwizacja).
 * Akcja przychodzi ZWIĄZANA po stronie serwera, więc do przeglądarki nie jedzie
 * żaden identyfikator do podmiany w formularzu.
 *
 * Dlaczego tutaj, a nie w katalogu ekranu: wzorzec powstał na ekranie pól
 * własnych (`(panel)/organizacja/pola-wlasne/row-action-button.tsx`) i kategorie
 * potrzebują go w identycznej postaci. Import z cudzego katalogu tras wiązałby
 * dwa niezależne ekrany, a kopia rozjechałaby się przy pierwszej poprawce
 * dostępności — więc wspólna postać stoi w `components/screens`, obok
 * `ScreenHeader`/`ScreenSection`. Kopia w pola-wlasne zostaje na miejscu do
 * osobnego sprzątania (nie ruszam cudzego ekranu w tej paczce).
 */
export function RowActionButton({
  action,
  label,
  disabled,
  variant = "outline",
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  disabled?: boolean;
  variant?: "outline" | "ghost";
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <Button
        type="submit"
        variant={variant}
        size="sm"
        loading={pending}
        disabled={pending || disabled}
      >
        {label}
      </Button>
      {state.formError ? (
        <p role="alert" className="text-destructive text-xs">
          {state.formError}
        </p>
      ) : null}
    </form>
  );
}
