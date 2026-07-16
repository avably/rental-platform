/**
 * Walidacja serwerowa wejścia waitlisty (wzorzec: apps/panel/lib/validation.ts).
 *
 * Waliduje KAŻDE pole, także te, które LP i tak ogranicza selectem — wejście
 * Server Action pochodzi od klienta i nic nie gwarantuje, że przeszło przez
 * nasz formularz. Ta walidacja jest niezależna od CHECK-ów tabeli i jawnej
 * walidacji w app.join_waitlist: te dwie są bramkami integralności, ta jest
 * bramką komunikatów (mapa pole→błąd dla LP).
 */
import { z } from "zod";

import { LOCALES } from "@avably/core";

import {
  CURRENT_PROCESSES,
  INVENTORY_RANGES,
  RENTAL_TYPES,
  type WaitlistFieldError,
  type WaitlistFieldErrors,
  type WaitlistField,
} from "./contract";

/** Znacznik własnego typu błędu przenoszony przez `params` issue'a Zoda. */
interface WaitlistIssueParams {
  waitlist?: WaitlistFieldError;
}

function issue(ctx: z.RefinementCtx, path: WaitlistField, error: WaitlistFieldError): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [path],
    params: { waitlist: error } satisfies WaitlistIssueParams,
    message: error,
  });
}

// E-mail NIE jest tu sprowadzany do lower-case. Normalizację i deduplikację
// robi baza (app.join_waitlist + unikalny indeks po lower(email)) — gdyby
// robił to schemat, deduplikacja zależałaby od warstwy, którą da się ominąć,
// a unikalny indeks przestałby być testowany jako realna bramka.
const emailSchema = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .email();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    // Puste pole z formularza przychodzi jako "" — semantycznie to brak
    // wartości, nie wartość pusta. Bez tego "" trafiłoby do bazy i
    // naruszyło CHECK zamiast dać czytelny błąd.
    .transform((value) => (value === undefined || value === "" ? undefined : value));

export const waitlistSchema = z
  .object({
    email: emailSchema,
    rentalType: z.enum(RENTAL_TYPES),
    inventoryRange: z.enum(INVENTORY_RANGES),
    currentProcess: z.enum(CURRENT_PROCESSES),
    // Zgoda jest warunkiem zapisu — literal(true) czyni brak zgody
    // niereprezentowalnym w danych wyjściowych schematu.
    consent: z.literal(true),
    otherEquipment: optionalText(500),
    pilotInterest: z.boolean().optional().default(false),
    phone: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value === undefined || value === "" ? undefined : value))
      .pipe(z.string().min(6).max(32).optional()),
    locale: z.enum(LOCALES).optional().default("pl"),
    source: optionalText(200),
    campaign: optionalText(200),
    captchaToken: z.string().max(4096).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.rentalType === "other" && value.otherEquipment === undefined) {
      issue(ctx, "otherEquipment", "required");
    }
    if (value.rentalType !== "other" && value.otherEquipment !== undefined) {
      issue(ctx, "otherEquipment", "not_allowed");
    }
    if (value.phone !== undefined && !value.pilotInterest) {
      issue(ctx, "phone", "not_allowed");
    }
  });

export type WaitlistParsed = z.infer<typeof waitlistSchema>;

const FIELDS = new Set<string>([
  "email",
  "rentalType",
  "otherEquipment",
  "inventoryRange",
  "currentProcess",
  "pilotInterest",
  "phone",
  "consent",
  "locale",
]);

function toFieldError(zodIssue: z.ZodIssue): WaitlistFieldError {
  const custom = (zodIssue as { params?: WaitlistIssueParams }).params?.waitlist;
  if (custom) return custom;

  switch (zodIssue.code) {
    case "too_big":
      return "too_long";
    // Brak zgody (literal(true) dostał false) czytamy jako „required" —
    // dla użytkownika to nie jest „zła wartość", tylko niezaznaczone pole.
    case "invalid_literal":
      return "required";
    case "invalid_type":
      return zodIssue.received === "undefined" ? "required" : "invalid";
    case "too_small":
      return "required";
    default:
      return "invalid";
  }
}

/**
 * Spłaszcza błędy Zoda do mapy pole→typ błędu. Pierwszy błąd na pole wygrywa
 * (LP pokazuje jeden komunikat pod polem). Issue'y spoza znanych pól są
 * pomijane — nie ma ich gdzie pokazać, a `captchaToken`/`source`/`campaign`
 * nie są polami formularza.
 */
export function toFieldErrors(error: z.ZodError): WaitlistFieldErrors {
  const fields: WaitlistFieldErrors = {};
  for (const zodIssue of error.issues) {
    const path = zodIssue.path[0];
    if (typeof path !== "string" || !FIELDS.has(path)) continue;
    const field = path as WaitlistField;
    if (fields[field] !== undefined) continue;
    fields[field] = toFieldError(zodIssue);
  }
  return fields;
}
