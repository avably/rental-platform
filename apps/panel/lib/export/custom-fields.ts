/**
 * Dynamiczne kolumny pól własnych w formacie wymiany CSV (C6-A3, ADR-121;
 * reguła rozszerzalności z ADR-111).
 *
 * Kolumny stałe są STABILNYM PREFIKSEM kontraktu — pola własne wolno wyłącznie
 * DOKLEJAĆ na końcu, pod nazwą `cf_<id definicji>`. Prefiks `cf_` gwarantuje
 * brak kolizji z kolumnami stałymi, a klucz to ID, nigdy etykieta: etykieta
 * zmienia się w ustawieniach i zerwałaby wiązanie przy pierwszej korekcie
 * literówki.
 *
 * ZAWARTOŚĆ TO DANE, NIE PREZENTACJA (ADR-111): liczba wychodzi liczbą,
 * checkbox boolem, data stringiem ISO. Formatowanie „po ludzku" należy do
 * ekranu i do umowy PDF, nie do pliku, który wraca importem.
 *
 * KTÓRE DEFINICJE WCHODZĄ — i dlaczego ODPOWIEDŹ JEST RÓŻNA dla katalogu
 * i dla pozostałych eksportów:
 *
 *   * KATALOG jest FORMATEM WYMIANY pod import (ADR-112), więc niesie
 *     wyłącznie definicje ŻYWE. Kolumna pod definicją zarchiwizowaną byłaby
 *     kolumną, której nie wolno edytować — a plik, który wraca importem,
 *     nie ma prawa zawierać pól-pułapek;
 *   * ZAMÓWIENIA i KLIENCI nie mają importu i są czystym zrzutem danych
 *     (anty-vendor-lock, przenoszalność z RODO), więc niosą definicje
 *     zarchiwizowane TAKŻE — tam kompletność nie kłóci się z niczym.
 *
 * Widoczności („panel"/„zamawianie"/„umowa") eksport NIE FILTRUJE w ogóle:
 * to są dane najemcy, a nie powierzchnia formularza. Operator zabiera swoje.
 */
import {
  customFieldDefinitionFromRow,
  type CustomFieldDefinition,
  type CustomFieldDefinitionRow,
  type CustomFieldEntity,
  type CustomFieldValues,
} from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CsvValue } from "./csv";

/** Prefiks kolumn dynamicznych — ten sam co nazwy pól formularza w panelu. */
export const CSV_CUSTOM_FIELD_PREFIX = "cf_";

export function customFieldColumn(definitionId: string): string {
  return `${CSV_CUSTOM_FIELD_PREFIX}${definitionId}`;
}

const DEFINITION_COLUMNS =
  "id, entity, field_type, label, help_text, required, options, position, show_in_panel, show_in_checkout, show_in_contract, archived_at, created_at";

/**
 * Definicje najemcy dla jednej encji, w KOLEJNOŚCI KOLUMN pliku.
 *
 * Sortowanie (position, created_at, id) jest tym samym, którego trzyma się
 * indeks z 0057, panel i umowa PDF — dzięki temu kolumny w arkuszu stoją
 * w kolejności, którą operator ustawił w ustawieniach, a nie w przypadkowej.
 *
 * Filtr najemcy jest jawny obok RLS (dwie warstwy, konwencja eksportów).
 */
export async function loadExportCustomFields(
  supabase: SupabaseClient,
  tenantId: string,
  entity: CustomFieldEntity,
  options: { includeArchived: boolean },
): Promise<CustomFieldDefinition[]> {
  const query = supabase
    .from("custom_field_definitions")
    .select(DEFINITION_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("entity", entity);
  const { data, error } = await (options.includeArchived ? query : query.is("archived_at", null))
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`Eksport pól własnych: odczyt nie powiódł się (${error.code}).`);
  return (data ?? []).map((row) =>
    customFieldDefinitionFromRow(row as unknown as CustomFieldDefinitionRow),
  );
}

/** Nagłówki dynamiczne — DOKLEJANE na końcu kolumn stałych. */
export function customFieldHeader(definitions: readonly CustomFieldDefinition[]): string[] {
  return definitions.map((definition) => customFieldColumn(definition.id));
}

/**
 * Komórki jednego wiersza, w kolejności `customFieldHeader`.
 *
 * Checkbox bez klucza wychodzi jako `false`, a nie jako pusta komórka —
 * inaczej round-trip nie byłby stabilny: import przeczytałby pustkę jako
 * `false` (tak samo jak niezaznaczone pole formularza) i DRUGI eksport tego
 * samego katalogu różniłby się od pierwszego. Pozostałe typy mają jedną
 * reprezentację pustki: brak klucza = pusta komórka.
 */
export function customFieldCells(
  definitions: readonly CustomFieldDefinition[],
  values: CustomFieldValues,
): CsvValue[] {
  return definitions.map((definition) => {
    const value = values[definition.id];
    if (value === undefined) return definition.type === "checkbox" ? false : null;
    return value;
  });
}
