/**
 * Model przychodu dashboardu (C1, ADR-109) — czysta arytmetyka na fixture.
 *
 * Kontrakty:
 *  1. MULTIWALUTA: wiersze różnych walut NIGDY nie zlewają się w jedną sumę
 *     — każda waluta dostaje własne podsumowanie, a dominującą wybiera
 *     przychód 12 miesięcy (nie kolejność wierszy).
 *  2. OKNA: bieżący i poprzedni miesiąc czytane z „dziś” operatora
 *     (YYYY-MM-DD z warsawToday), przełom roku liczony poprawnie.
 *  3. TREND: dokładnie N punktów, brakujące miesiące = 0 (oś czasu jest
 *     pełna, nie „tylko miesiące z danymi”).
 */
import { describe, expect, it } from "vitest";

import {
  addMonthsIso,
  buildRevenueSummaries,
  monthSequence,
  monthStartIso,
} from "@/lib/dashboard/revenue-model";
import type { DashboardRevenueRow } from "@/lib/dashboard/queries";

const row = (
  month: string,
  currency: string,
  rental: number,
  delivery = 0,
  orders = 1,
): DashboardRevenueRow => ({
  month_start: month,
  currency_code: currency,
  rental_grosze: rental,
  delivery_grosze: delivery,
  orders_count: orders,
});

describe("arytmetyka miesięcy (bez Date, bez stref)", () => {
  it("monthStartIso zwraca pierwszy dzień miesiąca", () => {
    expect(monthStartIso("2026-08-08")).toBe("2026-08-01");
  });

  it("addMonthsIso przechodzi przełom roku w obie strony", () => {
    expect(addMonthsIso("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonthsIso("2025-12-01", 1)).toBe("2026-01-01");
    expect(addMonthsIso("2026-08-01", -12)).toBe("2025-08-01");
  });

  it("monthSequence daje pełną, rosnącą oś kończącą się miesiącem „dziś”", () => {
    expect(monthSequence("2026-02-15", 3)).toEqual([
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
  });
});

describe("buildRevenueSummaries", () => {
  it("liczy kafle: bieżący miesiąc, poprzedni, 12 miesięcy — najem + dostawa", () => {
    const rows = [
      row("2026-08-01", "PLN", 30_000, 1_500, 2),
      row("2026-07-01", "PLN", 70_000, 2_000, 3),
      row("2025-09-01", "PLN", 5_000, 0, 1),
    ];
    const [pln] = buildRevenueSummaries(rows, "2026-08-08");

    expect(pln).toMatchObject({
      currency: "PLN",
      currentMonthGrosze: 31_500,
      currentMonthOrders: 2,
      previousMonthGrosze: 72_000,
      previousMonthOrders: 3,
      last12Grosze: 108_500,
      last12Orders: 6,
    });
  });

  it("MULTIWALUTA: osobne podsumowanie per waluta, dominującą wybiera przychód 12 mies., zero sumowania między walutami", () => {
    const rows = [
      row("2026-08-01", "PLN", 10_000),
      row("2026-08-01", "EUR", 50_000),
      row("2026-07-01", "PLN", 15_000),
    ];
    const summaries = buildRevenueSummaries(rows, "2026-08-08");

    expect(summaries.map((s) => s.currency)).toEqual(["EUR", "PLN"]);
    const eur = summaries[0]!;
    const pln = summaries[1]!;
    expect(eur.last12Grosze).toBe(50_000);
    expect(pln.last12Grosze).toBe(25_000);
    // Kontrola negatywna zmieszania walut: żadne podsumowanie nie równa się
    // sumie „wszystkiego” (75 000).
    expect(summaries.some((s) => s.last12Grosze === 75_000)).toBe(false);
  });

  it("TREND: pełna oś 12 punktów, miesiące bez danych = 0", () => {
    const rows = [row("2026-03-01", "PLN", 12_000)];
    const [pln] = buildRevenueSummaries(rows, "2026-08-08");

    expect(pln!.trend).toHaveLength(12);
    expect(pln!.trend[0]!.monthStart).toBe("2025-09-01");
    expect(pln!.trend[11]!.monthStart).toBe("2026-08-01");
    const march = pln!.trend.find((p) => p.monthStart === "2026-03-01");
    expect(march).toMatchObject({ totalGrosze: 12_000, ordersCount: 1 });
    expect(
      pln!.trend.filter((p) => p.monthStart !== "2026-03-01").every((p) => p.totalGrosze === 0),
    ).toBe(true);
  });

  it("brak wierszy = brak podsumowań (uczciwy pusty stan, nie zera udające dane)", () => {
    expect(buildRevenueSummaries([], "2026-08-08")).toEqual([]);
  });
});
