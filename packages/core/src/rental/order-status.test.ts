import { describe, expect, it } from "vitest";

import {
  AVAILABILITY_BLOCKING_ORDER_STATUSES,
  BLOCKING_PAYMENT_STATUSES,
  canTransition,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type OrderStatus,
} from "./order-status";

describe("zbiory statusów — lustro CHECK-ów z migracji 0007", () => {
  // Wartości przepisane DOSŁOWNIE z CHECK-ów w 0007_rental_core.sql.
  // Zgodność z ŻYWĄ bazą przypina osobny test introspekcyjny w
  // packages/db/test/order-gates.test.ts — ten tutaj pilnuje, żeby nikt nie
  // przestawił wartości w samym pakiecie core.
  it("order_status: dokładnie sześć wartości z 0007, w kolejności cyklu życia", () => {
    expect(ORDER_STATUSES).toEqual([
      "pending",
      "reserved",
      "ready_for_pickup",
      "picked_up",
      "returned",
      "cancelled",
    ]);
  });

  it("payment_status: dokładnie dziewięć wartości z 0007 + 0027", () => {
    expect(PAYMENT_STATUSES).toEqual([
      "unpaid",
      "pending",
      "payment_failed",
      "paid",
      "manual",
      "completed",
      "deposit_refunded",
      "refunded",
      "cancelled",
    ]);
  });
});

describe("canTransition — pełna mapa przejść (36 par)", () => {
  // Mapa wypisana W CAŁOŚCI, para po parze — a nie „sprawdź kilka przykładów".
  // Zmiana dowolnego przejścia w implementacji MUSI zapalić dokładnie ten test.
  const EXPECTED: Record<OrderStatus, readonly OrderStatus[]> = {
    pending: ["reserved", "cancelled"],
    reserved: ["ready_for_pickup", "pending", "cancelled"],
    ready_for_pickup: ["picked_up", "reserved", "cancelled"],
    picked_up: ["returned", "ready_for_pickup"],
    returned: [],
    cancelled: [],
  };

  it.each(
    ORDER_STATUSES.flatMap((from) =>
      ORDER_STATUSES.map((to) => ({
        from,
        to,
        allowed: EXPECTED[from].includes(to),
      })),
    ),
  )("$from → $to: $allowed", ({ from, to, allowed }) => {
    expect(canTransition(from, to)).toBe(allowed);
  });

  it("przejście tożsamościowe (from === to) nie jest przejściem", () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("returned i cancelled są terminalne — zero wyjść", () => {
    for (const to of ORDER_STATUSES) {
      expect(canTransition("returned", to)).toBe(false);
      expect(canTransition("cancelled", to)).toBe(false);
    }
  });
});

describe("BLOCKING_PAYMENT_STATUSES — statusy płatności blokujące anulowanie", () => {
  it("blokują: środki pobrane albo pobranie w toku; nie blokują: unpaid/refunded/cancelled", () => {
    expect([...BLOCKING_PAYMENT_STATUSES].sort()).toEqual(
      ["completed", "deposit_refunded", "manual", "paid", "pending"].sort(),
    );
  });

  it("każdy status blokujący jest poprawnym payment_status", () => {
    for (const status of BLOCKING_PAYMENT_STATUSES) {
      expect(PAYMENT_STATUSES).toContain(status);
    }
  });
});

describe("AVAILABILITY_BLOCKING_ORDER_STATUSES — statusy zamówień blokujące egzemplarz", () => {
  it("blokują wszystkie stany przed zwrotem; returned i cancelled zwalniają egzemplarz", () => {
    expect([...AVAILABILITY_BLOCKING_ORDER_STATUSES].sort()).toEqual(
      ["pending", "picked_up", "ready_for_pickup", "reserved"].sort(),
    );
  });

  it("każdy status blokujący jest poprawnym order_status", () => {
    for (const status of AVAILABILITY_BLOCKING_ORDER_STATUSES) {
      expect(ORDER_STATUSES).toContain(status);
    }
  });
});
