/**
 * Wspólny rdzeń eksportów CSV (C2, ADR-111): limit wierszy, stronicowany
 * odczyt i nazwa pliku. Moduł bez Next — rdzenie eksportów są testowane na
 * żywej bazie bez route handlerów.
 *
 * LIMIT ZAMIAST STRUMIENIA (decyzja ADR-111): eksport budowany w pamięci
 * z twardym limitem EXPORT_ROW_LIMIT wierszy. Przekroczenie NIE obcina po
 * cichu — rzuca ExportLimitError, a route handler zamienia go na jawny
 * komunikat z prośbą o zawężenie zakresu dat. Strumieniowanie wróci, gdy
 * realny wolumen najemcy przekroczy limit (dziś listy panelu tną na 100).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Role } from "@avably/db";

export const EXPORT_ROW_LIMIT = 10_000;

/** Rozmiar strony odczytu — poniżej domyślnego max_rows PostgREST (1000). */
export const EXPORT_PAGE_SIZE = 1_000;

/** Zbiór eksportu przekracza limit — sygnał dla warstwy HTTP, nie obcinek. */
export class ExportLimitError extends Error {
  constructor() {
    super(`Eksport przekracza limit ${EXPORT_ROW_LIMIT} wierszy.`);
    this.name = "ExportLimitError";
  }
}

/**
 * Minimalny kontekst eksportu — podzbiór AuthContext. Rdzeń dostaje rolę,
 * bo bramka „klienci tylko owner" żyje TUTAJ (warstwa serwera), nie w UI.
 */
export interface ExportContext {
  supabase: SupabaseClient;
  tenantId: string;
  role: Role | null;
}

export interface ExportFile {
  filename: string;
  csv: string;
}

/**
 * Czyta CAŁY zbiór stronami po EXPORT_PAGE_SIZE. Rzuca ExportLimitError,
 * gdy tylko liczba zebranych wierszy przekroczy limit — bez dociągania
 * reszty. `fetchPage` dostaje zakres INCLUSIVE jak `.range()` PostgREST-a.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  rowLimit: number = EXPORT_ROW_LIMIT,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
    const page = await fetchPage(from, from + EXPORT_PAGE_SIZE - 1);
    rows.push(...page);
    if (rows.length > rowLimit) throw new ExportLimitError();
    if (page.length < EXPORT_PAGE_SIZE) return rows;
  }
}

/** `avably-<typ>-<data>.csv` — data bieżąca w strefie operatora (Warszawa). */
export function exportFilename(
  kind: "orders" | "customers" | "catalog",
  now: Date = new Date(),
): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `avably-${kind}-${date}.csv`;
}
