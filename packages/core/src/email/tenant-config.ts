/**
 * Parser nadawcy e-maili tenanta z wierszy tenant_settings.
 *
 * FUNKCJA CZYSTA (bez I/O): zapytanie o wiersze żyje w warstwie wywołującej
 * (panel, przez RLS) — dokładnie jak parser kurierski (courier/tenant-config.ts)
 * i silnik wynajmu.
 *
 * ZERO CICHYCH FALLBACKÓW (wzorzec ADR-030/031): brak konfiguracji nie
 * podstawia nazwy platformy. Klient dostałby wtedy wiadomość podpisaną obcą
 * marką, a operator nie dowiedziałby się, że czegoś nie ustawił. Brak jest
 * tu zawsze GŁOŚNY: EmailConfigError niesie pełną listę braków, żeby operator
 * uzupełnił wszystko za jednym razem, a nie po serii prób.
 *
 * Kształt jsonb w bazie jest snake_case (spójnie z kolumnami), typy silnika
 * camelCase — mapowanie tylko tutaj. Walidacja jest lustrem CHECK-a z 0014:
 * baza jest bramką autorytatywną, parser daje czytelny komunikat, zanim
 * wiadomość w ogóle pójdzie do dostawcy.
 */
import type { TenantSettingRow } from "../courier";
import type { EmailSender } from "./types";

export const EMAIL_SENDER_KEY = "email_sender";

export class EmailConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Konfiguracja nadawcy e-maili jest niekompletna: ${problems.join("; ")}`);
    this.name = "EmailConfigError";
  }
}

export function emailSenderFromSettings(rows: TenantSettingRow[]): EmailSender {
  const row = rows.find((r) => r.key === EMAIL_SENDER_KEY);
  const value = row?.value as Record<string, unknown> | undefined;
  const problems: string[] = [];

  const name = typeof value?.name === "string" ? value.name.trim() : "";
  if (!name) problems.push("brak nazwy nadawcy (Ustawienia → E-maile)");

  // Rozróżniamy BRAK reply_to (legalny — pole opcjonalne) od reply_to
  // ZŁEGO TYPU (błąd konfiguracji). Lustro bramki `not (value ? 'reply_to')`
  // z CHECK-a 0014.
  const replyToRaw = value?.reply_to;
  if (replyToRaw !== undefined && typeof replyToRaw !== "string") {
    problems.push("adres odpowiedzi ma nieprawidłowy format");
  }

  if (problems.length > 0) throw new EmailConfigError(problems);

  const replyTo =
    typeof replyToRaw === "string" && replyToRaw.trim() ? replyToRaw.trim() : undefined;
  return replyTo ? { name, replyTo } : { name };
}
