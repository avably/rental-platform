/**
 * Masowa zmiana statusu zamówień (uwaga przeglądu U4) — logika bez I/O.
 *
 * SEDNO: operacja masowa nad maszyną stanów JEST z natury częściowo nieudana.
 * Bramką przejść jest trigger `orders_write_gate` z migracji 0010 (ADR-025),
 * który odmawia per wiersz — zaznaczenie dziesięciu zamówień w różnych stanach
 * i wybranie jednego celu to normalny, a nie wyjątkowy scenariusz, w którym
 * część przejść jest nielegalna. Dlatego wynikiem tej operacji NIE jest
 * „gotowe", tylko RAPORT PER ZAMÓWIENIE: co się zmieniło, co zostało
 * odrzucone i z jakiego powodu. Zbiorczy komunikat sukcesu przy cichych
 * porażkach byłby sygnałem udającym dowód — dokładnie tą klasą błędu, którą
 * projekt tępi (por. uczciwa częściowa porażka wysyłki e-maili, ADR-033).
 *
 * DLACZEGO UPDATE PER ZAMÓWIENIE, A NIE JEDEN `in (...)`: jedno zapytanie to
 * jedna transakcja — pierwsze nielegalne przejście wycofałoby CAŁOŚĆ, łącznie
 * z wierszami, które przeszły. Operator dostałby „nic się nie stało" zamiast
 * „siedem zmienione, trzy odrzucone". Osobne żądania kosztują rundy do bazy
 * (zaznaczenie jest ograniczone do wczytanej strony, czyli ≤100), ale kupują
 * jedyne uczciwe zachowanie.
 *
 * BRAMKI NIE OMIJAMY I NIE UDAJEMY. Nie ma tu filtra `canTransition`, który
 * odsiewałby wiersze przed wysłaniem: każde zamówienie dostaje PRAWDZIWY
 * UPDATE, a werdykt odmowy przychodzi z bazy (23514 / 23001 / 23P01) i trafia
 * do raportu jako powód. Jedyny przypadek rozstrzygany tutaj to cel równy
 * stanowi bieżącemu — trigger bramkuje wyłącznie ZMIANĘ statusu
 * (`new.order_status is distinct from old.order_status`), więc taki UPDATE
 * przeszedłby i raport ogłosiłby zmianę, której nie było.
 *
 * Funkcje są czyste (mechanizm dostępu wstrzykiwany jako `attempt`), więc
 * uczciwość raportu testuje się bez Supabase — wzorzec
 * `sendRentalEmailForTransition`.
 */
import type { OrderStatus } from "@avably/core";

/** Powody odmowy — kod, nie zdanie: tłumaczenie robi warstwa widoku. */
export const BULK_REJECT_REASONS = [
  /** Trigger 0010 odmówił przejścia (23514) albo INSERT-owy CHECK statusu. */
  "illegal-transition",
  /** Anulowanie przy nierozliczonej płatności (23001). */
  "cancel-blocked",
  /** Kolizja egzemplarza (23P01) — bramka dostępności. */
  "unit-conflict",
  /** Cel = stan bieżący: nie ma czego zmieniać (baza by tego nie odrzuciła). */
  "already-in-target",
  /** Ktoś zmienił status między odczytem listy a kliknięciem. */
  "changed-meanwhile",
  /** Zamówienia nie ma w zbiorze tenanta (usunięte albo obce id). */
  "not-found",
  /** Odmowa, której nie umiemy nazwać — `detail` niesie surowy komunikat. */
  "unknown",
] as const;

export type BulkRejectReason = (typeof BULK_REJECT_REASONS)[number];

/** Zamówienie wzięte na cel: `from === null` znaczy „nie znaleziono". */
export interface BulkStatusTarget {
  orderId: string;
  orderNumber: string;
  from: OrderStatus | null;
}

export type BulkStatusAttempt =
  | { ok: true }
  | { ok: false; reason: BulkRejectReason; detail?: string };

export interface BulkStatusEntry {
  orderId: string;
  orderNumber: string;
  from: OrderStatus | null;
  reason?: BulkRejectReason;
  detail?: string;
}

export interface BulkStatusReport {
  to: OrderStatus;
  changed: BulkStatusEntry[];
  rejected: BulkStatusEntry[];
}

/** Kod błędu PostgREST → powód odmowy (kody z nagłówka migracji 0010). */
export function rejectReasonFromCode(code: string | undefined): BulkRejectReason {
  switch (code) {
    case "23514":
      return "illegal-transition";
    case "23001":
      return "cancel-blocked";
    case "23P01":
      return "unit-conflict";
    default:
      return "unknown";
  }
}

/**
 * Przechodzi zaznaczenie zamówienie po zamówieniu i składa raport.
 *
 * Sekwencyjnie, a nie równolegle: bramka dostępności bierze blokady advisory
 * per egzemplarz (0010), a raport ma zachować kolejność zaznaczenia — dla
 * operatora czytającego listę odmów to różnica między „widzę, co poszło nie
 * tak" a losową sieczką.
 */
export async function runBulkStatusChange(
  targets: readonly BulkStatusTarget[],
  to: OrderStatus,
  attempt: (target: BulkStatusTarget) => Promise<BulkStatusAttempt>,
): Promise<BulkStatusReport> {
  const changed: BulkStatusEntry[] = [];
  const rejected: BulkStatusEntry[] = [];

  for (const target of targets) {
    const entry: BulkStatusEntry = {
      orderId: target.orderId,
      orderNumber: target.orderNumber,
      from: target.from,
    };

    if (target.from === null) {
      rejected.push({ ...entry, reason: "not-found" });
      continue;
    }
    if (target.from === to) {
      rejected.push({ ...entry, reason: "already-in-target" });
      continue;
    }

    const result = await attempt(target);
    if (result.ok) {
      changed.push(entry);
    } else {
      rejected.push({ ...entry, reason: result.reason, detail: result.detail });
    }
  }

  return { to, changed, rejected };
}

/**
 * Nagłówek raportu: „wszystko", „część", „nic".
 *
 * Wydzielony celowo — to jedyne miejsce, w którym interfejs decyduje, jakim
 * zdaniem podsumować operację. Dopóki werdykt liczy się TUTAJ z faktycznych
 * list, żadna zmiana w widoku nie zamieni częściowej porażki w zbiorcze
 * „gotowe" bez zapalenia testu.
 */
export function bulkStatusOutcome(report: BulkStatusReport): "all" | "partial" | "none" {
  // Kolejność warunków ma znaczenie: pusty raport (zero zmienionych, zero
  // odrzuconych) to „nic", a nie „wszystko" — „wszystko" musi znaczyć, że coś
  // się naprawdę wydarzyło.
  if (report.changed.length === 0) return "none";
  if (report.rejected.length === 0) return "all";
  return "partial";
}
