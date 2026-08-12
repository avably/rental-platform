/**
 * Stan akcji ekranu importu katalogu (C3, ADR-112).
 *
 * Osobny moduł (nie w actions.ts): plik "use server" może eksportować
 * WYŁĄCZNIE funkcje asynchroniczne — stała stanu początkowego musi żyć obok.
 */
import type { CatalogImportIssue } from "./catalog-csv";

export interface CatalogImportPreviewInfo {
  created: number;
  updated: number;
  tiers: number;
  /** Przypisania kategorii po imporcie (ADR-155); 0 dla pliku bez kolumny. */
  categories: number;
  rowCount: number;
  fileName: string;
}

export interface CatalogImportActionState {
  /** idle → preview (podsumowanie/błędy) → done (po zapisie). */
  phase: "idle" | "preview" | "done";
  formError?: string;
  /** Błędy wierszy z podglądu — tłumaczone po stronie ekranu (kody). */
  issues?: CatalogImportIssue[];
  /** Podsumowanie do zatwierdzenia — obecne tylko przy braku błędów. */
  preview?: CatalogImportPreviewInfo;
  /** Wynik udanego zapisu. */
  result?: { created: number; updated: number; tiers: number; categories: number };
}

export const CATALOG_IMPORT_INITIAL_STATE: CatalogImportActionState = { phase: "idle" };
