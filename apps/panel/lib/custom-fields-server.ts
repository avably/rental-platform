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
 * `existing` przekazuje KAŻDA akcja aktualizująca istniejący wiersz. Pominięcie
 * go nie jest błędem typu — jest cichym skasowaniem wartości pod polami,
 * których ten formularz nie pokazuje.
 */
export async function readCustomFieldsForWrite(
  supabase: SupabaseClient,
  tenantId: string,
  entity: CustomFieldEntity,
  formData: FormData,
  existing?: CustomFieldValues,
): Promise<CustomFieldFormResult> {
  const definitions = await loadCustomFieldDefinitions(supabase, tenantId, entity);
  const t = await getTranslations("customFields");
  return readCustomFieldsFromForm(definitions, formData, t, {
    entity,
    surface: "panel",
    ...(existing ? { existing } : {}),
  });
}
