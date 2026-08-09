/**
 * Pola własne — słownik pojęć i granice (C6-A1, ADR-118).
 *
 * Ten plik jest LUSTREM migracji 0057: każda stała ma odpowiednik w CHECK-u
 * albo w triggerze `app.custom_fields_validate`. Rozjazd między tymi dwoma
 * miejscami znaczy, że formularz przyjmie coś, co baza odrzuci (albo odwrotnie),
 * więc parytet pilnuje test kontraktowy w `packages/db/test/custom-fields.test.ts`.
 *
 * KTO JEST ŹRÓDŁEM PRAWDY: baza. Ten moduł istnieje po to, żeby użytkownik
 * zobaczył czytelny komunikat ZANIM zapis poleci, a nie po to, żeby zastąpić
 * bramkę — surowe API ma tę samą drogę do kolumny co panel.
 */

/**
 * Siedem typów fazy A.
 *
 * ŚWIADOMIE BEZ typu „plik" (ADR-118, spójnie z ADR-113): pole plikowe
 * wpuszczałoby skany dokumentów tożsamości tylnymi drzwiami — dokładnie to,
 * czego zakazuje decyzja o zakresie zbieranych danych. To jest decyzja
 * produktowa, nie luka do domknięcia w kolejnym zadaniu.
 */
export const CUSTOM_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "checkbox",
  "phone",
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** Encje, do których pole można przypiąć. */
export const CUSTOM_FIELD_ENTITIES = ["customer", "order", "product"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

/** Powierzchnie, na których pole może się pokazać. */
export const CUSTOM_FIELD_SURFACES = ["panel", "checkout", "contract"] as const;
export type CustomFieldSurface = (typeof CUSTOM_FIELD_SURFACES)[number];

/** Granice — lustro CHECK-ów i triggera z 0057. */
export const CUSTOM_FIELD_LIMITS = {
  labelMax: 60,
  helpTextMax: 200,
  textMax: 200,
  textareaMax: 2000,
  optionMax: 80,
  optionsMax: 50,
  positionMax: 9999,
  numberAbsMax: 1e12,
  numberScaleMax: 6,
  phoneDigitsMin: 6,
  phoneDigitsMax: 15,
  /** Rozmiar całej mapy wartości w bajtach (pg_column_size). */
  valuesBytesMax: 8192,
} as const;

/**
 * Definicja pola w kształcie domenowym (camelCase). Wiersz bazy mapuje na nią
 * `customFieldDefinitionFromRow`.
 */
export interface CustomFieldDefinition {
  id: string;
  entity: CustomFieldEntity;
  type: CustomFieldType;
  label: string;
  helpText: string | null;
  required: boolean;
  /** Niepuste wyłącznie dla `select`. */
  options: readonly string[];
  position: number;
  showInPanel: boolean;
  showInCheckout: boolean;
  showInContract: boolean;
  /** Niepuste = pole zarchiwizowane: znika z formularzy, wartości zostają. */
  archivedAt: string | null;
  /**
   * Rozstrzyga REMIS pozycji — dokładnie jak indeks
   * `(tenant_id, entity, position, created_at)`. Bez tego lista w ustawieniach
   * i kolejność na formularzu (oraz na umowie PDF) rozjeżdżałyby się przy
   * pierwszych dwóch polach o tej samej pozycji.
   */
  createdAt: string | null;
}

/** Wartość TYPOWANA — nie string. Na tym stoi cała przewaga modelu. */
export type CustomFieldValue = string | number | boolean;

/** Mapa ID definicji → wartość. Klucz to ZAWSZE id, nigdy etykieta. */
export type CustomFieldValues = Record<string, CustomFieldValue>;

/**
 * Powód odrzucenia. Kod, nie zdanie: tłumaczenie należy do warstwy widoku
 * (panel ma parytet PL/EN), a rdzeń nie zna języka użytkownika.
 */
export type CustomFieldIssue =
  | "unknownDefinition"
  | "archived"
  | "required"
  | "type"
  | "tooLong"
  | "controlChars"
  | "option"
  | "date"
  | "phone"
  | "number"
  | "range"
  | "tooLarge";

export type CustomFieldIssues = Record<string, CustomFieldIssue>;

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return typeof value === "string" && (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
}

export function isCustomFieldEntity(value: unknown): value is CustomFieldEntity {
  return typeof value === "string" && (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(value);
}

export function isCustomFieldSurface(value: unknown): value is CustomFieldSurface {
  return typeof value === "string" && (CUSTOM_FIELD_SURFACES as readonly string[]).includes(value);
}
