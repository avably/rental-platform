/**
 * Zapis rozliczenia zamówienia w obiegu dostawcy — JEDNA ścieżka dla
 * wszystkich, którzy mają do zapisania werdykt z odczytu (L11, ADR-104).
 *
 * ================== DLACZEGO TO WYJECHAŁO Z HANDLERA WEBHOOKA ==============
 *
 * Do 0030 istniał dokładnie jeden writer `paid`: handler webhooka. Od L11
 * są trzy wejścia do tej samej decyzji — webhook (przyszło zdarzenie), job
 * rekoncyliacji (zdarzenie nie przyszło) i przycisk operatora („sprawdź
 * status płatności"). Wszystkie trzy mają werdykt z odczytu u dostawcy
 * i wszystkie trzy muszą zapisać go IDENTYCZNIE.
 *
 * Druga kopia tej sekwencji rozjechałaby się przy pierwszej poprawce, a
 * rozjazd byłby rozjazdem W KSIĘGOWANIU PIENIĘDZY — dokładnie ten sam
 * argument, który wcześniej wyprowadził `bookDepositEvent` do osobnego
 * modułu (Z5). Klient bazy jest tu parametrem, a reguła jedna.
 *
 * ================== TRZY REGUŁY, KTÓRYCH TEN MODUŁ PILNUJE ================
 *
 * 1. KSIĘGOWANIE KAUCJI STOI PRZED ZMIANĄ STATUSU. Nie z powodu bramki
 *    (`paid` żadnej spójności z rejestrem nie wymaga), tylko z powodu
 *    PONOWIEŃ: gdyby szło po statusie i padło, kolejne wejście zastałoby
 *    zamówienie już w `paid`, uznało to za brak roboty i wyszło — a kaucja
 *    zostałaby pobrana od klienta i NIEOBECNA w rejestrze, czyli nie do
 *    zwrócenia. W tej kolejności każde ponowne wejście naprawia brak.
 *
 * 2. ZAPIS JEST WARUNKOWY (compare-and-set na statusie, który widzieliśmy).
 *    Filtr po STARYM statusie zamienia „nadpisz" w „zmień, jeśli nikt mnie
 *    nie wyprzedził". Bez niego job i webhook, działając równolegle na tej
 *    samej płatności, nadpisywałyby sobie wynik na podstawie starszych
 *    odczytów.
 *
 * 3. O WYNIKU DECYDUJE ODCZYT PO ZAPISIE, nie odpowiedź na zapis. PostgREST
 *    na UPDATE odpowiada 204 także wtedy, gdy nie trafił w żaden wiersz
 *    (wyprzedzenie, filtr, który przestał pasować, polityka RLS
 *    odfiltrowująca wiersz). Błąd z UPDATE-a wchodzi wyłącznie do
 *    UZASADNIENIA, bo niesie czytelny powód odmowy bramki (23514).
 *
 * ================== CZEGO TU NIE MA ==================
 *
 * Ani jednej linijki, która ROZSTRZYGA, jaki status ustawić. Ten moduł
 * dostaje `targetStatus` gotowy i nie ma jak go wyprowadzić — tłumaczenie
 * odczytu na naszą oś jest w `settlementVerdict` (@avably/core) i wyłącznie
 * tam. Gdyby ten moduł przyjmował `IntentRead`, byłby drugim miejscem, do
 * którego kusi dopisać „a jak status jest taki, to…".
 */
import type { PaymentStatus } from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import { bookDepositEvent } from "./deposit-booking";

/**
 * Statusy płatności, przy których pytanie dostawcy „i co z tymi pieniędzmi"
 * ma jeszcze sens (L11, ADR-104).
 *
 * Mieszka TUTAJ, a nie przy jobie, bo mają je znać dwa miejsca o różnych
 * uprawnieniach: rekoncyliacja (moduł z klientem service-role) i ekran
 * zamówienia, który decyduje, czy w ogóle pokazać przycisk. Import stąd
 * pozwala ekranowi poznać tę listę bez wciągania w swój graf modułu, który
 * omija RLS.
 *
 * `paid` i stany rozliczeniowe są POZA listą: tam odczyt mógłby co najwyżej
 * zaproponować regres, którego bramka reżimu stripe (0027) nie wpuści.
 */
export const CHECKABLE_PAYMENT_STATUSES: readonly PaymentStatus[] = ["pending", "payment_failed"];

/** Wiersz zamówienia w zakresie, którego zapis rozliczenia realnie dotyczy. */
export interface SettlementOrder {
  id: string;
  tenant_id: string;
  /** Status ODCZYTANY przed decyzją — podstawa compare-and-set. */
  payment_status: PaymentStatus;
  total_deposit_grosze: number;
}

/**
 * Wynik zapisu.
 *
 * `retryable` rozstrzyga, czy wołający ma prosić o ponowienie (webhook: 5xx
 * i zwolnienie dzierżawy; job: zostawienie zamówienia na następny przebieg).
 * Odmowa bramki statusów jest DETERMINISTYCZNA — dziesiąte ponowienie
 * skończy się tak samo, więc `retryable: false`.
 *
 * `changed: false` przy `ok: true` to NIE porażka: tak wygląda zamówienie,
 * które ktoś inny (druga ścieżka) już przestawił na ten sam status.
 */
export type SettlementApplication =
  | { ok: true; changed: boolean; paymentStatus: PaymentStatus; reason: string | null }
  | { ok: false; retryable: boolean; reason: string };

export interface ApplySettlementInput {
  order: SettlementOrder;
  /**
   * Status DO USTAWIENIA — nigdy `null`. Werdykt „odczyt nie uprawnia do
   * żadnego przejścia" wołający obsługuje SAM, zanim tu wejdzie: tamto nie
   * jest zapisem, tylko jego brakiem, i ma inne uzasadnienie do zapisania
   * w rejestrze niż cokolwiek, co robi ta funkcja.
   */
  targetStatus: PaymentStatus;
  /**
   * `pi_...` — dowód wiersza kaucji. Odnośnik płatności, nie zwrotu:
   * kaucja jedzie w tym samym intencie co najem (D1/D4, 0029).
   */
  providerReference: string;
}

export async function applySettlement(
  db: SupabaseClient,
  input: ApplySettlementInput,
): Promise<SettlementApplication> {
  const { order, targetStatus, providerReference } = input;

  // --- KAUCJA POBRANA: z tego samego POTWIERDZONEGO odczytu co `paid` ---
  //
  // Chwila, w której dostawca potwierdza opłacenie zamówienia, JEST chwilą,
  // w której kaucja została pobrana — nie ma tu osobnego zdarzenia do
  // odczytania i nie ma na co czekać. Sprawdzenie stoi PRZED „jesteśmy już
  // w tym statusie" właśnie po to, żeby wejście naprawcze miało gdzie
  // zadziałać (patrz reguła 1 w nagłówku).
  if (targetStatus === "paid" && order.total_deposit_grosze > 0) {
    const booked = await bookDepositEvent(db, {
      tenantId: order.tenant_id,
      orderId: order.id,
      kind: "collected",
      // Kwota kaucji z UTRWALONYCH danych zamówienia — nie z odczytu
      // płatności, bo tamten niesie sumę całego zamówienia. Rozjazd sumy
      // z oczekiwaną odciął już `settlementVerdict` u wołającego.
      amountGrosze: order.total_deposit_grosze,
      providerReference,
    });

    if (!booked.ok) {
      // Zamówienie z pobraną, a niezaksięgowaną kaucją jest gorsze niż
      // zamówienie czekające na człowieka — status NIE zostaje ustawiony.
      return { ok: false, retryable: booked.retryable, reason: booked.reason };
    }
  }

  if (targetStatus === order.payment_status) {
    return {
      ok: true,
      changed: false,
      paymentStatus: targetStatus,
      reason: `Zamówienie jest już w statusie ${targetStatus} - bez zapisu.`,
    };
  }

  const update = await db
    .from("orders")
    .update({ payment_status: targetStatus })
    .eq("id", order.id)
    .eq("tenant_id", order.tenant_id)
    .eq("payment_status", order.payment_status);

  // --- ODCZYT PO ZAPISIE: jedyne, co rozstrzyga o werdykcie ---
  const after = await db
    .from("orders")
    .select("payment_status")
    .eq("id", order.id)
    .eq("tenant_id", order.tenant_id)
    .maybeSingle();

  if (after.error || !after.data) {
    return {
      ok: false,
      retryable: true,
      reason: `Nie udało się potwierdzić zapisu odczytem: ${after.error?.message ?? "brak wiersza"}`,
    };
  }

  const confirmed = (after.data as { payment_status: PaymentStatus }).payment_status;
  if (confirmed !== targetStatus) {
    const detail = update.error ? ` Baza odmówiła: ${update.error.message}` : "";
    return {
      ok: false,
      retryable: false,
      reason: `Zamierzano ustawić ${targetStatus}, po zapisie w bazie jest ${confirmed}.${detail}`,
    };
  }

  return { ok: true, changed: true, paymentStatus: confirmed, reason: null };
}
