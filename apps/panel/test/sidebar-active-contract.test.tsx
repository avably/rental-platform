import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
 * DWA NIEZALEŻNE DOWODY, wzorem ADR-057 D1 (skan i render osobno nie
 * wystarczają):
 *  (1) ARTEFAKT — reguły `.sidebar-nav [aria-current="page"]` w źródle prawdy
 *      muszą malować TEN kierunek: jasną powierzchnię neutralną z limonkowym
 *      markerem, ciemną wypełnioną akcentem, obie bez widocznej krawędzi.
 *      Bez tej nogi dokumentacja pokazuje wersję, której produkt już nie ma —
 *      dokładnie to stało się po PR #313, który zdjął nogę zamiast
 *      zaktualizować artefakt.
 *  (2) RENDER — wyjściowy HTML sidebara musi nieść te same cztery nośniki
 *      decyzji: neutralne tło, limonkowy marker, jego geometrię i brak
 *      widocznej krawędzi. Sam artefakt nie broni kodu, a sam kod nie broni
 *      artefaktu.
 */

const artifact = readFileSync(
  resolve(process.cwd(), "../../docs/branding/2026-07-20-avably-faza-2-system.html"),
  "utf8",
);

/** Reguła artefaktu: ciało plus informacja, czy stoi pod `.dark`. */
type ArtifactRule = { readonly dark: boolean; readonly body: string };

/**
 * Wariantu NIE poznajemy po kolejności w pliku — przestawienie reguł nie może
 * po cichu zamienić dowodu jasnego z ciemnym. Rozstrzyga obecność prefiksu
 * `.dark` W SAMYM DOPASOWANIU (grupa 1).
 */
const rulesOf = (pattern: RegExp): ArtifactRule[] =>
  [...artifact.matchAll(pattern)].map((match) => ({
    dark: match[1] !== undefined,
    body: match[2] ?? "",
  }));

/**
 * Reguły POWIERZCHNI aktywnej pozycji. `\s*\{` zaraz po selektorze celowo
 * odcina `::before` — marker ma własny zbiór i własną kontrolę po pustym
 * zbiorze, bo jedno wyrażenie na oba dawałoby zieleń przy zgubieniu markera.
 */
const activeRules = rulesOf(
  /(\.dark\s+)?\.sidebar-nav \[aria-current="page"\]\s*\{([^}]*)\}/g,
);

/**
 * Reguły MARKERA — limonkowej kropki, która po ADR-177 niesie wyróżnienie.
 * `[data-lime-use]` w selektorze jest częścią kontraktu artefaktu, nie
 * ozdobnikiem: skan nośników limonki (`verify-branding-phase2.mjs`) ogląda
 * pojedynczą regułę, więc lime malowana w regule pseudoelementu musi mieć
 * nośnik zadeklarowany na elemencie.
 */
const markerRules = rulesOf(
  /(\.dark\s+)?\.sidebar-nav \[aria-current="page"\]\[data-lime-use\]::before\s*\{([^}]*)\}/g,
);

/**
 * Ciało żądanego wariantu. Brak reguły jest BŁĘDEM, nie pustym ciałem —
 * inaczej asercje na tekście byłyby zielone dlatego, że parser nic nie
 * znalazł (lekcja „dowód po pustym zbiorze", PR #75).
 */
function variantBody(rules: ArtifactRule[], dark: boolean, what: string): string {
  const found = rules.find((rule) => rule.dark === dark);
  if (found === undefined) throw new Error(`Artefakt nie ma reguły: ${what}`);
  return found.body;
}

/** Wartość deklaracji `background` z ciała reguły (`""`, gdy jej nie ma). */
const backgroundOf = (body: string): string =>
  body.match(/background:\s*([^;]+)/)?.[1]?.trim() ?? "";

/**
 * Czy ciało reguły deklaruje KRAWĘDŹ. `border-radius` przechodzi: to
 * geometria narożnika, nie kreska — a marker jest okrągły.
 */
const DECLARES_BORDER =
  /(?:^|[;{\s])border(?:-(?:top|right|bottom|left|inline|block|color|style|width)[\w-]*)?\s*:/;

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
    // Kontrola po pustym zbiorze: bez tej podłogi asercje niżej byłyby
    // zielone dlatego, że parser/render nic nie znalazł.
    expect(activeRules).toHaveLength(2);
    // Marker ma WŁASNĄ podłogę — zgubiony `::before` w artefakcie nie może
    // przejść jako „reguła bez krawędzi".
    expect(markerRules).toHaveLength(2);
    // Obie powierzchnie, nie tylko jasna: wariant `.dark` musi istnieć, inaczej
    // kontrakt pilnowałby połowy artefaktu.
    expect(artifact).toContain('.dark .sidebar-nav [aria-current="page"]');
    expect(activeClasses.length).toBeGreaterThan(5);
  });

  it("artefakt maluje kierunek ADR-177: jasny neutralnie z kropką, ciemny akcentem", () => {
    const light = variantBody(activeRules, false, 'jasna powierzchnia [aria-current="page"]');
    const dark = variantBody(activeRules, true, 'ciemna powierzchnia [aria-current="page"]');
    const lightMarker = variantBody(markerRules, false, "jasny marker ::before");
    const darkMarker = variantBody(markerRules, true, "ciemny marker ::before");

    // Jasny wariant: limonka NIE zalewa już wiersza, powierzchnia jest neutralna…
    expect(backgroundOf(light)).toContain("var(--muted)");
    expect(backgroundOf(light)).not.toContain("var(--accent)");
    // …ale WYRÓŻNIENIE MUSI ZOSTAĆ. Bez tej asercji „brak krawędzi" spełniałby
    // też wariant, w którym aktywna pozycja przestała się w ogóle wyróżniać.
    expect(backgroundOf(lightMarker)).toBe("var(--accent)");
    expect(lightMarker).toMatch(/border-radius:/);
    expect(lightMarker).toMatch(/content:\s*""/);

    // Ciemny wariant: wypełnienie akcentem zostaje (decyzja kontrastowa
    // ADR-177), a marker przechodzi na nośnik widoczny na tej powierzchni.
    expect(backgroundOf(dark)).toBe("var(--accent)");
    expect(backgroundOf(darkMarker)).toBe("var(--accent-foreground)");
  });

  it("render dostarcza realny aktywny link", () => {
    expect(activeClasses.length).toBeGreaterThan(5);
    expect(activeClasses).toContain("bg-muted/60");
    expect(activeClasses).toContain("before:bg-accent");
    expect(activeClasses).toContain("before:rounded-full");
    expect(activeClasses).toContain("rail-collapsed:before:hidden");
    expect(activeClasses).not.toContain("bg-accent");
    expect(activeClasses).toContain("dark:bg-accent");
  });

  it("oba predykaty krawędzi widzą kreskę, którą właśnie zdjęto", () => {
    // Kontrola POZYTYWNA: bez niej zepsuty predykat dawałby zielone na
    // każdym zbiorze klas (lekcja „dowód po pustym zbiorze", PR #75).
    expect(paintsBorderColor("border-l-signal-strong")).toBe(true);
    expect(paintsBorderColor("dark:border-l-accent-foreground")).toBe(true);
    // …i nie myli koloru z geometrią ani z nośnikiem focusu.
    expect(paintsBorderColor("border-l-2")).toBe(false);
    expect(paintsBorderColor("border-transparent")).toBe(false);
    expect(paintsBorderColor("focus-visible:border-foreground")).toBe(false);

    // Ta sama kontrola dla predykatu ARTEFAKTU: musi widzieć kreskę…
    expect(DECLARES_BORDER.test("border-left: 2px solid var(--accent);")).toBe(true);
    expect(DECLARES_BORDER.test("background: var(--muted); border: 1px solid #7E8994;")).toBe(true);
    expect(DECLARES_BORDER.test("border-inline-start: 2px solid #0B1017;")).toBe(true);
    // …i nie mylić jej z zaokrągleniem narożnika ani z okrągłym markerem.
    expect(DECLARES_BORDER.test("border-radius: 999px;")).toBe(false);
    expect(DECLARES_BORDER.test("background: var(--accent); border-radius: var(--radius-md);")).toBe(
      false,
    );
  });

  it("artefakt nie deklaruje krawędzi przy aktywnej pozycji", () => {
    // Marker liczy się tak samo jak powierzchnia: kolorowa kreska dołożona
    // do kropki jest tą samą krawędzią, której zakazał właściciel.
    const offenders = [...activeRules, ...markerRules]
      .map((rule) => rule.body)
      .filter((body) => DECLARES_BORDER.test(body));

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
