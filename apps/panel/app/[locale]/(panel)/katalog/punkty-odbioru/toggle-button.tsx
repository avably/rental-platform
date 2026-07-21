"use client";

import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

/** Wygaszenie/przywrócenie punktu wprost z listy. */
export function ToggleLocationButton({
  action,
  nextActive,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  nextActive: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("catalog.locations");

  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <Button type="submit" variant="outline" size="sm" loading={pending} disabled={pending}>
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
