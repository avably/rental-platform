/**
 * Bramka pliku importu katalogu (C3, ADR-112) — typ i rozmiar PRZED
 * dotknięciem bajtów (wzorzec checkInvoiceFile, D3/ADR-076).
 *
 * CSV nie ma nagłówka magicznego, więc treści nie wąchamy — autorytatywną
 * bramką treści jest parser (zła zawartość = błędy wierszy z nazwami
 * kolumn), a ten moduł odsiewa tylko oczywiste pomyłki wyboru pliku.
 */
export const IMPORT_MAX_MB = 5;

export type CatalogCsvFileProblem = "noFile" | "badType" | "tooLarge";

/** Typy MIME, pod którymi systemy operacyjne zgłaszają CSV. */
const ACCEPTED_TYPES = new Set([
  "",
  "text/csv",
  "application/csv",
  "text/plain",
  "application/vnd.ms-excel",
]);

export function checkCatalogCsvFile(file: File | null): CatalogCsvFileProblem | null {
  if (!file || file.size === 0) return "noFile";
  if (!file.name.toLowerCase().endsWith(".csv") || !ACCEPTED_TYPES.has(file.type)) {
    return "badType";
  }
  if (file.size > IMPORT_MAX_MB * 1024 * 1024) return "tooLarge";
  return null;
}
