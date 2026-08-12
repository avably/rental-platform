import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * KONTRAKT PASKA ZAKŁADEK REKORDU (U8b, ADR-146).
 *
 * Zakładki produktu prowadzą do OSOBNYCH TRAS, więc muszą być nawigacją:
 * linkami, z których bieżący niesie `aria-current="page"`. Wzorzec
 * `role="tablist"/"tab"` obiecałby czytnikowi ekranu panel w tym samym
 * dokumencie i odebrał linkom ich zachowanie (nowa karta, kopiowanie adresu).
 *
 * Test pilnuje trzech rzeczy, których komentarz nie utrzyma:
 *   1. wszystkie zakładki są kotwicami z adresem (kontrola POZYTYWNA — bez
 *      niej asercje „nie ma role=tab" przechodziłyby po pustym renderze),
 *   2. DOKŁADNIE JEDNA pozycja jest bieżąca na każdej z czterech tras —
 *      zakładka bazowa jest prefiksem wszystkich pozostałych, więc bez
 *      reguły „wygrywa najdłuższe dopasowanie" pasek pokazywałby dwie,
 *   3. w markupie nie ma ról widżetu zakładek.
 *
 * Render jak w pozostałych kontraktach panelu — `renderToStaticMarkup`,
 * bo suita chodzi w node bez testing-library.
 */

const pathname = vi.hoisted(() => ({ current: "/katalog/p1" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { RecordTabs, matchTabHref } = await import("@/components/screens/record-tabs");

const PRODUCT = "00000000-0000-4000-8000-000000000001";
const HREFS = [
  `/katalog/${PRODUCT}`,
  `/katalog/${PRODUCT}/egzemplarze`,
  `/katalog/${PRODUCT}/progi`,
  `/katalog/${PRODUCT}/zdjecia`,
];

function renderTabs(at: string): string {
  pathname.current = at;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <RecordTabs
        label={messages.catalog.record.tabsLabel}
        items={[
          { href: HREFS[0]!, label: messages.catalog.record.tabData },
          { href: HREFS[1]!, label: messages.catalog.record.tabUnits },
          { href: HREFS[2]!, label: messages.catalog.record.tabTiers },
          { href: HREFS[3]!, label: messages.catalog.record.tabImages },
        ]}
      />
    </NextIntlClientProvider>,
  );
}

describe("dopasowanie bieżącej zakładki", () => {
  it("trafia w zakładkę bazową na jej własnej trasie", () => {
    expect(matchTabHref(`/katalog/${PRODUCT}`, HREFS)).toBe(`/katalog/${PRODUCT}`);
  });

  it.each([
    ["egzemplarze", `/katalog/${PRODUCT}/egzemplarze`],
    ["progi", `/katalog/${PRODUCT}/progi`],
    ["zdjecia", `/katalog/${PRODUCT}/zdjecia`],
  ])("na podstronie %s wygrywa NAJDŁUŻSZE dopasowanie, nie prefiks bazowy", (_name, path) => {
    expect(matchTabHref(path, HREFS)).toBe(path);
  });

  it("trasa spoza rekordu nie ma bieżącej zakładki", () => {
    expect(matchTabHref("/katalog", HREFS)).toBeUndefined();
    expect(matchTabHref("/katalog/nowy", HREFS)).toBeUndefined();
    // Segment tylko ZACZYNAJĄCY SIĘ tak samo nie jest podstroną rekordu.
    expect(matchTabHref(`/katalog/${PRODUCT}x`, HREFS)).toBeUndefined();
  });
});

describe("pasek zakładek produktu jest NAWIGACJĄ", () => {
  const html = renderTabs(`/katalog/${PRODUCT}`);

  it("renderuje wszystkie cztery zakładki jako kotwice z adresem", () => {
    // Kontrola POZYTYWNA: bez niej asercje o braku ról niżej byłyby dowodem
    // po pustym zbiorze — pusty render też „nie zawiera role=tab".
    for (const href of HREFS) {
      expect(html, `brak zakładki ${href}`).toContain(`href="${href}"`);
    }
    expect(html.match(/data-record-tab\b/g) ?? []).toHaveLength(4);
    expect(html).toContain(messages.catalog.record.tabUnits);
  });

  it("nie używa ról widżetu zakładek", () => {
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain("aria-selected");
  });

  it("pasek ma własną nazwę dostępną", () => {
    expect(html).toContain(`aria-label="${messages.catalog.record.tabsLabel}"`);
  });

  it.each(HREFS)("na trasie %s bieżąca jest DOKŁADNIE JEDNA zakładka", (at) => {
    const markup = renderTabs(at);
    const currents = markup.match(/aria-current="page"/g) ?? [];
    expect(currents, `bieżących zakładek: ${currents.length}`).toHaveLength(1);

    // …i to ta właściwa: znacznik z `aria-current` musi nieść ten adres.
    const currentTag = markup.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0] ?? "";
    expect(currentTag).toContain(`href="${at}"`);
  });

  it("poza rekordem nie ma bieżącej zakładki", () => {
    const markup = renderTabs("/katalog");
    expect(markup).not.toContain('aria-current="page"');
    // Kontrola pozytywna: pasek NADAL się wyrenderował.
    expect(markup.match(/data-record-tab\b/g) ?? []).toHaveLength(4);
  });
});
