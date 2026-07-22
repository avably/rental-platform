/**
 * Rdzeń kroku płatności online (Z3, ADR-066) — bez `next/headers`, bez
 * Supabase i bez sieci, więc testowalny wprost (wzorzec lib/checkout/core.ts).
 *
 * TU STOI BRAMKA PIENIĘDZY. Płatność powstaje wyłącznie wtedy, gdy serwer
 * ODCZYTAŁ u dostawcy, że konto najemcy przyjmuje płatności — i jest to
 * odczyt wykonany TERAZ, nie kolumna `payment_accounts.charges_enabled`
 * (kopia prezentacyjna sprzed nieznanego czasu, 0028/ADR-049). Różnica jest
 * mierzalna w pieniądzach: konto zablokowane przez dostawcę po ostatniej
 * synchronizacji wyglądałoby w naszej bazie na gotowe, klient przeszedłby
 * płatność, a środki nie miałyby gdzie wpłynąć.
 *
 * IDEMPOTENCJA ZAMIAST STANU: funkcja nie pyta „czy intent już istnieje", bo
 * nie musi. Klucz idempotencji = `orders.id`, więc ponowne wejście na krok
 * płatności (odświeżenie, powrót przyciskiem wstecz, druga karta) odtwarza
 * TĘ SAMĄ płatność u dostawcy zamiast zakładać drugą. Sprawdzanie stanu
 * przed wywołaniem dałoby wyścig dwóch zakładek; klucz idempotencji nie daje.
 */
import type { CreateIntentParams, IntentHandle } from "@avably/core";

import { onlinePaymentUnavailableReason, type OnlineUnavailableReason } from "./payment-options";

/** Zamówienie w kształcie, w jakim zwraca je app.get_public_order_payment. */
export interface PayableOrder {
  orderId: string;
  orderNumber: string;
  /** Suma policzona przez SERWER, w groszach. Kwota z klienta tu nie istnieje. */
  amountGrosze: number;
  currency: string;
  paymentStatus: string;
  paymentProvider: string;
  providerPaymentIntentId: string | null;
}

export interface OnlinePaymentDeps {
  /** Identyfikator konta najemcy u dostawcy (app.get_public_payment_account). */
  readAccountId: () => Promise<string | null>;
  /** ODCZYT stanu konta u dostawcy — jedyne dopuszczalne źródło gotowości. */
  readAccountState: (accountId: string) => Promise<{ chargesEnabled: boolean }>;
  createIntent: (params: CreateIntentParams) => Promise<IntentHandle>;
  /** Zapis wiązania w bazie (app.attach_payment_intent) — zwraca stan Z ODCZYTU. */
  attachIntent: (input: {
    orderId: string;
    intentId: string;
    applicationFeeGrosze: number;
  }) => Promise<{ paymentStatus: string }>;
  /** Klucz publiczny dostawcy — z SERWERA, nie ze stałej build-time (ADR-066). */
  publishableKey: string;
}

export type OnlinePaymentPreparation =
  | {
      status: "ready";
      clientSecret: string;
      /** Konto najemcy — przeglądarka potwierdza płatność w JEGO kontekście. */
      accountId: string;
      publishableKey: string;
      /** Stan zamówienia PO zapisie, odczytany z bazy (nigdy „zamierzony”). */
      paymentStatus: string;
    }
  | { status: "unavailable"; reason: OnlineUnavailableReason }
  | { status: "error" };

/**
 * Prowizja platformy w fazie 3. Stała, żeby wartość miała JEDNO miejsce —
 * faza 4 zmienia tu liczbę (albo źródło liczby), a nie kształt wywołań.
 */
export const APPLICATION_FEE_GROSZE = 0;

/**
 * Przygotowuje płatność za zamówienie: bramka → utworzenie intentu →
 * związanie go z zamówieniem w bazie.
 *
 * CZEGO NIE ROBI: nie ustawia `paid` i nie ma jak — `attachIntent` prosi
 * bazę wyłącznie o `pending`, a w reżimie `stripe` (0027) przejście
 * `unpaid → paid` nie istnieje. Nie czyta też statusu z odpowiedzi dostawcy
 * na `POST`: `IntentHandle.status` jest tu ignorowany przy zapisie, bo
 * odpowiedź na zapis nie jest dowodem stanu (ADR-049).
 */
export async function preparePayment(
  order: PayableOrder,
  deps: OnlinePaymentDeps,
): Promise<OnlinePaymentPreparation> {
  if (order.paymentProvider !== "stripe") return { status: "error" };

  const accountId = await deps.readAccountId();
  if (!accountId) return { status: "unavailable", reason: "account_not_ready" };

  // ODCZYT STANU KONTA — bramka, nie ozdoba. Awaria odczytu też zamyka tor
  // online: „nie wiem, czy konto przyjmuje płatności" znaczy tu „nie
  // pobieram pieniędzy", a klient dostaje tor offline zamiast obciążenia,
  // którego nikt nie umie potwierdzić.
  let chargesEnabled: boolean;
  try {
    chargesEnabled = (await deps.readAccountState(accountId)).chargesEnabled;
  } catch {
    return { status: "unavailable", reason: "account_not_ready" };
  }

  const unavailable = onlinePaymentUnavailableReason({
    stripeConfigured: Boolean(deps.publishableKey),
    chargesEnabled,
  });
  if (unavailable) return { status: "unavailable", reason: unavailable };

  let handle: IntentHandle;
  try {
    handle = await deps.createIntent({
      // Kwota PROSTO z zamówienia w bazie — policzona przez serwer przy
      // składaniu, bez żadnego przeliczania po drodze.
      amountGrosze: order.amountGrosze,
      currency: order.currency,
      connectedAccountId: accountId,
      applicationFeeGrosze: APPLICATION_FEE_GROSZE,
      orderId: order.orderId,
      // Klucz = identyfikator zamówienia. Jedno zamówienie, jedna płatność.
      idempotencyKey: order.orderId,
    });
  } catch {
    return { status: "error" };
  }

  let paymentStatus: string;
  try {
    const attached = await deps.attachIntent({
      orderId: order.orderId,
      intentId: handle.intentId,
      applicationFeeGrosze: APPLICATION_FEE_GROSZE,
    });
    paymentStatus = attached.paymentStatus;
  } catch {
    // Płatność u dostawcy istnieje, a my nie umiemy jej zapisać. Nie wolno
    // pokazać formularza: klient zapłaciłby za zamówienie, którego z tą
    // płatnością nic nie łączy — a webhook z Z4 nie miałby czego domknąć.
    return { status: "error" };
  }

  return {
    status: "ready",
    clientSecret: handle.clientSecret,
    accountId,
    publishableKey: deps.publishableKey,
    paymentStatus,
  };
}
