/**
 * Maszyna stanów payment_status (ADR-035). Czyste funkcje — lustro mapy
 * egzekwowanej w bazie triggerem app.payment_transition_allowed (0015).
 * Zgodność TS↔SQL (wszystkie 64 pary) przypina packages/db/test/order-gates.test.ts.
 */
import { describe, expect, it } from "vitest";

import { canPaymentTransition, PAYMENT_STATUSES, PAYMENT_TRANSITIONS } from "./order-status";

const OPEN = ["unpaid", "pending", "paid", "manual", "completed"] as const;

describe("maszyna stanów payment_status (ADR-035)", () => {
  it("każdy stan otwarty przechodzi w każdy otwarty + rozliczeniowy", () => {
    for (const from of OPEN) {
      for (const to of [...OPEN, "deposit_refunded", "refunded", "cancelled"] as const) {
        if (from === to) continue;
        expect(canPaymentTransition(from, to), `${from}->${to}`).toBe(true);
      }
    }
  });

  it("deposit_refunded wychodzi WYŁĄCZNIE w refunded/cancelled (zero regresu do otwartych)", () => {
    expect(canPaymentTransition("deposit_refunded", "refunded")).toBe(true);
    expect(canPaymentTransition("deposit_refunded", "cancelled")).toBe(true);
    for (const to of OPEN) {
      expect(canPaymentTransition("deposit_refunded", to), `deposit_refunded->${to}`).toBe(false);
    }
  });

  it("refunded i cancelled są terminalne", () => {
    for (const to of PAYMENT_STATUSES) {
      expect(canPaymentTransition("refunded", to), `refunded->${to}`).toBe(false);
      expect(canPaymentTransition("cancelled", to), `cancelled->${to}`).toBe(false);
    }
  });

  it("przejście tożsamościowe nie jest przejściem", () => {
    for (const s of PAYMENT_STATUSES) expect(canPaymentTransition(s, s), `${s}->${s}`).toBe(false);
  });

  it("PAYMENT_TRANSITIONS pokrywa każdy status kluczem", () => {
    for (const s of PAYMENT_STATUSES) expect(PAYMENT_TRANSITIONS[s], `brak klucza ${s}`).toBeDefined();
  });
});
