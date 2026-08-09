/**
 * Pola własne na formularzach panelu (C6-A2, ADR-119).
 *
 * Warstwa wspólna dla trzech encji: klienta, zamówienia i produktu. Każda
 * z nich ma inny formularz i inną akcję, ale DOKŁADNIE JEDNĄ drogę do kolumny
 * `custom_fields` — tę. Trzy kopie odczytu formularza rozjechałyby się przy
 * pierwszej poprawce, a rozjazd tutaj znaczy utratę danych najemcy.
 *
 * Zero reguł walidacji w tym pliku: wszystkie mieszkają w `@avably/core`
 * (i w triggerze 0057, którego rdzeń jest lustrem). Tutaj jest wyłącznie
 * podłączenie ich do FormData i do stanu formularza.
 */
import {
  customFieldDefinitionFromRow,
  customFieldValuesFromColumn,
  readCustomFieldValues,
  visibleCustomFields,
  type CustomFieldDefinition,
  type CustomFieldDefinitionRow,
  type CustomFieldEntity,
  type CustomFieldIssue,
  type CustomFieldIssues,
  type CustomFieldSurface,
  type CustomFieldValues,
} from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Prefiks nazw pól w formularzu. Klucz to ID definicji, nigdy etykieta. */
export const CUSTOM_FIELD_PREFIX = "cf_";

/** Nazwa pola formularza dla definicji — jedno miejsce dla widoku i akcji. */
export function customFieldName(definitionId: string): string {
  return `${CUSTOM_FIELD_PREFIX}${definitionId}`;
}

const DEFINITION_COLUMNS =
  "id, entity, field_type, label, help_text, required, options, position, show_in_panel, show_in_checkout, show_in_contract, archived_at, created_at";

/**
 * Definicje najemcy dla jednej encji — WSZYSTKIE, także zarchiwizowane.
 *
 * Zarchiwizowane są tu potrzebne mimo że nie renderują się na formularzu:
 * bez nich `readCustomFieldValues` nie ma jak rozpoznać, że zapisaną wartość
 * należy przepisać nietkniętą, i skasowałby ją przy pierwszym zapisie karty.
 *
 * Filtr najemcy jest jawny, choć bramką jest RLS (0057) — druga warstwa
 * i wygoda diagnostyczna, jak w pozostałych odczytach panelu.
 */
export async function loadCustomFieldDefinitions(
  supabase: SupabaseClient,
  tenantId: string,
  /** Pominięcie daje definicje WSZYSTKICH encji — tak czyta je umowa PDF. */
  entity?: CustomFieldEntity,
): Promise<CustomFieldDefinition[]> {
  const query = supabase
    .from("custom_field_definitions")
    .select(DEFINITION_COLUMNS)
    .eq("tenant_id", tenantId);
  const { data, error } = await (entity ? query.eq("entity", entity) : query)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) =>
    customFieldDefinitionFromRow(row as unknown as CustomFieldDefinitionRow),
  );
}

/**
 * Definicje DO WYRENDEROWANIA na formularzu panelu.
 *
 * Filtr jest tu, po stronie serwera, a nie w komponencie: `visibleCustomFields`
 * to ta sama funkcja, którą zapis stosuje w akcji, więc ekran i zapis nie mają
 * jak się rozjechać. Filtr w widoku dawałby pole niewidoczne, ale zapisywalne.
 */
export async function loadPanelCustomFields(
  supabase: SupabaseClient,
  tenantId: string,
  entity: CustomFieldEntity,
): Promise<CustomFieldDefinition[]> {
  const definitions = await loadCustomFieldDefinitions(supabase, tenantId, entity);
  return visibleCustomFields(definitions, "panel", entity);
}

/** Wartości z kolumny `custom_fields` wiersza encji. */
export function customFieldValuesFromRow(row: { custom_fields?: unknown } | null): CustomFieldValues {
  return customFieldValuesFromColumn(row?.custom_fields);
}

/**
 * Tłumacz powodów odmowy.
 *
 * Rdzeń oddaje KOD (`date`, `option`, `tooLarge`), bo nie zna języka
 * użytkownika. Zamiana kodu na zdanie należy do widoku i ma parytet PL/EN.
 */
export type CustomFieldIssueTranslator = (key: `issue.${CustomFieldIssue}`) => string;

export function customFieldIssueMessage(
  issue: CustomFieldIssue,
  t: CustomFieldIssueTranslator,
): string {
  return t(`issue.${issue}`);
}

export interface CustomFieldFormResult {
  values: CustomFieldValues;
  /**
   * Błędy kluczowane NAZWĄ POLA FORMULARZA (`cf_<id>`), gotowe do wpięcia
   * w `FormState.fieldErrors` — dzięki temu komunikat trafia pod właściwe pole,
   * a nie do zbiorczej linii nad formularzem.
   */
  fieldErrors: Record<string, string>;
  /** Odmowa dotycząca CAŁEJ mapy (rozmiar) — nie ma pola, pod które by trafiła. */
  formError?: string;
}

/**
 * Odczyt pól własnych z FormData i przełożenie odmów na stan formularza.
 *
 * `existing` jest OBOWIĄZKOWY przy aktualizacji: kolumna zapisuje się
 * w całości, więc bez niego zapis skasowałby wartości pod polami, których ten
 * formularz nie pokazuje (zarchiwizowane i checkoutowe).
 */
export function readCustomFieldsFromForm(
  definitions: readonly CustomFieldDefinition[],
  formData: FormData,
  t: CustomFieldIssueTranslator,
  options: { entity: CustomFieldEntity; surface?: CustomFieldSurface; existing?: CustomFieldValues },
): CustomFieldFormResult {
  const { values, issues } = readCustomFieldValues(
    definitions,
    (name) => {
      const value = formData.get(name);
      return typeof value === "string" ? value : null;
    },
    {
      prefix: CUSTOM_FIELD_PREFIX,
      surface: options.surface ?? "panel",
      entity: options.entity,
      ...(options.existing ? { existing: options.existing } : {}),
    },
  );

  const fieldErrors: Record<string, string> = {};
  let formError: string | undefined;
  for (const [key, issue] of Object.entries(issues as CustomFieldIssues)) {
    if (key === "*") {
      formError = customFieldIssueMessage(issue, t);
      continue;
    }
    fieldErrors[customFieldName(key)] = customFieldIssueMessage(issue, t);
  }

  return { values, fieldErrors, ...(formError ? { formError } : {}) };
}

export function hasCustomFieldErrors(result: CustomFieldFormResult): boolean {
  return Object.keys(result.fieldErrors).length > 0 || result.formError !== undefined;
}
