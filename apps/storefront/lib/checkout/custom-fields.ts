/**
 * Pola własne w ZAMAWIANIU (C6-A3, ADR-121) — jedno wejście dla sklepu,
 * publicznego API v1 i wtyczki WordPress.
 *
 * Wszystkie trzy powierzchnie kończą w `submitCheckoutCore`, więc reguła
 * mieszka TUTAJ, a nie w trzech kopiach. Zero własnych reguł walidacji:
 * typy, długości i opcje sprawdza rdzeń `@avably/core/custom-fields`, który
 * jest lustrem triggera 0057, a ostatnią bramką jest baza
 * (`app.assert_checkout_custom_fields` + trigger).
 *
 * KLIENT SKLEPU TO NIEZAUFANE WEJŚCIE. Nic w tym module nie zakłada, że
 * wartość przeszła przez nasz formularz: mapa może przyjść z surowego POST-a
 * do `/api/v1/reservations` i wtedy jest dokładnie tak samo traktowana.
 */
import {
  checkoutCustomFields,
  customFieldDefinitionFromRow,
  parseCustomFieldInput,
  splitCustomFieldValuesByEntity,
  validateCustomFieldValues,
  type CustomFieldDefinition,
  type CustomFieldIssue,
  type CustomFieldIssues,
  type CustomFieldValues,
} from "@avably/core";

import type {
  CheckoutFieldError,
  CheckoutFieldErrors,
  PublicCustomField,
} from "./contract";

/** Prefiks kluczy błędów — ten sam co nazwy pól formularza w panelu. */
export const CHECKOUT_CUSTOM_FIELD_PREFIX = "cf_";

export function checkoutCustomFieldKey(definitionId: string): `cf_${string}` {
  return `${CHECKOUT_CUSTOM_FIELD_PREFIX}${definitionId}`;
}

/**
 * Publiczny wiersz → definicja domenowa.
 *
 * Flagi `showInPanel` i `showInContract` ustawiamy na `false`, bo publiczna
 * odpowiedź ich NIE NIESIE i nieść nie powinna. To nie jest zgadywanie stanu
 * najemcy, tylko fail-closed: każde przyszłe użycie flagi panelu w kodzie
 * publicznym ma być błędem widocznym od razu, a nie cichym przepuszczeniem.
 *
 * `position` bierzemy z INDEKSU tablicy: baza oddaje wiersze posortowane
 * (position, created_at, id), więc indeks odtwarza kolejność panelu bez
 * wystawiania znacznika czasu konfiguracji.
 */
export function customFieldsFromPublicRows(
  rows: readonly PublicCustomField[],
): CustomFieldDefinition[] {
  return rows.map((row, index) =>
    customFieldDefinitionFromRow({
      id: row.id,
      entity: row.entity,
      field_type: row.field_type,
      label: row.label,
      help_text: row.help_text,
      required: row.required,
      options: row.options,
      position: index,
      show_in_panel: false,
      show_in_checkout: true,
      show_in_contract: false,
      archived_at: null,
      created_at: null,
    }),
  );
}

export interface CheckoutCustomFieldsResult {
  /** Mapa do kolumny `orders.custom_fields`. */
  order: CustomFieldValues;
  /** Mapa do kolumny `customers.custom_fields` (baza ją SCALA, nie nadpisuje). */
  customer: CustomFieldValues;
  /** Odmowy w kluczach kontraktu checkoutu (`cf_<id>` / `customFields`). */
  fields: CheckoutFieldErrors;
}

/**
 * Cztery typy błędu kontraktu checkoutu muszą pomieścić trzynaście kodów
 * rdzenia. Mapowanie jest ŚWIADOMIE stratne — konsument dostaje tyle, ile
 * potrzebuje do pokazania komunikatu przy polu, a nie diagnostykę reguł
 * walidacji cudzego najemcy.
 *
 * `not_allowed` skleja trzy powody (pole nie istnieje / jest zarchiwizowane /
 * nie jest polem zamawiania) i to jest ta sama nierozróżnialność, którą oddaje
 * baza: rozróżnienie byłoby wyrocznią o konfiguracji sklepu.
 */
function toFieldError(issue: CustomFieldIssue): CheckoutFieldError {
  switch (issue) {
    case "required":
      return "required";
    case "tooLong":
    case "tooLarge":
      return "too_long";
    case "unknownDefinition":
    case "archived":
    case "hidden":
      return "not_allowed";
    default:
      return "invalid";
  }
}

function issuesToFields(issues: CustomFieldIssues): CheckoutFieldErrors {
  const fields: CheckoutFieldErrors = {};
  for (const [key, issue] of Object.entries(issues)) {
    if (key === "*") {
      fields.customFields = toFieldError(issue);
      continue;
    }
    fields[checkoutCustomFieldKey(key)] = toFieldError(issue);
  }
  return fields;
}

/**
 * Odczyt i walidacja płaskiej mapy z wejścia.
 *
 * `definitions` to KOMPLET definicji zamawiania (wszystkie encje); zawężenie
 * do wypełnialnych robi `checkoutCustomFields` — pole PRODUKTU oznaczone
 * „zamawianie" jest w katalogu do czytania, a nie do pisania, więc próba
 * zapisu pod jego identyfikatorem dostaje tę samą odmowę co identyfikator
 * zmyślony.
 */
export function readCheckoutCustomFields(
  definitions: readonly CustomFieldDefinition[],
  input: Record<string, unknown> | undefined,
): CheckoutCustomFieldsResult {
  const fillable = checkoutCustomFields(definitions);
  const byId = new Map(fillable.map((definition) => [definition.id, definition]));
  const values: CustomFieldValues = {};
  const issues: CustomFieldIssues = {};
  const raw = input ?? {};

  for (const definition of fillable) {
    // KLUCZ NIEOBECNY = wartość nie dostarczona. NIC z tego nie syntetyzujemy —
    // w szczególności checkbox bez klucza NIE jest deklaracją `false`. Baza
    // scala mapę KLIENTA (0058, operator `||`), więc `false` spoza żądania
    // zerowałby checkbox stałego klienta ustawiony w panelu przy KAŻDEJ jego
    // rezerwacji, wbrew własnej deklaracji kontraktu „scala, nie nadpisuje".
    if (!Object.hasOwn(raw, definition.id)) continue;
    const value = raw[definition.id];

    // Wartość TYPOWANA (konsument JSON-owy) idzie dalej bez tłumaczenia —
    // sprawdzi ją `validateCustomFieldValues` niżej, tą samą regułą co trigger.
    // Także jawne `false` z maszyny: konsument, który CHCE zapisać `false`,
    // wysyła boolean, a nie pomija klucz.
    if (typeof value === "number" || typeof value === "boolean") {
      values[definition.id] = value;
      continue;
    }

    // JSON `null` = brak wartości, jak brak klucza.
    if (value === null) continue;

    if (typeof value === "string") {
      if (definition.type === "checkbox") {
        // Checkbox ze STRINGA (formularz sklepu, embed, wtyczka) zapisujemy
        // TYLKO przy afirmatywnym zaznaczeniu. Pusty string albo „off" to
        // niezaznaczone pole HTML — nie deklaracja `false` (patrz komentarz
        // o scalaniu wyżej). Embed wysyła KAŻDY klucz jako "", więc bez tej
        // gałęzi zerowałby checkbox klienta tak samo jak API v1.
        if (parseCustomFieldInput(definition, value).value === true) {
          values[definition.id] = true;
        }
        continue;
      }
      const parsed = parseCustomFieldInput(definition, value);
      if (parsed.issue) {
        issues[definition.id] = parsed.issue;
        continue;
      }
      if (parsed.value !== undefined) values[definition.id] = parsed.value;
      continue;
    }

    // Obiekt albo tablica pod kluczem pola — nie jest wartością żadnego z typów.
    issues[definition.id] = "type";
  }

  // Klucze SPOZA zbioru pól zamawiania. Ciche pominięcie byłoby bezpieczne
  // (wartość i tak nie trafiłaby do bazy), ale kłamliwe: konsument dostałby
  // 201 na żądanie, którego części nie wykonaliśmy. Odmowa jest JEDNA dla
  // wszystkich powodów — patrz `toFieldError`.
  for (const key of Object.keys(raw)) {
    if (!byId.has(key)) issues[key] = "unknownDefinition";
  }

  const validated = validateCustomFieldValues(fillable, values, {
    // TWORZENIE: zamawianie zakłada NOWE zamówienie, więc na zamówieniu nie ma
    // czego przepisywać. Wiersz KLIENTA bywa za to stary i niesie wartości pod
    // polami, których sklep nie pokazuje — ale `existing` nie ma tu jak
    // powstać: anon nie czyta `customers` i nie ma prawa czytać (byłaby to
    // wyrocznia o kliencie po samym adresie e-mail). Dlatego scalenie robi
    // BAZA, operatorem `||` w `app.public_checkout` (0058).
    mode: "create",
    surface: "checkout",
  });

  const split = splitCustomFieldValuesByEntity(fillable, validated.values);
  return {
    order: split.order,
    customer: split.customer,
    fields: issuesToFields({ ...issues, ...validated.issues }),
  };
}
