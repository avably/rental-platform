/**
 * Księgowanie kaucji w obiegu dostawcy (Z5, ADR-068) — JEDYNE miejsce
 * w repo, które wstawia do `deposit_events` wiersz z `provider = 'stripe'`.
 *
 * ================== DLACZEGO TO JEST OSOBNY MODUŁ ==================
 *
 * Te same dwa zapisy wykonują DWIE ścieżki o różnych tożsamościach:
 *
 *   - handler webhooka (`lib/stripe-webhook.ts`), klientem SERVICE-ROLE,
 *     gdy potwierdzenie przyszło od dostawcy,
 *   - akcja panelu (`zamowienia/[id]/deposit-actions.ts`), klientem
 *     z SESJĄ OPERATORA, gdy potwierdzenie przyniósł nasz własny
 *     `GET /v1/refunds/{id}` tuż po zleceniu zwrotu.
 *
 * Obie są legalne, obie mogą dotyczyć tego samego refundu i dostawca nie
 * gwarantuje, która będzie pierwsza. Gdyby każda miała własną kopię tej
 * logiki, różnica między nimi byłaby różnicą w KSIĘGOWANIU PIENIĘDZY —
 * a taką różnicę zauważa się po fakcie, na wyciągu klienta. Klient bazy
 * jest tu więc parametrem, a reguła jedna.
 *
 * ================== TRZY REGUŁY, KTÓRYCH TEN MODUŁ PILNUJE ==================
 *
 * 1. WIERSZ POWSTAJE Z POTWIERDZONEGO ODCZYTU. Ten moduł nie rozmawia
 *    z dostawcą i nie umie tego zrobić — przyjmuje KWOTĘ i ODNOŚNIK, które
 *    wołający wyprowadził z odczytu. Wywołanie go z odpowiedzi na `POST`
 *    wymagałoby zdobycia gdzieś statusu, a `createDepositRefund` statusu
 *    nie zwraca (bariera w kształcie typu, `@avably/core` → stripe/refund.ts).
 *
 * 2. KOLEJNOŚĆ: REJESTR, POTEM `payment_status`. Bramka `deposit_refunded`
 *    (0030, reguła B) czyta saldo z `deposit_events` PUNKTOWO, w transakcji
 *    swojego UPDATE-a. Odwrócenie kolejności daje 23514 — odmowę, która
 *    wygląda jak błąd bramki, a jest błędem kolejności. Dlatego
 *    `settleDepositIfComplete` jest osobną funkcją wołaną PO potwierdzeniu
 *    zapisu, a nie fragmentem tej samej instrukcji.
 *
 * 3. SUKCES ZAPISU TEŻ JEST DEKLARACJĄ (reguła 4 z Z4). PostgREST na INSERT
 *    z `.select()` odfiltrowanym przez RLS oddaje pustą tablicę bez błędu,
 *    a na UPDATE — 204 także wtedy, gdy nie trafił w żaden wiersz. Dlatego
 *    o wyniku decyduje ODCZYT PO ZAPISIE, nie odpowiedź na zapis.
 */
import type { PaymentStatus } from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  depositTotals,
  isDepositSettled,
  type DepositEventRow,
} from "@/app/[locale]/(panel)/zamowienia/[id]/deposit";

/** Nazwa obiegu w rejestrze — lustro CHECK-a `deposit_events_provider_valid` (0031). */
export const DEPOSIT_PROVIDER_STRIPE = "stripe";

/** 23505 — unikat odnośnika dostawcy (0031): zdarzenie już zaksięgowane. */
const PG_UNIQUE_VIOLATION = "23505";
/** 23514 — bramka salda z 0011 albo bramka spójności rozliczenia z 0030. */
const PG_CHECK_VIOLATION = "23514";

/**
 * `retryable` rozstrzyga, czy wołający ma oddać dostawcy 5xx.
 *
 * Odmowa bramki 0011 („zwrot przekracza pobranie") jest DETERMINISTYCZNA:
 * dziesiąta dostawa tego samego zdarzenia skończy się identycznie, więc
 * proszenie o ponowienie zamienia jeden błąd w pętlę. Awaria bazy albo
 * odczytu jest przejściowa i tam ponowienie jest jedynym wyjściem.
 */
export type DepositBookingResult =
  | { ok: true; alreadyBooked: boolean }
  | { ok: false; reason: string; retryable: boolean };

export interface BookDepositEventInput {
  tenantId: string;
  orderId: string;
  kind: "collected" | "refunded";
  /** Kwota Z ODCZYTU u dostawcy, w groszach. Nigdy z formularza. */
  amountGrosze: number;
  /** `pi_...` przy pobraniu, `re_...` przy zwrocie — dowód tego wiersza. */
  providerReference: string;
  /** Autor zapisu; NULL dla ścieżki webhooka (zapisu nie zrobił człowiek). */
  createdBy?: string | null;
}

/**
 * Księguje zdarzenie kaucji w obiegu dostawcy — idempotentnie.
 *
 * IDEMPOTENCJA JEST OGRANICZENIEM BAZY, NIE WARUNKIEM W KODZIE (reguła 3
 * z Z4): sprawdzenie „czy już jest" przed wstawieniem przeszłoby oba
 * SELECT-y, gdyby webhook i akcja panelu potwierdziły ten sam refund
 * równolegle. Rozstrzyga unikat `(provider, provider_reference)` z 0031,
 * a 23505 czytamy jako „ktoś inny zdążył" — czyli SUKCES, nie awarię.
 */
export async function bookDepositEvent(
  db: SupabaseClient,
  input: BookDepositEventInput,
): Promise<DepositBookingResult> {
  const insert = await db.from("deposit_events").insert({
    tenant_id: input.tenantId,
    order_id: input.orderId,
    kind: input.kind,
    amount_grosze: input.amountGrosze,
    provider: DEPOSIT_PROVIDER_STRIPE,
    provider_reference: input.providerReference,
    created_by: input.createdBy ?? null,
  });

  let alreadyBooked = false;
  if (insert.error) {
    if (insert.error.code === PG_UNIQUE_VIOLATION) {
      alreadyBooked = true;
    } else if (insert.error.code === PG_CHECK_VIOLATION) {
      // Bramka 0011: zwrot + potrącenia przekroczyłyby pobranie. To NIE jest
      // stan do obejścia ani do ponowienia — rejestr mówi, że nie ma czego
      // zwracać, i ma pierwszeństwo przed tym, co przyjął dostawca.
      return {
        ok: false,
        retryable: false,
        reason: `Rejestr kaucji odrzucił zapis (${input.kind}, ${input.amountGrosze} gr): ${insert.error.message}`,
      };
    } else {
      return {
        ok: false,
        retryable: true,
        reason: `Zapis do rejestru kaucji nie powiódł się: ${insert.error.message}`,
      };
    }
  }

  // ODCZYT PO ZAPISIE. Odpowiedź na INSERT świadomie nie decyduje: brak
  // błędu znaczy „żądanie przyjęto", a polityka RLS potrafi odfiltrować
  // wiersz tak, że `.select()` po mutacji oddaje pustkę bez ani jednego
  // błędu (pułapka opisana w nagłówku rls-isolation.test.ts).
  const after = await db
    .from("deposit_events")
    .select("id, kind, amount_grosze")
    .eq("tenant_id", input.tenantId)
    .eq("order_id", input.orderId)
    .eq("provider", DEPOSIT_PROVIDER_STRIPE)
    .eq("provider_reference", input.providerReference)
    .maybeSingle();

  if (after.error) {
    return {
      ok: false,
      retryable: true,
      reason: `Nie udało się potwierdzić zapisu odczytem: ${after.error.message}`,
    };
  }
  if (!after.data) {
    return {
      ok: false,
      retryable: true,
      reason: `Zapis do rejestru kaucji nie zostawił wiersza dla odnośnika ${input.providerReference}.`,
    };
  }

  return { ok: true, alreadyBooked };
}

export type DepositSettlementResult =
  | { ok: true; settled: boolean; paymentStatus: PaymentStatus }
  | { ok: false; reason: string };

/**
 * Domyka rozliczenie kaucji: jeśli saldo wróciło do zera przy pobraniach
 * większych od zera (ADR-027), zamówienie przechodzi w `deposit_refunded`.
 *
 * WOŁANA WYŁĄCZNIE PO POTWIERDZONYM ZAPISIE DO REJESTRU. Warunek liczony
 * na ŚWIEŻYM odczycie rejestru, nie na danych z formularza ani na kwocie,
 * którą przed chwilą księgowaliśmy: między jednym a drugim mogło dojść
 * potrącenie z drugiej sesji.
 *
 * Brak przejścia NIE jest porażką — zwrot częściowy zostawia saldo dodatnie
 * i to jest normalny stan rozliczenia w toku.
 */
export async function settleDepositIfComplete(
  db: SupabaseClient,
  tenantId: string,
  orderId: string,
): Promise<DepositSettlementResult> {
  const events = await db
    .from("deposit_events")
    .select("kind, amount_grosze")
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId);

  if (events.error) {
    return { ok: false, reason: `Odczyt rejestru kaucji nie powiódł się: ${events.error.message}` };
  }

  const totals = depositTotals(
    (events.data ?? []) as Pick<DepositEventRow, "kind" | "amount_grosze">[],
  );

  const order = await db
    .from("orders")
    .select("payment_status")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();

  if (order.error || !order.data) {
    return {
      ok: false,
      reason: `Odczyt zamówienia nie powiódł się: ${order.error?.message ?? "brak wiersza"}`,
    };
  }
  const current = (order.data as { payment_status: PaymentStatus }).payment_status;

  if (!isDepositSettled(totals) || current === "deposit_refunded") {
    return { ok: true, settled: current === "deposit_refunded", paymentStatus: current };
  }

  const update = await db
    .from("orders")
    .update({ payment_status: "deposit_refunded" })
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .eq("payment_status", current);

  // Znowu ODCZYT PO ZAPISIE — i znowu błąd z UPDATE-a wchodzi wyłącznie do
  // UZASADNIENIA, bo niesie czytelny powód odmowy bramki (23514).
  const after = await db
    .from("orders")
    .select("payment_status")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();

  if (after.error || !after.data) {
    return {
      ok: false,
      reason: `Nie udało się potwierdzić rozliczenia odczytem: ${after.error?.message ?? "brak wiersza"}`,
    };
  }

  const confirmed = (after.data as { payment_status: PaymentStatus }).payment_status;
  if (confirmed !== "deposit_refunded") {
    const detail = update.error ? ` Baza odmówiła: ${update.error.message}` : "";
    return {
      ok: false,
      reason: `Zamierzano ustawić deposit_refunded, po zapisie w bazie jest ${confirmed}.${detail}`,
    };
  }

  return { ok: true, settled: true, paymentStatus: confirmed };
}
