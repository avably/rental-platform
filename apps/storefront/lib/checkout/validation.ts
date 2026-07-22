/**
 * Walidacja serwerowa wejścia checkoutu (wzorzec lib/waitlist/validation.ts).
 *
 * Waliduje KAŻDE pole — wejście Server Action pochodzi od klienta i nic nie
 * gwarantuje, że przeszło przez nasz formularz. Ta walidacja jest niezależna od
 * jawnej walidacji w app.public_checkout i CHECK-ów tabel: te są bramkami
 * integralności, ta jest bramką KOMUNIKATÓW (mapa pole→błąd dla LP). Kwot nie
 * waliduje, bo wejście ich nie niesie (liczy je serwer).
 */
import { z } from "zod";

import { LOCALES } from "@avably/core";

import {
  CHECKOUT_DELIVERY_METHODS,
  type CheckoutField,
  type CheckoutFieldError,
  type CheckoutFieldErrors,
} from "./contract";

interface CheckoutIssueParams {
  checkout?: CheckoutFieldError;
}

function issue(ctx: z.RefinementCtx, path: CheckoutField, error: CheckoutFieldError): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [path],
    params: { checkout: error } satisfies CheckoutIssueParams,
    message: error,
  });
}

// E-mail bez sprowadzania do lower-case — normalizuje i deduplikuje baza
// (app.public_checkout + unikalny indeks customers po lower(email)).
const emailSchema = z.string().trim().min(1).max(320).email();

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "invalid");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    // Puste pole z formularza przychodzi jako "" — semantycznie brak wartości.
    .transform((value) => (value === undefined || value === "" ? undefined : value));

export const checkoutSchema = z
  .object({
    email: emailSchema,
    fullName: z.string().trim().min(1).max(200),
    startDate: isoDate,
    endDate: isoDate,
    deliveryMethod: z.enum(CHECKOUT_DELIVERY_METHODS),
    pickupLocationId: z.string().uuid().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().min(1).max(100),
        }),
      )
      .min(1),
    // Akceptacja regulaminu jest warunkiem — literal(true) czyni brak zgody
    // niereprezentowalnym w danych wyjściowych schematu.
    termsAccepted: z.literal(true),
    termsVersion: z.string().trim().min(1).max(100),
    phone: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === undefined || v === "" ? undefined : v))
      .pipe(z.string().min(4).max(32).optional()),
    companyName: optionalText(200),
    nip: optionalText(32),
    addressStreet: optionalText(200),
    addressZip: optionalText(20),
    addressCity: optionalText(120),
    locale: z.enum(LOCALES).optional(),
    notes: optionalText(2000),
    captchaToken: z.string().max(4096).optional(),
    honeypot: z.string().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    // Zakres dat INCLUSIVE — odwrócony jest błędem endDate (LP podświetla koniec).
    if (value.endDate < value.startDate) {
      issue(ctx, "endDate", "invalid");
    }
    // Odbiór osobisty wymaga punktu; przy dostawie punkt nie ma prawa wystąpić.
    if (value.deliveryMethod === "pickup" && value.pickupLocationId === undefined) {
      issue(ctx, "pickupLocationId", "required");
    }
    if (value.deliveryMethod !== "pickup" && value.pickupLocationId !== undefined) {
      issue(ctx, "pickupLocationId", "not_allowed");
    }
  });

export type CheckoutParsed = z.infer<typeof checkoutSchema>;

const FIELDS = new Set<string>([
  "email",
  "fullName",
  "startDate",
  "endDate",
  "deliveryMethod",
  "pickupLocationId",
  "items",
  "terms",
  "phone",
  "companyName",
  "nip",
  "addressStreet",
  "addressZip",
  "addressCity",
  "locale",
]);

function toFieldError(zodIssue: z.ZodIssue): CheckoutFieldError {
  const custom = (zodIssue as { params?: CheckoutIssueParams }).params?.checkout;
  if (custom) return custom;

  switch (zodIssue.code) {
    case "too_big":
      return "too_long";
    // Zod 4 używa invalid_value zarówno dla literal(true), jak i enumów.
    // Tylko brak akceptacji regulaminu ma dla użytkownika znaczenie „required”.
    case "invalid_value":
      return zodIssue.path[0] === "termsAccepted" ? "required" : "invalid";
    case "invalid_type":
      return zodIssue.input === undefined ? "required" : "invalid";
    case "too_small":
      return "required";
    default:
      return "invalid";
  }
}

/**
 * Spłaszcza błędy Zoda do mapy pole→typ. Pierwszy błąd na pole wygrywa. Pole
 * `termsAccepted` mapujemy na klucz kontraktu `terms`; issue'y spoza znanych pól
 * (captchaToken/honeypot/notes/items[n].*) są pomijane — nie ma ich gdzie
 * pokazać. Błąd wewnątrz `items` raportujemy jako pojedyncze pole `items`.
 */
export function toCheckoutFieldErrors(error: z.ZodError): CheckoutFieldErrors {
  const fields: CheckoutFieldErrors = {};
  for (const zodIssue of error.issues) {
    let path = zodIssue.path[0];
    if (path === "termsAccepted") path = "terms";
    if (path === "items") {
      if (fields.items === undefined) fields.items = toFieldError(zodIssue);
      continue;
    }
    if (typeof path !== "string" || !FIELDS.has(path)) continue;
    const field = path as CheckoutField;
    if (fields[field] !== undefined) continue;
    fields[field] = toFieldError(zodIssue);
  }
  return fields;
}
