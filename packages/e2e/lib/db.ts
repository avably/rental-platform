import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requiredEnv } from "./env";

/** Klient service_role — wyłącznie do odczytów pomocniczych testu
 * (np. numer zamówienia po identyfikatorze z metadanych intentu).
 * Asercje o zachowaniu produktu idą przez UI/HTTP, nie tędy. */
export function adminClient(): SupabaseClient {
  return createClient(
    requiredEnv("SUPABASE_LOCAL_API_URL"),
    requiredEnv("SUPABASE_LOCAL_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function orderById(
  orderId: string,
): Promise<{ orderNumber: string; paymentStatus: string }> {
  const { data, error } = await adminClient()
    .from("orders")
    .select("order_number, payment_status")
    .eq("id", orderId)
    .single();
  if (error || !data) {
    throw new Error(`Nie znalazłem zamówienia ${orderId}: ${error?.message}`);
  }
  return {
    orderNumber: (data as { order_number: string }).order_number,
    paymentStatus: (data as { payment_status: string }).payment_status,
  };
}
