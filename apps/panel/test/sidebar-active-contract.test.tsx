import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * Aktywna pozycja nawigacji NIE NIESIE KRAWĘDZI (decyzja właściciela
 * 2026-07-21). Od ADR-177 jasny panel ma neutralną powierzchnię aktywnego
 * linku i małą limonkową kropkę; limonka nie zalewa już całego wiersza.
 * W dark dotychczasowe wypełnienie `--accent` zostaje dla kontrastu.
 *
 * Render broni jednocześnie czterech nośników decyzji: neutralnego tła,
 * limonkowego markera, jego geometrii i braku widocznej krawędzi.
 */

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
  it("render dostarcza realny aktywny link", () => {
    expect(activeClasses.length).toBeGreaterThan(5);
    expect(activeClasses).toContain("bg-muted/60");
    expect(activeClasses).toContain("before:bg-accent");
    expect(activeClasses).toContain("before:rounded-full");
    expect(activeClasses).toContain("rail-collapsed:before:hidden");
    expect(activeClasses).not.toContain("bg-accent");
    expect(activeClasses).toContain("dark:bg-accent");
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
