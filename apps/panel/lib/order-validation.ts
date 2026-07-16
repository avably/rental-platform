/**
 * Schematy Zod dla formularzy zamówień (Zadanie 4) — wzorzec
 * catalog-validation.ts: każda akcja serwerowa waliduje FormData PRZED
 * Supabase, lustra CHECK-ów z 0007/0010 dają czytelny komunikat zamiast
 * surowego PostgREST. Bramką ostateczną pozostaje baza (RLS + triggery 0010).
 *
 * Daty waliduje assertIsoDate z silnika — jedyne źródło arytmetyki i
 * poprawności dat (2026-02-31 ma poprawny kształt, a nie istnieje).
 */
import { assertIsoDate, ORDER_STATUSES, type IsoDate } from "@avably/core";
import { z } from "zod";

import { parseMajorToGrosze } from "./money-input";

export const uuidSchema = z.string().uuid("Nieprawidłowy identyfikator.");

/** Lustro CHECK-a orders.delivery_method (0007). */
export const DELIVERY_METHODS = ["pickup", "courier", "parcel_locker", "own_delivery"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

const ISO_DATE_MESSAGE = "Podaj datę w formacie RRRR-MM-DD.";

const isoDateSchema = z.string().transform((raw, ctx): IsoDate => {
  try {
    return assertIsoDate(raw.trim());
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: ISO_DATE_MESSAGE });
    return z.NEVER;
  }
});

/** Pole opcjonalne tekstowe: puste → null (wzorzec catalog-validation.ts). */
const optionalTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maksymalnie ${max} znaków.`)
    .transform((value) => (value === "" ? null : value));

/**
 * Pozycje przychodzą jako JSON w jednym polu formularza (koszyk żyje w
 * stanie klienta — wzorzec edytora progów, tiersSchema). Pozycja niesie
 * WYŁĄCZNIE productId: egzemplarz przypisuje serwer (ADR-024), a kwoty
 * liczy silnik po autorytatywnym odczycie cennika — klient nie ma jak
 * podstawić własnej ceny.
 */
const itemsSchema = z
  .string()
  .transform((raw, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Nieprawidłowe dane pozycji." });
      return z.NEVER;
    }
    return parsed;
  })
  .pipe(
    z
      .array(z.object({ productId: uuidSchema }))
      .min(1, "Zamówienie wymaga co najmniej jednej pozycji.")
      .max(50, "Zbyt wiele pozycji (maksymalnie 50)."),
  );

export const orderFormSchema = z
  .object({
    customerId: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.union([z.literal(""), z.string().uuid("Nieprawidłowy identyfikator klienta.")])),
    newCustomerEmail: z
      .string()
      .trim()
      .pipe(
        z.union([
          z.literal(""),
          z.string().email("Podaj poprawny adres e-mail.").max(320, "Adres jest za długi."),
        ]),
      ),
    newCustomerName: optionalTextSchema(200),
    newCustomerPhone: optionalTextSchema(32),
    items: itemsSchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    deliveryMethod: z.enum(DELIVERY_METHODS, {
      errorMap: () => ({ message: "Wybierz metodę dostawy." }),
    }),
    pickupLocationId: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.union([z.literal(""), z.string().uuid("Nieprawidłowy identyfikator punktu.")])),
    notes: optionalTextSchema(2000),
  })
  // Klient jest DOKŁADNIE jeden: istniejący (customerId) albo nowy (e-mail).
  .refine((form) => (form.customerId !== "") !== (form.newCustomerEmail !== ""), {
    message: "Wybierz istniejącego klienta ALBO podaj e-mail nowego.",
    path: ["customerId"],
  })
  // Lustro orders_dates_ordered: zakres INCLUSIVE, start = end jest poprawny.
  .refine((form) => form.endDate >= form.startDate, {
    message: "Koniec najmu nie może być wcześniejszy niż początek.",
    path: ["endDate"],
  })
  // Lustro orders_pickup_requires_location.
  .refine((form) => form.deliveryMethod !== "pickup" || form.pickupLocationId !== "", {
    message: "Odbiór osobisty wymaga wskazania punktu odbioru.",
    path: ["pickupLocationId"],
  })
  .transform((form) => ({
    customerId: form.customerId === "" ? null : form.customerId,
    newCustomer:
      form.newCustomerEmail === ""
        ? null
        : { email: form.newCustomerEmail, fullName: form.newCustomerName, phone: form.newCustomerPhone },
    items: form.items,
    startDate: form.startDate,
    endDate: form.endDate,
    deliveryMethod: form.deliveryMethod,
    pickupLocationId: form.pickupLocationId === "" ? null : form.pickupLocationId,
    notes: form.notes,
  }));

export type OrderFormInput = z.infer<typeof orderFormSchema>;

const orderStatusSchema = z.enum(
  ORDER_STATUSES as unknown as [string, ...string[]],
  { errorMap: () => ({ message: "Nieznany status zamówienia." }) },
);

/**
 * Zmiana statusu niesie też stan OCZEKIWANY (optymistyczna współbieżność):
 * UPDATE trafia wyłącznie wiersz, który wciąż jest w expectedFrom — jeśli
 * ktoś zdążył zmienić status, akcja dosięga zero wierszy i mówi to wprost,
 * zamiast wykonać przejście z innego stanu, niż widział operator.
 */
export const statusChangeSchema = z.object({
  orderId: uuidSchema,
  to: orderStatusSchema,
  expectedFrom: orderStatusSchema,
});

export type StatusChangeInput = z.infer<typeof statusChangeSchema>;

/**
 * Filtry listy zamówień z searchParams. Błędna wartość jest IGNOROWANA
 * (`catch(undefined)`), nie błędem — zepsuty link nie ma wywracać listy,
 * a filtry i tak zawężają wyłącznie odczyt w obrębie RLS tenanta.
 */
export const ordersFilterSchema = z.object({
  status: orderStatusSchema.optional().catch(undefined),
  od: isoDateSchema.optional().catch(undefined),
  do: isoDateSchema.optional().catch(undefined),
  klient: z.string().uuid().optional().catch(undefined),
});

export type OrdersFilter = z.infer<typeof ordersFilterSchema>;

/**
 * Rozliczenia kaucji (Zadanie 5). Lustro CHECK-a
 * deposit_events_structured_reason z 0011 — bramką jest baza (trigger
 * deposit_events_gate + CHECK, ADR-026), schematy dają czytelny komunikat
 * zanim żądanie do niej dotrze.
 */
export const DEDUCTION_REASON_CODES = [
  "damage",
  "late_return",
  "missing_part",
  "cleaning",
  "other",
] as const;
export type DeductionReasonCode = (typeof DEDUCTION_REASON_CODES)[number];

/** Kwota z pola formularza → grosze; zero i śmieci odrzucone, nie zgadywane. */
const depositAmountSchema = z.string().transform((raw, ctx) => {
  const grosze = parseMajorToGrosze(raw);
  if (grosze === null || grosze <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Podaj dodatnią kwotę (np. 100 lub 100,50)." });
    return z.NEVER;
  }
  return grosze;
});

export const depositCollectSchema = z
  .object({ orderId: uuidSchema, amount: depositAmountSchema })
  .transform((form) => ({ orderId: form.orderId, amountGrosze: form.amount }));

export const depositRefundSchema = depositCollectSchema;

export const depositDeductSchema = z
  .object({
    orderId: uuidSchema,
    amount: depositAmountSchema,
    reasonCode: z.enum(DEDUCTION_REASON_CODES, {
      errorMap: () => ({ message: "Wybierz powód potrącenia." }),
    }),
    reason: optionalTextSchema(500),
  })
  // Lustro zależności warunkowej z 0011: kod 'other' bez doprecyzowania
  // jest pusty informacyjnie — dokładnie anty-wzorzec notatki tekstowej.
  .refine((form) => form.reasonCode !== "other" || form.reason !== null, {
    message: "Powód „inny” wymaga doprecyzowania.",
    path: ["reason"],
  })
  .transform((form) => ({
    orderId: form.orderId,
    amountGrosze: form.amount,
    reasonCode: form.reasonCode,
    reason: form.reason,
  }));

export type DepositDeductInput = z.infer<typeof depositDeductSchema>;
