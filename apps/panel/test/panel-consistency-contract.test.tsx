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
  // Z7: ekran ustawień umowy to jeden formularz — miara jak kreator.
  ["ustawienia-umow/page.tsx", ["max-w-2xl"]],
  ["zamowienia/[id]/extension-form.tsx", ["max-w-sm"]],
  ["zamowienia/nowe/order-wizard.tsx", ["max-w-2xl"]],
]);

const topbarOwnedTitleFiles = [
  "bezpieczenstwo/page.tsx",
  "bezpieczenstwo/wyzwanie/page.tsx",
  "historia-emaili/page.tsx",
  "katalog/page.tsx",
  "organizacja/page.tsx",
  "organizacja/nowa/page.tsx",
  "strona/page.tsx",
  "strona/site-editor.tsx",
  "ustawienia-domen/page.tsx",
  "ustawienia-umow/page.tsx",
  "ustawienia-dostaw/page.tsx",
  "ustawienia-emaili/page.tsx",
  "zamowienia/page.tsx",
  "zamowienia/nowe/page.tsx",
  "zaproszenia/page.tsx",
] as const;

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
    expect(allowedMaxWidth.size).toBe(6);
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

  /*
    Skan `max-w-*` pilnuje JEDNEGO ZAPISU szerokości, a przeglądarka rozumie
    trzy. Ekran przypięty przez `w-[42rem]` albo `style={{ maxWidth }}` daje
    dokładnie ten objaw, przeciw któremu powstała ta paczka — rozjazd
    szerokości między ekranami — a bramka na `max-w-` go nie widzi
    (sprawdzone mutacją: 16/16 na zielono przy własnej szerokości ekranu).
    Dowolne `w-[…]` mają w panelu legalne zastosowania (miniatura, minimalna
    szerokość tabeli przewijanej w poziomie, szerokość popovera), więc zakaz
    jest whitelistowany DOKŁADNĄ parą ścieżka+token, tak jak przy `max-w`,
    i przypięty rozmiarem — nowy wpis musi przejść przez recenzję. Zapis
    inline w `style` nie ma dziś ANI JEDNEGO wystąpienia i jest zakazany
    całkowicie.
  */
  const ARBITRARY_WIDTH_PATTERN = /\b(?:min-)?w-\[[^\]]+\]/g;
  const INLINE_WIDTH_PATTERN = /style=\{\{[^}]*\b(?:max-?[Ww]idth|width)\b/g;
  const allowedArbitraryWidth = new Map<string, readonly string[]>([
    ["katalog/[id]/zdjecia/photo-forms.tsx", ["w-[120px]", "w-[10rem]"]],
    ["katalog/products-table.tsx", ["min-w-[720px]"]],
    ["katalog/punkty-odbioru/locations-table.tsx", ["min-w-[640px]"]],
    ["zamowienia/nowe/order-wizard.tsx", ["w-[320px]"]],
    ["zamowienia/orders-date-filter.tsx", ["w-[248px]"]],
    ["zamowienia/orders-table.tsx", ["min-w-[880px]"]],
  ]);

  it("wykrywa oba obejścia skanu max-w (kontrola pozytywna)", () => {
    expect('<div className="w-[42rem]">'.match(ARBITRARY_WIDTH_PATTERN)).toEqual(["w-[42rem]"]);
    expect('<div className="min-w-[30rem]">'.match(ARBITRARY_WIDTH_PATTERN)).toEqual([
      "min-w-[30rem]",
    ]);
    expect('<div className="w-full size-5">'.match(ARBITRARY_WIDTH_PATTERN)).toBeNull();
    expect('<div style={{ maxWidth: "42rem" }}>'.match(INLINE_WIDTH_PATTERN)).toHaveLength(1);
    expect('<div style={{ gap: 4 }}>'.match(INLINE_WIDTH_PATTERN)).toBeNull();
  });

  it("ekrany nie przypinają szerokości poza notacją max-w", () => {
    expect(allowedArbitraryWidth.size).toBe(6);

    const offenders = sources.flatMap(({ path, code }) => {
      const relativePath = relative(path);
      const allowed = allowedArbitraryWidth.get(relativePath) ?? [];
      return [
        ...[...code.matchAll(ARBITRARY_WIDTH_PATTERN)]
          .map(([token]) => token)
          .filter((token) => !allowed.includes(token))
          .map((token) => `${relativePath}: ${token}`),
        ...[...code.matchAll(INLINE_WIDTH_PATTERN)].map(() => `${relativePath}: style width`),
      ];
    });

    expect(
      offenders,
      `szerokość ekranu poza kontraktem: ${offenders.join(", ")}`,
    ).toEqual([]);
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

  it("belka jest jedynym widocznym tytułem ekranów objętych ADR-060", () => {
    const offenders = topbarOwnedTitleFiles.filter((path) => {
      const file = sources.find((candidate) => relative(candidate.path) === path);
      expect(file, `brak ekranu w skanie: ${path}`).toBeDefined();
      return (
        /<h2\b[^>]*>\s*\{t\("title"\)\}\s*<\/h2>/.test(file!.code) ||
        /<ScreenHeader\b[^>]*title=\{t\("title"\)\}/.test(file!.code) ||
        (path === "organizacja/nowa/page.tsx" && file!.code.includes(">Załóż organizację</h2>"))
      );
    });

    expect(offenders, `widoczny duplikat tytułu z belki: ${offenders.join(", ")}`).toEqual([]);
  });

  it("żaden ekran tenanta nie używa natywnego selecta", () => {
    const offenders = sources
      .filter(({ code }) => /<select\b/.test(code))
      .map(({ path }) => relative(path));

    expect(
      offenders,
      `natywny <select> zamiast @avably/ui: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("resolver tytułu istnieje i obejmuje trasy spoza głównej nawigacji", () => {
    const resolver = (nav as unknown as Record<string, unknown>).panelTitleKey;
    expect(typeof resolver).toBe("function");
    if (typeof resolver !== "function") return;
    expect(resolver("/historia-emaili")).toBe("emailHistory");
    expect(resolver("/organizacja/nowa")).toBe("newOrganization");
    expect(resolver("/bezpieczenstwo/wyzwanie")).toBe("securityChallenge");
    expect(resolver("/zamowienia/nowe")).toBe("newOrder");
  });

  it.each(nav.PANEL_NAV_ITEMS)("render trasy $href ma dokładnie jeden h1", (item) => {
    pathname.current = item.href;
    const html = renderTopbar();
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(html).toContain(messages.nav[item.labelKey as keyof typeof messages.nav]);
  });
});
