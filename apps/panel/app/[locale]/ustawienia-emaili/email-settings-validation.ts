/**
 * Walidacja nadawcy e-maili — lustro CHECK-a tenant_settings_email_sender_valid
 * (migracja 0014, ADR-033). Schemat PRODUKUJE jsonb w kształcie bazy
 * (snake_case): { name, reply_to? }, gotowy do upsert-u. Walidacja U ŹRÓDŁA,
 * autorytatywna w bazie (CHECK, kod 23514).
 *
 * reply_to sprawdzamy DŁUGOŚCIĄ (3..320), nie formatem — dokładnie jak CHECK
 * 0014 i parser emailSenderFromSettings; czy skrzynka istnieje, weryfikuje
 * dostawca przy wysyłce. Pusty reply_to = pole nieobecne w jsonb (opcjonalne).
 */
import { z } from "zod";

export const emailSenderSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Podaj nazwę nadawcy.")
      .max(120, "Nazwa nadawcy jest za długa (maks. 120 znaków)."),
    replyTo: z
      .string()
      .trim()
      .max(320, "Adres odpowiedzi jest za długi (maks. 320 znaków).")
      .optional()
      .transform((value) => (value ? value : undefined))
      .refine(
        (value) => value === undefined || value.length >= 3,
        "Adres odpowiedzi jest za krótki (min. 3 znaki).",
      ),
  })
  .transform((sender) => ({
    name: sender.name,
    ...(sender.replyTo !== undefined ? { reply_to: sender.replyTo } : {}),
  }));
