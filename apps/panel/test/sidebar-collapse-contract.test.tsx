import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * Kontrakt zwijanego sidebara (uwaga przeglądu właściciela 2026-07-23,
 * rozszerzony po uwagach M1/M2 z 2026-07-24).
 *
 * SEDNO PO NAPRAWIE M2: powłoka ma dwa STANY, ale JEDEN RENDER. Stan zwinięcia
 * mieszka w `localStorage` i trafia na `<html data-sidebar>` przez skrypt
 * startowy — PRZED pierwszym malowaniem. Serwer tej wartości nie zna, więc
 * cokolwiek wybiera GAŁĄŹ REACTA, maluje się w wariancie rozwiniętym na już
 * zwężonym pasku i znika dopiero po hydracji. To był skok przy ładowaniu.
 *
 * Dlatego test broni MECHANIZMU, nie wyglądu:
 *  (1) markup niesie OBA warianty naraz — etykiety i dymki, nagłówki grup
 *      i separatory, badge; nic nie zależy od stanu klienta;
 *  (2) każdy z tych elementów przełącza się wariantem `rail-collapsed:`
 *      (albo regułą `[data-nav-tooltip]` w arkuszu), czyli atrybutem
 *      ustawionym przed malowaniem;
 *  (3) źródła powłoki NIE MOGĄ wrócić do gałęzi Reacta po stanie zwinięcia —
 *      skan źródeł pali suitę, gdy ktoś przywróci `collapsed ? … : …`.
 *
 * M1 (kontekst układania) też jest kontraktem: `md:sticky` na `<aside>` czyni
 * z paska osobny kontekst układania, więc `z-index` dymka NIE SIĘGA poza pasek.
 * Warstwę ustawia POWŁOKA (`md:z-40` na pasku), a dymki zostają nisko —
 * regres w postaci licytacji `z-50` na dymku pali test.
 */

const pathname = vi.hoisted(() => ({ current: "/zamowienia" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { SidebarNav, PANEL_NAV_ID } = await import("@/components/shell/sidebar-nav");
const { SidebarToggle } = await import("@/components/shell/sidebar-toggle");
const { SuperadminEntry } = await import("@/components/shell/superadmin-entry");
const { NAV_ICON_STROKE_WIDTH } = await import("@/components/shell/nav-icons");
const { PANEL_NAV_ITEMS, PANEL_NAV_GROUPS } = await import("@/lib/shell/nav");

function source(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8");
}

const NAV_SOURCE = source("components/shell/sidebar-nav.tsx");
const TOGGLE_SOURCE = source("components/shell/sidebar-toggle.tsx");
const SUPERADMIN_SOURCE = source("components/shell/superadmin-entry.tsx");
const LAYOUT_SOURCE = source("app/[locale]/(panel)/layout.tsx");
const CSS_SOURCE = source("app/globals.css");

function renderNav(path = "/zamowienia"): string {
  pathname.current = path;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <SidebarNav />
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

/** Znaczniki otwierające elementy niosące podany atrybut-marker. */
function tagsWith(html: string, marker: string): string[] {
  return [...html.matchAll(new RegExp(`<[a-z]+[^>]*\\b${marker}\\b[^>]*>`, "g"))].map(
    (m) => m[0],
  );
}

describe("kontrakt sidebara — JEDEN render na oba stany (M2)", () => {
  const html = renderNav();

  it("markup niesie OBA warianty naraz: etykiety i dymki, nagłówki grup i separatory", () => {
    expect(PANEL_NAV_ITEMS.length).toBeGreaterThan(5); // podłoga: pusta lista nie chroni pętli
    for (const item of PANEL_NAV_ITEMS) {
      anchorFor(html, item.id);
    }
    // Wariant rozwinięty. (+1 = pozycja dashboardu poza grupami; badge
    // „Wkrótce" zdjęty w UX1/ADR-140 — dashboard jest zwykłym linkiem.)
    expect(tagsWith(html, "data-nav-label")).toHaveLength(PANEL_NAV_ITEMS.length + 1);
    expect(tagsWith(html, "data-nav-group-label")).toHaveLength(PANEL_NAV_GROUPS.length);
    expect(tagsWith(html, "data-nav-badge")).toHaveLength(0);
    expect(html).toContain(messages.nav.groupSales);
    // Wariant zwinięty — W TYM SAMYM renderze.
    expect(tagsWith(html, "data-nav-tooltip")).toHaveLength(PANEL_NAV_ITEMS.length + 1);
    expect(tagsWith(html, "data-nav-separator")).toHaveLength(PANEL_NAV_GROUPS.length - 1);
    expect(html).toContain('role="tooltip"');
    expect(html).not.toContain('title="');
  });

  it("każdy element zależny od zwinięcia przełącza się wariantem CSS, nie renderem", () => {
    for (const tag of [
      ...tagsWith(html, "data-nav-label"),
      ...tagsWith(html, "data-nav-group-label"),
    ]) {
      expect(tag, `element bez wariantu zwinięcia: ${tag}`).toContain(
        "rail-collapsed:hidden",
      );
    }
    for (const tag of tagsWith(html, "data-nav-separator")) {
      expect(tag, `separator bez wariantu zwinięcia: ${tag}`).toContain(
        "rail-collapsed:block",
      );
    }
    // Dymek nie ma własnej klasy widoczności — całość należy do arkusza,
    // więc w markupie NIE MOŻE stać `hidden` (to była wersja sprzed naprawy).
    for (const tag of tagsWith(html, "data-nav-tooltip")) {
      expect(tag, `dymek z klasą widoczności: ${tag}`).not.toMatch(
        /class="[^"]*\bhidden\b/,
      );
    }
  });

  it("nazwa dostępna pozycji jest STAŁA — nie pojawia się dopiero po hydracji", () => {
    for (const item of PANEL_NAV_ITEMS) {
      const label = messages.nav[item.labelKey as keyof typeof messages.nav];
      expect(anchorFor(html, item.id), `pozycja ${item.id} bez aria-label`).toContain(
        `aria-label="${label}"`,
      );
    }
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

  it("aktywna pozycja niesie aria-current i bg-accent (widoczne w obu stanach)", () => {
    expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(1);
    const orders = anchorFor(html, "orders");
    expect(orders).toContain('aria-current="page"');
    expect(orders).toContain("bg-accent");
    expect(anchorFor(html, "catalog")).not.toContain("aria-current");
  });
});

describe("kontrakt sidebara — źródła nie wracają do gałęzi Reacta (M2)", () => {
  it("nawigacja NIE czyta stanu zwinięcia — nie ma czego rozjechać z serwerem", () => {
    expect(NAV_SOURCE).not.toContain("useSidebarCollapsed");
    expect(NAV_SOURCE).not.toMatch(/collapsed\s*\?/);
  });

  it("przełącznik i wejście superadmina wybierają wygląd CSS-em", () => {
    // Ikona przełącznika: OBA warianty w DOM, wybór wariantem.
    expect(TOGGLE_SOURCE).toContain("rail-collapsed:hidden");
    expect(TOGGLE_SOURCE).toContain("rail-collapsed:block");
    expect(TOGGLE_SOURCE).not.toMatch(/const\s+Icon\s*=\s*collapsed/);
    expect(SUPERADMIN_SOURCE).toContain("rail-collapsed:hidden");
    expect(SUPERADMIN_SOURCE).toContain("data-nav-tooltip");
  });

  it("arkusz definiuje wariant zakotwiczony w pasku i widoczność dymka", () => {
    expect(CSS_SOURCE).toContain(
      '@custom-variant rail-collapsed (html[data-sidebar="collapsed"] [data-sidebar-rail] &)',
    );
    expect(CSS_SOURCE).toMatch(/\[data-nav-tooltip\]\s*\{\s*display:\s*none/);
    expect(CSS_SOURCE).toMatch(
      /html\[data-sidebar="collapsed"\] \[data-sidebar-rail\] :hover > \[data-nav-tooltip\]/,
    );
  });
});

describe("kontrakt sidebara — kontekst układania dymka (M1)", () => {
  it("warstwę ustawia POWŁOKA: pasek przyklejony dostaje własny numer warstwy", () => {
    // `md:sticky` czyni z paska kontekst układania — bez numeru warstwy
    // pozycjonowana treść strony (np. `sm:z-30` w pasku filtrów) wygrywa
    // z dymkiem, bo stoi po pasku w porządku drzewa.
    expect(LAYOUT_SOURCE).toContain("data-sidebar-rail");
    expect(LAYOUT_SOURCE).toContain("md:sticky");
    expect(LAYOUT_SOURCE).toContain("md:z-40");
  });

  it("dymki NIE licytują z-indeksem — problem nigdy nie był w ich wartości", () => {
    for (const src of [NAV_SOURCE, SUPERADMIN_SOURCE]) {
      expect(src).not.toContain("z-50");
      expect(src).toContain("z-10");
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

describe("kontrakt wejścia superadmina w zwiniętym pasku", () => {
  it("etykieta ustępuje CSS-em, nazwa dostępna zostaje na linku", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="pl" messages={messages}>
        <SuperadminEntry superadmin label={messages.nav.superadminPanel} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain(`aria-label="${messages.nav.superadminPanel}"`);
    expect(tagsWith(html, "data-nav-label")[0]).toContain("rail-collapsed:hidden");
    expect(tagsWith(html, "data-nav-tooltip")).toHaveLength(1);
  });
});
