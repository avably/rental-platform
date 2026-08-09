/**
 * Reguły po stronie DEFINICJI pola własnego (C6-A1, ADR-118).
 *
 * Lustro `app.custom_field_definitions_guard` z 0057. Operator wpisuje opcje
 * listy wyboru w jedno pole tekstowe (po jednej w wierszu) — rozbicie tego na
 * tablicę i sprawdzenie jej kształtu jest tu, a nie w akcji panelu, żeby
 * checkout i API v1 (część 2) miały tę samą regułę bez kopiowania.
 */

import { CUSTOM_FIELD_LIMITS, type CustomFieldType } from "./types";

export type SelectOptionsIssue =
  | "empty"
  | "tooMany"
  | "tooLong"
  | "duplicate"
  | "controlChars"
  | "notSelect";

export interface SelectOptionsResult {
  options: string[];
  issue?: SelectOptionsIssue;
}

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F]/;

/**
 * Rozbija tekst z pola „opcje" na listę.
 *
 * Puste wiersze wypadają w ciszy (operator zostawia je przy wklejaniu
 * z arkusza), ale duplikat NIE jest scalany po cichu — baza go odrzuci, więc
 * ukrycie go tutaj dałoby ekran, który mówi „zapisano", a nie zapisał.
 * Porównanie duplikatów bez względu na wielkość liter, tak jak w guardzie.
 */
export function parseSelectOptions(raw: string): SelectOptionsResult {
  const options = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (options.length === 0) return { options, issue: "empty" };
  if (options.length > CUSTOM_FIELD_LIMITS.optionsMax) return { options, issue: "tooMany" };
  if (options.some((option) => option.length > CUSTOM_FIELD_LIMITS.optionMax)) {
    return { options, issue: "tooLong" };
  }
  if (options.some((option) => CONTROL_RE.test(option))) {
    return { options, issue: "controlChars" };
  }
  const seen = new Set(options.map((option) => option.toLocaleLowerCase("pl-PL")));
  if (seen.size !== options.length) return { options, issue: "duplicate" };

  return { options };
}

/**
 * Opcje w kształcie, w jakim wchodzą do kolumny `options`.
 *
 * Dla typów innych niż `select` MUSI wyjść pusta tablica — CHECK w 0057
 * odrzuca wszystko inne, a milczące przepuszczenie opcji przy zmianie typu
 * zostawiałoby w bazie listę, której formularz nigdy nie pokaże.
 */
export function optionsForType(type: CustomFieldType, raw: string): SelectOptionsResult {
  if (type !== "select") return { options: [] };
  return parseSelectOptions(raw);
}

/** Tekst do pola „opcje" z zapisanej tablicy — odwrotność `parseSelectOptions`. */
export function selectOptionsToText(options: readonly string[]): string {
  return options.join("\n");
}

/**
 * Kolejna wolna pozycja w obrębie encji. Nowe pole ląduje NA KOŃCU listy,
 * nigdy pośrodku — operator, który dodaje pole, nie przestawia kolejności
 * tych, które już opisał.
 */
export function nextCustomFieldPosition(positions: readonly number[]): number {
  const max = positions.reduce((acc, value) => (value > acc ? value : acc), -1);
  return Math.min(max + 1, CUSTOM_FIELD_LIMITS.positionMax);
}
