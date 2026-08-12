"use client";

import { suggestCategorySlug } from "@avably/core";
import { Button, Input, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useRef, useState } from "react";

import type { FormState } from "@/lib/form-state";

const emptyState: FormState = {};

export interface CategoryFormValues {
  name: string;
  slug: string;
  description: string;
}

/** Błąd POD polem — ta sama konwencja co w formularzu produktu (ADR-057). */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-[13px] leading-[18px] font-medium">
      {message}
    </p>
  );
}

function FieldHint({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-muted-foreground text-[13px] leading-[18px]">
      {children}
    </p>
  );
}

/**
 * Formularz kategorii katalogu (ADR-155).
 *
 * ADRES PODPOWIADANY Z NAZWY, ale tylko DOPÓKI operator go nie tknął. To jest
 * cała logika stanu w tym komponencie i ma jeden powód: adres kategorii, który
 * raz poszedł w świat, jest wart więcej niż zgodność z nazwą. Gdy ktoś zmienia
 * „Namioty" na „Namioty rodzinne", automatyczne przepisanie adresu zgasiłoby
 * mu działający link — więc po pierwszej ręcznej edycji (albo przy edycji
 * istniejącej kategorii) podpowiadanie milknie na zawsze.
 *
 * Podpowiedź liczy TA SAMA funkcja, której używa serwer przy pustym polu
 * (`suggestCategorySlug` z rdzenia) — inaczej to, co operator widzi w polu,
 * różniłoby się od tego, co zapisze formularz wysłany bez JS.
 */
export function CategoryForm({
  action,
  defaults,
  submitLabel,
  isNew,
  initialState = emptyState,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  defaults: CategoryFormValues;
  submitLabel: string;
  /** Nowa kategoria = adres jeszcze niczyj, więc wolno go podpowiadać. */
  isNew: boolean;
  initialState?: FormState;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("catalog.categories.form");

  const slugRef = useRef<HTMLInputElement>(null);
  const [slugTouched, setSlugTouched] = useState(!isNew || defaults.slug !== "");

  const value = (field: keyof CategoryFormValues) => state.values?.[field] ?? defaults[field];
  const errorId = (field: string) =>
    state.fieldErrors?.[field] ? `category-${field}-error` : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-name">{t("name")}</Label>
        <Input
          id="category-name"
          name="name"
          required
          maxLength={80}
          defaultValue={value("name")}
          aria-invalid={state.fieldErrors?.name ? true : undefined}
          aria-describedby={errorId("name")}
          onChange={(event) => {
            if (slugTouched || !slugRef.current) return;
            slugRef.current.value = suggestCategorySlug(event.target.value);
          }}
        />
        <FieldError id="category-name-error" message={state.fieldErrors?.name} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-slug">{t("slug")}</Label>
        <Input
          id="category-slug"
          name="slug"
          ref={slugRef}
          maxLength={60}
          defaultValue={value("slug")}
          aria-invalid={state.fieldErrors?.slug ? true : undefined}
          aria-describedby={errorId("slug") ?? "category-slug-hint"}
          onInput={() => setSlugTouched(true)}
        />
        <FieldHint id="category-slug-hint">{t("slugHint")}</FieldHint>
        <FieldError id="category-slug-error" message={state.fieldErrors?.slug} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-description">{t("description")}</Label>
        <Textarea
          id="category-description"
          name="description"
          rows={3}
          maxLength={500}
          defaultValue={value("description")}
          aria-invalid={state.fieldErrors?.description ? true : undefined}
          aria-describedby={errorId("description") ?? "category-description-hint"}
        />
        <FieldHint id="category-description-hint">{t("descriptionHint")}</FieldHint>
        <FieldError id="category-description-error" message={state.fieldErrors?.description} />
      </div>

      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-status-positive-fg text-sm">
          {t("saved")}
        </p>
      ) : null}

      <div>
        <Button type="submit" loading={pending} disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
