"use server";

/**
 * Server Action checkoutu — jedyne publiczne wejście do składania zamówienia.
 *
 * Ten plik jest CIENKI z rozmysłem (wzorzec przejęty po akcji waitlisty,
 * zdjętej razem z backendem w 0071): dostarcza
 * rdzeniowi (lib/checkout/core.ts) to, czego nie umie zdobyć bez Next.js i bez
 * sieci — tenant_id z nagłówka, IP, wywołanie RPC, weryfikację captchy,
 * rate-limit i wysyłkę e-maili. Cała logika decyzyjna (kolejność bramek,
 * mapowanie SQLSTATE na statusy kontraktu) siedzi w rdzeniu, testowalnym bez
 * `next/headers`.
 *
 * Kontrakt zwracanych statusów: lib/checkout/contract.ts.
 */
import { cookies, headers } from "next/headers";

import { PANEL_URL, emailAvailability, resendTransport } from "@avably/core";
import {
  STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX,
  checkRateLimit,
} from "@avably/security/rate-limit";
import { verifyTurnstile } from "@avably/security/turnstile";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { TENANT_ID_HEADER } from "@/lib/tenant/headers";
import { getPublishedLegalDocuments } from "@/lib/legal/published";
import { checkoutEmailLogRecorder } from "@/lib/checkout/email-log";
import { checkoutEmailLogo } from "@/lib/checkout/tenant-logo";
import { sendCheckoutEmails } from "@/lib/checkout/emails";
import { readCheckoutCustomFieldDefinitions } from "@/lib/checkout/catalog";
import { readOnlinePaymentAvailability } from "@/lib/checkout/online-availability";
import { issueCheckoutTicket } from "@/lib/checkout/ticket";
import {
  CHECKOUT_COOKIE,
  CHECKOUT_COOKIE_MAX_AGE_SECONDS,
  encodeCheckoutHandle,
} from "@/lib/checkout/session-cookie";
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
    // Świeży ODCZYT stanu konta u dostawcy (ADR-049) — nie kolumna z bazy.
    readOnlineAvailability: () => readOnlinePaymentAvailability(tenantId),
    // Definicje pól własnych zamawiania (0058) — ta sama lista, którą strona
    // checkoutu wyrenderowała; czytana PONOWNIE po stronie akcji, bo to, co
    // przyszło z przeglądarki, nie jest dowodem na konfigurację najemcy.
    readCustomFields: () => readCheckoutCustomFieldDefinitions(tenantId),
    // Spis opublikowanych dokumentów prawnych (0063) dla bramki H-COMP-01
    // (ADR-191) — z tego samego powodu PONOWNIE po stronie akcji: stan
    // publikacji z chwili renderu nie jest dowodem na stan z chwili zapisu.
    readLegalDocuments: () => getPublishedLegalDocuments(tenantId),
    // Formularz sklepu renderuje zgodę z rejestru (etykieta+permalink z
    // serwera strony), więc jego deklaracja MUSI być etykietą żywej wersji.
    termsFromRegistry: true,
    // Uchwyt do własnego checkoutu: httpOnly, więc niewidoczny dla skryptów
    // strony; `lax`, bo powrót od dostawcy to nawigacja z obcej witryny.
    // `secure` zależnie od schematu — lokalny dev stoi na http i ciasteczko
    // z flagą `secure` po prostu by nie doszło.
    rememberCheckout: async (handle) => {
      const store = await cookies();
      store.set(CHECKOUT_COOKIE, encodeCheckoutHandle(handle), {
        httpOnly: true,
        sameSite: "lax",
        secure: (h.get("x-forwarded-proto") ?? "http") === "https",
        path: "/",
        maxAge: CHECKOUT_COOKIE_MAX_AGE_SECONDS,
      });
    },
    checkRateLimit: (key, opts) =>
      checkRateLimit(key, { ...opts, prefix: STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX }),
    verifyCaptcha: (token) => verifyTurnstile(token),
    // Bilet zaufanej granicy (0059, ADR-125). Sekret bierze się z env procesu
    // (serwerowy, bez NEXT_PUBLIC_) wewnątrz issueCheckoutTicket — akcja
    // podaje tylko tenanta, którego bilet ma wiązać. Tenant pochodzi
    // z nagłówka middleware'u, nie od klienta: bilet dla cudzego sklepu
    // byłby dokładnie tym, przed czym broni wiązanie tenanta w bazie.
    issueTicket: () => issueCheckoutTicket(tenantId),
    callRpc: async (args: CheckoutRpcArgs): Promise<CheckoutRpcResult> => {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.schema("app").rpc("public_checkout", args);
      if (error) {
        // Przenosimy SQLSTATE, żeby rdzeń zmapował go na status kontraktu
        // (23P01 → unavailable, 22023 → rejected), DETAIL — który w tym
        // torze bywa znacznikiem kategorii odmowy ('legal_documents_missing',
        // 'terms_outdated'; ADR-181) albo liczbą minimum najmu (0089,
        // ADR-202) — oraz HINT, znacznik kategorii odmów klasy PT
        // ('min_rental_days'). Treść zostaje w logu.
        const wrapped = new Error(error.message) as CheckoutRpcError;
        wrapped.code = error.code;
        if (typeof error.details === "string") wrapped.detail = error.details;
        if (typeof error.hint === "string") wrapped.hint = error.hint;
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
        // Znak najemcy, U KTÓREGO złożono zamówienie (ADR-175). Odczyt idzie
        // tym samym identyfikatorem, którym powstało zamówienie, i tą samą
        // drogą co powłoka sklepu — czyli z kolumny OPUBLIKOWANEJ.
        ...(await checkoutEmailLogo(tenantId, ctx.tenant.name)),
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
