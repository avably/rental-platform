import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * Kontrakt zwijanego sidebara (uwaga przeglądu właściciela 2026-07-23).
 *
 * Powłoka ma DWA stany i test broni OBU, bo cały sens zmiany leży w różnicy
 * między nimi:
 *  • ROZWINIĘTY — ikona + etykieta tekstowa (`data-nav-label`), nagłówki grup,
 *    badge zapowiedzi; jak przed zmianą.
 *  • ZWINIĘTY — sam pasek ikon: etykieta znika z przepływu (`data-nav-label`
 *    NIEOBECNE), a nazwa przenosi się do `aria-label` linku i wizualnego
 *    tooltipa (`data-nav-tooltip`). Aktywna pozycja W OBU stanach niesie
 *    `aria-current="page"` i `bg-accent` — „tu stoisz" nie może zniknąć razem
 *    z etykietą.
 *
 * Render `renderToStaticMarkup` (środowisko `node`, jak reszta suity powłoki):
 * `SidebarNav`/`SidebarToggle` czytają stan zewnętrzny hookiem, ale przyjmują
 * `collapsed` propem, więc test steruje stanem bez `document`.
 */

const pathname = vi.hoisted(() => ({ current: "/zamowienia" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { SidebarNav, PANEL_NAV_ID } = await import("@/components/shell/sidebar-nav");
const { SidebarToggle } = await import("@/components/shell/sidebar-toggle");
const { NAV_ICON_STROKE_WIDTH } = await import("@/components/shell/nav-icons");
const { PANEL_NAV_ITEMS } = await import("@/lib/shell/nav");

function renderNav(collapsed: boolean, path = "/zamowienia"): string {
  pathname.current = path;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <SidebarNav collapsed={collapsed} />
    </NextIntlClientProvider>,
  );
}

function renderToggle(collapsed: boolean): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <SidebarToggle collapsed={collapsed} />
    </NextIntlClientProvider>,
  );
}

/** Wycinek HTML pojedynczego znacznika `<a …>` z podanym data-nav-item. */
function anchorFor(html: string, id: string): string {
  const match = html.match(new RegExp(`<a[^>]*data-nav-item="${id}"[^>]*>`));
  expect(match, `brak pozycji ${id}`).not.toBeNull();
  return match![0];
}

describe("kontrakt sidebara — stan ROZWINIĘTY", () => {
  const html = renderNav(false);

  it("każda pozycja niesie etykietę tekstową, nagłówki grup i badge są widoczne", () => {
    expect(PANEL_NAV_ITEMS.length).toBeGreaterThan(5); // podłoga: pusta lista nie chroni pętli
    for (const item of PANEL_NAV_ITEMS) {
      anchorFor(html, item.id);
    }
    expect(html).toContain("data-nav-label");
    expect(html).toContain(messages.nav.groupSales);
    expect(html).toContain(messages.nav.comingSoon);
  });

  it("nie renderuje tooltipów — etykieta stoi w przepływie, nie w dymku", () => {
    expect(html).not.toContain("data-nav-tooltip");
    expect(html).not.toContain('role="tooltip"');
  });
});

describe("kontrakt sidebara — stan ZWINIĘTY", () => {
  const html = renderNav(true);

  it("pokazuje ikony BEZ etykiety tekstowej w przepływie", () => {
    // Sedno zwinięcia: znika widoczna etykieta i nagłówki grup, znika badge.
    expect(html).not.toContain("data-nav-label");
    expect(html).not.toContain(messages.nav.groupSales);
    expect(html).not.toContain(messages.nav.comingSoon);
  });

  it("nazwę pozycji niesie aria-label ORAZ dostępny tooltip", () => {
    for (const item of PANEL_NAV_ITEMS) {
      const label = messages.nav[item.labelKey as keyof typeof messages.nav];
      const anchor = anchorFor(html, item.id);
      expect(anchor, `pozycja ${item.id} bez aria-label`).toContain(`aria-label="${label}"`);
    }
    // Tooltip jest realnym węzłem (rola + marker), nie samym atrybutem title.
    const tooltips = [...html.matchAll(/data-nav-tooltip/g)];
    expect(tooltips.length).toBe(PANEL_NAV_ITEMS.length + 1); // + zapowiedź
    expect(html).toContain('role="tooltip"');
    expect(html).not.toContain('title="');
    // Zapowiedź dashboardu też dostaje dostępną nazwę.
    expect(html).toContain(`aria-label="${messages.nav.dashboard}"`);
  });

  it("ikony pozostają dekoracyjne, po jednej na pozycję i zapowiedź", () => {
    const icons = [...html.matchAll(/<svg[^>]*>/g)].map((m) => m[0]);
    expect(icons).toHaveLength(PANEL_NAV_ITEMS.length + 1);
    for (const icon of icons) {
      expect(icon).toContain('aria-hidden="true"');
      expect(icon).toContain(`stroke-width="${NAV_ICON_STROKE_WIDTH}"`);
    }
  });
});

describe("kontrakt sidebara — aktywna pozycja w OBU stanach", () => {
  it("aktywna trasa niesie aria-current i bg-accent niezależnie od zwinięcia", () => {
    for (const collapsed of [false, true]) {
      const html = renderNav(collapsed);
      const stan = collapsed ? "zwinięty" : "rozwinięty";
      expect([...html.matchAll(/aria-current="page"/g)], stan).toHaveLength(1);
      const orders = anchorFor(html, "orders");
      expect(orders, `${stan}: brak aria-current`).toContain('aria-current="page"');
      expect(orders, `${stan}: brak bg-accent`).toContain("bg-accent");
      expect(anchorFor(html, "catalog"), stan).not.toContain("aria-current");
    }
  });
});

describe("kontrakt przełącznika zwijania", () => {
  it("rozwinięty: aria-expanded=true, celuje w nawigację, etykieta = zwiń", () => {
    const html = renderToggle(false);
    expect(html).toContain("data-sidebar-toggle");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(`aria-controls="${PANEL_NAV_ID}"`);
    expect(html).toContain(`aria-label="${messages.nav.sidebarCollapse}"`);
  });

  it("zwinięty: aria-expanded=false, etykieta = rozwiń", () => {
    const html = renderToggle(true);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`aria-label="${messages.nav.sidebarExpand}"`);
  });
});
