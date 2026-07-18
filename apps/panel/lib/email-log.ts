/**
 * Rejestrator historii wysyłek dla panelu (Zadanie 2.8, ADR-045).
 *
 * Pisze SESJĄ CZŁONKA, nie kluczem service-role: polityka tenant_insert z
 * 0021 przepuszcza wyłącznie własnego tenanta, więc izolację pilnuje ta sama
 * bramka co przy każdym innym zapisie panelu. Klucz service-role obchodziłby
 * RLS, czyli zamieniłby najszczelniejszy element systemu w zaufanie do
 * poprawności argumentu `tenantId` — bez żadnego zysku.
 *
 * RZUCA przy błędzie zapisu i to jest celowe: jedynym miejscem, które ten
 * błąd pochłania, jest sendAndLog (@avably/core) — połykanie go tutaj
 * zabrałoby operatorowi informację, że dziennik jest niesprawny.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailLogEntry, EmailLogRecorder } from "@avably/core";

export function panelEmailLogRecorder(
  supabase: SupabaseClient,
  tenantId: string,
): EmailLogRecorder {
  return {
    async record(entry: EmailLogEntry): Promise<void> {
      const { error } = await supabase.from("email_logs").insert({
        tenant_id: tenantId,
        order_id: entry.orderId ?? null,
        kind: entry.kind,
        recipient: entry.recipient,
        subject: entry.subject,
        status: entry.status,
        provider_message_id: entry.providerMessageId ?? null,
        error: entry.error ?? null,
      });
      if (error) throw new Error(error.message);
    },
  };
}
