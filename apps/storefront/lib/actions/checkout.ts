"use server";

/**
 * Server Action checkoutu — jedyne publiczne wejście do składania zamówienia.
 *
 * Ten plik jest CIENKI z rozmysłem (wzorzec lib/actions/waitlist.ts): dostarcza
 * rdzeniowi (lib/checkout/core.ts) to, czego nie umie zdobyć bez Next.js i bez
 * sieci — tenant_id z nagłówka, IP, wywołanie RPC, weryfikację captchy,
 * rate-limit i wysyłkę e-maili. Cała logika decyzyjna (kolejność bramek,
 * mapowanie SQLSTATE na statusy kontraktu) siedzi w rdzeniu, testowalnym bez
 * `next/headers`.
 *
 * Kontrakt zwracanych statusów: lib/checkout/contract.ts.
 */
import { headers } from "next/headers";

import { PANEL_URL, emailAvailability, resendTransport } from "@avably/core";
import {
  STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX,
  checkRateLimit,
} from "@avably/security/rate-limit";
import { verifyTurnstile } from "@avably/security/turnstile";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { TENANT_ID_HEADER } from "@/lib/tenant/headers";
import { checkoutEmailLogRecorder } from "@/lib/checkout/email-log";
import { sendCheckoutEmails } from "@/lib/checkout/emails";
import {
  submitCheckoutCore,
  type CheckoutRpcArgs,
  type CheckoutRpcError,
  type CheckoutRpcResult,
} from "@/lib/checkout/core";
import type { CheckoutInput, CheckoutResult } from "@/lib/checkout/contract";

export async function submitCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const h = await headers();

  // tenant_id WYŁĄCZNIE z nagłówka ustawionego server-side przez middleware
  // (anty-spoofing, ADR-039) — nigdy z klienta. Brak = żądanie spoza gałęzi
  // tenanckiej; nie ma sklepu, do którego składać zamówienie.
  const tenantId = h.get(TENANT_ID_HEADER);
  if (!tenantId) return { status: "server_error" };

  const ip = h.get("x-forwarded-for") ?? "unknown";

  return submitCheckoutCore(input, {
    tenantId,
    ip,
    checkRateLimit: (key, opts) =>
      checkRateLimit(key, { ...opts, prefix: STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX }),
    verifyCaptcha: (token) => verifyTurnstile(token),
    callRpc: async (args: CheckoutRpcArgs): Promise<CheckoutRpcResult> => {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.schema("app").rpc("public_checkout", args);
      if (error) {
        // Przenosimy SQLSTATE, żeby rdzeń zmapował go na status kontraktu
        // (23P01 → unavailable, 22023 → rejected). Treść zostaje w logu.
        const wrapped = new Error(error.message) as CheckoutRpcError;
        wrapped.code = error.code;
        throw wrapped;
      }
      return data as CheckoutRpcResult;
    },
    // Transport i dostępność z env (Vercel) — semantyka fail-closed: @avably/core.
    // Panel URL dla linku w powiadomieniu najemcy.
    // Rejestrator historii wysyłek (ADR-045) powstaje DOPIERO tutaj: dopiero
    // teraz znamy numer zamówienia, a bez niego funkcja z 0021 nie ma czego
    // rozwiązać na order_id. Klient anonowy, zapis przez RPC SECURITY DEFINER
    // — storefront nie ma service-role, a anon nie ma grantu na tabelę.
    sendEmails: async (ctx) =>
      sendCheckoutEmails(ctx, {
        transport: resendTransport(),
        availability: emailAvailability(),
        panelBaseUrl: PANEL_URL,
        recorder: checkoutEmailLogRecorder(
          await createSupabaseServerClient(),
          tenantId,
          ctx.order_number,
          // Token z odpowiedzi RPC — dowód, że to MY przeprowadziliśmy ten
          // checkout. Nie opuszcza serwera: `ctx` jest server-only, a kontrakt
          // CheckoutResult go nie niesie (ADR-045).
          ctx.log_token,
        ),
      }),
  });
}
