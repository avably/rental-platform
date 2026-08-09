/**
 * Prezentacja wartości pól własnych (C6-A2, ADR-119).
 *
 * JEDNO miejsce, w którym wartość TYPOWANA zamienia się w tekst dla człowieka
 * — karta w panelu i sekcja umowy PDF muszą pokazywać tę samą datę tak samo.
 * Gdyby każda powierzchnia formatowała po swojemu, operator widziałby na
 * ekranie „5 marca 2026", a klient na podpisanej umowie „2026-03-05".
 *
 * Formatowanie jest ŚWIADOMIE poza pakietem `@avably/pdf`: ten pakiet ma
 * kontrakt „wołający podaje gotowe stringi" (wzorzec 8a) i nie zna ani
 * definicji pól, ani stref czasowych.
 */

import type { Locale } from "../locale";

import type {
  CustomFieldDefinition,
  CustomFieldEntity,
  CustomFieldSurface,
  CustomFieldValue,
  CustomFieldValues,
} from "./types";
import { visibleCustomFields } from "./validate";

/**
 * Odpowiedź na pole zaznaczane.
 *
 * `false` to ODPOWIEDŹ, nie brak odpowiedzi — „Nie" musi być na umowie
 * widoczne, bo dokładnie po to operator to pole zakłada (zgoda odebrana czy
 * nie, kaucja w gotówce czy nie).
 */
const BOOLEAN_WORDS: Record<Locale, { yes: string; no: string }> = {
  pl: { yes: "Tak", no: "Nie" },
  en: { yes: "Yes", no: "No" },
};

const INTL_LOCALE: Record<Locale, string> = { pl: "pl-PL", en: "en-US" };

const ISO_DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * Wartość jako tekst — albo PUSTY STRING, gdy wartości faktycznie nie ma.
 *
 * Pusty wynik jest sygnałem dla wołającego: wiersz ma NIE POWSTAĆ. Sierocą
 * etykietę bez wartości widać na umowie jak dziurę w dokumencie, a pustą
 * sekcję „Dane dodatkowe" — jak błąd generatora.
 */
export function formatCustomFieldValue(
  definition: CustomFieldDefinition,
  value: CustomFieldValue | undefined,
  locale: Locale,
): string {
  if (value === undefined || value === null) return "";

  if (definition.type === "checkbox") {
    if (typeof value !== "boolean") return String(value).trim();
    return value ? BOOLEAN_WORDS[locale].yes : BOOLEAN_WORDS[locale].no;
  }

  if (definition.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return String(value).trim();
    // `maximumFractionDigits` musi sięgać granicy typu (scale 6 w 0057),
    // inaczej Intl zaokrągliłby wartość, którą operator wpisał świadomie —
    // i umowa niosłaby inną liczbę niż baza.
    return new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 6 }).format(value);
  }

  const text = typeof value === "string" ? value.trim() : String(value).trim();
  if (text === "") return "";

  if (definition.type === "date") {
    // Kształt sprawdzamy PRZED `Date`, bo wartość mogła trafić do kolumny
    // surowym API sprzed walidacji. Gdy nie jest datą — pokazujemy ją tak, jak
    // leży, zamiast „Invalid Date" na dokumencie najemcy.
    if (!ISO_DATE_RE.test(text)) return text;
    const parsed = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return text;
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(parsed);
  }

  return text;
}

/** Para etykieta→wartość gotowa do wydruku. */
export interface CustomFieldDisplayRow {
  id: string;
  label: string;
  value: string;
}

export interface CustomFieldDisplayOptions {
  surface: CustomFieldSurface;
  locale: Locale;
  entity?: CustomFieldEntity;
}

/**
 * Wiersze do pokazania na danej powierzchni — w kolejności z definicji.
 *
 * WIDOCZNOŚĆ JEST KONTRAKTEM, NIE SUGESTIĄ: filtruje `visibleCustomFields`,
 * czyli ta sama funkcja, która decyduje o renderowaniu pola na formularzu.
 * Pole bez flagi danej powierzchni nie ma stąd żadnego wyjścia — także wtedy,
 * gdy wartość w kolumnie jest.
 */
export function customFieldDisplayRows(
  definitions: readonly CustomFieldDefinition[],
  values: CustomFieldValues,
  options: CustomFieldDisplayOptions,
): CustomFieldDisplayRow[] {
  const rows: CustomFieldDisplayRow[] = [];
  for (const definition of visibleCustomFields(definitions, options.surface, options.entity)) {
    const value = formatCustomFieldValue(definition, values[definition.id], options.locale);
    if (value === "") continue;
    rows.push({ id: definition.id, label: definition.label, value });
  }
  return rows;
}

/**
 * Odczyt kolumny `custom_fields` z wiersza PostgREST.
 *
 * `jsonb` przychodzi jako `unknown`. Wartości spoza `string | number | boolean`
 * (zagnieżdżony obiekt, tablica, `null`) są POMIJANE, a nie rzutowane: trigger
 * z 0057 ich nie wpuści, więc gdyby jednak się tam znalazły, znaczyłoby to, że
 * kolumnę zapisano z pominięciem bazy — i wtedy tym bardziej nie chcemy ich
 * podawać dalej jako wartości pola.
 */
export function customFieldValuesFromColumn(column: unknown): CustomFieldValues {
  if (typeof column !== "object" || column === null || Array.isArray(column)) return {};
  const values: CustomFieldValues = {};
  for (const [key, value] of Object.entries(column as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      values[key] = value;
    }
  }
  return values;
}
