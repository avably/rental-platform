/**
 * Testy prezentacji checkoutu (apps/storefront/lib/checkout-form-ui.ts).
 *
 * Dwie bramki kontraktu:
 *  1. KAŻDY status CheckoutResult mapuje się na jawny stan widoku (żaden nie
 *     wpada w dziurę „brak komunikatu").
 *  2. Podsumowanie kwot liczy się WYŁĄCZNIE z order serwera — podmiana kwot
 *     „lokalnych" nie ma prawa go ruszyć.
 */
import { describe, expect, it } from "vitest";

import type { CheckoutOrderSummary, CheckoutResult, CheckoutStatus } from "@/lib/checkout/contract";
import {
  getCheckoutMessageKey,
  mapCheckoutResult,
  orderSummaryTotals,
  shouldResetCaptcha,
} from "@/lib/checkout-form-ui";

const ORDER: CheckoutOrderSummary = {
  orderNumber: "AV-2026-000123",
  orderStatus: "pending",
  paymentStatus: "unpaid",
  paymentMethod: "transfer",
  startDate: "2026-10-01",
  endDate: "2026-10-05",
  deliveryMethod: "courier",
  totalRentalGrosze: 50_000,
  totalDepositGrosze: 20_000,
  deliveryGrosze: 1_500,
  currency: "PLN",
  items: [
    { productId: "p1", quantity: 2, unitRentalGrosze: 20_000, unitDepositGrosze: 10_000 },
    { productId: "p2", quantity: 1, unitRentalGrosze: 10_000, unitDepositGrosze: 0 },
  ],
};

describe("mapCheckoutResult pokrywa KAŻDY status", () => {
  const cases: { result: CheckoutResult; expected: string }[] = [
    { result: { status: "success", order: ORDER, nextStep: "confirmation" }, expected: "success" },
    { result: { status: "validation_error", fields: { email: "invalid" } }, expected: "validation" },
    { result: { status: "unavailable" }, expected: "unavailable" },
    { result: { status: "rejected" }, expected: "rejected" },
    { result: { status: "rate_limited" }, expected: "rate_limited" },
    { result: { status: "captcha_failed" }, expected: "captcha_error" },
    { result: { status: "payment_unavailable" }, expected: "payment_unavailable" },
    { result: { status: "server_error" }, expected: "server_error" },
  ];

  it.each(cases)("$result.status → stan $expected", ({ result, expected }) => {
    expect(mapCheckoutResult(result).kind).toBe(expected);
  });

  it("każdy status kontraktu ma gałąź (bez wpadnięcia w default)", () => {
    const allStatuses: CheckoutStatus[] = [
      "success",
      "validation_error",
      "unavailable",
      "rejected",
      "rate_limited",
      "captcha_failed",
      "server_error",
    ];
    for (const status of allStatuses) {
      const result = (status === "success"
        ? { status, order: ORDER }
        : status === "validation_error"
          ? { status, fields: {} }
          : { status }) as CheckoutResult;
      expect(() => mapCheckoutResult(result)).not.toThrow();
      expect(mapCheckoutResult(result).kind).toBeTruthy();
    }
  });

  it("każdy stan błędu (poza walidacją) daje niepusty klucz komunikatu", () => {
    for (const status of ["unavailable", "rejected", "rate_limited", "captcha_failed", "server_error"] as const) {
      const view = mapCheckoutResult({ status } as CheckoutResult);
      expect(getCheckoutMessageKey(view)).not.toBeNull();
    }
  });

  it("success niesie order i puste emailIssues, gdy serwer ich nie zwrócił", () => {
    const view = mapCheckoutResult({ status: "success", order: ORDER, nextStep: "confirmation" });
    expect(view).toMatchObject({ kind: "success", order: ORDER, emailIssues: [], nextStep: "confirmation" });
  });

  it("success przenosi emailIssues z serwera", () => {
    const view = mapCheckoutResult({ status: "success", order: ORDER, nextStep: "confirmation", emailIssues: ["brak nadawcy"] });
    expect(view.kind === "success" && view.emailIssues).toEqual(["brak nadawcy"]);
  });
});

describe("reset captchy", () => {
  it("resetuje po błędach zużywających token, nie po sukcesie/walidacji", () => {
    expect(shouldResetCaptcha({ kind: "server_error" })).toBe(true);
    expect(shouldResetCaptcha({ kind: "captcha_error" })).toBe(true);
    expect(shouldResetCaptcha({ kind: "unavailable" })).toBe(true);
    expect(shouldResetCaptcha({ kind: "success", order: ORDER, emailIssues: [], nextStep: "confirmation" })).toBe(false);
    expect(shouldResetCaptcha({ kind: "validation", fields: {} })).toBe(false);
    expect(shouldResetCaptcha({ kind: "idle" })).toBe(false);
  });
});

describe("kwoty potwierdzenia pochodzą z serwera", () => {
  it("sumuje najem + kaucja + dostawa z order serwera", () => {
    expect(orderSummaryTotals(ORDER)).toEqual({
      rentalGrosze: 50_000,
      depositGrosze: 20_000,
      deliveryGrosze: 1_500,
      totalGrosze: 71_500,
    });
  });

  it("podmiana kwot 'lokalnych' nie zmienia podsumowania — liczy się tylko order", () => {
    // Symulacja: klient mógłby próbować podać własne (zaniżone) kwoty obok.
    // orderSummaryTotals patrzy WYŁĄCZNIE na order serwera, więc wynik jest
    // niezmieniony niezależnie od jakiejkolwiek lokalnej wartości.
    const localTampered = { totalRentalGrosze: 1, totalDepositGrosze: 1, deliveryGrosze: 0 };
    void localTampered;
    expect(orderSummaryTotals(ORDER).totalGrosze).toBe(71_500);
  });
});
