"use client";

import type { CustomFieldDefinition, CustomFieldValues } from "@avably/core";
import { Button, Checkbox, Input, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { CustomFieldsFieldset } from "@/components/fields/custom-fields-fieldset";
import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

/** Kategoria do wyboru na karcie produktu (ADR-155). */
export interface ProductCategoryOption {
  id: string;
  name: string;
}

/** Wartości pól jako STRINGI — konwersję grosze↔pole robi wyłącznie strona
 * serwerowa (lib/money-input.ts), formularz niczego nie przelicza. */
export interface ProductFormValues {
  name: string;
  /**
   * ADRES STRONY SPRZĘTU (ADR-182) — fragment `/produkt/{slug}`. Pusty przy
   * nowym sprzęcie: adres nada baza z nazwy, więc formularz nie musi (i nie
   * powinien) go wymyślać drugą regułą.
   */
  slug: string;
  description: string;
  basePriceDay: string;
  deposit: string;
  autoIncrementMultiplier: string;
  bufferBeforeDays: string;
  bufferAfterDays: string;
  /**
   * Minimalny okres najmu w dobach (0089, ADR-202). "1" = brak ograniczenia —
   * neutralny default, ten sam, który kolumna nadała istniejącym produktom.
   */
  minRentalDays: string;
  active: boolean;
}

/**
 * Formularz produktu wg sekcji 06 artefaktu Fazy 2 (ADR-058).
 *
 * Wzorzec przeniesiony z kreatora zamówień (ADR-057): ETYKIETA NAD POLEM,
 * KONKRETNY komunikat błędu POD polem (nie zbiorcze „popraw formularz"),
 * pole w stanie error z P2 przez `aria-invalid`, submit w `aria-busy`
 * (`Button loading`) zamiast podmiany napisu na „Zapisuję…".
 *
 * Pola spoza mockupu (bufory serwisowe, mnożnik doby) idą DOKŁADNIE tym
 * samym wzorcem — sekcja 06 pokazuje formę, nie listę dozwolonych pól.
 */

/**
 * Błąd POD polem, w kolorze destructive i z rolą alertu. Pole obok dostaje
 * `aria-invalid`, więc obrys pola i komunikat mówią to samo — sam kolor
 * nigdy nie niesie informacji.
 */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-[13px] leading-[18px] font-medium">
      {message}
    </p>
  );
}

/** Podpowiedź pod polem — ton drugorzędny, nigdy kolor statusu. */
function FieldHint({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-muted-foreground text-[13px] leading-[18px]">
      {children}
    </p>
  );
}

export function ProductForm({
  action,
  defaults,
  currencyCode,
  customFields = [],
  customFieldValues = {},
  categories = [],
  selectedCategoryIds = [],
  initialState: initial = initialState,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  defaults: ProductFormValues;
  currencyCode: string;
  /** Pola własne produktu z flagą „panel", w kolejności z definicji (serwer). */
  customFields?: readonly CustomFieldDefinition[];
  customFieldValues?: CustomFieldValues;
  /** Kategorie najemcy w kolejności prezentacji (serwer). */
  categories?: readonly ProductCategoryOption[];
  /** Kategorie już przypięte do produktu. */
  selectedCategoryIds?: readonly string[];
  /**
   * Stan startowy formularza. W produkcie ZAWSZE pusty — prop istnieje po to,
   * by kontrakt renderu (`catalog-screen-contract`) mógł obejrzeć formularz
   * w stanie błędu. `useActionState` oddaje przy renderze serwerowym wyłącznie
   * stan początkowy, więc bez tego szwu jedynym sposobem na dowód „błąd jest
   * POD polem" byłoby podmienienie Reacta w teście.
   */
  initialState?: FormState;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const t = useTranslations("catalog.productForm");

  const errorId = (field: string) =>
    state.fieldErrors?.[field] ? `product-${field}-error` : undefined;

  return (
    <form action={formAction} data-form-line-measure className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-name">{t("name")}</Label>
        <Input
          id="product-name"
          name="name"
          required
          maxLength={200}
          defaultValue={defaults.name}
          aria-invalid={state.fieldErrors?.name ? true : undefined}
          aria-describedby={errorId("name")}
        />
        <FieldError id="product-name-error" message={state.fieldErrors?.name} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-slug">{t("slug")}</Label>
        <Input
          id="product-slug"
          name="slug"
          maxLength={60}
          defaultValue={defaults.slug}
          aria-invalid={state.fieldErrors?.slug ? true : undefined}
          aria-describedby={errorId("slug") ?? "product-slug-hint"}
        />
        <FieldHint id="product-slug-hint">{t("slugHint")}</FieldHint>
        <FieldError id="product-slug-error" message={state.fieldErrors?.slug} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-description">{t("description")}</Label>
        <Textarea
          id="product-description"
          name="description"
          rows={4}
          defaultValue={defaults.description}
          aria-invalid={state.fieldErrors?.description ? true : undefined}
          aria-describedby={errorId("description")}
        />
        <FieldError id="product-description-error" message={state.fieldErrors?.description} />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-base-price">
            {t("basePriceDay", { currency: currencyCode })}
          </Label>
          <Input
            id="product-base-price"
            name="basePriceDayGrosze"
            required
            inputMode="decimal"
            className="tabular-nums"
            defaultValue={defaults.basePriceDay}
            aria-invalid={state.fieldErrors?.basePriceDayGrosze ? true : undefined}
            aria-describedby={errorId("basePriceDayGrosze") ?? "product-base-price-hint"}
          />
          <FieldHint id="product-base-price-hint">{t("moneyHint")}</FieldHint>
          <FieldError
            id="product-basePriceDayGrosze-error"
            message={state.fieldErrors?.basePriceDayGrosze}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-deposit">{t("deposit", { currency: currencyCode })}</Label>
          <Input
            id="product-deposit"
            name="depositGrosze"
            inputMode="decimal"
            className="tabular-nums"
            defaultValue={defaults.deposit}
            aria-invalid={state.fieldErrors?.depositGrosze ? true : undefined}
            aria-describedby={errorId("depositGrosze")}
          />
          <FieldError id="product-depositGrosze-error" message={state.fieldErrors?.depositGrosze} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-auto-increment">{t("autoIncrementMultiplier")}</Label>
        <Input
          id="product-auto-increment"
          name="autoIncrementMultiplier"
          required
          inputMode="decimal"
          className="tabular-nums"
          defaultValue={defaults.autoIncrementMultiplier}
          aria-invalid={state.fieldErrors?.autoIncrementMultiplier ? true : undefined}
          aria-describedby={errorId("autoIncrementMultiplier") ?? "product-auto-increment-hint"}
        />
        <FieldHint id="product-auto-increment-hint">{t("autoIncrementHint")}</FieldHint>
        <FieldError
          id="product-autoIncrementMultiplier-error"
          message={state.fieldErrors?.autoIncrementMultiplier}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-buffer-before">{t("bufferBefore")}</Label>
          <Input
            id="product-buffer-before"
            name="bufferBeforeDays"
            required
            type="number"
            min={0}
            step={1}
            className="tabular-nums"
            defaultValue={defaults.bufferBeforeDays}
            aria-invalid={state.fieldErrors?.bufferBeforeDays ? true : undefined}
            aria-describedby={errorId("bufferBeforeDays")}
          />
          <FieldError
            id="product-bufferBeforeDays-error"
            message={state.fieldErrors?.bufferBeforeDays}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-buffer-after">{t("bufferAfter")}</Label>
          <Input
            id="product-buffer-after"
            name="bufferAfterDays"
            required
            type="number"
            min={0}
            step={1}
            className="tabular-nums"
            defaultValue={defaults.bufferAfterDays}
            aria-invalid={state.fieldErrors?.bufferAfterDays ? true : undefined}
            aria-describedby={errorId("bufferAfterDays")}
          />
          <FieldError
            id="product-bufferAfterDays-error"
            message={state.fieldErrors?.bufferAfterDays}
          />
        </div>
      </div>

      {/* MINIMALNY OKRES NAJMU (0089, ADR-202). Egzekwuje baza w publicznym
          checkoucie (odmowa PT422 z liczbą); klient sklepu dowiaduje się
          o minimum z odmowy — etykieta proaktywna w widgecie to faza 2.
          Pomoc kontekstowa mówi wprost, że 1 = brak ograniczenia, żeby
          operator nie szukał osobnego wyłącznika. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-min-rental-days">{t("minRentalDays")}</Label>
        <Input
          id="product-min-rental-days"
          name="minRentalDays"
          required
          type="number"
          min={1}
          step={1}
          className="tabular-nums"
          defaultValue={defaults.minRentalDays}
          aria-invalid={state.fieldErrors?.minRentalDays ? true : undefined}
          aria-describedby={errorId("minRentalDays") ?? "product-min-rental-days-hint"}
        />
        <FieldHint id="product-min-rental-days-hint">{t("minRentalDaysHint")}</FieldHint>
        <FieldError
          id="product-minRentalDays-error"
          message={state.fieldErrors?.minRentalDays}
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="product-active" name="active" defaultChecked={defaults.active} />
        <Label htmlFor="product-active">{t("active")}</Label>
      </div>

      {/* KATEGORIE (ADR-155). Zaznaczenia idą jako POWTÓRZONE pole `categoryIds`
          (jedna nazwa, wiele wartości) — serwer czyta je `formData.getAll`,
          tym samym mechanizmem, którym czyta `active`. Produkt bez ani jednej
          kategorii jest stanem NORMALNYM, nie błędem walidacji: taksonomia jest
          porządkiem oferty, a nie warunkiem jej istnienia.

          Gdy najemca nie ma jeszcze żadnej kategorii, sekcja pokazuje ZDANIE
          z drogą dalej zamiast pustej ramki: ekran ma uczyć w trakcie pracy
          (wzorzec „Progi cenowe"), a pusty fieldset niczego nie mówi. */}
      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="text-foreground mb-1 text-sm leading-[18px] font-medium">
          {t("categoriesLegend")}
        </legend>
        {categories.length === 0 ? (
          <p className="text-muted-foreground text-[13px] leading-[18px]" data-product-categories-empty>
            {t("categoriesEmpty")}
          </p>
        ) : (
          <div className="flex flex-col gap-2" data-product-categories>
            {categories.map((category) => (
              <div key={category.id} className="flex items-center gap-2">
                <Checkbox
                  id={`product-category-${category.id}`}
                  name="categoryIds"
                  value={category.id}
                  defaultChecked={selectedCategoryIds.includes(category.id)}
                />
                <Label htmlFor={`product-category-${category.id}`}>{category.name}</Label>
              </div>
            ))}
          </div>
        )}
        <FieldError id="product-categoryIds-error" message={state.fieldErrors?.categoryIds} />
      </fieldset>

      {/* Formularz produktu nie ma grup — sąsiadami są same etykiety pól,
          więc legenda zostaje etykietą. Wariant jest podany JAWNIE, choć
          zgadza się z domyślnym: wybór konwencji ma być widoczny w miejscu,
          w którym zapadł, a nie domyślany z braku propa. */}
      <CustomFieldsFieldset
        fields={customFields}
        values={customFieldValues}
        errors={state.fieldErrors}
        idPrefix="product-cf"
        legendVariant="label"
      />

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
        {/* Stan zapisu niesie `aria-busy` + wielokropek z P2, a nie inny
            napis — przycisk, który zmienia treść, gubi szerokość i miejsce
            w drzewie dostępności (ta sama decyzja co w kreatorze P4). */}
        <Button type="submit" loading={pending} disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
