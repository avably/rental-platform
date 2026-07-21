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
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(messages.nav.orders);
    expect(html).toContain(messages.nav.catalog);
    expect(html).toContain((messages.nav as Record<string, string>).newOrder);
    expect(html).toContain((messages.nav as Record<string, string>).mobileMenu);
    expect(html).toContain("env(safe-area-inset-bottom)");
    expect(html).toContain("border-t");
    expect(html).not.toMatch(/shadow-/);
  });

  it("CTA jest jedyną bieżącą pozycją na /zamowienia/nowe", () => {
    const html = renderMobileNav("/zamowienia/nowe");
    expect(html.match(/aria-current="page"/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/href="\/zamowienia\/nowe"[^>]*aria-current="page"/);
  });
});
