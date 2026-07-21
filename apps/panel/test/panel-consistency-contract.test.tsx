import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

const screensDir = resolve(process.cwd(), "app/[locale]/(panel)");
const layoutPath = resolve(screensDir, "layout.tsx");

function collectSources(dir: string): { path: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return collectSources(path);
    if (!/\.tsx?$/.test(entry.name) || path === layoutPath) return [];
    return [{ path, source: readFileSync(path, "utf8") }];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const relative = (path: string) => path.replace(`${screensDir}/`, "");
const sources = collectSources(screensDir).map((file) => ({
  ...file,
  code: stripComments(file.source),
}));
const layout = readFileSync(layoutPath, "utf8");

/**
 * To nie są kontenery stron: ograniczają pojedynczy formularz albo kontrolkę.
 * Dokładna ścieżka + dokładna klasa sprawiają, że whitelisty nie da się użyć
 * do przemycenia nowej geometrii całego ekranu.
 */
const allowedMaxWidth = new Map<string, readonly string[]>([
  ["katalog/[id]/zdjecia/photo-forms.tsx", ["max-w-[10rem]"]],
  ["katalog/product-form.tsx", ["max-w-2xl"]],
  ["katalog/punkty-odbioru/location-form.tsx", ["max-w-2xl"]],
  ["zamowienia/[id]/extension-form.tsx", ["max-w-sm"]],
  ["zamowienia/nowe/order-wizard.tsx", ["max-w-2xl"]],
]);

const pathname = vi.hoisted(() => ({ current: "/zamowienia" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/components/shell/mobile-nav", () => ({
  MobileNav: () => createElement("button", { type: "button" }, "menu"),
}));
vi.mock("@/components/shell/locale-switcher", () => ({
  LocaleSwitcher: () => createElement("button", { type: "button" }, "PL"),
}));
vi.mock("@/components/shell/theme-toggle", () => ({
  ThemeToggle: () => createElement("button", { type: "button" }, "motyw"),
}));
vi.mock("@/lib/actions/logout", () => ({ logoutAction: "/logout" }));

const nav = await import("@/lib/shell/nav");
const { PanelTopbar } = await import("@/components/shell/panel-topbar");

function renderTopbar(): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <PanelTopbar userEmail="operator@example.test" />
    </NextIntlClientProvider>,
  );
}

describe("kontrakt spójności ekranów panelu — ADR-060", () => {
  it("skan obejmuje realny zbiór ekranów i precyzyjną whitelistę", () => {
    expect(sources.length).toBeGreaterThanOrEqual(50);
    expect(sources.some((file) => relative(file.path) === "zamowienia/page.tsx")).toBe(true);
    expect(allowedMaxWidth.size).toBe(5);
  });

  it("pliki ekranów nie definiują własnego kontenera max-w", () => {
    const offenders = sources.flatMap(({ path, code }) => {
      const relativePath = relative(path);
      const allowed = allowedMaxWidth.get(relativePath) ?? [];
      return [...code.matchAll(/\bmax-w-(?:\[[^\]]+\]|[\w-]+)/g)]
        .map((match) => match[0])
        .filter((token) => !allowed.includes(token))
        .map((token) => `${relativePath}: ${token}`);
    });

    expect(offenders, `własny kontener ekranu: ${offenders.join(", ")}`).toEqual([]);
  });

  it("layout jest jedynym właścicielem standardu max-w-6xl i paddingu", () => {
    expect(layout).toContain('data-panel-container="true"');
    expect(layout).toContain("max-w-6xl");
    expect(layout).toContain("px-4");
    expect(layout).toContain("md:px-6");
  });

  it("źródła ekranów nie renderują drugiego h1", () => {
    const offenders = sources
      .filter(({ code }) => /<h1\b/.test(code))
      .map(({ path }) => relative(path));

    expect(offenders, `drugi h1 w treści: ${offenders.join(", ")}`).toEqual([]);
  });

  it("resolver tytułu istnieje i obejmuje trasy spoza głównej nawigacji", () => {
    const resolver = (nav as unknown as Record<string, unknown>).panelTitleKey;
    expect(typeof resolver).toBe("function");
    if (typeof resolver !== "function") return;
    expect(resolver("/historia-emaili")).toBe("emailHistory");
    expect(resolver("/organizacja/nowa")).toBe("newOrganization");
    expect(resolver("/bezpieczenstwo/wyzwanie")).toBe("securityChallenge");
  });

  it.each(nav.PANEL_NAV_ITEMS)("render trasy $href ma dokładnie jeden h1", (item) => {
    pathname.current = item.href;
    const html = renderTopbar();
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(html).toContain(messages.nav[item.labelKey as keyof typeof messages.nav]);
  });
});
