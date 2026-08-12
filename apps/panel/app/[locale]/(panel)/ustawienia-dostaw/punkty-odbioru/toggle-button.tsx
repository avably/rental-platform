"use client";

import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

/**
 * Wyłączenie/włączenie punktu wprost z listy.
 *
 * `describedBy` wskazuje zdanie o SKUTKU, które stoi na tym samym ekranie nad
 * tabelą (U9, audyt UX 6.1). Do U9 skutek był opisany na ekranie RODZICA
 * (`/ustawienia-dostaw`), więc operator klikający tutaj nie miał go przed
 * oczami w ogóle — a jest to jedyna informacja, która odróżnia wyłączenie od
 * usunięcia.
 */
export function ToggleLocationButton({
  action,
  nextActive,
  describedBy,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  nextActive: boolean;
  describedBy?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("orders.delivery.locations");

  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <Button
        type="submit"
        variant="outline"
        size="sm"
        loading={pending}
        disabled={pending}
        aria-describedby={describedBy}
      >
        {nextActive ? t("activate") : t("deactivate")}
      </Button>
      {state.formError ? (
        <p role="alert" className="text-destructive text-xs">
          {state.formError}
        </p>
      ) : null}
    </form>
  );
}
