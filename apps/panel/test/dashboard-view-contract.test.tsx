/**
 * Kontrakt renderu sekcji dashboardu (C1, ADR-109).
 *
 * Render jak w pozostałych kontraktach panelu — `renderToStaticMarkup` na
 * fixture, `Link` z next-intl podmieniony na kotwicę. Bronione WYNIKI:
 *  1. Kwoty formatowane WALUTĄ WIERSZA (ADR-103) — sekcja przychodu pokazuje
 *     kafle dominującej waluty i OSOBNY wiersz pozostałych; nigdzie nie
 *     pojawia się suma groszy dwóch walut.
 *  2. Pozycje „wymaga uwagi” linkują do /zamowienia/{UUID} — URL nie niesie
 *     nazwiska ani e-maila klienta (dane osobowe zostają w treści strony).
 *  3. Puste stany mówią wprost „brak danych” (data-dashboard-empty), zamiast
 *     zer udających metryki.
 *  4. Utilization: produkt bez egzemplarzy dostaje „brak egzemplarzy”,
 *     nie 0% (zero i „nie da się policzyć” to różne zdania).
 */
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { DashboardRevenueSection, DashboardUtilizationSection, DashboardAttentionSection, DashboardCustomersSection } =
  await import("@/app/[locale]/(panel)/dashboard-view");
const { buildRevenueSummaries } = await import("@/lib/dashboard/revenue-model");

function renderPl(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("sekcja przychodu", () => {
  const summaries = buildRevenueSummaries(
    [
      {
        month_start: "2026-08-01",
        currency_code: "PLN",
        rental_grosze: 30_000,
        delivery_grosze: 1_500,
        orders_count: 2,
      },
      {
        month_start: "2026-07-01",
        currency_code: "PLN",
        rental_grosze: 70_000,
        delivery_grosze: 2_000,
        orders_count: 3,
      },
      {
        month_start: "2026-08-01",
        currency_code: "EUR",
        rental_grosze: 12_345,
        delivery_grosze: 655,
        orders_count: 1,
      },
    ],
    "2026-08-08",
  );

  it("kafle niosą kwoty dominującej waluty, pozostałe waluty mają OSOBNY wiersz — zero sumy międzywalutowej", () => {
    const html = renderPl(<DashboardRevenueSection summaries={summaries} locale="pl" />);

    expect(html).toContain('data-dashboard-stat="current-month"');
    expect(html).toContain('data-dashboard-stat="previous-month"');
    expect(html).toContain('data-dashboard-stat="last-12-months"');
    // 315,00 zł (sierpień) i 1035,00 zł (12 mies. PLN).
    expect(html).toContain("315,00");
    expect(html).toContain("1035,00");
    // EUR osobno: 130,00 € w wierszu pozostałych walut.
    expect(html).toContain('data-dashboard-other-currency="EUR"');
    expect(html).toContain("130,00");
    // Kontrola negatywna: suma groszy PLN+EUR (103 500 + 13 000 = 116 500,
    // czyli „1165,00”) nie ma prawa pojawić się w żadnej walucie.
    expect(html).not.toContain("1165,00");
  });

  it("pełna oś trendu: 12 słupków z data-dashboard-trend-month", () => {
    const html = renderPl(<DashboardRevenueSection summaries={summaries} locale="pl" />);
    expect(html.match(/data-dashboard-trend-month=/g)).toHaveLength(12);
  });

  it("bez danych mówi wprost „brak danych w tym oknie”", () => {
    const html = renderPl(<DashboardRevenueSection summaries={[]} locale="pl" />);
    expect(html).toContain('data-dashboard-empty="true"');
    expect(html).toContain("Brak danych w tym oknie.");
  });
});

describe("sekcja wykorzystania sprzętu", () => {
  it("produkt bez egzemplarzy dostaje „brak egzemplarzy”, nie 0%", () => {
    const html = renderPl(
      <DashboardUtilizationSection
        locale="pl"
        rows={[
          {
            product_id: "00000000-0000-4000-8000-000000000101",
            product_name: "Koparka",
            product_active: true,
            unit_count: 2,
            busy_days: 16,
            window_days: 30,
            utilization_pct: 26.7,
          },
          {
            product_id: "00000000-0000-4000-8000-000000000102",
            product_name: "Młot",
            product_active: true,
            unit_count: 0,
            busy_days: 0,
            window_days: 30,
            utilization_pct: null,
          },
        ]}
      />,
    );

    expect(html).toContain("26,7% zajętości");
    expect(html).toContain("brak egzemplarzy");
    expect(html).toContain('href="/katalog/00000000-0000-4000-8000-000000000101"');
  });
});

describe("sekcja złotych klientów", () => {
  it("rankingi różnych walut są rozdzielone, kwoty w walucie wiersza", () => {
    const html = renderPl(
      <DashboardCustomersSection
        locale="pl"
        rows={[
          {
            customer_id: "00000000-0000-4000-8000-000000000201",
            customer_name: "Bartek Beta",
            currency_code: "PLN",
            revenue_grosze: 72_000,
            orders_count: 2,
            last_order_date: "2026-07-20",
            share_pct: 69.6,
          },
          {
            customer_id: "00000000-0000-4000-8000-000000000202",
            customer_name: "Celina Gamma",
            currency_code: "EUR",
            revenue_grosze: 13_000,
            orders_count: 1,
            last_order_date: "2026-08-07",
            share_pct: 100,
          },
        ]}
      />,
    );

    expect(html).toContain("Bartek Beta");
    expect(html).toContain("69,6% przychodu");
    expect(html).toContain('href="/klienci/00000000-0000-4000-8000-000000000201"');
    // Nagłówki walut rozdzielają rankingi.
    expect(html).toContain(">PLN<");
    expect(html).toContain(">EUR<");
  });
});

describe("sekcja „wymaga uwagi”", () => {
  const rows = [
    {
      kind: "overdue_return" as const,
      order_id: "00000000-0000-4000-8000-000000000301",
      order_number: "AV-2026-001",
      customer_name: "Anna Alfa",
      end_date: "2026-08-01",
      amount_grosze: 20_000,
      currency_code: "PLN",
    },
  ];

  it("pozycja linkuje po UUID zamówienia — URL bez danych osobowych", () => {
    const html = renderPl(<DashboardAttentionSection rows={rows} locale="pl" />);

    expect(html).toContain('href="/zamowienia/00000000-0000-4000-8000-000000000301"');
    expect(html).toContain('data-dashboard-attention="overdue_return"');
    // Nazwisko jest w TREŚCI, nie w URL.
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.every((href) => !href.includes("Anna") && !href.includes("Alfa"))).toBe(
      true,
    );
  });

  it("pusty stan jest pozytywny („nic nie wymaga uwagi”), nie udaje danych", () => {
    const html = renderPl(<DashboardAttentionSection rows={[]} locale="pl" />);
    expect(html).toContain("Nic nie wymaga uwagi.");
  });
});
