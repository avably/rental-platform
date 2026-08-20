/**
 * Webhook płatności — spięcie trasy Next.js z rdzeniem (Z4, ADR-067).
 *
 * Cała logika (weryfikacja podpisu, idempotencja, odczyt u dostawcy, zapis
 * i potwierdzenie odczytem) mieszka w `lib/stripe-webhook.ts` — tutaj zostaje
 * wyłącznie to, czego `route.ts` nie może oddać: eksport handlera HTTP
 * i zbudowanie zależności ze świata (wzorzec `runProxy` i webhooka
 * `supabase-email`).
 *
 * TRASA JEST PUBLICZNA I TAK MA BYĆ: woła ją dostawca płatności, nie
 * zalogowany operator, więc żaden guard sesji tu nie pasuje. Chroni ją
 * PODPIS, fail-closed: bez poprawnego podpisu nie ma ani zapisu stanu, ani
 * nawet wiersza w rejestrze zdarzeń.
 *
 * `force-dynamic`: żądanie niesie podpis liczony z SUROWEGO ciała — nie ma
 * tu czego prerenderować ani cache'ować.
 *
 * ============ TU I TYLKO TU ŻYJE KLIENT SERVICE-ROLE ============
 *
 * Ta trasa jest jednym z dwóch miejsc w repo budujących klienta service-role
 * (drugie to webhook e-maili kont, ADR-054). Powody są dwa i oba są twarde:
 *
 *   1. `public.webhook_events` jest tabelą PLATFORMOWĄ z RLS i ZEREM polityk
 *      dla `authenticated`/`anon` (0030) — żadna rola tenanta nie ma jak
 *      zapisać wiersza idempotencji, i to jest zamierzone: rejestr zdarzeń
 *      płatniczych nie jest widokiem najemcy,
 *   2. przejście `payment_status` w `paid` (i w `payment_failed`) w obiegu
 *      `stripe` jest w bazie dopuszczone WYŁĄCZNIE roli `service_role`
 *      (0030, ADR-067). Członek tenanta dostaje 23514 — bo inaczej mógłby
 *      zwykłym UPDATE-em przez PostgREST ogłosić opłacenie zamówienia,
 *      za które nikt nie zapłacił.
 *
 * Import `@avably/db/service` poza `app/api/webhooks/**` jest błędem lintu
 * (`no-restricted-imports` w eslint.config.mjs panelu), a osobna bramka CI
 * (`scripts/audit-service-role.sh`) pilnuje, że nikt nie sięgnie po
 * `SUPABASE_SERVICE_ROLE_KEY` z pominięciem tej ścieżki.
 *
 * KLIENT BUDOWANY LENIWIE, ALE BRAK KONFIGURACJI NIE JEST TU PRZEPUSZCZANY.
 * W webhooku e-maili brak service-role gasił tylko dziennik, a mail leciał
 * (ADR-054 D4). Tutaj bez service-role nie ma CZEGO zrobić: ani przejąć
 * zdarzenia, ani zapisać statusu. Dlatego brak konfiguracji kończy się 500
 * — dostawca ponowi, a my zobaczymy powód w logach zamiast cicho gubić
 * płatności.
 */
import {
  readDepositRefund,
  readPaymentIntent,
  requireStripeWebhookSecret,
  syncConnectAccountSafely,
} from "@avably/core";
import { createServiceClient } from "@avably/db/service";

import { handleStripeWebhook } from "@/lib/stripe-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = requireStripeWebhookSecret();
  } catch (error) {
    console.error(
      `[stripe-webhook] endpoint niedostępny — ${
        error instanceof Error ? error.message : "brak konfiguracji podpisu"
      }`,
    );
    return new Response(JSON.stringify({ error: "Webhook płatności nie jest skonfigurowany." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let db;
  try {
    db = createServiceClient();
  } catch (error) {
    console.error(
      `[stripe-webhook] brak klienta service-role — ${
        error instanceof Error ? error.message : "brak konfiguracji"
      }`,
    );
    return new Response(JSON.stringify({ error: "Rejestr zdarzeń nie jest skonfigurowany." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return handleStripeWebhook(request, {
    db,
    // Odczyt idzie na KONCIE NAJEMCY — identyfikator konta podaje rdzeń
    // po odnalezieniu zamówienia, bo to nasza baza wie, czyja to płatność.
    readIntent: (intentId, connectedAccountId) =>
      readPaymentIntent(intentId, { connectedAccountId }),
    // Zwrot kaucji (Z5) — ten sam wzorzec: zdarzenie niesie `re_...`,
    // a o tym, czy pieniądze wróciły do klienta, mówi dopiero odczyt.
    readRefund: (refundId, connectedAccountId) =>
      readDepositRefund(refundId, { connectedAccountId }),
    // Cykl życia konta (ADR-213) — PULL prawdy o gotowości z GET /v1/accounts.
    // Odczyt konta idzie na kluczu PLATFORMY (bez nagłówka Stripe-Account):
    // to platforma retrieve'uje konta połączone. syncConnectAccountSafely
    // NIGDY nie rzuca i redaguje sekret w porcie.
    syncAccount: (providerAccountId) => syncConnectAccountSafely(providerAccountId),
    secret,
  });
}
