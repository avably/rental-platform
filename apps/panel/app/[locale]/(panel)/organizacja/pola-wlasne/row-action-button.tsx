"use client";

import { Button } from "@avably/ui";
import { useActionState } from "react";

import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

/**
 * Jeden przycisk = jedna akcja wiersza (przesunięcie, archiwizacja,
 * przywrócenie). Akcja przychodzi ZWIĄZANA po stronie serwera, więc do
 * przeglądarki nie jedzie żaden identyfikator do podmiany w formularzu.
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
