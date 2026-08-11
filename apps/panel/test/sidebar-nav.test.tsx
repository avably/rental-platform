import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * Zachowanie sidebara (ADR-056): oznaczenie trasy bieżącej, nieklikalność
 * zapowiedzi dashboardu, dekoracyjność ikon.
 *
 * Renderujemy `renderToStaticMarkup` zamiast testing-library, bo suita panelu
 * chodzi w środowisku `node`, a P3 nie ma zgody na nowe zależności poza
 * `lucide-react`. To nadal PRAWDZIWY render komponentu — asercje patrzą na
 * wyjściowy HTML, nie na treść pliku źródłowego, więc zdjęcie `aria-current`
 * z aktywnej pozycji pali test.
 *
 * `usePathname` podmieniamy, bo to jedyne wejście, od którego zależy stan
 * aktywny; `Link` z next-intl zastępujemy zwykłą kotwicą, żeby nie ciągnąć
 * routera do renderu statycznego.
 */

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.current,
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => createElement("a", { href, ...props }, children),
}));

const { SidebarNav } = await import("@/components/shell/sidebar-nav");
const { NAV_ICON_STROKE_WIDTH } = await import("@/components/shell/nav-icons");
const { PANEL_NAV_ITEMS } = await import("@/lib/shell/nav");

function renderNav(path: string): string {
  pathname.current = path;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <SidebarNav />
    </NextIntlClientProvider>,
  );
}

/** Wycinek HTML pojedynczego znacznika `<a …>` z podanym data-nav-item. */
function anchorFor(html: string, id: string): string | undefined {
  return html.match(new RegExp(`<a[^>]*data-nav-item="${id}"[^>]*>`))?.[0];
}

describe("sidebar panelu", () => {
  it("renderuje komplet pozycji, każdą z etykietą tekstową obok ikony", () => {
    const html = renderNav("/");

    for (const item of PANEL_NAV_ITEMS) {
      const label = messages.nav[item.labelKey as keyof typeof messages.nav];
      expect(anchorFor(html, item.id), `brak pozycji ${item.id}`).toBeDefined();
      // Ikona nigdy sama — etykieta musi zostać w treści.
      expect(html).toContain(label);
    }
  });

  it("oznacza trasę bieżącą przez aria-current i tylko ją", () => {
    const html = renderNav("/zamowienia");

    expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(1);
    expect(anchorFor(html, "orders")).toContain('aria-current="page"');
    expect(anchorFor(html, "catalog")).not.toContain("aria-current");
  });

  it("ekran zagnieżdżony trzyma podświetlenie na swojej sekcji", () => {
    // Trasa dwupoziomowa: punkty odbioru stoją pod Dostawami od 2026-08-04.
    const html = renderNav("/ustawienia-dostaw/punkty-odbioru/nowy");

    expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(1);
    expect(anchorFor(html, "delivery")).toContain('aria-current="page"');
    expect(anchorFor(html, "catalog")).not.toContain("aria-current");
  });

  it("trasa spoza nawigacji nie podświetla żadnej pozycji", () => {
    expect(renderNav("/historia-emaili")).not.toContain('aria-current="page"');
  });

  it("dashboard jest LINKIEM do `/` bez badge „Wkrótce” (UX1, ADR-140) i dostaje aria-current na stronie głównej", () => {
    const html = renderNav("/");
    const placeholder = html.match(/<(\w+)[^>]*data-nav-placeholder="dashboard"[^>]*>/);

    expect(placeholder).not.toBeNull();
    // Ekran istnieje i jest stroną startową — pozycja jest klikalna.
    expect(placeholder?.[1]).toBe("a");
    expect(placeholder?.[0]).toContain('href="/"');
    expect(placeholder?.[0]).toContain('aria-current="page"');
    // Zapowiedź zdjęta w całości: ani flagi, ani badge.
    expect(html).not.toContain('data-future');
    expect(html).not.toContain("data-nav-badge");
  });

  it("dashboard NIE świeci na innych trasach (równość ścieżki, nie prefiks)", () => {
    const html = renderNav("/zamowienia");
    const placeholder = html.match(/<a[^>]*data-nav-placeholder="dashboard"[^>]*>/);

    expect(placeholder).not.toBeNull();
    expect(placeholder?.[0]).not.toContain("aria-current");
  });

  it("ikony są dekoracyjne i mają jeden ciężar kreski w całym shellu", () => {
    const html = renderNav("/");
    const icons = [...html.matchAll(/<svg[^>]*>/g)].map((match) => match[0]);

    // Podłoga liczności: bez niej pusta lista przechodziłaby pętlę niżej.
    expect(icons).toHaveLength(PANEL_NAV_ITEMS.length + 1); // + zapowiedź
    for (const icon of icons) {
      expect(icon).toContain('aria-hidden="true"');
      expect(icon).toContain(`stroke-width="${NAV_ICON_STROKE_WIDTH}"`);
    }
  });
});
