/**
 * Walidacja i odczyt wartości pól własnych (C6-A1, ADR-118).
 *
 * JEDNA funkcja dla wszystkich powierzchni: panel dziś, checkout i API v1
 * w części 2. Reguła istniejąca w dwóch kopiach rozjeżdża się przy pierwszej
 * poprawce, a tu rozjazd znaczy „formularz przyjął, baza odrzuciła" (albo
 * gorzej: „formularz odrzucił, surowe API przyjęło").
 *
 * Wszystko poniżej jest LUSTREM triggera `app.custom_fields_validate` z 0057
 * — z JEDNYM świadomym rozszerzeniem: `required`. Wymagalność jest regułą
 * formularza, nie reprezentowalności wiersza (uzasadnienie w nagłówku 0057
 * i w ADR-118), więc egzekwuje ją wyłącznie ta funkcja.
 */

import {
  CUSTOM_FIELD_LIMITS,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldIssue,
  type CustomFieldIssues,
  type CustomFieldSurface,
  type CustomFieldValue,
  type CustomFieldValues,
  isCustomFieldEntity,
  isCustomFieldType,
} from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const PHONE_SHAPE_RE = /^[0-9 ()+-]{6,30}$/;
// Klasa [[:cntrl:]] Postgresa to U+0000..U+001F oraz U+007F. Zapis przez
// escape'y, a nie dosłowne znaki sterujące w źródle — te drugie są
// niewidoczne w diffie i giną przy kopiowaniu pliku.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_WS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Wiersz `public.custom_field_definitions` tak, jak oddaje go PostgREST. */
export interface CustomFieldDefinitionRow {
  id: string;
  entity: string;
  field_type: string;
  label: string;
  help_text: string | null;
  required: boolean;
  options: unknown;
  position: number;
  show_in_panel: boolean;
  show_in_checkout: boolean;
  show_in_contract: boolean;
  archived_at: string | null;
}

/**
 * Mapowanie wiersza na kształt domenowy. Nieznany typ albo nieznana encja to
 * BŁĄD, nie wartość domyślna: wiersz spoza zamkniętej listy oznacza, że kod
 * jest starszy od schematu, a ciche podstawienie „text" renderowałoby pole
 * niezgodnie z tym, co waliduje baza.
 */
export function customFieldDefinitionFromRow(row: CustomFieldDefinitionRow): CustomFieldDefinition {
  if (!isCustomFieldType(row.field_type)) {
    throw new Error(`Nieznany typ pola własnego: ${row.field_type}`);
  }
  if (!isCustomFieldEntity(row.entity)) {
    throw new Error(`Nieznana encja pola własnego: ${row.entity}`);
  }
  return {
    id: row.id,
    entity: row.entity,
    type: row.field_type,
    label: row.label,
    helpText: row.help_text,
    required: row.required,
    options: Array.isArray(row.options) ? (row.options as string[]) : [],
    position: row.position,
    showInPanel: row.show_in_panel,
    showInCheckout: row.show_in_checkout,
    showInContract: row.show_in_contract,
    archivedAt: row.archived_at,
  };
}

function surfaceFlag(definition: CustomFieldDefinition, surface: CustomFieldSurface): boolean {
  if (surface === "panel") return definition.showInPanel;
  if (surface === "checkout") return definition.showInCheckout;
  return definition.showInContract;
}

/**
 * Pola do wyrenderowania na danej powierzchni, w kolejności z definicji.
 *
 * Zarchiwizowane NIE WCHODZĄ — to jest cała mechanika „pole znika
 * z formularzy, wartości zostają". Sortowanie po `position`, remis rozstrzyga
 * `id`, żeby kolejność była deterministyczna także dla pól z tą samą pozycją
 * (inaczej umowa PDF w części 2 drukowałaby je raz tak, raz tak).
 */
export function visibleCustomFields(
  definitions: readonly CustomFieldDefinition[],
  surface: CustomFieldSurface,
  entity?: CustomFieldEntity,
): CustomFieldDefinition[] {
  return definitions
    .filter(
      (definition) =>
        definition.archivedAt === null &&
        surfaceFlag(definition, surface) &&
        (entity === undefined || definition.entity === entity),
    )
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

function checkTypedValue(
  definition: CustomFieldDefinition,
  value: CustomFieldValue,
): CustomFieldIssue | null {
  switch (definition.type) {
    case "text": {
      if (typeof value !== "string") return "type";
      if (value.length > CUSTOM_FIELD_LIMITS.textMax) return "tooLong";
      if (CONTROL_RE.test(value)) return "controlChars";
      return null;
    }
    case "textarea": {
      if (typeof value !== "string") return "type";
      if (value.length > CUSTOM_FIELD_LIMITS.textareaMax) return "tooLong";
      if (CONTROL_EXCEPT_WS_RE.test(value)) return "controlChars";
      return null;
    }
    case "phone": {
      if (typeof value !== "string") return "type";
      const digits = value.replace(/[^0-9]/g, "");
      if (
        !PHONE_SHAPE_RE.test(value) ||
        digits.length < CUSTOM_FIELD_LIMITS.phoneDigitsMin ||
        digits.length > CUSTOM_FIELD_LIMITS.phoneDigitsMax
      ) {
        return "phone";
      }
      return null;
    }
    case "date": {
      if (typeof value !== "string") return "type";
      if (!ISO_DATE_RE.test(value)) return "date";
      // Rzeczywista data, nie sam kształt: `2026-02-31` przechodzi regex,
      // ale nie jest dniem — a od tego zależy, czy sortowanie po tym polu
      // będzie w części 2 uczciwe.
      const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
      ) {
        return "date";
      }
      return null;
    }
    case "select": {
      if (typeof value !== "string") return "type";
      return definition.options.includes(value) ? null : "option";
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "type";
      if (Math.abs(value) > CUSTOM_FIELD_LIMITS.numberAbsMax) return "range";
      const decimals = (value.toString().split(".")[1] ?? "").length;
      if (decimals > CUSTOM_FIELD_LIMITS.numberScaleMax) return "range";
      return null;
    }
    case "checkbox": {
      return typeof value === "boolean" ? null : "type";
    }
    default: {
      // Fail-closed jak w bazie: typ bez gałęzi jest polem BEZ walidacji.
      return "type";
    }
  }
}

export interface ValidateCustomFieldsResult {
  values: CustomFieldValues;
  issues: CustomFieldIssues;
}

/**
 * Sprawdza mapę wartości względem definicji.
 *
 * `values` może zawierać wyłącznie klucze znanych, NIEZARCHIWIZOWANYCH
 * definicji tej encji — klucz spoza tego zbioru to `unknownDefinition`, czyli
 * dokładnie ta odmowa, którą baza oddaje kodem 22023 przy próbie zapisu pod
 * ID cudzej definicji.
 */
export function validateCustomFieldValues(
  definitions: readonly CustomFieldDefinition[],
  values: CustomFieldValues,
  options: { requireRequired?: boolean; surface?: CustomFieldSurface } = {},
): ValidateCustomFieldsResult {
  const { requireRequired = true, surface } = options;
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const issues: CustomFieldIssues = {};
  const clean: CustomFieldValues = {};

  for (const [key, value] of Object.entries(values)) {
    const definition = byId.get(key);
    if (!UUID_RE.test(key) || !definition) {
      issues[key] = "unknownDefinition";
      continue;
    }
    if (definition.archivedAt !== null) {
      issues[key] = "archived";
      continue;
    }
    const issue = checkTypedValue(definition, value);
    if (issue) {
      issues[key] = issue;
      continue;
    }
    clean[key] = value;
  }

  if (requireRequired) {
    for (const definition of definitions) {
      if (!definition.required || definition.archivedAt !== null) continue;
      if (surface !== undefined && !surfaceFlag(definition, surface)) continue;
      if (issues[definition.id]) continue;
      const value = clean[definition.id];
      // Checkbox wymagany znaczy „musi być zaznaczony" — `false` nie spełnia
      // wymogu, inaczej flaga wymagalności nie znaczyłaby przy nim nic.
      const filled =
        value !== undefined && !(typeof value === "string" && value.trim() === "") && value !== false;
      if (!filled) issues[definition.id] = "required";
    }
  }

  if (byteLength(JSON.stringify(clean)) > CUSTOM_FIELD_LIMITS.valuesBytesMax) {
    issues["*"] = "tooLarge";
  }

  return { values: clean, issues };
}

function byteLength(text: string): number {
  return typeof TextEncoder === "undefined" ? text.length : new TextEncoder().encode(text).length;
}

/**
 * Zamiana surowego wejścia formularza (zawsze string albo brak) na wartość
 * TYPOWANĄ. Pusty wpis daje `undefined` — czyli klucz NIE TRAFIA do mapy.
 * Pustka ma jedną reprezentację: brak klucza (tak samo w bazie, gdzie JSON-owy
 * `null` jest odrzucany).
 */
export function parseCustomFieldInput(
  definition: CustomFieldDefinition,
  raw: string | null | undefined,
): { value?: CustomFieldValue; issue?: CustomFieldIssue } {
  if (definition.type === "checkbox") {
    // Niezaznaczony checkbox nie przychodzi w `FormData` w ogóle — brak wpisu
    // znaczy `false`, a nie „pole pominięte".
    return { value: raw === "on" || raw === "true" || raw === "1" };
  }

  const text = (raw ?? "").trim();
  if (text === "") return {};

  if (definition.type === "number") {
    // Przecinek dziesiętny jest tym, co realnie wpisuje polski operator.
    const normalized = text.replace(/\s/g, "").replace(",", ".");
    if (!/^-?[0-9]+(\.[0-9]+)?$/.test(normalized)) return { issue: "number" };
    const value = Number(normalized);
    if (!Number.isFinite(value)) return { issue: "number" };
    const issue = checkTypedValue(definition, value);
    return issue ? { issue } : { value };
  }

  const issue = checkTypedValue(definition, text);
  return issue ? { issue } : { value: text };
}

/**
 * Odczyt kompletu wartości z formularza. Nazwy pól to `<prefix><id>` — id,
 * nigdy etykieta, bo etykieta zmienia się w ustawieniach i zerwałaby wiązanie.
 */
export function readCustomFieldValues(
  definitions: readonly CustomFieldDefinition[],
  read: (name: string) => string | null | undefined,
  options: { prefix?: string; surface?: CustomFieldSurface } = {},
): ValidateCustomFieldsResult {
  const { prefix = "cf_", surface } = options;
  const active = definitions.filter((definition) => definition.archivedAt === null);
  const values: CustomFieldValues = {};
  const issues: CustomFieldIssues = {};

  for (const definition of active) {
    if (surface !== undefined && !surfaceFlag(definition, surface)) continue;
    const { value, issue } = parseCustomFieldInput(definition, read(`${prefix}${definition.id}`));
    if (issue) {
      issues[definition.id] = issue;
      continue;
    }
    if (value !== undefined) values[definition.id] = value;
  }

  const validated = validateCustomFieldValues(active, values, { surface });
  return { values: validated.values, issues: { ...issues, ...validated.issues } };
}
