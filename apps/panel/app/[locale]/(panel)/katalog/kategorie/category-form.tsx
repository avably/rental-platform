"use client";

import { suggestCategorySlug } from "@avably/core";
import { Button, FileField, Input, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useId, useRef, useState, useTransition } from "react";

import { siteImagePublicBase } from "@/lib/site-image-base";
import type { FormState } from "@/lib/form-state";

import {
  finalizeCategoryImageUploadAction,
  prepareCategoryImageUploadAction,
  setCategoryImageAction,
} from "./category-image-actions";
import { runCategoryImageUpload, uploadCategoryBannerToSignedUrl } from "./category-image-flow";

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
  categoryId,
  bannerPath = null,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  defaults: CategoryFormValues;
  submitLabel: string;
  /** Nowa kategoria = adres jeszcze niczyj, więc wolno go podpowiadać. */
  isNew: boolean;
  initialState?: FormState;
  /**
   * Identyfikator kategorii — obecny WYŁĄCZNIE w edycji. Baner wymaga istniejącej
   * kategorii (bilet i zapis wołają `p_category_id`), więc pole uploadu pojawia
   * się dopiero po założeniu: najpierw kategoria, potem baner.
   */
  categoryId?: string;
  /** Bieżąca ścieżka banera (`catalog_categories.image_path`) albo null. */
  bannerPath?: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("catalog.categories.form");

  const slugRef = useRef<HTMLInputElement>(null);
  const [slugTouched, setSlugTouched] = useState(!isNew || defaults.slug !== "");

  const value = (field: keyof CategoryFormValues) => state.values?.[field] ?? defaults[field];
  const errorId = (field: string) =>
    state.fieldErrors?.[field] ? `category-${field}-error` : undefined;

  const form = (
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

  // Baner ŻYJE OBOK formularza, nie w nim: wgrywa się i zapisuje własnymi
  // czasownikami (bilet → signed upload → set_category_image), a nie polem
  // wysyłanym z resztą formularza — bajty nie przechodzą przez Server Action.
  if (!categoryId) return form;
  return (
    <div className="flex flex-col gap-6">
      {form}
      <CategoryBannerField categoryId={categoryId} initialPath={bannerPath} />
    </div>
  );
}

/**
 * POLE BANERA KATEGORII (ADR-260) — lustro karty logo sklepu (store-logo-card).
 *
 * Kategoria nie ma bliźniaka draft/published: baner jest JEDNYM stanem, czytanym
 * wprost z `catalog_categories.image_path`, więc nie ma tu kroku „opublikuj".
 * Wgranie pliku od razu zapisuje ścieżkę (`set_category_image`) i unieważnia
 * cache katalogu sklepu — zmiana jest widoczna po najbliższym odczycie.
 *
 * DWA WIDOKI, jak przy logo: gdy baner JEST — miniatura + „zmień"/„usuń"; gdy go
 * NIE MA — pojedyncza strefa `FileField` (drag&drop, walidacja, dostępność).
 * Brak banera NIE jest błędem — kafel kategorii bez banera wygląda tak, jak
 * wyglądał.
 */
function CategoryBannerField({
  categoryId,
  initialPath,
}: {
  categoryId: string;
  initialPath: string | null;
}) {
  const t = useTranslations("catalog.categories.banner");
  const tErr = useTranslations("catalog.categories.banner.errors");
  const base = siteImagePublicBase();

  const [path, setPath] = useState<string | null>(initialPath);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fieldId = useId();
  const changeInputRef = useRef<HTMLInputElement>(null);
  const busy = pending || uploading;

  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    setUploading(true);
    const outcome = await runCategoryImageUpload(categoryId, file, {
      prepare: prepareCategoryImageUploadAction,
      upload: uploadCategoryBannerToSignedUrl,
      finalize: finalizeCategoryImageUploadAction,
      message: (problem) => tErr(problem),
    });
    setUploading(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    // Plik jest w Storage — dopiero zapis ścieżki czyni go banerem kategorii.
    startTransition(async () => {
      const result = await setCategoryImageAction({ categoryId, path: outcome.path });
      if (result.ok) setPath(outcome.path);
      else setError(result.error);
    });
  }

  function removeBanner() {
    setError(null);
    startTransition(async () => {
      const result = await setCategoryImageAction({ categoryId, path: null });
      if (result.ok) setPath(null);
      else setError(result.error);
    });
  }

  return (
    <section
      data-category-banner
      data-category-banner-state={path ? "set" : "empty"}
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("subtitle")}</p>
      </div>

      {path ? (
        <div className="flex flex-wrap items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- miniatura z publicznego Storage, jak logo sklepu i zdjęcie sekcji */}
          <img
            data-category-banner-preview
            src={`${base}/${path}`}
            alt=""
            className="border-border h-16 w-28 shrink-0 rounded-md border object-cover"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => changeInputRef.current?.click()}
            >
              {uploading ? t("uploading") : t("replace")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={removeBanner}>
              {t("remove")}
            </Button>
          </div>
          {/* Ukryty nośnik pliku dla akcji „zmień" — natywny input jest źródłem
              prawdy o pliku; po wyborze czyścimy wartość, żeby ponowny wybór TEGO
              SAMEGO pliku też odpalił onChange. */}
          <input
            ref={changeInputRef}
            id={fieldId}
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/webp,image/avif"
            disabled={busy}
            aria-label={t("replace")}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0] ?? null;
              e.currentTarget.value = "";
              void handleFile(file);
            }}
          />
        </div>
      ) : (
        <FileField
          id={fieldId}
          prompt={uploading ? t("uploading") : t("prompt")}
          hint={t("hint")}
          removeLabel={t("fieldRemove")}
          accept="image/jpeg,image/png,image/webp,image/avif"
          disabled={busy}
          error={error ?? undefined}
          onChange={(e) => void handleFile(e.currentTarget.files?.[0] ?? null)}
        />
      )}

      {/* W stanie pustym błąd niesie FileField (który renderuje go w
          `role="alert"`); przy ustawionym banerze miniatura nie ma na to
          miejsca, więc pokazujemy go tu — tą samą drogą co błędy pól
          (`FieldError`, ADR-057), żeby czytnik ekranu OGŁOSIŁ nieudany upload
          także w stanie „baner ustawiony" (a11y, audyt przedlaunchowy, ADR-265). */}
      {error && path ? <FieldError id="category-banner-error" message={error} /> : null}
    </section>
  );
}
