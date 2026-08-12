/**
 * KONTRAKT PRZYCHODU ZREALIZOWANEGO PRODUKTU (U8b, ADR-146) — czysta
 * arytmetyka na fixture, bez bazy.
 *
 * Ten test jest LUSTREM nagłówka migracji `0054_dashboard_aggregates.sql`.
 * Karta produktu i pulpit muszą liczyć przychód TĄ SAMĄ regułą; rozjazd
 * dałby operatorowi dwie różne kwoty pod jedną nazwą — pułapkę, którą dla
 * kafli pulpitu zamykał ADR-140. Każda asercja niżej sprawdza obie strony:
 * że coś się liczy ORAZ że coś innego się nie liczy.
 */
import { describe, expect, it } from "vitest";

import {
  REALIZED_PAYMENT_STATUSES,
  isRealizedRevenue,
  sumRevenueByCurrency,
  type RevenueItemRow,
} from "@/lib/catalog/product-revenue";

const item = (
  rental: number,
  payment: string,
  order = "returned",
  currency: string | null = "PLN",
): RevenueItemRow => ({
  rental_grosze: rental,
  orders: { payment_status: payment, order_status: order, currency },
});

describe("predykat przychodu zrealizowanego", () => {
  it("lista statusów płatności jest DOKŁADNIE tą z nagłówka 0054", () => {
    // Kontrakt przepisany co do litery — poszerzenie listy o `refunded` albo
    // `pending` musi przejść przez zmianę tego testu, czyli przez recenzję.
    expect([...REALIZED_PAYMENT_STATUSES]).toEqual([
      "paid",
      "manual",
      "completed",
      "deposit_refunded",
    ]);
  });

  it.each(["paid", "manual", "completed", "deposit_refunded"])(
    "%s liczy się do przychodu",
    (status) => {
      expect(isRealizedRevenue({ payment_status: status, order_status: "returned", currency: "PLN" })).toBe(
        true,
      );
    },
  );

  it.each(["unpaid", "pending", "payment_failed", "refunded", "cancelled"])(
    "%s NIE liczy się do przychodu",
    (status) => {
      expect(isRealizedRevenue({ payment_status: status, order_status: "returned", currency: "PLN" })).toBe(
        false,
      );
    },
  );

  it("zamówienie anulowane nie jest przychodem MIMO pobranej wpłaty", () => {
    // 0015 dopuszcza anulowanie zamówienia z rozliczoną płatnością, więc oś
    // płatności sama nie wystarcza. Bez drugiej połowy koniunkcji ta asercja
    // jest jedyną, która pali.
    expect(
      isRealizedRevenue({ payment_status: "paid", order_status: "cancelled", currency: "PLN" }),
    ).toBe(false);
  });

  it("pozycja bez zamówienia nie jest przychodem", () => {
    expect(isRealizedRevenue(null)).toBe(false);
  });
});

describe("sumowanie per waluta", () => {
  it("sumuje wyłącznie pozycje zrealizowane", () => {
    const buckets = sumRevenueByCurrency([
      item(10_000, "paid"),
      item(5_000, "manual"),
      item(90_000, "unpaid"),
      item(70_000, "paid", "cancelled"),
    ]);

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toEqual({ currency: "PLN", rentalGrosze: 15_000, itemCount: 2 });
  });

  it("NIGDY nie zlewa walut w jedną sumę", () => {
    const buckets = sumRevenueByCurrency([
      item(10_000, "paid", "returned", "PLN"),
      item(30_000, "paid", "returned", "EUR"),
      item(5_000, "completed", "returned", "PLN"),
    ]);

    // Dwa kubełki, nie jeden o wartości 45 000 — suma groszy różnych walut
    // nie istnieje (ADR-103).
    expect(buckets).toEqual([
      { currency: "EUR", rentalGrosze: 30_000, itemCount: 1 },
      { currency: "PLN", rentalGrosze: 15_000, itemCount: 2 },
    ]);
  });

  it("produkt bez przychodu oddaje PUSTĄ listę, nie zero w domyślnej walucie", () => {
    expect(sumRevenueByCurrency([])).toEqual([]);
    expect(sumRevenueByCurrency([item(90_000, "unpaid")])).toEqual([]);
  });

  it("nieznana waluta wiersza spada na domyślną, a nie wywraca sumy", () => {
    // Kolumna ma CHECK na podzbiór walut (0049), więc to higiena granicy
    // typów — ale wywrócony render karty byłby gorszy niż fallback.
    const buckets = sumRevenueByCurrency([item(10_000, "paid", "returned", null)]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.rentalGrosze).toBe(10_000);
  });

  it("kolejność jest deterministyczna: malejąco po kwocie", () => {
    const buckets = sumRevenueByCurrency([
      item(1_000, "paid", "returned", "PLN"),
      item(2_000, "paid", "returned", "EUR"),
    ]);
    expect(buckets.map((bucket) => bucket.currency)).toEqual(["EUR", "PLN"]);
  });
});
