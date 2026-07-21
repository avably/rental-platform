import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * Aktywna pozycja nawigacji NIE NIESIE KRAWĘDZI (decyzja właściciela
 * 2026-07-21) — samo limonkowe zakreślenie, w dark samo wypełnienie
 * `--accent` (#263016).
 *
 * DWA niezależne dowody, wzorem ADR-057 D1 (skan i render osobno nie
 * wystarczają):
 *  (1) ARTEFAKT — reguły `.sidebar-nav [aria-current="page"]` w źródle prawdy
 *      nie mogą deklarować widocznej krawędzi. Bez tego dokumentacja
 *      pokazywałaby wersję, której produkt już nie ma.
 *  (2) RENDER — wyjściowy HTML sidebara nie może nieść klasy krawędzi w
 *      kolorze innym niż `transparent`. Sam artefakt nie broni kodu, a sam
 *      kod nie broni artefaktu.
 */

const artifact = readFileSync(
  resolve(process.cwd(), "../../docs/branding/2026-07-20-avably-faza-2-system.html"),
  "utf8",
);

/** Ciała reguł `[aria-current="page"]` sidebara — wariant jasny i ciemny. */
const activeRules = [
  ...artifact.matchAll(/\.sidebar-nav \[aria-current="page"\]\s*\{([^}]*)\}/g),
].map((match) => match[1]!);

const pathname = vi.hoisted(() => ({ current: "/zamowienia" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { SidebarNav } = await import("@/components/shell/sidebar-nav");

const html = renderToStaticMarkup(
  <NextIntlClientProvider locale="pl" messages={messages}>
    <SidebarNav />
  </NextIntlClientProvider>,
);

/** Klasy znacznika `<a>` oznaczonego jako bieżący. */
const activeClasses = (
  html.match(/<a[^>]*aria-current="page"[^>]*class="([^"]*)"/)?.[1] ??
  html.match(/<a[^>]*class="([^"]*)"[^>]*aria-current="page"/)?.[1] ??
  ""
).split(/\s+/);

/**
 * Czy klasa maluje KOLOR krawędzi w stanie SPOCZYNKOWYM.
 *
 * Warianty interakcji (`focus-visible:` itd.) są poza zakresem tej reguły —
 * nośnik `focus-visible:border-foreground` jest WYMAGANY przez ADR-055 D3
 * i nie ma nic wspólnego z oznaczeniem trasy bieżącej. Wariant motywu
 * (`dark:`) liczy się normalnie: to nadal stan spoczynkowy.
 *
 * Sama geometria (`border-l-2`) i `border-transparent` są legalne — chodzi
 * o widoczną kreskę, nie o obrys trzymający stałą szerokość.
 */
const INTERACTION_VARIANT = /^(?:hover|focus|focus-visible|active|group-hover|aria-\w+):/;

function paintsBorderColor(cls: string): boolean {
  if (INTERACTION_VARIANT.test(cls)) return false;
  const bare = cls.replace(/^dark:/, "");
  const tail = bare.match(/^border(?:-[lrtbxy])?-(.+)$/)?.[1];
  if (tail === undefined) return false;
  // Ogon czysto liczbowy to szerokość (`border-l-2`), nie kolor.
  return tail !== "transparent" && !/^\d+(?:\.\d+)?$/.test(tail);
}

describe("kontrakt aktywnej pozycji nawigacji", () => {
  it("artefakt i render dostarczają realny materiał do sprawdzenia", () => {
    // Kontrola po pustym zbiorze: bez tej podłogi obie asercje niżej byłyby
    // zielone dlatego, że parser/render nic nie znalazł.
    expect(activeRules).toHaveLength(2);
    // Obie powierzchnie, nie tylko jasna: wariant `.dark` musi istnieć, inaczej
    // kontrakt pilnowałby połowy artefaktu.
    expect(artifact).toContain('.dark .sidebar-nav [aria-current="page"]');
    expect(activeClasses.length).toBeGreaterThan(5);
    // Zakreślenie MUSI zostać — inaczej „brak krawędzi" spełniałby też
    // wariant, w którym aktywna pozycja przestała się w ogóle wyróżniać.
    expect(activeClasses).toContain("bg-accent");
    expect(activeRules.every((rule) => /background:\s*var\(--accent\)/.test(rule))).toBe(true);
  });

  it("predykat krawędzi widzi kreskę, którą właśnie zdjęto", () => {
    // Kontrola POZYTYWNA: bez niej zepsuty predykat dawałby zielone na
    // każdym zbiorze klas (lekcja „dowód po pustym zbiorze", PR #75).
    expect(paintsBorderColor("border-l-signal-strong")).toBe(true);
    expect(paintsBorderColor("dark:border-l-accent-foreground")).toBe(true);
    // …i nie myli koloru z geometrią ani z nośnikiem focusu.
    expect(paintsBorderColor("border-l-2")).toBe(false);
    expect(paintsBorderColor("border-transparent")).toBe(false);
    expect(paintsBorderColor("focus-visible:border-foreground")).toBe(false);
  });

  it("artefakt nie maluje krawędzi przy aktywnej pozycji", () => {
    const offenders = activeRules.filter((rule) => /border(-left)?\s*:/.test(rule));

    expect(
      offenders,
      `reguła [aria-current] w artefakcie deklaruje krawędź: ${offenders.join(" | ")}`,
    ).toEqual([]);
  });

  it("wyrenderowana aktywna pozycja nie niesie klasy koloru krawędzi", () => {
    const offenders = activeClasses.filter(paintsBorderColor);

    expect(
      offenders,
      `aktywna pozycja maluje krawędź klasami: ${offenders.join(", ")}`,
    ).toEqual([]);
    // Geometria zostaje: stała szerokość obrysu zapobiega skokowi layoutu.
    expect(activeClasses).toContain("border-l-2");
    expect(activeClasses).toContain("border-transparent");
  });
});
