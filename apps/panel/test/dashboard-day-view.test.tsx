/**
 * Kontrakt renderu kafli „Dzisiaj" (UX1, ADR-140) — reguły zawartości kafla
 * ze spec-u, przypięte na fixture bez Supabase (wzorzec
 * dashboard-view-contract.test.tsx):
 *
 *  1. MAKS. 3 POZYCJE — nawet gdy warstwa I/O odda więcej wierszy, kafel
 *     tnie do trzech (obrona w głąb wobec limitu bazy).
 *  2. KAFLE NIGDY NIE ZNIKAJĄ — pięć kafli w stałej kolejności również przy
 *     kompletnym zerze.
 *  3. STAN ZEROWY — licznik „0" wyszarzony, zdanie stanu zamiast pozycji,
 *     BEZ linku „Zobacz wszystkie" (klik-wydmuszka do pustej listy).
 *  4. KOLOR TYLKO PRZY N>0 i tylko dla wyjątków: bursztyn („Po terminie"),
 *     czerwień („Alarmy pieniężne"); kafle rutyny neutralne przy każdym N.
 *  5. LINKI — pozycja do /zamowienia/{UUID} (bez danych osobowych w URL),
 *     „Zobacz wszystkie (N)" do listy z filtrem `dzien` o tej samej
 *     definicji zbioru; licznik w etykiecie = kind_total.
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

const { DashboardDaySection, DAY_TILE_ITEM_LIMIT } = await import(
  "@/app/[locale]/(panel)/dashboard-day"
);

const TODAY = "2026-08-11";

function renderDay(rows: DashboardDayRow[]): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <DashboardDaySection rows={rows} today={TODAY} locale="pl" />
    </NextIntlClientProvider>,
  );
}

function dayRow(overrides: Partial<DashboardDayRow>): DashboardDayRow {
  return {
    kind: "pickup_today",
    kind_total: 1,
    item_position: 1,
    order_id: "00000000-0000-4000-8000-000000000401",
    order_number: "AV-2026-001",
    customer_name: "Anna Alfa",
    start_date: TODAY,
    end_date: TODAY,
    amount_grosze: 53_400,
    currency_code: "PLN",
    payment_status: "manual",
    unit_missing: false,
    item_kind: null,
    ...overrides,
  };
}

/** Wycinek HTML jednego kafla (od data-dashboard-day-tile do następnego). */
function tileHtml(html: string, kind: string): string {
  const start = html.indexOf(`data-dashboard-day-tile="${kind}"`);
  expect(start, `brak kafla ${kind}`).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const next = rest.indexOf("data-dashboard-day-tile=", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

const KINDS = [
  "pickup_today",
  "return_today",
  "overdue",
  "prepare_tomorrow",
  "money_alert",
] as const;

describe("siatka dnia — stałość i kolejność kafli", () => {
  it("pięć kafli renderuje się ZAWSZE, także przy kompletnym zerze, w stałej kolejności", () => {
    const html = renderDay([]);
    const positions = KINDS.map((kind) =>
      html.indexOf(`data-dashboard-day-tile="${kind}"`),
    );
    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Nagłówek dnia mówi datę.
    expect(html).toContain("Dzisiaj, ");
  });
});

describe("reguła maks. 3 pozycji", () => {
  it("kafel tnie pozycje do trzech nawet przy większym wejściu; licznik mówi CAŁY zbiór", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      dayRow({
        kind_total: 7,
        item_position: i + 1,
        order_id: `00000000-0000-4000-8000-00000000041${i}`,
        order_number: `AV-2026-01${i}`,
      }),
    );
    const html = tileHtml(renderDay(rows), "pickup_today");

    expect(DAY_TILE_ITEM_LIMIT).toBe(3);
    expect(html.match(/data-day-item="pickup_today"/g)).toHaveLength(3);
    // Licznik kafla i licznik „Zobacz wszystkie" = kind_total (7), nie 3 i nie 5.
    expect(html).toContain('data-day-count="7"');
    expect(html).toContain("Zobacz wszystkie (7)");
  });
});

describe("stan zerowy kafla", () => {
  it("zdanie stanu zamiast pozycji, licznik wyszarzony, BEZ linku „Zobacz wszystkie”", () => {
    const html = tileHtml(renderDay([]), "pickup_today");

    expect(html).toContain("Nic do wydania dziś.");
    expect(html).toContain('data-day-empty="true"');
    expect(html).not.toContain("data-day-see-all");
    expect(html).not.toContain("data-day-item");
    // Wyszarzenie licznika „0" (token muted na liczniku).
    const counter = html.match(/<span[^>]*data-day-counter[^>]*>/);
    expect(counter?.[0]).toContain("text-muted-foreground");
  });

  it("zdania stanu są per kafel (mówią prawdę o rodzaju, nie ogólnik)", () => {
    const html = renderDay([]);
    expect(html).toContain("Nic do zwrotu dziś.");
    expect(html).toContain("Nic po terminie.");
    expect(html).toContain("Nic do przygotowania na jutro.");
    expect(html).toContain("Brak alarmów.");
  });
});

describe("kolor wyłącznie dla wyjątków i tylko przy N>0", () => {
  it("„Po terminie” barwi licznik bursztynem, „Alarmy pieniężne” czerwienią — przy N>0", () => {
    const html = renderDay([
      dayRow({ kind: "overdue", kind_total: 2, order_id: "00000000-0000-4000-8000-000000000420", end_date: "2026-08-08" }),
      dayRow({
        kind: "money_alert",
        kind_total: 1,
        order_id: "00000000-0000-4000-8000-000000000421",
        item_kind: "deposit_unsettled",
        payment_status: "completed",
      }),
    ]);

    const overdue = tileHtml(html, "overdue");
    const money = tileHtml(html, "money_alert");
    expect(overdue.match(/<span[^>]*data-day-counter[^>]*>/)?.[0]).toContain(
      "text-status-attention-fg",
    );
    expect(money.match(/<span[^>]*data-day-counter[^>]*>/)?.[0]).toContain(
      "text-status-problem-fg",
    );
  });

  it("przy N=0 kolor wyjątków GAŚNIE, a kafle rutyny są neutralne przy każdym N", () => {
    const html = renderDay([
      // Rutyna pod obciążeniem: 7 wydań to obciążenie dnia, nie problem.
      dayRow({ kind_total: 7 }),
    ]);

    const overdue = tileHtml(html, "overdue");
    const money = tileHtml(html, "money_alert");
    const pickup = tileHtml(html, "pickup_today");
    expect(overdue.match(/<span[^>]*data-day-counter[^>]*>/)?.[0]).not.toContain(
      "text-status-attention-fg",
    );
    expect(money.match(/<span[^>]*data-day-counter[^>]*>/)?.[0]).not.toContain(
      "text-status-problem-fg",
    );
    expect(pickup.match(/<span[^>]*data-day-counter[^>]*>/)?.[0]).not.toContain(
      "text-status-attention-fg",
    );
    expect(pickup.match(/<span[^>]*data-day-counter[^>]*>/)?.[0]).not.toContain(
      "text-status-problem-fg",
    );
  });
});

describe("linki kafla", () => {
  it("pozycja prowadzi do szczegółu po UUID (bez danych osobowych w URL), „Zobacz wszystkie” do listy z filtrem dnia", () => {
    const html = renderDay([
      dayRow({ kind_total: 4 }),
      dayRow({
        kind: "overdue",
        kind_total: 1,
        order_id: "00000000-0000-4000-8000-000000000430",
        end_date: "2026-08-08",
      }),
    ]);

    expect(html).toContain('href="/zamowienia/00000000-0000-4000-8000-000000000401"');
    expect(html).toContain('href="/zamowienia?dzien=wydania-dzis"');
    expect(html).toContain('href="/zamowienia?dzien=po-terminie"');
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.every((href) => !href.includes("Anna") && !href.includes("Alfa"))).toBe(
      true,
    );
  });

  it("treść pozycji per rodzaj: badge płatności i braku egzemplarza, saldo kaucji, dni po terminie, etykieta alarmu", () => {
    const html = renderDay([
      dayRow({ payment_status: "manual", unit_missing: true }),
      dayRow({
        kind: "return_today",
        order_id: "00000000-0000-4000-8000-000000000440",
        amount_grosze: 30_000,
        payment_status: "paid",
      }),
      dayRow({
        kind: "overdue",
        order_id: "00000000-0000-4000-8000-000000000441",
        end_date: "2026-08-08",
        payment_status: "paid",
      }),
      dayRow({
        kind: "money_alert",
        order_id: "00000000-0000-4000-8000-000000000442",
        item_kind: "payment_failed",
        payment_status: "payment_failed",
        amount_grosze: 120_000,
      }),
    ]);

    // Wydania: status płatności ze słownika statusów + chip braku egzemplarza.
    expect(tileHtml(html, "pickup_today")).toContain('data-status-value="manual"');
    expect(tileHtml(html, "pickup_today")).toContain("Egzemplarz nieprzypisany");
    // Zwroty: otwarte saldo kaucji jako zdanie kwotowe.
    expect(tileHtml(html, "return_today")).toContain("kaucja do rozliczenia");
    // Po terminie: liczba dni (2026-08-08 → 3 dni przy TODAY 2026-08-11).
    expect(tileHtml(html, "overdue")).toContain("3 dni po terminie");
    // Alarmy: etykieta rodzaju sprawy.
    expect(tileHtml(html, "money_alert")).toContain("Nieudana płatność");
  });
});
