/**
 * Statystyki kafli nagłówka listy zamówień (uwaga przeglądu U1) — ADR-057.
 *
 * Czysta funkcja nad wierszami tenanta (odczyt zawężony RLS-em robi strona):
 * kafel liczy się z DANYCH, nie ze zgadywania. Kryteria każdego kafla są tu
 * jawne i mają jedno źródło prawdy (stałe niżej), więc test przypina je do
 * definicji, a nie do przypadku ułożenia fixture.
 *
 * Statusy „u klienta"/„do wysłania"/„zaległe" trzymamy jako listy statusów
 * domenowych z @avably/core — nie literały rozsiane po funkcji — żeby dopisanie
 * statusu w silniku było widoczne tutaj jako świadoma decyzja.
 */
import { type OrderStatus, type PaymentStatus } from "@avably/core";

import { addIsoDays } from "./order-dates";

export interface OrderStatRow {
  /** `YYYY-MM-DD`. */
  startDate: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  totalRentalGrosze: number;
}

export interface OrderStatTile {
  count: number;
  sumGrosze: number;
}

export interface OrderStats {
  /** Wszystkie zamówienia tenanta: liczba + łączna wartość. */
  all: OrderStatTile;
  /** Startujące w oknie najbliższych dni i wciąż czekające na wydanie. */
  toDispatch: OrderStatTile;
  /** Sprzęt u klientów (status „wydane"). */
  inRental: OrderStatTile;
  /** Zamówienia z zaległą należnością: liczba + suma do pobrania. */
  outstanding: OrderStatTile;
}

/** Sprzęt jest u klienta, jeszcze nie wrócił — kafel „W wynajmie". */
export const IN_RENTAL_ORDER_STATUSES: readonly OrderStatus[] = ["picked_up"];

/** Przed wydaniem, realnie w kolejce do obsługi — kafel „Do wysłania". */
export const TO_DISPATCH_ORDER_STATUSES: readonly OrderStatus[] = [
  "pending",
  "reserved",
  "ready_for_pickup",
];

/**
 * Płatność wciąż do pobrania — kafel „Do zapłaty". `unpaid` (nikt nie
 * zapłacił) i `payment_failed` (próba online odrzucona/wygasła) to jedyne
 * stany, w których pieniądze operatora nadal są „w powietrzu"; `pending`
 * (BLIK w toku) ani stany rozliczone/zwrócone tu nie należą.
 */
export const OUTSTANDING_PAYMENT_STATUSES: readonly PaymentStatus[] = ["unpaid", "payment_failed"];

/** Okno kafla „Do wysłania": start w ciągu tylu dni od dziś (włącznie). */
export const DISPATCH_WINDOW_DAYS = 3;

function tile(rows: OrderStatRow[]): OrderStatTile {
  return {
    count: rows.length,
    sumGrosze: rows.reduce((sum, row) => sum + row.totalRentalGrosze, 0),
  };
}

/**
 * Liczy cztery kafle z wierszy tenanta względem `today` (`YYYY-MM-DD`).
 * Okno „do wysłania" to [today, today + DISPATCH_WINDOW_DAYS] INCLUSIVE;
 * porównanie łańcuchów `YYYY-MM-DD` jest tożsame z porównaniem dat.
 */
export function computeOrderStats(rows: OrderStatRow[], today: string): OrderStats {
  const dispatchEnd = addIsoDays(today, DISPATCH_WINDOW_DAYS);
  return {
    all: tile(rows),
    toDispatch: tile(
      rows.filter(
        (row) =>
          TO_DISPATCH_ORDER_STATUSES.includes(row.orderStatus) &&
          row.startDate >= today &&
          row.startDate <= dispatchEnd,
      ),
    ),
    inRental: tile(rows.filter((row) => IN_RENTAL_ORDER_STATUSES.includes(row.orderStatus))),
    outstanding: tile(rows.filter((row) => OUTSTANDING_PAYMENT_STATUSES.includes(row.paymentStatus))),
  };
}
