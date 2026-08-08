/**
 * Porty PRODUKCYJNE tras /api/v1 (M1, ADR-108) — jedyne miejsce, gdzie
 * warstwa API dotyka Supabase, licznika i poczty. Wzorzec 1:1 z
 * lib/actions/checkout.ts: rdzenie (lib/api/handlers.ts) znają wyłącznie
 * porty, więc testują się bez sieci.
 */
import { PANEL_URL, emailAvailability, resendTransport } from "@avably/core";
import {
  STOREFRONT_API_RATE_LIMIT_PREFIX,
  checkRateLimit,
} from "@avably/security/rate-limit";
import { clientIpFromHeaders } from "@avably/security/client-ip";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getPublicAvailability, getPublicCatalog } from "@/lib/checkout/catalog";
import { checkoutEmailLogRecorder } from "@/lib/checkout/email-log";
import { sendCheckoutEmails } from "@/lib/checkout/emails";
import { readOnlinePaymentAvailability } from "@/lib/checkout/online-availability";
import type { CheckoutRpcArgs, CheckoutRpcError, CheckoutRpcResult } from "@/lib/checkout/core";

import type { VerifiedApiKey } from "./auth";
import type { ApiV1Deps, AvailabilityDeps, CatalogDeps, ReservationDeps } from "./handlers";

/**
 * Weryfikacja hasha klucza przez app.verify_api_key (0053) kluczem anon —
 * funkcja jest SECURITY DEFINER i sama pilnuje, że odpowiada wyłącznie na
 * hash, który wołający już zna (patrz nagłówek migracji 0053).
 */
async function verifyKeyHashRpc(keyHash: string): Promise<VerifiedApiKey | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .schema("app")
    .rpc("verify_api_key", { p_key_hash: keyHash });
  if (error || !Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as { tenant_id?: unknown; key_id?: unknown; tenant_status?: unknown };
  if (
    typeof row.tenant_id !== "string" ||
    typeof row.key_id !== "string" ||
    typeof row.tenant_status !== "string"
  ) {
    return null;
  }
  return { tenantId: row.tenant_id, keyId: row.key_id, tenantStatus: row.tenant_status };
}

function baseDeps(request: Request): ApiV1Deps {
  return {
    verifyKeyHash: verifyKeyHashRpc,
    // IP z modelu zaufania ADR-106 (x-real-ip → ostatni hop XFF → "unknown"),
    // nie goły nagłówek od klienta.
    ip: clientIpFromHeaders(request.headers),
    checkRateLimit: (key, opts) =>
      checkRateLimit(key, { ...opts, prefix: STOREFRONT_API_RATE_LIMIT_PREFIX }),
  };
}

export function catalogDeps(request: Request): CatalogDeps {
  return {
    ...baseDeps(request),
    getCatalog: (tenantId) => getPublicCatalog(tenantId),
  };
}

export function availabilityDeps(request: Request): AvailabilityDeps {
  return {
    ...baseDeps(request),
    getAvailability: (tenantId, productId, startDate, endDate) =>
      getPublicAvailability(tenantId, productId, startDate, endDate),
  };
}

export function reservationDeps(request: Request): ReservationDeps {
  return {
    ...baseDeps(request),
    callRpc: async (args: CheckoutRpcArgs): Promise<CheckoutRpcResult> => {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.schema("app").rpc("public_checkout", args);
      if (error) {
        // SQLSTATE przechodzi do rdzenia (23P01 → conflict, 22023 → rejected)
        // — mapowanie siedzi w rdzeniu, jak przy Server Action.
        const wrapped = new Error(error.message) as CheckoutRpcError;
        wrapped.code = error.code;
        throw wrapped;
      }
      return data as CheckoutRpcResult;
    },
    // Ta sama poczta co checkout storefrontu (ADR-042/045): kontekst wysyłki
    // jest server-only i nie przechodzi do odpowiedzi v1.
    sendEmails: async (tenantId, ctx) =>
      sendCheckoutEmails(ctx, {
        transport: resendTransport(),
        availability: emailAvailability(),
        panelBaseUrl: PANEL_URL,
        recorder: checkoutEmailLogRecorder(
          await createSupabaseServerClient(),
          tenantId,
          ctx.order_number,
          ctx.log_token,
        ),
      }),
    readOnlineAvailability: (tenantId) => readOnlinePaymentAvailability(tenantId),
  };
}
