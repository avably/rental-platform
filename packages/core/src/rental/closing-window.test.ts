import { describe, expect, it } from "vitest";

import {
  CLOSING_OBLIGATION_PAYMENT_STATUSES,
  CLOSING_OPEN_ORDER_STATUSES,
  CLOSING_WINDOW_DAYS,
  closingWindowDaysLeft,
  isClosingForwardTransition,
  isClosingWindowOpen,
  isOpenObligation,
  type ClosableOrderShape,
} from "./closing-window";
import { BLOCKING_PAYMENT_STATUSES, ORDER_STATUSES, PAYMENT_STATUSES } from "./order-status";

/**
 * Okno domykania (Zasada 8, ADR-138) — zegar, zamrożony zbiór, forward-only.
 * Asercje graniczne zegara PO OBU stronach progu są tu, a ich egzekwowanie
 * w guardzie panelu przypina apps/panel/test/tenant-status-guard.test.ts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const SUSPENDED_AT = "2026-08-01T12:00:00.000Z";
const SUSPENDED_MS = Date.parse(SUSPENDED_AT);

describe("isClosingWindowOpen — twardy zegar od suspended_at", () => {
  it("chwilę PRZED progiem 30 dni okno jest otwarte", () => {
    expect(isClosingWindowOpen(SUSPENDED_AT, SUSPENDED_MS + CLOSING_WINDOW_DAYS * DAY_MS - 1)).toBe(
      true,
    );
  });

  it("DOKŁADNIE na progu okno jest zamknięte (now ≥ suspended_at + 30 dni)", () => {
    expect(isClosingWindowOpen(SUSPENDED_AT, SUSPENDED_MS + CLOSING_WINDOW_DAYS * DAY_MS)).toBe(
      false,
    );
  });

  it("chwilę PO progu okno jest zamknięte", () => {
    expect(isClosingWindowOpen(SUSPENDED_AT, SUSPENDED_MS + CLOSING_WINDOW_DAYS * DAY_MS + 1)).toBe(
      false,
    );
  });

  it("fail-closed: brak zegara (null/undefined) i wartość nieparsowalna → zamknięte", () => {
    expect(isClosingWindowOpen(null, SUSPENDED_MS)).toBe(false);
    expect(isClosingWindowOpen(undefined, SUSPENDED_MS)).toBe(false);
    expect(isClosingWindowOpen("nie-data", SUSPENDED_MS)).toBe(false);
  });

  it("stała okna to 30 dni (kontrakt z Zasadą 8 i banerem)", () => {
    expect(CLOSING_WINDOW_DAYS).toBe(30);
  });
});

describe("closingWindowDaysLeft — licznik banera", () => {
  it("na starcie okna zostaje pełne 30 dni", () => {
    expect(closingWindowDaysLeft(SUSPENDED_AT, SUSPENDED_MS)).toBe(CLOSING_WINDOW_DAYS);
  });

  it("ostatnie godziny to wciąż 1 dzień, nigdy 0 przy otwartym oknie", () => {
    const lastHours = SUSPENDED_MS + CLOSING_WINDOW_DAYS * DAY_MS - 3 * 60 * 60 * 1000;
    expect(closingWindowDaysLeft(SUSPENDED_AT, lastHours)).toBe(1);
    expect(isClosingWindowOpen(SUSPENDED_AT, lastHours)).toBe(true);
  });

  it("po zamknięciu i bez zegara → 0", () => {
    expect(closingWindowDaysLeft(SUSPENDED_AT, SUSPENDED_MS + 31 * DAY_MS)).toBe(0);
    expect(closingWindowDaysLeft(null)).toBe(0);
  });
});

function order(overrides: Partial<ClosableOrderShape> = {}): ClosableOrderShape {
  return {
    createdAt: "2026-07-20T10:00:00.000Z",
    paymentStatus: "paid",
    orderStatus: "picked_up",
    depositBalanceGrosze: 0,
    ...overrides,
  };
}

describe("isOpenObligation — zamrożony zbiór", () => {
  it("zamówienie opłacone przed zawieszeniem, w toku → w zbiorze", () => {
    expect(isOpenObligation(order(), SUSPENDED_AT)).toBe(true);
  });

  it.each(["paid", "manual", "completed"] as const)(
    "status płatności %s wchodzi (pieniądze klienta są u najemcy)",
    (paymentStatus) => {
      expect(isOpenObligation(order({ paymentStatus }), SUSPENDED_AT)).toBe(true);
    },
  );

  it.each(["unpaid", "pending", "payment_failed", "deposit_refunded", "refunded", "cancelled"] as const)(
    "status płatności %s NIE wchodzi",
    (paymentStatus) => {
      expect(isOpenObligation(order({ paymentStatus }), SUSPENDED_AT)).toBe(false);
    },
  );

  it("zamówienie utworzone PO zawieszeniu → poza zbiorem (nawet opłacone)", () => {
    expect(
      isOpenObligation(order({ createdAt: "2026-08-02T10:00:00.000Z" }), SUSPENDED_AT),
    ).toBe(false);
  });

  it("utworzone przed zawieszeniem, OPŁACONE WEBHOOKIEM PO zawieszeniu → w zbiorze " +
    "(predykat pyta o created_at, nie o chwilę zaksięgowania)", () => {
    // Webhook nie czyta statusu tenanta — płatność wpada także po
    // zawieszeniu. Zamówienie POWSTAŁO przed suspended_at, więc wchodzi.
    expect(
      isOpenObligation(
        order({ createdAt: "2026-08-01T11:59:59.000Z", paymentStatus: "paid" }),
        SUSPENDED_AT,
      ),
    ).toBe(true);
  });

  it("returned z niezerowym saldem kaucji → w zbiorze; saldo 0 → wypada", () => {
    expect(
      isOpenObligation(order({ orderStatus: "returned", depositBalanceGrosze: 5_000 }), SUSPENDED_AT),
    ).toBe(true);
    expect(
      isOpenObligation(order({ orderStatus: "returned", depositBalanceGrosze: 0 }), SUSPENDED_AT),
    ).toBe(false);
  });

  it("cancelled nigdy nie wchodzi, nawet z saldem", () => {
    expect(
      isOpenObligation(order({ orderStatus: "cancelled", depositBalanceGrosze: 5_000 }), SUSPENDED_AT),
    ).toBe(false);
  });

  it("fail-closed: brak/nieparsowalny suspended_at → poza zbiorem", () => {
    expect(isOpenObligation(order(), null)).toBe(false);
    expect(isOpenObligation(order(), "nie-data")).toBe(false);
  });

  it("NIE jest lustrem BLOCKING_PAYMENT_STATUSES (bramka anulowania to inna decyzja)", () => {
    // Bramka anulowania zawiera `pending` i `deposit_refunded` — miara
    // wypłacalności zbioru NIE. Ten test pali się, gdy ktoś „uprości"
    // predykat do pożyczonej stałej.
    expect([...CLOSING_OBLIGATION_PAYMENT_STATUSES].sort()).not.toEqual(
      [...BLOCKING_PAYMENT_STATUSES].sort(),
    );
    expect(CLOSING_OBLIGATION_PAYMENT_STATUSES).toEqual(["paid", "manual", "completed"]);
    expect(CLOSING_OPEN_ORDER_STATUSES).toEqual([
      "pending",
      "reserved",
      "ready_for_pickup",
      "picked_up",
    ]);
  });
});

describe("isClosingForwardTransition — wyłącznie do przodu", () => {
  it.each([
    ["reserved", "ready_for_pickup"],
    ["ready_for_pickup", "picked_up"],
    ["picked_up", "returned"],
  ] as const)("%s → %s dozwolone", (from, to) => {
    expect(isClosingForwardTransition(from, to)).toBe(true);
  });

  it("pending → reserved ZABLOKOWANE (przyjęcie rezerwacji to nie domykanie)", () => {
    expect(isClosingForwardTransition("pending", "reserved")).toBe(false);
  });

  it.each([
    ["picked_up", "ready_for_pickup"],
    ["ready_for_pickup", "reserved"],
    ["reserved", "pending"],
  ] as const)("cofnięcie %s → %s zablokowane", (from, to) => {
    expect(isClosingForwardTransition(from, to)).toBe(false);
  });

  it("anulowanie OFF bez wyjątków — z żadnego stanu", () => {
    for (const from of ORDER_STATUSES) {
      expect(isClosingForwardTransition(from, "cancelled")).toBe(false);
    }
  });

  it("domena wejść pokrywa całą oś statusów (nowy status wymaga decyzji tutaj)", () => {
    // Snapshot domeny: dopisanie statusu w order-status.ts bez rozstrzygnięcia,
    // czy jest „do przodu", ma płonąć TUTAJ, nie w recenzji.
    expect(ORDER_STATUSES).toHaveLength(6);
    expect(PAYMENT_STATUSES).toHaveLength(9);
  });
});
