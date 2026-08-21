import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * Akordeon drzewa nawigacji (ADR-231). Sprawdza NOWE zachowanie, którego nie
 * dotyka kontrakt struktury: rozwijanie/zwijanie gałęzi, domyślne rozwinięcie
 * gałęzi z trasą aktywną (SSR-spójne, bez skryptu startowego), rozdział
 * „klik-w-parent NAWIGUJE / chevron TOGGLUJE" oraz a11y akordeonu.
 *
 * `renderToStaticMarkup` — to render SERWERA (SSR): jeśli gałąź aktywna nie
 * rozwijałaby się już na serwerze, byłby flash po hydracji. Test patrzy na
 * wyjściowy HTML, nie na źródło.
 */

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { SidebarNav } = await import("@/components/shell/sidebar-nav");

function render(
  path: string,
  props: { expanded?: string[]; isOwner?: boolean } = {},
): string {
  pathname.current = path;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <SidebarNav isOwner {...props} />
    </NextIntlClientProvider>,
  );
}

/** Klasa kontenera dzieci gałęzi (albo `undefined`, gdy brak gałęzi). */
function childrenContainerClass(html: string, branchId: string): string | undefined {
  return html.match(
    new RegExp(`<div[^>]*data-nav-branch-children="${branchId}"[^>]*class="([^"]*)"`),
  )?.[1];
}

/** Znacznik przełącznika akordeonu danej gałęzi. */
function toggleTag(html: string, branchId: string): string | undefined {
  return html.match(new RegExp(`<button[^>]*data-nav-branch-toggle="${branchId}"[^>]*>`))?.[0];
}

describe("akordeon drzewa nawigacji (ADR-231)", () => {
  it("domyślnie (brak trasy aktywnej w gałęzi, puste ciasteczko) gałęzie są ZWINIĘTE", () => {
    const html = render("/");
    // Kontener dzieci niesie `hidden`, gdy gałąź zwinięta; `rail-collapsed:flex`
    // odsłania je dopiero w wąskim pasku.
    for (const branch of ["storeSection", "settings", "organization"]) {
      const cls = childrenContainerClass(html, branch);
      expect(cls, `brak kontenera dzieci gałęzi ${branch}`).toBeDefined();
      expect(cls, `gałąź ${branch} powinna być zwinięta`).toContain("hidden");
    }
  });

  it("gałąź z trasą AKTYWNĄ rozwija się SAMA — już w renderze serwera (zero flash-a)", () => {
    const html = render("/ustawienia-platnosci");
    // Settings zawiera aktywne „Płatności" → rozwinięta (bez `hidden`).
    const settings = childrenContainerClass(html, "settings");
    expect(settings).toBeDefined();
    expect(settings).not.toContain("hidden");
    // Pozostałe gałęzie bez aktywnej trasy — zwinięte.
    expect(childrenContainerClass(html, "storeSection")).toContain("hidden");
    expect(childrenContainerClass(html, "organization")).toContain("hidden");
    // Aktywne dziecko niesie aria-current, przełącznik settings — aria-expanded=true.
    expect(html).toMatch(/data-nav-item="payments"[^>]*aria-current="page"/);
    expect(toggleTag(html, "settings")).toContain('aria-expanded="true"');
    expect(toggleTag(html, "storeSection")).toContain('aria-expanded="false"');
  });

  it("ciasteczko rozwija gałąź bez trasy aktywnej (expanded z layoutu)", () => {
    const html = render("/", { expanded: ["storeSection"] });
    expect(childrenContainerClass(html, "storeSection")).not.toContain("hidden");
    expect(childrenContainerClass(html, "settings")).toContain("hidden");
    expect(toggleTag(html, "storeSection")).toContain('aria-expanded="true"');
  });

  it("podtrasa /strona/wyglad rozwija gałąź sklepu i podświetla dziecko Wygląd", () => {
    const html = render("/strona/wyglad");
    expect(childrenContainerClass(html, "storeSection")).not.toContain("hidden");
    // matchNavItem najdłuższy → storeAppearance (ADR-231), nie store.
    expect(html).toMatch(/data-nav-item="storeAppearance"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/data-nav-item="store"[^>]*aria-current="page"/);
  });

  it("klik-w-parent: gałąź NAWIGOWALNA to LINK + osobny chevron (nie zjada nawigacji)", () => {
    const html = render("/");
    // „Strona sklepu": wiersz-rodzic jest linkiem do /strona, a przełącznik to
    // OSOBNY <button> (dwa rodzeństwa) — klik w chevron nie nawiguje.
    const storeLink = html.match(/<a[^>]*data-nav-branch-link="storeSection"[^>]*>/)?.[0];
    expect(storeLink, "brak wiersza-linku gałęzi Strona sklepu").toBeDefined();
    expect(storeLink).toContain('href="/strona"');
    const storeToggle = toggleTag(html, "storeSection");
    expect(storeToggle).toBeDefined();
    expect(storeToggle).toContain('aria-controls="panel-nav-storeSection"');
    // „Organizacja": wiersz-rodzic to link JEDNOCZEŚNIE będący pozycją
    // matchNavItem (data-nav-item="organization"), bo trasy /organizacja nie
    // pokrywa żadne dziecko.
    const orgLink = html.match(/<a[^>]*data-nav-branch-link="organization"[^>]*>/)?.[0];
    expect(orgLink, "brak wiersza-linku gałęzi Organizacja").toBeDefined();
    expect(orgLink).toContain('data-nav-item="organization"');
    expect(orgLink).toContain('href="/organizacja"');
  });

  it("klik-w-parent: gałąź-GRUPA bez ekranu (Ustawienia) to sam PRZYCISK, bez linku", () => {
    const html = render("/");
    // Ustawienia nie ma wiersza-linku (brak ekranu) — tylko przełącznik.
    expect(html).not.toMatch(/data-nav-branch-link="settings"/);
    const settingsToggle = toggleTag(html, "settings");
    expect(settingsToggle).toBeDefined();
    expect(settingsToggle).toContain('aria-controls="panel-nav-settings"');
    expect(settingsToggle).toContain('aria-expanded=');
    // Kontener dzieci jest celem aria-controls i ma role=group.
    expect(html).toMatch(/<div[^>]*id="panel-nav-settings"[^>]*role="group"/);
  });

  it("kontenery dzieci odsłaniają się w wąskim pasku (rail-collapsed:flex)", () => {
    const html = render("/");
    for (const branch of ["storeSection", "settings", "organization"]) {
      expect(childrenContainerClass(html, branch)).toContain("rail-collapsed:flex");
    }
  });
});
