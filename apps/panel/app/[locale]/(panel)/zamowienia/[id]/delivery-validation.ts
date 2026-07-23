/**
 * Walidacja formularzy przesyłek kurierskich (Zod PRZED Supabase — konwencja
 * repo). Wymiary jako liczby z pól type="number" (kropka dziesiętna);
 * granice 999 cm / 999 kg odcinają pomyłki jednostek (mm/g), nie realne
 * paczki.
 *
 * Nadawca i odbiorca są PREFILLOWANE (nadawca z konfiguracji kuriera tenanta,
 * odbiorca z kartoteki klienta), ale EDYTOWALNE w modalu jako override na tę
 * jedną przesyłkę — dlatego walidujemy je tutaj, jako pełne strony przesyłki.
 * To NIE jest fabrykowanie wartości (anty-wzorzec ADR-031): operator poprawia
 * realne dane pod konkretną wysyłkę, a wymagane pola i tak muszą być
 * niepuste — pusty override nie przejdzie bramki.
 */
import { z } from "zod";

import { uuidSchema } from "@/lib/order-validation";

const dimensionSchema = z.coerce
  .number({ message: "Podaj liczbę." })
  .positive("Wartość musi być większa od zera.")
  .max(999, "Wartość poza zakresem.");

/** Kod pocztowy — luźno (bramką formatu jest API dostawcy), byle niepusty. */
const postCodeField = z
  .string()
  .trim()
  .min(1, "Podaj kod pocztowy.")
  .max(12, "Kod pocztowy jest za długi.");

const requiredText = (message: string, max = 120) =>
  z.string().trim().min(1, message).max(max, "Wartość jest za długa.");

const apartmentField = z
  .string()
  .trim()
  .max(20, "Numer lokalu jest za długi.")
  .optional()
  .transform((value) => (value ? value : undefined));

const emailField = z
  .string()
  .trim()
  .min(1, "Podaj e-mail.")
  .max(200, "E-mail jest za długi.")
  .email("Nieprawidłowy e-mail.");

/**
 * Pola jednej strony przesyłki (nadawca albo odbiorca) — wypisane JAWNIE per
 * strona (bez generowania kluczy z prefiksu), żeby `z.infer` dawał precyzyjne
 * typy `senderName`/`recipientName`... w akcji, a nie luźny indeks `string`.
 */
const senderFields = {
  senderName: requiredText("Podaj nazwę nadawcy."),
  senderStreet: requiredText("Podaj ulicę nadawcy."),
  senderHouseNumber: requiredText("Podaj numer domu nadawcy.", 20),
  senderApartmentNumber: apartmentField,
  senderPostCode: postCodeField,
  senderCity: requiredText("Podaj miasto nadawcy.", 80),
  senderPhone: requiredText("Podaj telefon nadawcy.", 30),
  senderEmail: emailField,
} as const;

const recipientFields = {
  recipientName: requiredText("Podaj imię i nazwisko odbiorcy."),
  recipientStreet: requiredText("Podaj ulicę odbiorcy."),
  recipientHouseNumber: requiredText("Podaj numer domu odbiorcy.", 20),
  recipientApartmentNumber: apartmentField,
  recipientPostCode: postCodeField,
  recipientCity: requiredText("Podaj miasto odbiorcy.", 80),
  recipientPhone: requiredText("Podaj telefon odbiorcy.", 30),
  recipientEmail: emailField,
} as const;

export const SHIPMENT_TYPES = ["outbound", "return"] as const;

const parcelFields = {
  lengthCm: dimensionSchema,
  widthCm: dimensionSchema,
  heightCm: dimensionSchema,
  weightKg: dimensionSchema,
} as const;

export const shipmentCreateSchema = z
  .object({
    orderId: uuidSchema,
    shipmentType: z.enum(SHIPMENT_TYPES, { message: "Nieprawidłowy typ przesyłki." }),
    ...parcelFields,
    content: z
      .string()
      .trim()
      .min(1, "Podaj zawartość przesyłki.")
      .max(200, "Opis zawartości jest za długi."),
    // Wybrany przewoźnik z wyszukiwarki ofert (id produktu GlobKurier). Brak =
    // bestPrice sam dobiera najtańszy (zachowanie sprzed wyszukiwarki).
    productId: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.number().int().positive().optional(),
    ),
    // Ubezpieczenie przesyłki: checkbox ("on"/brak) + zadeklarowana wartość PLN.
    insurance: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
    insuranceValuePln: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce
        .number()
        .positive("Podaj wartość ubezpieczenia większą od zera.")
        .max(1_000_000, "Wartość ubezpieczenia poza zakresem.")
        .optional(),
    ),
    ...senderFields,
    ...recipientFields,
  })
  .superRefine((data, ctx) => {
    if (data.insurance && data.insuranceValuePln === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["insuranceValuePln"],
        message: "Podaj wartość ubezpieczenia.",
      });
    }
  });

export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>;

/**
 * Wyszukiwarka przewoźników: minimalny zestaw dla searchProducts — dwa kody
 * pocztowe (nadania i doręczenia, kierunek rozstrzyga modal) + gabaryty.
 * NIE tworzy zlecenia i nie niesie kosztu (GET /products), więc nie potrzebuje
 * kompletu danych stron.
 */
export const carrierSearchSchema = z.object({
  orderId: uuidSchema,
  senderPostCode: postCodeField,
  receiverPostCode: postCodeField,
  ...parcelFields,
});

export const shipmentRefreshSchema = z.object({
  shipmentId: uuidSchema,
});

/** Odśwież status wszystkich przesyłek zamówienia (przycisk zbiorczy). */
export const shipmentRefreshAllSchema = z.object({
  orderId: uuidSchema,
});

/** Wyślij klientowi etykietę zwrotną e-mailem (istniejąca przesyłka zwrotna). */
export const returnLabelEmailSchema = z.object({
  orderId: uuidSchema,
  shipmentId: uuidSchema,
});

/** Wyślij klientowi przypomnienie o zwrocie (zamówienie z odbiorem osobistym). */
export const pickupReturnReminderSchema = z.object({
  orderId: uuidSchema,
});
