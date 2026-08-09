"use client";

/**
 * Pola własne najemcy na formularzu panelu (C6-A2, ADR-119).
 *
 * JEDEN komponent dla klienta, zamówienia i produktu. Trzy formularze mają
 * trzy różne kształty (produkt — wspólny komponent, klient — tylko edycja,
 * zamówienie — kreator i sekcja karty), ale pole własne musi wyglądać
 * i zachowywać się na każdym z nich TAK SAMO: ta sama kolejność, ta sama
 * etykieta najemcy, ten sam sposób pokazania błędu.
 *
 * WIDOCZNOŚĆ JEST KONTRAKTEM: komponent renderuje dokładnie to, co dostał,
 * a filtrowanie po fladze „panel" robi `visibleCustomFields` po stronie
 * serwera — ta sama funkcja, którą zapis sprawdza w akcji. Gdyby filtr żył
 * tutaj, pole checkoutowe zniknęłoby z ekranu, a zapis i tak by je przyjął.
 */
import { CUSTOM_FIELD_LIMITS, type CustomFieldDefinition, type CustomFieldValues } from "@avably/core";
import { Checkbox, Input, Label, Textarea } from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";

import { PanelSelect } from "@/components/fields/panel-select";
import { customFieldName } from "@/lib/custom-fields";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-[13px] leading-[18px] font-medium">
      {message}
    </p>
  );
}

/**
 * Wartość liczbowa w zapisie, w którym operator ją wpisał (przecinek po
 * polsku). Grupowanie tysięcy jest WYŁĄCZONE świadomie: pole jest do edycji,
 * a nie do czytania, i separator tysięcy musiałby przetrwać drogę powrotną
 * przez parser. Jeden separator dziesiętny przetrwa ją zawsze.
 */
function numberToInput(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === "pl" ? "pl-PL" : "en-US", {
    useGrouping: false,
    maximumFractionDigits: 6,
  }).format(value);
}

function defaultText(definition: CustomFieldDefinition, values: CustomFieldValues, locale: string): string {
  const value = values[definition.id];
  if (value === undefined) return "";
  if (typeof value === "number") return numberToInput(value, locale);
  if (typeof value === "boolean") return value ? "1" : "";
  return value;
}

export function CustomFieldsFieldset({
  fields,
  values,
  errors,
  idPrefix = "cf",
}: {
  /** Definicje JUŻ przefiltrowane po fladze „panel" i posortowane (serwer). */
  fields: readonly CustomFieldDefinition[];
  values: CustomFieldValues;
  errors?: Record<string, string>;
  /** Rozróżnia identyfikatory DOM, gdy na jednym ekranie stoi więcej formularzy. */
  idPrefix?: string;
}) {
  const t = useTranslations("customFields");
  const locale = useLocale();

  // Zero pól = zero sekcji. Najemca, który pól własnych nie założył, nie ma
  // widzieć pustego nagłówka „Pola własne" na każdym formularzu w systemie.
  if (fields.length === 0) return null;

  return (
    <fieldset data-custom-fields className="flex flex-col gap-5">
      <legend className="text-sm font-medium">{t("values.section")}</legend>

      {fields.map((definition) => {
        const name = customFieldName(definition.id);
        const domId = `${idPrefix}-${definition.id}`;
        const message = errors?.[name];
        const errorId = message ? `${domId}-error` : undefined;
        const hintId = definition.helpText ? `${domId}-hint` : undefined;
        const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
        const invalid = message ? true : undefined;

        const hint = definition.helpText ? (
          <p id={hintId} className="text-muted-foreground text-[13px] leading-[18px]">
            {definition.helpText}
          </p>
        ) : null;

        // Pole zaznaczane ma etykietę OBOK, nie nad — jak wszystkie checkboxy
        // w panelu (wzorzec „aktywny" z formularza produktu).
        if (definition.type === "checkbox") {
          return (
            <div key={definition.id} data-custom-field={definition.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={domId}
                  name={name}
                  defaultChecked={values[definition.id] === true}
                  aria-describedby={describedBy}
                />
                <Label htmlFor={domId}>{definition.label}</Label>
              </div>
              {hint}
              <FieldError id={`${domId}-error`} message={message} />
            </div>
          );
        }

        return (
          <div key={definition.id} data-custom-field={definition.id} className="flex flex-col gap-1.5">
            <Label htmlFor={domId}>{definition.label}</Label>

            {definition.type === "textarea" ? (
              <Textarea
                id={domId}
                name={name}
                rows={4}
                maxLength={CUSTOM_FIELD_LIMITS.textareaMax}
                defaultValue={defaultText(definition, values, locale)}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              />
            ) : definition.type === "select" ? (
              <PanelSelect
                id={domId}
                name={name}
                defaultValue={defaultText(definition, values, locale)}
                // Pusta pozycja jest ZAWSZE: wymagalność egzekwuje serwer
                // (D6 z ADR-118), a lista bez pustki podstawiałaby pierwszą
                // opcję jako odpowiedź, której nikt nie udzielił.
                options={[
                  { value: "", label: t("values.notSelected") },
                  ...definition.options.map((option) => ({ value: option, label: option })),
                ]}
                invalid={Boolean(message)}
                describedBy={describedBy}
              />
            ) : (
              <Input
                id={domId}
                name={name}
                type={definition.type === "date" ? "date" : definition.type === "phone" ? "tel" : "text"}
                inputMode={
                  definition.type === "number" ? "decimal" : definition.type === "phone" ? "tel" : undefined
                }
                maxLength={definition.type === "text" ? CUSTOM_FIELD_LIMITS.textMax : undefined}
                className={definition.type === "number" ? "tabular-nums" : undefined}
                defaultValue={defaultText(definition, values, locale)}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              />
            )}

            {hint}
            <FieldError id={`${domId}-error`} message={message} />
          </div>
        );
      })}
    </fieldset>
  );
}
