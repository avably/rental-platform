/**
 * Salda kaucji i schematy rozliczeń (Zadanie 5) — czysta logika, bez bazy.
 *
 * Salda w JS to WYGODA UI (rejestr, podpowiedzi kwot, stan przycisków) —
 * bramką jest trigger deposit_events_gate z 0011 (ADR-026); analogicznie
 * schematy Zod dają czytelny komunikat PRZED bazą, a autorytatywna odmowa
 * przychodzi kodem 23514.
 */
import { describe, expect, it } from "vitest";

import {
  depositTotals,
  isDepositSettled,
  runningBalances,
} from "@/app/[locale]/zamowienia/[id]/deposit";
import {
  DEDUCTION_REASON_CODES,
  depositCollectSchema,
  depositDeductSchema,
  depositRefundSchema,
} from "@/lib/order-validation";

const ORDER_ID = "3f0a86a2-51b7-4a86-9f5e-6a8f1d1b2c3d";

describe("depositTotals / runningBalances / isDepositSettled", () => {
  it("pusty rejestr: zera i brak rozliczenia", () => {
    const totals = depositTotals([]);
    expect(totals).toEqual({ collectedGrosze: 0, settledGrosze: 0, balanceGrosze: 0 });
    expect(isDepositSettled(totals)).toBe(false);
    expect(runningBalances([])).toEqual([]);
  });

  it("kierunek niesie kind: pobrania dodają, zwroty i potrącenia odejmują", () => {
    const events = [
      { kind: "collected", amount_grosze: 100_00 },
      { kind: "collected", amount_grosze: 50_00 },
      { kind: "refunded", amount_grosze: 60_00 },
      { kind: "deducted", amount_grosze: 40_00 },
    ] as const;
    expect(depositTotals(events)).toEqual({
      collectedGrosze: 150_00,
      settledGrosze: 100_00,
      balanceGrosze: 50_00,
    });
    expect(runningBalances(events)).toEqual([100_00, 150_00, 90_00, 50_00]);
  });

  it("rozliczona = pobrania > 0 i saldo 0 (samo puste saldo nie wystarcza)", () => {
    expect(
      isDepositSettled(
        depositTotals([
          { kind: "collected", amount_grosze: 100_00 },
          { kind: "refunded", amount_grosze: 70_00 },
          { kind: "deducted", amount_grosze: 30_00 },
        ] as const),
      ),
    ).toBe(true);

    expect(
      isDepositSettled(depositTotals([{ kind: "collected", amount_grosze: 100_00 }] as const)),
    ).toBe(false);
  });
});

describe("schematy rozliczeń kaucji", () => {
  it("kwota przechodzi przez parseMajorToGrosze: przecinek, kropka, całe złote", () => {
    expect(depositCollectSchema.parse({ orderId: ORDER_ID, amount: "100,50" }).amountGrosze).toBe(
      100_50,
    );
    expect(depositRefundSchema.parse({ orderId: ORDER_ID, amount: "80.25" }).amountGrosze).toBe(
      80_25,
    );
    expect(depositCollectSchema.parse({ orderId: ORDER_ID, amount: "100" }).amountGrosze).toBe(
      100_00,
    );
  });

  it("zero, kwota ujemna i śmieci są odrzucane", () => {
    for (const amount of ["0", "-5", "abc", "1,234", ""]) {
      const result = depositCollectSchema.safeParse({ orderId: ORDER_ID, amount });
      expect(result.success, `kwota "${amount}" przeszła`).toBe(false);
    }
  });

  it("potrącenie wymaga kodu z listy", () => {
    const missing = depositDeductSchema.safeParse({
      orderId: ORDER_ID,
      amount: "10",
      reasonCode: "",
      reason: "",
    });
    expect(missing.success).toBe(false);

    const unknown = depositDeductSchema.safeParse({
      orderId: ORDER_ID,
      amount: "10",
      reasonCode: "vandalism",
      reason: "",
    });
    expect(unknown.success).toBe(false);

    const ok = depositDeductSchema.parse({
      orderId: ORDER_ID,
      amount: "10",
      reasonCode: "damage",
      reason: "",
    });
    expect(ok.reasonCode).toBe("damage");
    expect(ok.reason).toBeNull();
  });

  it("kod 'other' wymaga doprecyzowania (biały znak to brak)", () => {
    const missing = depositDeductSchema.safeParse({
      orderId: ORDER_ID,
      amount: "10",
      reasonCode: "other",
      reason: "   ",
    });
    expect(missing.success).toBe(false);

    const ok = depositDeductSchema.parse({
      orderId: ORDER_ID,
      amount: "10",
      reasonCode: "other",
      reason: "zgubiony klucz",
    });
    expect(ok.reason).toBe("zgubiony klucz");
  });

  it("lista kodów jest lustrem CHECK-a z 0011", () => {
    expect(DEDUCTION_REASON_CODES).toEqual([
      "damage",
      "late_return",
      "missing_part",
      "cleaning",
      "other",
    ]);
  });
});
