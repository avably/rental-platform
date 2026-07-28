"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { createTenantAction, type CreateTenantState } from "./actions";

const initialState: CreateTenantState = {};

export function CreateTenantForm() {
  const [state, formAction, pending] = useActionState(createTenantAction, initialState);
  const t = useTranslations("newOrganization");

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {t("name")}
        <input type="text" name="name" required maxLength={200} className="rounded border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("slug")}
        <input
          type="text"
          name="slug"
          required
          pattern="[a-z0-9][a-z0-9-]{2,38}"
          className="rounded border px-3 py-2"
        />
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <button
        type="submit"
          aria-busy={pending || undefined}
        disabled={pending}
        className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
      >
        {pending ? t("submitPending") : t("submit")}
      </button>
    </form>
  );
}
