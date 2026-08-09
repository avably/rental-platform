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
 *
 * Parytetu obu kopii pilnuje WSPÓLNY zestaw wektorów
 * (`CUSTOM_FIELD_PARITY_VECTORS` w `./vectors`), przepuszczany przez tę
 * funkcję w suicie rdzenia i przez PRAWDZIWY trigger w suicie
 * `packages/db/test/custom-fields.test.ts`. Zestaw jest jeden, więc nie da się
 * poprawić jednej strony i zapomnieć o drugiej.
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

/**
 * Klasa `[[:cntrl:]]` Postgresa.
 *
 * U+0000..U+001F i U+007F to wersja minimalna (strategia „C"), ale na bazie
 * UTF-8 z lokalizacją libc — czyli w naszej konfiguracji — silnik regexpów woła
 * `iswcntrl`, które w glibc obejmuje TAKŻE U+0080..U+009F. Bierzemy zakres
 * SZERSZY: rozjazd w tę stronę znaczy „formularz odrzucił coś, co baza by
 * przyjęła" (komunikat), a w drugą — „formularz przyjął śmieć, baza wywaliła
 * surowy błąd" (awaria).
 */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;
/** To samo, ale z przepustką dla tabulatora i łamania wiersza (tekst długi). */
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_WS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

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
  created_at?: string | null;
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
    createdAt: row.created_at ?? null,
  };
}

function surfaceFlag(definition: CustomFieldDefinition, surface: CustomFieldSurface): boolean {
  if (surface === "panel") return definition.showInPanel;
  if (surface === "checkout") return definition.showInCheckout;
  return definition.showInContract;
}

/** Długość w ZNAKACH, jak `length()` w Postgresie — nie w jednostkach UTF-16. */
function charLength(text: string): number {
  return [...text].length;
}

/**
 * Liczba miejsc po przecinku, ODPORNA na notację wykładniczą.
 *
 * `(0.0000001).toString()` to `"1e-7"`, więc naiwne `split(".")[1]` widziało
 * ZERO miejsc po przecinku i przepuszczało liczbę, którą baza odrzuca
 * (`scale() = 7`). Wykładnik trzeba doliczyć.
 */
function decimalPlaces(value: number): number {
  const match = /^-?\d+(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.toString());
  if (!match) return 0;
  const fraction = (match[1] ?? "").length;
  const exponent = match[2] ? Number(match[2]) : 0;
  return Math.max(0, fraction - exponent);
}

function checkTypedValue(
  definition: CustomFieldDefinition,
  value: CustomFieldValue,
): CustomFieldIssue | null {
  switch (definition.type) {
    case "text": {
      if (typeof value !== "string") return "type";
      if (charLength(value) > CUSTOM_FIELD_LIMITS.textMax) return "tooLong";
      if (CONTROL_RE.test(value)) return "controlChars";
      return null;
    }
    case "textarea": {
      if (typeof value !== "string") return "type";
      if (charLength(value) > CUSTOM_FIELD_LIMITS.textareaMax) return "tooLong";
      if (CONTROL_EXCEPT_WS_RE.test(value)) return "controlChars";
      return null;
    }
    case "phone": {
      if (typeof value !== "string") return "type";
      // SUROWE cyfry — dokładnie tak liczy trigger. Kanonizacja numeru
      // (zdejmowanie „00" i kodu kraju) należy do dopasowywania banów,
      // a nie do pytania „czy to wygląda na telefon".
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
      // PostgreSQL NIE MA ROKU ZEROWEGO — kalendarz idzie 1 p.n.e. → 1 n.e.,
      // więc `'0000-01-01'::date` kończy się „date/time field value out of
      // range". JavaScript rok 0 zna i round-trip przez setUTCFullYear
      // przechodził, więc formularz przyjmował datę, której baza nie zapisze.
      // Zrównanie idzie po stronie SUROWSZEJ: ostatnią bramką jest baza i to
      // JEJ odmowa dociera do użytkownika, więc rdzeń nie ma prawa być
      // luźniejszy. Górnej granicy nie dokładamy: format czterocyfrowy kończy
      // się na 9999, a `'9999-12-31'::date` Postgres przyjmuje (sprawdzone).
      if (year < 1) return "date";
      const parsed = new Date(0);
      // `new Date(Date.UTC(50, …))` mapuje lata 0..99 na 1900+rok, więc data
      // „0050-01-01" wypadała z porównania jako nieistniejąca, choć Postgres
      // przyjmuje ją bez zastrzeżeń. setUTCFullYear tej pułapki nie ma.
      parsed.setUTCFullYear(year, month - 1, day);
      parsed.setUTCHours(0, 0, 0, 0);
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
      if (decimalPlaces(value) > CUSTOM_FIELD_LIMITS.numberScaleMax) return "range";
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

/**
 * Pola do wyrenderowania na danej powierzchni, w kolejności z definicji.
 *
 * Zarchiwizowane NIE WCHODZĄ — to jest cała mechanika „pole znika
 * z formularzy, wartości zostają". Sortowanie po `position`, a remis
 * rozstrzyga `createdAt` — DOKŁADNIE tak, jak indeks
 * `(tenant_id, entity, position, created_at)` i zapytanie ekranu ustawień.
 * Gdyby remis rozstrzygało tu cokolwiek innego (np. `id`), lista w ustawieniach
 * i kolejność na formularzu oraz na umowie PDF rozjechałyby się przy pierwszym
 * remisie pozycji.
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
    .sort(
      (a, b) =>
        a.position - b.position ||
        (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Oszacowanie rozmiaru mapy W REPREZENTACJI BAZY (`pg_column_size` na jsonb),
 * a nie długości JSON-a.
 *
 * jsonb to nie tekst: nagłówek varlena, nagłówek kontenera i DWA czterobajtowe
 * wpisy JEntry na każdą parę. Przy 36-znakowych kluczach różnica idzie w setki
 * bajtów, więc mierzenie `JSON.stringify().length` dawało formularz, który
 * mówi „mieści się", i bazę, która odmawia. Szacunek jest świadomie
 * KONSERWATYWNY (nigdy nie zaniża).
 */
function estimateJsonbSize(values: CustomFieldValues): number {
  let size = 8;
  for (const [key, value] of Object.entries(values)) {
    size += 8 + byteLength(key);
    if (typeof value === "string") size += byteLength(value);
    else if (typeof value === "number") size += 16;
    else size += 1;
  }
  return size;
}

function byteLength(text: string): number {
  return typeof TextEncoder === "undefined" ? text.length : new TextEncoder().encode(text).length;
}

export interface ValidateCustomFieldsResult {
  values: CustomFieldValues;
  issues: CustomFieldIssues;
}

export interface ValidateCustomFieldsOptions {
  requireRequired?: boolean;
  surface?: CustomFieldSurface;
  /** Encja, do której należy zapisywany wiersz — lustro filtra encji w triggerze. */
  entity?: CustomFieldEntity;
  /**
   * Wartości JUŻ ZAPISANE na wierszu. Przepisywane bez zmian wszędzie tam,
   * gdzie TEN zapis pola nie widzi: pod definicją zarchiwizowaną oraz pod
   * definicją spoza `surface`. Bez tego zapis formularza kasowałby dane, do
   * których ten formularz nie ma nawet pola.
   *
   * Podanie `existing` jest OBOWIĄZKOWE przy każdej AKTUALIZACJI wiersza —
   * pominięcie go nie jest błędem typu, tylko cichą utratą danych.
   */
  existing?: CustomFieldValues;
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
  options: ValidateCustomFieldsOptions = {},
): ValidateCustomFieldsResult {
  const { requireRequired = true, surface, entity, existing } = options;
  const scoped = definitions.filter(
    (definition) => entity === undefined || definition.entity === entity,
  );
  const byId = new Map(scoped.map((definition) => [definition.id, definition]));
  const issues: CustomFieldIssues = {};
  const clean: CustomFieldValues = {};

  /**
   * Pole, którego TEN zapis nie widzi — a więc i nie ma prawa nadpisać.
   *
   * Dwa powody, jeden skutek. Zarchiwizowane znika ze WSZYSTKICH formularzy
   * (D4 z ADR-118). Niewidoczne na powierzchni znika z JEDNEJ: pole oznaczone
   * wyłącznie „zamawianie" nie renderuje się w panelu, więc formularz panelu
   * nie przynosi dla niego żadnej wartości.
   *
   * Wynik jest MAPĄ DO ZAPISANIA W CAŁOŚCI (`custom_fields` to jedna kolumna,
   * nie zbiór wierszy), więc każdy klucz pominięty tutaj ZNIKA z bazy. Bez tej
   * gałęzi pierwszy zapis karty klienta kasowałby to, co klient wpisał
   * w sklepie — cicho, bez błędu i bez śladu.
   */
  const invisibleHere = (definition: CustomFieldDefinition): boolean =>
    definition.archivedAt !== null || (surface !== undefined && !surfaceFlag(definition, surface));

  if (existing) {
    for (const [key, value] of Object.entries(existing)) {
      const definition = byId.get(key);
      if (definition && invisibleHere(definition)) clean[key] = value;
    }
  }

  for (const [key, value] of Object.entries(values)) {
    const definition = byId.get(key);
    if (!UUID_RE.test(key) || !definition) {
      issues[key] = "unknownDefinition";
      continue;
    }
    if (invisibleHere(definition)) {
      // Przepisanie tej samej wartości to nie zmiana — baza je przepuszcza,
      // więc formularz też musi (inaczej edycja klienta z zarchiwizowanym
      // polem byłaby niemożliwa z panelu, a możliwa surowym API).
      if (existing && Object.hasOwn(existing, key) && existing[key] === value) continue;
      issues[key] = definition.archivedAt !== null ? "archived" : "hidden";
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
    for (const definition of scoped) {
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

  if (estimateJsonbSize(clean) > CUSTOM_FIELD_LIMITS.valuesBytesMax) {
    issues["*"] = "tooLarge";
  }

  return { values: clean, issues };
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
    // Miejsca po przecinku liczymy z TEKSTU, nie z liczby: `Number` gubi
    // nadmiarowe zera, a to one decydują o `scale()` w bazie.
    if ((normalized.split(".")[1] ?? "").length > CUSTOM_FIELD_LIMITS.numberScaleMax) {
      return { issue: "range" };
    }
    const issue = checkTypedValue(definition, value);
    return issue ? { issue } : { value };
  }

  const issue = checkTypedValue(definition, text);
  return issue ? { issue } : { value: text };
}

export interface ReadCustomFieldValuesOptions extends ValidateCustomFieldsOptions {
  prefix?: string;
}

/**
 * Odczyt kompletu wartości z formularza. Nazwy pól to `<prefix><id>` — id,
 * nigdy etykieta, bo etykieta zmienia się w ustawieniach i zerwałaby wiązanie.
 *
 * Wynik jest mapą do ZAPISANIA W CAŁOŚCI, więc niesie też wartości pod
 * definicjami zarchiwizowanymi (przekazane w `existing`) — patrz
 * `validateCustomFieldValues`.
 */
export function readCustomFieldValues(
  definitions: readonly CustomFieldDefinition[],
  read: (name: string) => string | null | undefined,
  options: ReadCustomFieldValuesOptions = {},
): ValidateCustomFieldsResult {
  const { prefix = "cf_", surface, entity, existing, requireRequired } = options;
  const scoped = definitions.filter(
    (definition) => entity === undefined || definition.entity === entity,
  );
  const active = scoped.filter((definition) => definition.archivedAt === null);
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

  const validated = validateCustomFieldValues(scoped, values, {
    surface,
    entity,
    existing,
    requireRequired,
  });
  return { values: validated.values, issues: { ...issues, ...validated.issues } };
}
