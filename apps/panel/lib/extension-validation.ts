/**
 * Schemat akcji przedłużenia najmu (Zadanie 6) — wzorzec
 * order-validation.ts: walidacja FormData PRZED Supabase, czytelny
 * komunikat zamiast surowego PostgREST. Bramką pozostaje baza (0010).
 *
 * expectedEndDate to optymistyczna współbieżność (wzorzec expectedFrom
 * ze zmiany statusu): UPDATE trafi wyłącznie wiersz, którego end_date
 * wciąż jest tym, co widział operator.
 */
import { z } from "zod";

import { isoDateSchema, uuidSchema } from "./order-validation";

export const orderExtensionSchema = z
  .object({
    orderId: uuidSchema,
    newEndDate: isoDateSchema,
    expectedEndDate: isoDateSchema,
  })
  // Lustro guardu silnika (quoteExtension): przedłużenie = data PO obecnym końcu.
  .refine((form) => form.newEndDate > form.expectedEndDate, {
    message: "Nowa data końca musi być późniejsza niż obecna.",
    path: ["newEndDate"],
  });

export type OrderExtensionInput = z.infer<typeof orderExtensionSchema>;
