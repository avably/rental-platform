import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

const pathname = vi.hoisted(() => ({ current: "/zamowienia" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/lib/actions/logout", () => ({ logoutAction: "/logout" }));
vi.mock("@/components/shell/sidebar-nav", () => ({
  SidebarNav: () => createElement("nav", { "data-panel-nav": "true" }, "sidebar"),
}));
vi.mock("@/components/shell/locale-switcher", () => ({
  LocaleSwitcher: () => createElement("button", { type: "button" }, "PL"),
}));

const nav = await import("@/lib/shell/nav");
const { MobileNav } = await import("@/components/shell/mobile-nav");

function renderMobileNav(path: string): string {
  pathname.current = path;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <MobileNav userEmail="operator@example.test" />
    </NextIntlClientProvider>,
  );
}

describe("kontrakt mobilnego bottom bara — ADR-060", () => {
  it("pozycje domenowe są referencjami z PANEL_NAV_ITEMS", () => {
    const bottomItems = (nav as unknown as Record<string, unknown>).PANEL_BOTTOM_NAV_ITEMS;
    expect(bottomItems).toBeInstanceOf(Array);
    if (!Array.isArray(bottomItems)) return;
    expect(bottomItems.map((item) => item.id)).toEqual(["orders", "catalog"]);
    expect(bottomItems.every((item) => nav.PANEL_NAV_ITEMS.includes(item))).toBe(true);
  });

  it("resolver odrzuca identyfikator spoza PANEL_NAV_ITEMS", () => {
    const resolver = (nav as unknown as Record<string, unknown>).resolvePanelNavItem;
    expect(typeof resolver).toBe("function");
    if (typeof resolver !== "function") return;
    expect(() => resolver("spoza-nav")).toThrow(/spoza PANEL_NAV_ITEMS/);
  });

  it("renderuje cztery pozycje, safe-area, obrys i aria-current", () => {
    const html = renderMobileNav("/zamowienia");
    expect(html).toContain('data-mobile-bottom-nav="true"');
    expect(html).toContain("grid-cols-5");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(messages.nav.dashboard);
    expect(html).toContain(messages.nav.orders);
    expect(html).toContain(messages.nav.catalog);
    // Na pasku widoczna jest etykieta SKRÓCONA (pięć kolumn na 390 px), ale
    // pełna nazwa musi zostać dla czytnika — inaczej „Nowe" nic nie znaczy.
    expect(html).toContain((messages.nav as Record<string, string>).newOrderShort);
    expect(html).toMatch(
      new RegExp(`aria-label="${(messages.nav as Record<string, string>).newOrder}"`),
    );
    expect(html).toContain((messages.nav as Record<string, string>).mobileMenu);
    expect(html).toContain("env(safe-area-inset-bottom)");
    expect(html).toContain("border-t");
    expect(html).not.toMatch(/shadow-/);
  });

  it("skrót do strony głównej bierze etykietę z zapowiedzi, nie z drugiej kopii", () => {
    const home = (nav as unknown as Record<string, unknown>).PANEL_BOTTOM_NAV_HOME as {
      id: string;
      href: string;
      labelKey: string;
    };
    expect(home.href).toBe("/");
    expect(home.id).toBe(nav.PANEL_NAV_PLACEHOLDER.id);
    expect(home.labelKey).toBe(nav.PANEL_NAV_PLACEHOLDER.labelKey);
    /*
      Dashboard NIE JEST pozycją nawigacji — artefakt trzyma go jako zapowiedź
      i sidebar dalej pokazuje go jako nieklikalny. Gdyby kiedyś nią został,
      ten wpis ma ZNIKNĄĆ na rzecz `resolvePanelNavItem`, a nie stać się drugą
      definicją tej samej rzeczy; ta asercja o tym przypomni.
    */
    expect(nav.PANEL_NAV_ITEMS.some((item) => item.id === home.id)).toBe(false);
  });

  it("„Nowe\" stoi na środku paska i nie jest wyróżnione", () => {
    const html = renderMobileNav("/zamowienia");
    const bar = html.slice(html.indexOf("data-mobile-bottom-nav"));
    // Kolejność decyzją właściciela: Dashboard · Zamówienia · Nowe · Katalog
    // · Menu — CTA pod kciukiem, w trzeciej z pięciu komórek.
    const kolejnosc = [
      bar.indexOf('href="/"'),
      bar.indexOf('href="/zamowienia"'),
      bar.indexOf('href="/zamowienia/nowe"'),
      bar.indexOf('href="/katalog"'),
      bar.indexOf("aria-haspopup"),
    ];
    expect(kolejnosc.every((i) => i >= 0)).toBe(true);
    expect([...kolejnosc].sort((a, b) => a - b)).toEqual(kolejnosc);
    // Bez obrysu i bez własnej geometrii — CTA wygląda jak każda inna
    // pozycja (wcześniejsza ramka `border-border` na Linku paska zniknęła).
    expect(bar).not.toMatch(/<a[^>]*href="\/zamowienia\/nowe"[^>]*border/);
  });

  /*
    Limonka na pasku niesie JEDNĄ informację: gdzie jesteś. CTA wypełnione
    limonką na stałe kasowało tę różnicę (decyzja właściciela 2026-07-22),
    więc wypełnienie ma być DOKŁADNIE jedno i ma siedzieć na pozycji bieżącej
    — również wtedy, gdy bieżące jest samo CTA.
  */
  it.each([["/"], ["/zamowienia"], ["/katalog"], ["/zamowienia/nowe"]])(
    "na %s dokładnie jedna pozycja paska jest wypełniona limonką",
    (path) => {
      const html = renderMobileNav(path);
      const bar = html.slice(html.indexOf("data-mobile-bottom-nav"));
      expect(bar.match(/bg-accent\b/g) ?? []).toHaveLength(1);
      expect(html.match(/aria-current="page"/g) ?? []).toHaveLength(1);
    },
  );

  it("CTA jest jedyną bieżącą pozycją na /zamowienia/nowe", () => {
    const html = renderMobileNav("/zamowienia/nowe");
    expect(html.match(/aria-current="page"/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/href="\/zamowienia\/nowe"[^>]*aria-current="page"/);
  });

  it("skrót do strony głównej nie zapala się na innych ekranach", () => {
    const html = renderMobileNav("/katalog");
    expect(html).toMatch(/href="\/katalog"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/href="\/"[^>]*aria-current="page"/);
  });
});
