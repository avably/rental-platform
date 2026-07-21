import { ORDER_STATUSES, PAYMENT_STATUSES } from "@avably/core";
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

/**
 * Fixture pokrywa OBIE osie w całości: tyle wierszy, ile ma dłuższa oś, a
 * krótsza (zamówienia) zawija się modulo — każda wartość pojawia się co
 * najmniej raz, łącznie z `cancelled` po obu stronach.
 */
const rows = PAYMENT_STATUSES.map((paymentStatus, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  orderNumber: `ZAM/2026/07${index}`,
  customerLabel: `Klient ${index}`,
  equipment: ["Nagrzewnica 20 kW"],
  startDate: "2026-07-20",
  endDate: "2026-07-22",
  orderStatus: ORDER_STATUSES[index % ORDER_STATUSES.length]!,
  paymentStatus,
  totalRentalGrosze: 119900,
}));

const html = renderToStaticMarkup(
  <NextIntlClientProvider locale="pl" messages={messages}>
    <OrdersTable rows={rows} currency="PLN" locale="pl" />
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
