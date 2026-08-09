/**
 * Pola własne po stronie serwera — odczyt definicji i formularza w jednym
 * kroku (C6-A2, ADR-119).
 *
 * Osobny plik od `lib/custom-fields.ts` z JEDNEGO powodu: tamten moduł jest
 * współdzielony z komponentem klienckim (nazwa pola formularza), a tutaj
 * wchodzi `next-intl/server`. Wspólny plik wciągnąłby serwerowe tłumaczenia
 * do bundla przeglądarki.
 */
import type { CustomFieldEntity, CustomFieldValues } from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";

import {
  loadCustomFieldDefinitions,
  readCustomFieldsFromForm,
  type CustomFieldFormResult,
} from "./custom-fields";

/**
 * Komplet: definicje najemcy z bazy + odczyt wartości z formularza + odmowy
 * przetłumaczone na język operatora.
 *
 * DWIE FUNKCJE, NIE JEDNA Z OPCJĄ (C6-A3, ADR-121). Jedno wejście z
 * `existing?: CustomFieldValues` znaczyło, że akcja aktualizująca wiersz mogła
 * pominąć mapę BEZ BŁĘDU KOMPILACJI — a pominięcie jej kasuje wartości pod
 * polami, których panel nie pokazuje: przede wszystkim te oznaczone wyłącznie
 * „zamawianie", czyli wpisane przez KLIENTA w sklepie. Od C6-A3 taka wartość
 * realnie istnieje, więc pomyłka przestała być teoretyczna. Rozdzielenie
 * czyni ją błędem typu: `readCustomFieldsForUpdate` nie da się zawołać bez
 * `existing`, a wybór funkcji jest widoczny w miejscu wywołania.
 */
async function readForPanel(
  supabase: SupabaseClient,
  tenantId: string,
  entity: CustomFieldEntity,
  formData: FormData,
  mode: { mode: "create" } | { mode: "update"; existing: CustomFieldValues },
): Promise<CustomFieldFormResult> {
  const definitions = await loadCustomFieldDefinitions(supabase, tenantId, entity);
  const t = await getTranslations("customFields");
  return readCustomFieldsFromForm(definitions, formData, t, {
    ...mode,
    entity,
    surface: "panel",
  });
}

/** TWORZENIE wiersza — nie ma czego przepisywać, bo wiersza jeszcze nie ma. */
export async function readCustomFieldsForCreate(
  supabase: SupabaseClient,
  tenantId: string,
  entity: CustomFieldEntity,
  formData: FormData,
): Promise<CustomFieldFormResult> {
  return readForPanel(supabase, tenantId, entity, formData, { mode: "create" });
}

/**
 * AKTUALIZACJA wiersza — `existing` jest argumentem WYMAGANYM (pominięcie =
 * błąd kompilacji). Mapa musi pochodzić z ODCZYTU TEGO wiersza tuż przed
 * zapisem, nie ze stanu formularza.
 */
export async function readCustomFieldsForUpdate(
  supabase: SupabaseClient,
  tenantId: string,
  entity: CustomFieldEntity,
  formData: FormData,
  existing: CustomFieldValues,
): Promise<CustomFieldFormResult> {
  return readForPanel(supabase, tenantId, entity, formData, { mode: "update", existing });
}
