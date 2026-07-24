import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type ShipmentStatus,
} from "@avably/core";
import { statusSemantics } from "@avably/ui";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * Kontrakt renderu listy zamówień (ADR-057).
 *
 * Skan źródeł (`order-status-tone-contract.test.ts`) broni sposobu pisania,
 * ten test broni WYNIKU: dla każdej wartości obu osi chip wyrenderowany przez
 * ekran musi mieć `data-tone` równy `statusSemantics[oś][wartość]`. Lokalna
 * podmiana mapowania w ekranie (nawet bez literału `tone=`) pali tutaj.
 *
 * Render jak w P3 — `renderToStaticMarkup`, bo suita panelu chodzi w node bez
 * testing-library. `Link` z next-intl podmieniamy na zwykłą kotwicę, żeby nie
 * ciągnąć routera do renderu statycznego.
 */

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/zamowienia",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { OrdersTable } = await import("@/app/[locale]/(panel)/zamowienia/orders-table");
const { OrdersStats } = await import("@/app/[locale]/(panel)/zamowienia/orders-stats");
const { OrdersToolbar } = await import("@/app/[locale]/(panel)/zamowienia/orders-toolbar");
const { OrderStatusAxes } = await import(
  "@/app/[locale]/(panel)/zamowienia/[id]/order-status-axes"
);

/**
 * Fixture pokrywa OBIE osie w całości: tyle wierszy, ile ma dłuższa oś, a
 * krótsza (zamówienia) zawija się modulo — każda wartość pojawia się co
 * najmniej raz, łącznie z `cancelled` po obu stronach.
 */
const rows = PAYMENT_STATUSES.map((paymentStatus, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  orderNumber: `ZAM/2026/07${index}`,
  customerLabel: `Klient ${index}`,
  customerName: `Klient ${index}`,
  customerEmail: `klient${index}@example.com`,
  equipment: ["Nagrzewnica 20 kW"],
  startDate: "2026-07-20",
  endDate: "2026-07-22",
  orderStatus: ORDER_STATUSES[index % ORDER_STATUSES.length]!,
  paymentStatus,
  totalRentalGrosze: 119900,
}));

/** Efektywny sort domyślny (najnowsze po „#") — dla nagłówków i aria-sort. */
const sort = { key: "numer", dir: "desc" } as const;
const baseParams = { q: "szlifierka", status: "reserved" };

const html = renderToStaticMarkup(
  <NextIntlClientProvider locale="pl" messages={messages}>
    <OrdersTable rows={rows} currency="PLN" locale="pl" sort={sort} baseParams={baseParams} />
  </NextIntlClientProvider>,
);

/** Znacznik chipa danej osi i wartości — z całym zestawem atrybutów. */
function chipTag(axis: string, value: string): string | undefined {
  return html.match(
    new RegExp(`<span[^>]*data-status-axis="${axis}"[^>]*data-status-value="${value}"[^>]*>`),
  )?.[0];
}

describe("kontrakt renderu listy zamówień", () => {
  it("wiersze fixture pokrywają wszystkie wartości obu osi", () => {
    // Kontrola po pustym zbiorze: bez niej pętle niżej mogłyby nie sprawdzić
    // żadnej wartości i wciąż być zielone.
    expect(new Set(rows.map((row) => row.orderStatus)).size).toBe(ORDER_STATUSES.length);
    expect(new Set(rows.map((row) => row.paymentStatus)).size).toBe(PAYMENT_STATUSES.length);
    expect(ORDER_STATUSES).toContain("cancelled");
    expect(PAYMENT_STATUSES).toContain("cancelled");
  });

  it("każdy chip osi zamówienia niesie ton ze statusSemantics", () => {
    for (const status of ORDER_STATUSES) {
      const tag = chipTag("order", status);
      expect(tag, `brak chipa order/${status}`).toBeDefined();
      expect(tag, `order/${status}`).toContain(`data-tone="${statusSemantics.order[status]}"`);
    }
  });

  it("każdy chip osi płatności niesie ton ze statusSemantics", () => {
    for (const status of PAYMENT_STATUSES) {
      const tag = chipTag("payment", status);
      expect(tag, `brak chipa payment/${status}`).toBeDefined();
      expect(tag, `payment/${status}`).toContain(`data-tone="${statusSemantics.payment[status]}"`);
    }
  });

  it("każdy chip niesie tekst etykiety, nie sam kolor", () => {
    // Twardy zakaz `color-only-status` z artefaktu: status bez tekstu znika
    // dla daltonisty i dla czytnika ekranu.
    for (const [axis, values] of Object.entries({
      order: ORDER_STATUSES,
      payment: PAYMENT_STATUSES,
    })) {
      for (const value of values) {
        const label = (messages.orders.statusLabels as Record<string, Record<string, string>>)[
          axis
        ]![value]!;
        expect(html, `${axis}/${value}`).toContain(`>${label}</span>`);
      }
    }
  });

  it("kolumny i akcje wiersza są zgodne z sekcją 04 artefaktu", () => {
    for (const column of [
      messages.orders.list.colId,
      messages.orders.list.colCustomer,
      messages.orders.list.colEquipment,
      messages.orders.list.colTerm,
      messages.orders.list.colAmount,
      messages.orders.list.colOrderStatus,
      messages.orders.list.colPaymentStatus,
      messages.orders.list.colActions,
    ]) {
      expect(html).toContain(column);
    }

    // Trigger akcji jest ikoniczny — etykieta musi zostać w aria-label,
    // z numerem zamówienia, żeby nie było dwunastu identycznych „•••".
    const triggers = [...html.matchAll(/aria-label="Działania dla ([^"]+)"/g)];
    expect(triggers).toHaveLength(rows.length);
    expect(triggers.map((match) => match[1])).toEqual(rows.map((row) => row.orderNumber));
  });
});

/* ── Nagłówek: cztery kafle statystyk (U1) ─────────────────────────────── */

const statsHtml = renderToStaticMarkup(
  <NextIntlClientProvider locale="pl" messages={messages}>
    <OrdersStats
      stats={{
        all: { count: 12, sumGrosze: 3_624_700 },
        toDispatch: { count: 2, sumGrosze: 0 },
        inRental: { count: 3, sumGrosze: 0 },
        outstanding: { count: 1, sumGrosze: 129_900 },
      }}
      currency="PLN"
      locale="pl"
    />
  </NextIntlClientProvider>,
);

describe("kontrakt nagłówka: cztery kafle statystyk (U1)", () => {
  it("renderuje komplet czterech kafli z etykietami", () => {
    for (const stat of ["all", "to-dispatch", "in-rental", "outstanding"]) {
      expect(statsHtml, stat).toContain(`data-order-stat="${stat}"`);
    }
    expect(statsHtml).toContain(messages.orders.list.statAllLabel);
    expect(statsHtml).toContain(messages.orders.list.statToDispatchLabel);
    expect(statsHtml).toContain(messages.orders.list.statInRentalLabel);
    expect(statsHtml).toContain(messages.orders.list.statOutstandingLabel);
  });

  it("kwota zaległa idzie akcentem ostrzegawczym z tokenów, nie własnym hexem", () => {
    // „Do zapłaty" jako jedyny kafel niesie ton attention; brak hexa w klasach.
    expect(statsHtml).toContain("text-status-attention-fg");
    expect(statsHtml).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

/* ── Belka: wyszukiwarka, szybkie zakresy, zaawansowane (U1) ────────────── */

const toolbarHtml = renderToStaticMarkup(
  <NextIntlClientProvider locale="pl" messages={messages}>
    <OrdersToolbar filter={{ q: "szlifierka", preset: "biezacy-miesiac" }} customers={[]} resultCount={7} />
  </NextIntlClientProvider>,
);

describe("kontrakt belki: wyszukiwarka i szybkie filtry (U1)", () => {
  it("ma pole wyszukiwarki z placeholderem i licznik wyników", () => {
    expect(toolbarHtml).toContain("data-orders-search");
    expect(toolbarHtml).toContain(messages.orders.list.searchPlaceholder);
    expect(toolbarHtml).toContain("data-orders-result-count");
    expect(toolbarHtml).toContain("7 wyników");
  });

  it("wystawia trzy szybkie zakresy terminu i sekcję zaawansowaną", () => {
    expect(toolbarHtml).toContain(messages.orders.list.presetThisMonth);
    expect(toolbarHtml).toContain(messages.orders.list.presetNextMonth);
    expect(toolbarHtml).toContain(messages.orders.list.presetNext14);
    expect(toolbarHtml).toContain(messages.orders.list.advancedFilters);
  });
});

/* ── Tabela: sortowalne nagłówki (U2) ──────────────────────────────────── */

describe("kontrakt tabeli: sortowalne nagłówki (U2)", () => {
  it("sześć nagłówków sortu niesie klucz i parametr sort w href", () => {
    for (const key of ["numer", "klient", "termin", "kwota", "status", "platnosc"]) {
      const link = html.match(new RegExp(`<a[^>]*data-sort-key="${key}"[^>]*>`))?.[0];
      expect(link, `brak nagłówka sortu ${key}`).toBeDefined();
      expect(link, key).toMatch(new RegExp(`href="[^"]*sort=${key}[^"]*"`));
    }
    const keys = [...html.matchAll(/data-sort-key="([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toHaveLength(6);
  });

  it("dokładnie jedna kolumna jest aktywna (aria-sort), pozostałe none", () => {
    const ariaSorts = [...html.matchAll(/aria-sort="([^"]+)"/g)].map((m) => m[1]);
    // Domyślny sort to „#" malejąco (najnowsze): jedna descending, pięć none.
    expect(ariaSorts.filter((a) => a === "descending")).toHaveLength(1);
    expect(ariaSorts.filter((a) => a === "none")).toHaveLength(5);
  });
});

/* ── Tabela: wiersz-link i widok mobilny (U3) ──────────────────────────── */

describe("kontrakt tabeli: wiersz-link i karty mobilne (U3)", () => {
  it("każdy wiersz ma rozciągnięty link do szczegółu, nie tylko komórkę ID", () => {
    const rowLinks = [...html.matchAll(/<a[^>]*data-row-link[^>]*>/g)];
    expect(rowLinks).toHaveLength(rows.length);
    for (const row of rows) {
      expect(html).toContain(`href="/zamowienia/${row.id}"`);
    }
  });

  it("rozciągnięcie idzie pseudo-elementem (after:inset-0), a nie klikiem JS", () => {
    const link = html.match(/<a[^>]*data-row-link[^>]*>/)?.[0] ?? "";
    expect(link).toContain("after:inset-0");
  });

  it("kolumna Akcje wychodzi ponad nakładkę (relative z-10), by menu działało", () => {
    const cell = html.match(/<td[^>]*data-cell="actions"[^>]*>/)?.[0] ?? "";
    expect(cell).toContain("z-10");
  });

  it("na mobile każdy wiersz to osobna karta prowadząca do szczegółu", () => {
    const cards = [...html.matchAll(/data-order-card/g)];
    expect(cards).toHaveLength(rows.length);
  });
});

/**
 * Trzecia oś statusu (wysyłka) żyje WYŁĄCZNIE na szczególe zamówienia, którego
 * kontrakt renderu listy nie dotyka — bez tego bloku `shipment` byłoby jedyną
 * osią bez strażnika wyniku (luka znaleziona przy recenzji PR #88).
 *
 * Szczegół jest asynchronicznym server componentem z odczytami z Supabase,
 * więc renderujemy wydzielony z niego rząd chipów: to ten sam kod, który
 * maluje osie na ekranie.
 */
const SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  "created",
  "in_progress",
  "in_transit",
  "delivered",
  "cancelled",
  "returned_to_sender",
];

function renderAxes(shipmentStatus: ShipmentStatus | null): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <OrderStatusAxes
        orderStatus="picked_up"
        paymentStatus="paid"
        shipmentStatus={shipmentStatus}
      />
    </NextIntlClientProvider>,
  );
}

describe("kontrakt renderu osi statusów na szczególe", () => {
  it("fixture pokrywa wszystkie wartości osi wysyłki", () => {
    // Podłoga po pustym zbiorze ORAZ pin na komplet: oś dopisana w
    // statusSemantics bez dopisania tutaj zostawiłaby dziurę w dowodzie.
    expect(SHIPMENT_STATUSES).toHaveLength(6);
    expect([...SHIPMENT_STATUSES].sort()).toEqual(
      Object.keys(statusSemantics.shipment).sort(),
    );
  });

  it("każdy chip osi wysyłki niesie ton ze statusSemantics", () => {
    for (const status of SHIPMENT_STATUSES) {
      const html = renderAxes(status);
      const tag = html.match(
        new RegExp(`<span[^>]*data-status-axis="shipment"[^>]*data-status-value="${status}"[^>]*>`),
      )?.[0];

      expect(tag, `brak chipa shipment/${status}`).toBeDefined();
      expect(tag, `shipment/${status}`).toContain(
        `data-tone="${statusSemantics.shipment[status]}"`,
      );
      expect(html, `etykieta shipment/${status}`).toContain(
        `>${messages.orders.statusLabels.shipment[status]}</span>`,
      );
    }
  });

  it("zamówienie bez przesyłki nie dostaje trzeciej osi", () => {
    const html = renderAxes(null);

    // Chip wysyłki bez przesyłki byłby zmyśleniem stanu, którego nie ma.
    expect(html).not.toContain('data-status-axis="shipment"');
    // …ale dwie pozostałe osie muszą zostać, inaczej test wyżej niczego nie pilnuje.
    expect(html).toContain('data-status-axis="order"');
    expect(html).toContain('data-status-axis="payment"');
  });
});
