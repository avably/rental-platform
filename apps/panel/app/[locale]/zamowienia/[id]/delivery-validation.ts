/**
 * Walidacja formularzy przesyłek kurierskich (Zod PRZED Supabase — konwencja
 * repo). Wymiary jako liczby z pól type="number" (kropka dziesiętna);
 * granice 999 cm / 999 kg odcinają pomyłki jednostek (mm/g), nie realne
 * paczki. Numer domu KLIENTA wpisuje operator przy nadaniu: customers nie
 * rozbija adresu na numer, a fabrykowanie wartości do API kurierskiego to
 * klasa fallbacków, którą to zadanie usuwa (ADR-031).
 */
import { z } from "zod";

import { uuidSchema } from "@/lib/order-validation";

const dimensionSchema = z.coerce
  .number({ message: "Podaj liczbę." })
  .positive("Wartość musi być większa od zera.")
  .max(999, "Wartość poza zakresem.");

export const SHIPMENT_TYPES = ["outbound", "return"] as const;

export const shipmentCreateSchema = z.object({
  orderId: uuidSchema,
  shipmentType: z.enum(SHIPMENT_TYPES, { message: "Nieprawidłowy typ przesyłki." }),
  houseNumber: z
    .string()
    .trim()
    .min(1, "Podaj numer domu adresu klienta.")
    .max(20, "Numer domu jest za długi."),
  apartmentNumber: z
    .string()
    .trim()
    .max(20, "Numer lokalu jest za długi.")
    .optional()
    .transform((value) => (value ? value : undefined)),
  lengthCm: dimensionSchema,
  widthCm: dimensionSchema,
  heightCm: dimensionSchema,
  weightKg: dimensionSchema,
  content: z
    .string()
    .trim()
    .min(1, "Podaj zawartość przesyłki.")
    .max(200, "Opis zawartości jest za długi."),
});

export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>;

export const shipmentRefreshSchema = z.object({
  shipmentId: uuidSchema,
});
