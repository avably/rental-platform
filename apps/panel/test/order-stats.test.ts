/**
 * Kafle nagłówka listy (uwaga przeglądu U1): każdy kafel liczy się z danych po
 * jawnym kryterium, nie z ułożenia fixture. Test pilnuje definicji okien i
 * zbiorów statusów, w tym podłogi po pustym wejściu.
 */
import { describe, expect, it } from "vitest";

import { type OrderStatRow, computeOrderStats } from "@/lib/orders/order-stats";

const TODAY = "2026-07-23";

function row(over: Partial<OrderStatRow>): OrderStatRow {
  return {
    startDate: "2026-08-01",
    orderStatus: "reserved",
    paymentStatus: "paid",
    totalRentalGrosze: 100_00,
    ...over,
  };
}

describe("computeOrderStats — kafel Wszystkie", () => {
  it("liczy wszystkie wiersze i sumuje wartość", () => {
    const stats = computeOrderStats(
      [row({ totalRentalGrosze: 100_00 }), row({ totalRentalGrosze: 250_00 })],
      TODAY,
    );
    expect(stats.all.count).toBe(2);
    expect(stats.all.sumGrosze).toBe(350_00);
  });

  it("puste wejście → zera, nie NaN", () => {
    const stats = computeOrderStats([], TODAY);
    expect(stats.all).toEqual({ count: 0, sumGrosze: 0 });
    expect(stats.outstanding).toEqual({ count: 0, sumGrosze: 0 });
  });
});

describe("computeOrderStats — kafel Do wysłania (start w ciągu 3 dni)", () => {
  it("łapie start dziś i za 3 dni, gubi za 4 dni i wczorajszy", () => {
    const stats = computeOrderStats(
      [
        row({ startDate: TODAY, orderStatus: "reserved" }),
        row({ startDate: "2026-07-26", orderStatus: "ready_for_pickup" }), // +3
        row({ startDate: "2026-07-27", orderStatus: "reserved" }), // +4 poza oknem
        row({ startDate: "2026-07-22", orderStatus: "reserved" }), // wczoraj
      ],
      TODAY,
    );
    expect(stats.toDispatch.count).toBe(2);
  });

  it("liczy tylko statusy przed wydaniem — wydane/zwrócone/anulowane nie czekają", () => {
    const stats = computeOrderStats(
      [
        row({ startDate: TODAY, orderStatus: "picked_up" }),
        row({ startDate: TODAY, orderStatus: "returned" }),
        row({ startDate: TODAY, orderStatus: "cancelled" }),
        row({ startDate: TODAY, orderStatus: "pending" }),
      ],
      TODAY,
    );
    expect(stats.toDispatch.count).toBe(1);
  });
});

describe("computeOrderStats — kafel W wynajmie (sprzęt u klientów)", () => {
  it("liczy wyłącznie zamówienia wydane (picked_up)", () => {
    const stats = computeOrderStats(
      [
        row({ orderStatus: "picked_up" }),
        row({ orderStatus: "picked_up" }),
        row({ orderStatus: "reserved" }),
      ],
      TODAY,
    );
    expect(stats.inRental.count).toBe(2);
  });
});

describe("computeOrderStats — kafel Do zapłaty (zaległa należność)", () => {
  it("sumuje nieopłacone i z odrzuconą płatnością, pomija opłacone/zwrócone", () => {
    const stats = computeOrderStats(
      [
        row({ paymentStatus: "unpaid", totalRentalGrosze: 300_00 }),
        row({ paymentStatus: "payment_failed", totalRentalGrosze: 200_00 }),
        row({ paymentStatus: "paid", totalRentalGrosze: 999_00 }),
        row({ paymentStatus: "pending", totalRentalGrosze: 999_00 }),
        row({ paymentStatus: "refunded", totalRentalGrosze: 999_00 }),
      ],
      TODAY,
    );
    expect(stats.outstanding.count).toBe(2);
    expect(stats.outstanding.sumGrosze).toBe(500_00);
  });
});
