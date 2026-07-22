import "server-only";

/**
 * Związanie płatności z zamówieniem (Z3, ADR-066) — cienka owijka na RPC
 * `app.attach_payment_intent` z 0029.
 *
 * DLACZEGO PRZEZ RPC, A NIE `UPDATE`: storefront jest anonem i NIE MA klucza
 * service-role (twarda konwencja fazy 3), a anon nie ma grantu UPDATE na
 * `orders`. Wąska funkcja SECURITY DEFINER z bramką na tokenie jest tu jedyną
 * drogą — tą samą, którą idzie dziennik wysyłek z 0021.
 *
 * ODPOWIEDŹ JEST ODCZYTEM, NIE ECHEM: funkcja z 0029 po zapisie czyta wiersz
 * i zwraca to, co w nim NAPRAWDĘ stoi. Dlatego `paymentStatus` z tej funkcji
 * wolno pokazać; gdyby był echem parametrów, nie dowodziłby niczego.
 */
import { createSupabaseServerClient } from "@/lib/supabase-server";

export interface AttachPaymentIntentInput {
  tenantId: string;
  orderId: string;
  token: string;
  intentId: string;
  applicationFeeGrosze: number;
}

interface AttachRow {
  order_id: string;
  payment_status: string;
  provider_payment_intent_id: string | null;
}

export async function attachPaymentIntent(
  input: AttachPaymentIntentInput,
): Promise<{ paymentStatus: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema("app").rpc("attach_payment_intent", {
    p_tenant_id: input.tenantId,
    p_order_id: input.orderId,
    p_checkout_token: input.token,
    p_intent_id: input.intentId,
    p_application_fee_grosze: input.applicationFeeGrosze,
  });

  // RZUCAMY, zamiast zwracać porażkę jako wartość — i to jest różnica wobec
  // wzorca „uczciwej częściowej porażki" z ADR-046. Tam porażka zapisu
  // zostawiała stan do pokazania; tutaj oznaczałaby płatność u dostawcy,
  // z którą zamówienie nie jest niczym związane. Formularz płatności nie ma
  // prawa się wtedy pokazać (patrz preparePayment).
  if (error) {
    throw new Error(`Nie udało się związać płatności z zamówieniem: ${error.message}`);
  }

  const row = data as AttachRow | null;
  if (!row) throw new Error("Wiązanie płatności nie zwróciło stanu zamówienia.");
  return { paymentStatus: row.payment_status };
}
