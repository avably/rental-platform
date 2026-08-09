"use client";

/**
 * Pola własne najemcy na formularzu zamawiania (C6-A3, ADR-121).
 *
 * WŁASNY KOMPONENT, NIE `CustomFieldsFieldset` Z PANELU — i to nie jest
 * duplikacja przez niedopatrzenie. Tamten renderuje w tokenach panelu
 * (obrys pola, kolor fokusu, wypełnienie kontrolki); tutaj obowiązuje reguła
 * z nagłówka `checkout-form.tsx`: kasa nosi WYŁĄCZNIE role motywu najemcy
 * (`site-field`, `site-label`, `site-error`). Wspólny komponent wciągnąłby
 * paletę panelu przez zależność, której skan źródeł tego pliku nie widzi.
 *
 * Wspólna zostaje rzecz ważniejsza od wyglądu: zbiór typów, ich granice
 * i decyzja, KTÓRE pole się renderuje (`checkoutCustomFields` z rdzenia).
 *
 * Wartości trzymamy STRINGAMI — tak, jak wychodzą z kontrolek HTML. Typowanie
 * (liczba liczbą, checkbox boolem) robi serwer tym samym parserem, którym
 * czyta je panel i wtyczka WordPress; przeglądarka nie jest miejscem, w którym
 * wolno rozstrzygać o kształcie wartości trafiającej do bazy.
 */
import { CUSTOM_FIELD_LIMITS, type CustomFieldDefinition } from "@avably/core";

import { SITE_HEADING } from "@/components/storefront/store-chrome";

export interface CheckoutCustomFieldsProps {
  definitions: readonly CustomFieldDefinition[];
  values: Record<string, string>;
  onChange: (definitionId: string, value: string) => void;
  /** Komunikat pod polem — klucz to ID definicji. */
  errors: Record<string, string | undefined>;
  heading: string;
  requiredLabel: string;
  optionalLabel: string;
  choosePlaceholder: string;
  disabled: boolean;
}

function fieldId(definitionId: string): string {
  return `co-cf-${definitionId}`;
}

export function CheckoutCustomFields({
  definitions,
  values,
  onChange,
  errors,
  heading,
  requiredLabel,
  optionalLabel,
  choosePlaceholder,
  disabled,
}: CheckoutCustomFieldsProps) {
  // Brak pól = BRAK SEKCJI (ta sama zasada co przy sekcji umowy w ADR-119):
  // pusty nagłówek wygląda na awarię, a nie na sklep bez pól własnych.
  if (definitions.length === 0) return null;

  return (
    <fieldset className="grid gap-4" disabled={disabled}>
      <legend className={`text-lg ${SITE_HEADING}`}>{heading}</legend>
      {definitions.map((definition) => {
        const id = fieldId(definition.id);
        const errorId = `${id}-error`;
        const message = errors[definition.id];
        const value = values[definition.id] ?? "";
        const describedBy = message ? errorId : undefined;
        const common = {
          id,
          "aria-invalid": Boolean(message),
          "aria-describedby": describedBy,
        } as const;

        // Checkbox nosi etykietę PO PRAWEJ i nie dostaje dopisku
        // „wymagane/opcjonalnie": przy zgodzie taki dopisek czyta się jak
        // część treści zgody, a nie jak metadana pola.
        if (definition.type === "checkbox") {
          return (
            <div className="grid gap-1" key={definition.id}>
              <div className="flex items-start gap-3">
                <input
                  {...common}
                  type="checkbox"
                  className="mt-1 size-4 accent-[color:var(--site-accent)]"
                  checked={value === "on"}
                  onChange={(event) => onChange(definition.id, event.target.checked ? "on" : "")}
                />
                <label htmlFor={id} className="text-sm leading-6">
                  {definition.label}
                </label>
              </div>
              {definition.helpText ? (
                <p className="site-text-muted text-xs">{definition.helpText}</p>
              ) : null}
              <p className="site-error min-h-5 text-sm" id={errorId}>
                {message}
              </p>
            </div>
          );
        }

        return (
          <div className="grid gap-1" key={definition.id}>
            <label className="site-label text-sm" htmlFor={id}>
              {definition.label}{" "}
              <span className="site-text-muted">
                ({definition.required ? requiredLabel : optionalLabel})
              </span>
            </label>

            {definition.type === "textarea" ? (
              <textarea
                {...common}
                className="site-field w-full px-3 py-2 text-sm"
                rows={3}
                maxLength={CUSTOM_FIELD_LIMITS.textareaMax}
                value={value}
                onChange={(event) => onChange(definition.id, event.target.value)}
              />
            ) : null}

            {definition.type === "select" ? (
              // Ta sama konstrukcja co przy punkcie odbioru: natywny <select>
              // (dostępność, klawiatura, natywna lista na telefonie) bez
              // systemowej strzałki, z własną narysowaną pod spodem.
              <div className="relative">
                <select
                  {...common}
                  className="site-field h-10 w-full appearance-none px-3 pr-9 text-sm"
                  value={value}
                  onChange={(event) => onChange(definition.id, event.target.value)}
                >
                  <option value="">{choosePlaceholder}</option>
                  {definition.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <svg
                  aria-hidden="true"
                  className="site-text-muted pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </div>
            ) : null}

            {definition.type === "text" ||
            definition.type === "number" ||
            definition.type === "date" ||
            definition.type === "phone" ? (
              <input
                {...common}
                className="site-field h-9 w-full px-3 text-sm"
                // `number` jedzie jako tekst z klawiaturą numeryczną, nie jako
                // <input type="number">: polski operator i polski klient piszą
                // przecinek dziesiętny, a `type="number"` odrzuca go po cichu
                // (pole zostaje puste i nikt nie wie dlaczego). Parser rdzenia
                // przecinek zna.
                type={
                  definition.type === "date"
                    ? "date"
                    : definition.type === "phone"
                      ? "tel"
                      : "text"
                }
                {...(definition.type === "number" ? { inputMode: "decimal" as const } : {})}
                {...(definition.type === "text"
                  ? { maxLength: CUSTOM_FIELD_LIMITS.textMax }
                  : {})}
                {...(definition.type === "phone" ? { maxLength: 30 } : {})}
                value={value}
                onChange={(event) => onChange(definition.id, event.target.value)}
              />
            ) : null}

            {definition.helpText ? (
              <p className="site-text-muted text-xs">{definition.helpText}</p>
            ) : null}
            <p className="site-error min-h-5 text-sm" id={errorId}>
              {message}
            </p>
          </div>
        );
      })}
    </fieldset>
  );
}
