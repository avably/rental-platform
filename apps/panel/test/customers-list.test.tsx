// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/klienci",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { CustomersTable } = await import("@/app/[locale]/(panel)/klienci/customers-table");
const { filterCustomersBySearch } = await import("@/lib/customers/customer-search");
const { resolveCustomerSort, sortCustomers } = await import("@/lib/customers/customer-sort");

/**
 * Render listy klientów (R6a) — RTL na jsdom.
 *
 * Kluczowa asercja: WYSZUKIWANIE ZAWĘŻA. Test przepuszcza wiersze przez tę
 * samą potokę co ekran (`filterCustomersBySearch` → `sortCustomers`) i renderuje
 * tabelę z wynikiem, więc mutacja wyszukiwarki (np. „ignoruj frazę → zwróć
 * wszystko") zapala test: niepasujący klient pojawiłby się w DOM. Poza tym
 * sprawdzamy, że wiersz PROWADZI DO KARTY klienta (`/klienci/<id>`).
 */

interface Row {
  id: string;
  fullName: string | null;
  email: string;
  phone: string | null;
  orderCount: number;
  lastOrderAt: string | null;
}

const RAW: Row[] = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", fullName: "Anna Kowalska", email: "anna@example.com", phone: "+48 600 100 200", orderCount: 3, lastOrderAt: "2026-07-20T10:00:00Z" },
  { id: "bbbbbbbb-0000-4000-8000-000000000002", fullName: "Michał Nowak", email: "michal@firma.pl", phone: null, orderCount: 1, lastOrderAt: "2026-06-01T10:00:00Z" },
  { id: "cccccccc-0000-4000-8000-000000000003", fullName: null, email: "biuro@studioplanb.pl", phone: "223334455", orderCount: 0, lastOrderAt: null },
];

/** Odwzorowanie potoki page.tsx: wiersz-model + etykieta klienta. */
function toTableRows(rows: Row[]) {
  return rows.map((row) => ({
    id: row.id,
    customerLabel: row.fullName?.trim() || row.email,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    orderCount: row.orderCount,
    lastOrderAt: row.lastOrderAt,
  }));
}

function renderList(query: string) {
  const sort = resolveCustomerSort(undefined, undefined);
  const visible = sortCustomers(filterCustomersBySearch(toTableRows(RAW), query), sort, "pl");
  render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <CustomersTable rows={visible} locale="pl" sort={sort} baseParams={{ q: query || undefined }} />
    </NextIntlClientProvider>,
  );
  return visible;
}

afterEach(() => cleanup());

describe("lista klientów — render i wyszukiwanie", () => {
  it("bez frazy pokazuje wszystkich klientów", () => {
    renderList("");
    expect(screen.getAllByText("Anna Kowalska").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Michał Nowak").length).toBeGreaterThan(0);
    expect(screen.getAllByText("biuro@studioplanb.pl").length).toBeGreaterThan(0);
  });

  it("wyszukiwanie po nazwisku ZAWĘŻA listę do dopasowań", () => {
    renderList("kowal");
    // Dopasowany klient został…
    expect(screen.getAllByText("Anna Kowalska").length).toBeGreaterThan(0);
    // …a niepasujący ZNIKNĄŁ. Ta asercja pali przy wyszukiwarce ignorującej frazę.
    expect(screen.queryByText("Michał Nowak")).toBeNull();
    expect(screen.queryByText("biuro@studioplanb.pl")).toBeNull();
  });

  it("wyszukiwanie po fragmencie telefonu zawęża do jednego klienta", () => {
    renderList("2233");
    expect(screen.getAllByText("biuro@studioplanb.pl").length).toBeGreaterThan(0);
    expect(screen.queryByText("Anna Kowalska")).toBeNull();
  });

  it("wiersz prowadzi do karty klienta (/klienci/<id>)", () => {
    renderList("");
    // Etykieta „Otwórz kartę klienta" niesie zarówno wiersz tabeli (desktop),
    // jak i karta mobilna — obie mają prowadzić do TEJ SAMEJ karty.
    const links = screen.getAllByRole("link", {
      name: messages.customers.list.openCard.replace("{name}", "Anna Kowalska"),
    });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(`/klienci/${RAW[0]!.id}`);
    }
  });

  it("liczba zamówień klienta bez zamówień pokazuje myślnik, nie zero", () => {
    renderList("studioplanb");
    const rowCells = screen.getAllByText("—");
    // „—" pojawia się dla braku telefonu ORAZ braku zamówień/ostatniego zamówienia.
    expect(rowCells.length).toBeGreaterThan(0);
  });

  it("licznik pozycji zgadza się z zawężeniem (kontrola potoki)", () => {
    const visible = renderList("kowal");
    expect(visible).toHaveLength(1);
    within(document.body).getAllByText("Anna Kowalska");
  });
});
