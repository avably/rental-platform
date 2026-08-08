/**
 * Budowa CSV dla eksportów panelu (C2, ADR-111) — moduł CZYSTY, bez Next
 * i bez Supabase, żeby format dało się przypiąć testami jednostkowymi.
 *
 * Kontrakt formatu (przypięty w test/csv-format.test.ts):
 *   * separator `;` — Excel z polskim locale rozumie średnik bez kreatora
 *     importu (przecinek dzieliłby kolumny w polach z opisami, a lokalny
 *     Excel i tak by go nie rozpoznał jako separatora),
 *   * UTF-8 z BOM — bez BOM Excel na Windows czyta plik w cp1250 i miele
 *     polskie znaki; BOM to trzy bajty EF BB BF na początku strumienia,
 *   * CRLF między wierszami (RFC 4180) i na końcu ostatniego wiersza,
 *   * cytowanie pól zawierających separator, cudzysłów lub znak nowej linii
 *     (cudzysłów podwajany wg RFC 4180),
 *   * NEUTRALIZACJA FORMUŁ: pole tekstowe zaczynające się od `=`, `+`, `-`,
 *     `@`, TAB lub CR dostaje prefiks `'`. CSV injection to realny wektor:
 *     nazwisko `=HYPERLINK(...)` wpisane w publicznym checkoucie wykonałoby
 *     się w Excelu operatora przy otwarciu eksportu. Prefiksujemy WSZYSTKIE
 *     wartości tekstowe z bazy (także legalne `+48...` w telefonie — koszt
 *     apostrofu jest niższy niż utrzymywanie listy „bezpiecznych" pól).
 *
 * Liczby i booleany są emitowane bez neutralizacji (generujemy je sami,
 * grosze to int ≥ 0) — kropka dziesiętna, bez separatora tysięcy: to format
 * DANYCH pod re-import (C3), nie prezentacja.
 */

export const CSV_SEPARATOR = ";";

/** BOM UTF-8 — w strumieniu bajtów: EF BB BF. */
export const CSV_BOM = "\ufeff";

const CSV_EOL = "\r\n";

/** Znaki otwierające formułę w arkuszach (OWASP: CSV injection). */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

export type CsvValue = string | number | boolean | null | undefined;

/** Pole zaczynające się znakiem formuły dostaje apostrof — Excel pokaże tekst. */
export function neutralizeFormula(value: string): string {
  return value.length > 0 && FORMULA_TRIGGERS.has(value[0]) ? `'${value}` : value;
}

function encodeField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const neutralized = neutralizeFormula(value);
  if (
    neutralized.includes(CSV_SEPARATOR) ||
    neutralized.includes('"') ||
    neutralized.includes("\n") ||
    neutralized.includes("\r")
  ) {
    return `"${neutralized.replaceAll('"', '""')}"`;
  }
  return neutralized;
}

export function buildCsv(
  header: readonly string[],
  rows: ReadonlyArray<readonly CsvValue[]>,
): string {
  const lines = [header.map((name) => encodeField(name)).join(CSV_SEPARATOR)];
  for (const row of rows) {
    lines.push(row.map((value) => encodeField(value)).join(CSV_SEPARATOR));
  }
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}
