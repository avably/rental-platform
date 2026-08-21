/**
 * Kontrakt hierarchii nagłówków — dashboard i eksport danych (M-A11Y-01,
 * audyt właściciela 17.08, ADR-193).
 *
 * PREMISA (ADR-060, pilnowana przez panel-consistency-contract): jedyny `h1`
 * ekranu niesie belka shella (`PanelTopbar` → `panelTitleKey`). Treść ekranu
 * zaczyna więc konspekt od `h2` — a oba audytowane ekrany zaczynały go od
 * `h3` (dashboard: karta startowa, sekcja „Dzisiaj", karty metryk; eksport:
 * trzy karty zbiorów), przeskakując poziom. Czytnik ekranu nawigujący po
 * nagłówkach dostawał dziurę w konspekcie.
 *
 * Bramka mierzy WYNIK (poziomy w wyrenderowanym HTML), nie tekst źródła:
 * sekwencja nagłówków treści ekranu, poprzedzona niejawnym `h1` belki, nie
 * może NIGDY rosnąć o więcej niż 1. Fixture'y są celowo w stanach, które
 * renderują KOMPLET nagłówków (kafle dnia stoją zawsze — spec UX1; karty
 * metryk mają nagłówek także w stanie pustym).
 */
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

import type { DashboardDayRow } from "@/lib/dashboard/queries";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { DashboardLaunchBanner } = await import(
  "@/app/[locale]/(panel)/dashboard-launch-banner"
);
const { DashboardDaySection } = await import("@/app/[locale]/(panel)/dashboard-day");
const {
  DashboardCustomersSection,
  DashboardRevenueSection,
  DashboardUtilizationSection,
} = await import("@/app/[locale]/(panel)/dashboard-view");
const { ExportView } = await import("@/app/[locale]/(panel)/eksport-danych/export-view");
const { buildRevenueSummaries } = await import("@/lib/dashboard/revenue-model");

function renderPl(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

/** Poziomy nagłówków w kolejności dokumentu — z HTML, nie ze źródła. */
function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
}

/**
 * Konspekt ekranu POD belką shella: sekwencja [1, ...poziomy treści] nie
 * rośnie nigdzie o więcej niż 1 (zejścia w dół są legalne). Wymusza też, że
 * treść nie dokłada własnego `h1` — drugi tytuł ekranu łamałby ADR-060.
 */
function expectSaneOutline(levels: number[]): void {
  // Kontrola po pustym zbiorze: bez tej podłogi ekran bez nagłówków
  // przechodziłby pętlę niżej na pusto.
  expect(levels.length, "ekran nie wyrenderował żadnego nagłówka").toBeGreaterThan(0);
  expect(levels, "treść ekranu nie może nieść drugiego h1").not.toContain(1);

  const outline = [1, ...levels];
  for (let i = 1; i < outline.length; i += 1) {
    expect(
      outline[i] - outline[i - 1],
      `przeskok poziomu nagłówka: h${outline[i - 1]} → h${outline[i]} (pozycja ${i} w ${JSON.stringify(outline)})`,
    ).toBeLessThanOrEqual(1);
  }
}

function dayRow(overrides: Partial<DashboardDayRow>): DashboardDayRow {
  return {
    kind: "pickup_today",
    kind_total: 1,
    item_position: 1,
    order_id: "00000000-0000-4000-8000-000000000401",
    order_number: "AV-2026-001",
    customer_name: "Anna Alfa",
    start_date: "2026-08-18",
    end_date: "2026-08-18",
    amount_grosze: 53_400,
    currency_code: "PLN",
    payment_status: "manual",
    unit_missing: false,
    item_kind: null,
    ...overrides,
  };
}

describe("hierarchia nagłówków — dashboard (M-A11Y-01)", () => {
  it("pełny układ pulpitu schodzi h2 → h3 bez przeskoków pod h1 belki", () => {
    // Ten sam skład i KOLEJNOŚĆ co DashboardSections: baner uruchomienia
    // (ADR-228), „Dzisiaj" (kafle stoją zawsze), przychód, wykorzystanie, klienci.
    const html = renderPl(
      <div>
        <DashboardLaunchBanner done={0} total={7} />
        <DashboardDaySection
          rows={[dayRow({})]}
          today="2026-08-18"
          locale="pl"
        />
        <DashboardRevenueSection
          summaries={buildRevenueSummaries([], "2026-08-18")}
          locale="pl"
        />
        <DashboardUtilizationSection rows={[]} locale="pl" />
        <DashboardCustomersSection rows={[]} locale="pl" />
      </div>,
    );

    const levels = headingLevels(html);
    // Podłoga liczności: karta startowa + sekcja dnia + 5 kafli + 3 karty
    // metryk = co najmniej 10 nagłówków. Gdyby fixture przestał renderować
    // sekcje, asercje hierarchii mierzyłyby pustkę.
    expect(levels.length).toBeGreaterThanOrEqual(10);
    expectSaneOutline(levels);
    // Audytowany defekt wprost: konspekt treści zaczyna się od h2, nie h3.
    expect(levels[0]).toBe(2);
  });

  it("kafle dnia to h3 pod h2 sekcji „Dzisiaj” — także w stanach zerowych", () => {
    const html = renderPl(
      <DashboardDaySection rows={[]} today="2026-08-18" locale="pl" />,
    );
    const levels = headingLevels(html);
    // Nagłówek sekcji + pięć kafli (kafle NIGDY nie znikają — spec UX1).
    expect(levels).toEqual([2, 3, 3, 3, 3, 3]);
  });
});

describe("hierarchia nagłówków — eksport danych (M-A11Y-01)", () => {
  it("trzy karty zbiorów to h2 pod h1 belki — bez przeskoku na h3", () => {
    const html = renderPl(<ExportView locale="pl" isOwner error={null} />);
    const levels = headingLevels(html);
    expect(levels).toEqual([2, 2, 2]);
    expectSaneOutline(levels);
  });

  it("wariant staff (bez formularza klientów) trzyma ten sam konspekt", () => {
    const html = renderPl(<ExportView locale="pl" isOwner={false} error={null} />);
    expect(headingLevels(html)).toEqual([2, 2, 2]);
  });
});

describe("strażnik samego strażnika", () => {
  it("expectSaneOutline NAPRAWDĘ pali przeskok h1→h3 (kontrola pozytywna)", () => {
    expect(() => expectSaneOutline([3])).toThrow(/przeskok poziomu/);
    expect(() => expectSaneOutline([2, 4])).toThrow(/przeskok poziomu/);
    expect(() => expectSaneOutline([])).toThrow(/żadnego nagłówka/);
    expect(() => expectSaneOutline([2, 3, 2, 3])).not.toThrow();
  });
});
