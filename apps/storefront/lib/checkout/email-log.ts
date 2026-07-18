/**
 * Rejestrator historii wysyłek dla checkoutu storefrontu (Zadanie 2.8, ADR-045).
 *
 * DLACZEGO RPC, A NIE INSERT: storefront chodzi kluczem ANON i nie ma — z
 * twardej konwencji — klucza service-role. Grant INSERT dla anona na
 * public.email_logs wystawiłby przez PostgREST zapis do rejestru każdemu, kto
 * ma publiczny klucz strony. Zapis idzie więc wąską funkcją SECURITY DEFINER
 * app.log_public_checkout_email (0021) — tym samym wzorcem, którym idzie sam
 * checkout (app.public_checkout, ADR-042): jedna funkcja, jawny zakres, zero
 * dostępu do tabeli.
 *
 * Funkcja przyjmuje NUMER zamówienia, nie identyfikator: numer wołający i tak
 * zna (dostał go z checkoutu), a order_id nie musi opuszczać bazy — dzięki
 * czemu odpowiedź RPC checkoutu nie musi go nieść (ADR-042: odpowiedź czyta
 * każdy bezpośredni wołający kluczem anonimowym).
 *
 * LOG_TOKEN JEST TU ISTOTĄ BEZPIECZEŃSTWA, nie parametrem technicznym
 * (znalezisko recenzji 2.8, ADR-045): tenant_id jest jawny, a order_number
 * SEKWENCYJNY, więc bez tokenu każdy posiadacz publicznego klucza strony
 * dopisywałby zmyślone wpisy do historii cudzych zamówień. Token wydaje
 * app.public_checkout przy zapisie zamówienia i niesie go odpowiedź RPC —
 * dane SERWEROWE, nigdy nie schodzą do przeglądarki (jak notify_email).
 *
 * RZUCA przy błędzie — pochłania go wyłącznie sendAndLog (@avably/core).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailLogEntry, EmailLogRecorder } from "@avably/core";

export function checkoutEmailLogRecorder(
  supabase: SupabaseClient,
  tenantId: string,
  orderNumber: string,
  logToken: string,
): EmailLogRecorder {
  return {
    async record(entry: EmailLogEntry): Promise<void> {
      const { error } = await supabase.schema("app").rpc("log_public_checkout_email", {
        p_tenant_id: tenantId,
        p_order_number: orderNumber,
        p_log_token: logToken,
        p_kind: entry.kind,
        p_recipient: entry.recipient,
        p_subject: entry.subject,
        p_status: entry.status,
        p_provider_message_id: entry.providerMessageId ?? null,
        p_error: entry.error ?? null,
      });
      if (error) throw new Error(error.message);
    },
  };
}
