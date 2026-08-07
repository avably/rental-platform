import { randomUUID } from "node:crypto";

import type { APIRequestContext, APIResponse } from "@playwright/test";
import { signStripeWebhook } from "@avably/core";

import { E2E_STRIPE_WEBHOOK_SECRET, PANEL_URL } from "./env";

/**
 * Nagłówki podpisanego żądania webhooka — dokładnie kontrakt produkcyjny:
 * HMAC-SHA256 (hex) z sekretem współdzielonym z procesem panelu, treść
 * `${t}.${surowe_ciało}`, nagłówek `stripe-signature: t=...,v1=...`.
 * Podpisujemy PRODUKCYJNĄ funkcją `signStripeWebhook` z @avably/core —
 * ten sam algorytm, którym weryfikuje endpoint.
 */
export function signedWebhookHeaders(
  payload: string,
  options: { secret?: string; timestampSeconds?: number } = {},
): Record<string, string> {
  const timestamp = String(options.timestampSeconds ?? Math.floor(Date.now() / 1000));
  const signature = signStripeWebhook({
    secret: options.secret ?? E2E_STRIPE_WEBHOOK_SECRET,
    timestamp,
    payload,
  });
  return {
    "content-type": "application/json",
    "stripe-signature": `t=${timestamp},v1=${signature}`,
  };
}

/**
 * Ciało zdarzenia `payment_intent.*`. Endpoint bierze z ciała WYŁĄCZNIE
 * `id`, `type` i `data.object.id` — stan (`status` w ciele) jest celowo
 * obecny i celowo KŁAMLIWY w scenariuszu anty-spoofingowym: prawda ma
 * pochodzić z odczytu u dostawcy, nigdy z payloadu.
 */
export function intentEventBody(
  intentId: string,
  type: string = "payment_intent.succeeded",
): string {
  return JSON.stringify({
    id: `evt_e2e_${randomUUID()}`,
    type,
    data: { object: { id: intentId, status: "succeeded", amount_received: 99_999_99 } },
  });
}

/** POST na produkcyjny endpoint webhooka panelu. */
export async function postWebhook(
  request: APIRequestContext,
  payload: string,
  headers: Record<string, string>,
): Promise<APIResponse> {
  return request.post(`${PANEL_URL}/api/webhooks/stripe`, { data: payload, headers });
}
