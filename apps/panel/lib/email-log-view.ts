/**
 * Wspólny kontrakt odczytu historii wysyłek dla warstwy widoku (ADR-045):
 * lista kolumn, kształt wiersza, walidacja filtrów listy i formatowanie daty.
 *
 * Wydzielone z ekranów, bo używają tego DWA miejsca (sekcja zamówienia i
 * ekran globalny), a rozjazd listy kolumn między nimi kończyłby się brakiem
 * pola dopiero w runtime.
 */
import { EMAIL_LOG_STATUSES } from "@avably/core";
import { z } from "zod";

/** Kolumny czytane przez oba ekrany. Treści wiadomości tabela nie trzyma. */
export const EMAIL_LOG_ROW_COLUMNS =
  "id, created_at, kind, recipient, subject, status, error, order_id";

export interface EmailLogRow {
  id: string;
  created_at: string;
  kind: string;
  recipient: string;
  subject: string;
  status: string;
  error: string | null;
  order_id: string | null;
}

/** Ile wpisów na stronę ekranu globalnego. */
export const EMAIL_LOG_PAGE_SIZE = 25;

/**
 * Filtry listy globalnej. Błędna wartość jest IGNOROWANA (catch → undefined),
 * nie błędem strony — wzorzec ordersFilterSchema: podrzucony link z bzdurnym
 * parametrem ma pokazać listę, a nie 500.
 */
export const emailLogFilterSchema = z.object({
  status: z.enum(EMAIL_LOG_STATUSES).optional().catch(undefined),
  strona: z.coerce.number().int().min(1).optional().catch(undefined),
});

export type EmailLogFilter = z.infer<typeof emailLogFilterSchema>;

/**
 * Data i godzina w locale operatora. Godzina jest tu konieczna, a nie
 * ozdobna: kilka wiadomości tego samego dnia rozróżnia wyłącznie czas.
 */
export function formatLogTimestamp(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(new Date(iso));
}
