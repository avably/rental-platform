// @vitest-environment jsdom
/**
 * KATEGORIE W BELCE — IKONA Z ROZWIJANĄ LISTĄ (F7b) + KONTRAKT S-30
 * („nawigacja do oferty stoi na każdej trasie").
 *
 * ==================== CZEGO PILNUJE TEN PLIK ====================
 *
 * 1. S-30 BEZ REGRESU: każda trasa powłoki dalej PODAJE `categoryNav`,
 *    a powłoka z pozycjami dalej rysuje nawigację kategorii (znacznik
 *    `data-store-category-menu` — ten sam, na którym stoją testy tras).
 * 2. F7b: nawigacja jest JEDNĄ IKONĄ 44 × 44 z rozwijaną listą — nie ma już
 *    ani poziomej listwy (rząd 2), ani chipsów mobilnych, ani wyzwalacza
 *    „Więcej" (formy z F7). Lista niesie WSZYSTKIE półki, bez limitu.
 * 3. „Wszystkie kategorie" domyka listę i prowadzi na `/katalog`.
 * 4. `aria-current="page"` na bieżącej półce i na „Wszystkich kategoriach".
 * 5. Panel klampowany (S-01) i chowany `display:none` — inaczej sonda
 *    geometrii widzi wiersze zamkniętego `details`.
 * 6. Warianty wyłącznie KONTENEROWE (bez `sm:`/`md:`/`lg:` — ADR-085).
 * 7. KASA MA TEN SAM ZESTAW (korekta właściciela): tryb kasowy z F7 zniknął
 *    razem z propsem `headerMode`, więc koszyk i kasa dostają wyzwalacz
 *    kategorii jak każda inna trasa.
 *
 * DOWÓD MUTACYJNY: zdjęcie wyzwalacza z powłoki gasi testy S-30; przywrócenie
 * listwy/chipsów gasi test „form z F7 nie ma"; zdjęcie separatora i pozycji
 * katalogu gasi test „Wszystkich kategorii"; zdjęcie `aria-current` gasi test
 * bieżącej półki; przywrócenie limitu 8 pozycji gasi test pełnej listy.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DEFAULT_SITE_STYLE } from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { PageShell } from "../components/storefront/page-shell";
import { StoreCategoryMenu } from "../components/storefront/store-category-menu";
import type { CategoryNavItem } from "../lib/catalog/category-nav";
import { getStorefrontCopy } from "../lib/storefront/copy";

afterEach(cleanup);

const BAZA_ZDJEC = "https://storage.test/storage/v1/object/public/site-images";

const POZYCJE: CategoryNavItem[] = [
  { id: "c-1", name: "Kosiarki", slug: "kosiarki", href: "/kategoria/kosiarki", count: 3 },
  { id: "c-2", name: "Agregaty", slug: "agregaty", href: "/kategoria/agregaty", count: 2 },
];

/** Dziewięć kategorii — PONAD limit, którym listwa F7 tłumaczyła „Więcej ▾". */
const DZIEWIEC: CategoryNavItem[] = Array.from({ length: 9 }, (_, i) => ({
  id: `c-${i + 1}`,
  name: `Kategoria ${i + 1}`,
  slug: `kat-${i + 1}`,
  href: `/kategoria/kat-${i + 1}`,
  count: 1,
}));

const ETYKIETY = {
  label: "Kategorie",
  allCategoriesLabel: "Wszystkie kategorie",
};

async function renderPodstrony(categoryNav?: readonly CategoryNavItem[]): Promise<string> {
  const copy = await getStorefrontCopy("pl");
  return renderToStaticMarkup(
    <PageShell
      style={DEFAULT_SITE_STYLE}
      copy={copy}
      storeName="Wypożyczalnia Kontrolna"
      site={null}
      logo={null}
      siteImageBase={BAZA_ZDJEC}
      term={null}
      {...(categoryNav ? { categoryNav } : {})}
    >
      <p>treść podstrony</p>
    </PageShell>,
  );
}

describe("S-30 — nawigacja kategorii na podstronach (PageShell)", () => {
  it("podstrona z pozycjami niesie wyzwalacz kategorii w nagłówku", async () => {
    const html = await renderPodstrony(POZYCJE);
    expect(html, "kontrola przyrządu: powłoka się nie wyrenderowała").toContain("treść podstrony");
    expect(
      html,
      "kategorie nie doszły na podstronę — nagłówek bez nawigacji do oferty",
    ).toContain("data-store-category-menu");
    expect(html).toContain('href="/kategoria/kosiarki"');
    expect(html).toContain("Agregaty");
    // „Wszystkie kategorie" domyka listę (F7b).
    expect(html, "lista bez odnośnika do pełnego katalogu").toContain('href="/katalog"');
  });

  it("bez pozycji wyzwalacz NIE staje (ikona otwierałaby pustą listę)", async () => {
    const html = await renderPodstrony();
    expect(html).toContain("treść podstrony");
    expect(html).not.toContain("data-store-category-menu");
  });

  it("KAŻDA trasa powłoki podaje categoryNav — kontrakt wywołań", () => {
    /*
      Domknięcie od strony ŹRÓDŁA (wzorzec: „trasa katalogu podaje rendererowi
      SEKCJE STRONY" w shell-footer.test.tsx). Render wyżej dowodzi mechaniki
      PageShell; ten kontrakt pilnuje, żeby żadna trasa nie wróciła do wariantu
      „nagłówek bez nawigacji" po cichu. Lista jest DOKŁADNA: to wszystkie
      wywołania PageShell/StoreChrome w aplikacji.
    */
    const trasy = [
      "app/(tenant)/cart/page.tsx",
      "app/(tenant)/checkout/page.tsx",
      "app/(tenant)/checkout/platnosc/page.tsx",
      "app/(tenant)/checkout/platnosc/status/page.tsx",
      "app/(tenant)/not-found.tsx",
      "app/(tenant)/store/page.tsx",
      "app/(tenant)/store/[slug]/page.tsx",
      "app/(tenant)/katalog/page.tsx",
      "components/storefront/legal-page.tsx",
      "lib/catalog/category-page.tsx",
      "lib/catalog/product-page.tsx",
    ];
    for (const trasa of trasy) {
      const zrodlo = readFileSync(resolve(process.cwd(), trasa), "utf8");
      const kod = zrodlo.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");
      expect(kod, `${trasa} przestała podawać categoryNav — jej nagłówek traci nawigację`).toContain(
        "categoryNav={",
      );
    }
  });

  /*
    KONIEC TRYBÓW NAGŁÓWKA (F7b). Do F7b koszyk i cała ścieżka `/checkout/*`
    deklarowały `headerMode="checkout"` (bez listwy, search jako ikona), a trasy
    katalogowe `headerMode="catalog"`. Właściciel rozstrzygnął, że zestaw ikon
    ma być wszędzie TEN SAM — prop stracił więc jedyne, co różnicował, i został
    usunięty. Ten kontrakt jest odwrotnością poprzedniego: pilnuje, żeby tryby
    nie wróciły po cichu jako martwa konfiguracja, której nagłówek nie czyta.
  */
  it("żadna trasa nie deklaruje już trybu nagłówka (prop zniknął razem z wariantami)", () => {
    const trasy = [
      "app/(tenant)/cart/page.tsx",
      "app/(tenant)/checkout/page.tsx",
      "app/(tenant)/checkout/platnosc/page.tsx",
      "app/(tenant)/checkout/platnosc/status/page.tsx",
      "app/(tenant)/katalog/page.tsx",
      "app/(tenant)/store/page.tsx",
      "lib/catalog/category-page.tsx",
      "lib/catalog/product-page.tsx",
      "components/storefront/store-chrome.tsx",
      "components/storefront/page-shell.tsx",
    ];
    for (const trasa of trasy) {
      const zrodlo = readFileSync(resolve(process.cwd(), trasa), "utf8");
      const kod = zrodlo.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");
      expect(kod, `${trasa} wróciła do trybów nagłówka — belka miała być jedna`).not.toContain(
        "headerMode",
      );
    }
  });

  it("KASA dostaje kategorie jak każda trasa (koniec redukcji dystrakcji z F7)", async () => {
    /*
      Druga noga poprzedniego kontraktu, tym razem na SKUTKU: trasa kasowa
      renderuje ten sam wyzwalacz. Do F7b powłoka gasiła nawigację na
      `/cart` i `/checkout/*`; właściciel chce „analogicznie wszędzie".
      Powłoka kasowa i treściowa różnią się dziś WYŁĄCZNIE treścią strony.
    */
    const html = await renderPodstrony(POZYCJE);
    expect(html).toContain("data-store-category-menu");
    expect(html).toContain("data-store-header-search-toggle");
  });
});

describe("F7b — kategorie jako ikona z rozwijaną listą", () => {
  it("wyzwalacz to `details` z celem 44 × 44 i nazwą dostępną (sam znak nic nie mówi)", () => {
    const { container } = render(<StoreCategoryMenu items={POZYCJE} {...ETYKIETY} />);
    const details = container.querySelector("details[data-store-category-dropdown]");
    expect(details, "wyzwalacza kategorii nie ma w dokumencie").not.toBeNull();
    const summary = details!.querySelector("summary")!;
    expect(summary.getAttribute("aria-label")).toBe("Kategorie");
    for (const klasa of ["h-11", "w-9", "@min-[28rem]/site:w-10", "@min-[40rem]/site:w-11"]) {
      expect(summary.className, `wyzwalacz stracił ${klasa} — cel dotykowy poniżej minimum`).toContain(
        klasa,
      );
    }
    // Znak jest dekoracją kontrolki, nie jej nazwą — inaczej czytnik czytałby dwa razy.
    expect(summary.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  /*
    [F12] NAGŁÓWEK PANELU — DRUGA POŁOWA ZMIANY ZNAKU. Belka nosi od F12 trzy
    kreski, czyli konwencję czytaną jako „menu"; odcień „to są PÓŁKI oferty"
    dopowiada pierwsza rzecz widziana po tapnięciu.

    CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie nagłówka (znak wraca do bycia zagadką),
    wpisanie mu WŁASNEGO napisu zamiast `label` (dwa źródła jednej nazwy —
    oko i czytnik ekranu dostają różne odpowiedzi) albo zdjęcie `aria-hidden`
    (czytnik czyta „Kategorie" dwa razy: z `summary` i z nagłówka).
  */
  it("panel otwiera się nagłówkiem „Kategorie” — tym samym napisem, co nazwa wyzwalacza", () => {
    const { container } = render(<StoreCategoryMenu items={POZYCJE} {...ETYKIETY} />);
    const naglowek = container.querySelector("[data-store-category-heading]");
    expect(naglowek, "panel bez nagłówka — po tapnięciu nie wiadomo, co się otworzyło").not.toBeNull();
    expect(naglowek!.textContent).toBe(ETYKIETY.label);
    expect(naglowek!.getAttribute("aria-label"), "nagłówek dorobił sobie drugą nazwę").toBeNull();
    expect(
      naglowek!.getAttribute("aria-hidden"),
      "nagłówek czytany na głos powtarza nazwę widgetu z `summary`",
    ).toBe("true");
    // Stoi PRZED listą półek, nie pod nią — inaczej nie zdąży niczego wyjaśnić.
    const panel = container.querySelector("div.site-card")!;
    expect(panel.firstElementChild, "nagłówek nie jest pierwszy w panelu").toBe(naglowek);
    // Wyzwalacz i nagłówek biorą napis z JEDNEGO propsa.
    expect(container.querySelector("summary")!.getAttribute("aria-label")).toBe(
      naglowek!.textContent,
    );
  });

  it("form z F7 NIE MA: ani listwy, ani chipsów, ani wyzwalacza „Więcej”", () => {
    const { container } = render(<StoreCategoryMenu items={DZIEWIEC} {...ETYKIETY} />);
    for (const znacznik of [
      "[data-store-category-bar]",
      "[data-store-category-chips]",
      "[data-store-category-more]",
    ]) {
      expect(
        container.querySelector(znacznik),
        `forma z F7 (${znacznik}) wróciła do belki — właściciel zdjął ją z produkcji`,
      ).toBeNull();
    }
  });

  it("lista niesie WSZYSTKIE półki — bez limitu ośmiu i bez nadmiaru w drugim panelu", () => {
    const { container } = render(<StoreCategoryMenu items={DZIEWIEC} {...ETYKIETY} />);
    for (const n of [1, 6, 7, 9]) {
      expect(
        container.querySelector(`a[href="/kategoria/kat-${n}"]`),
        `kategoria ${n} wypadła z listy — limit listwy F7 wrócił`,
      ).not.toBeNull();
    }
    // 9 półek + „Wszystkie kategorie".
    expect(container.querySelectorAll("a")).toHaveLength(10);
  });

  it("„Wszystkie kategorie” domyka listę, prowadzi na /katalog i stoi za separatorem", () => {
    const { container } = render(<StoreCategoryMenu items={POZYCJE} {...ETYKIETY} />);
    const linki = container.querySelectorAll("a");
    const ostatni = linki[linki.length - 1]!;
    expect(ostatni.getAttribute("href")).toBe("/katalog");
    expect(ostatni.textContent).toBe("Wszystkie kategorie");
    expect(ostatni.hasAttribute("data-store-category-all")).toBe(true);
    // Kreska mówi „to nie jest kolejna półka" wcześniej, niż da się przeczytać napis.
    expect(
      ostatni.parentElement!.className,
      "separator przed wejściem do katalogu zniknął",
    ).toContain("site-rule-top");
  });

  it("bieżąca półka niesie aria-current i akcent; sąsiadka NIE (dwie nogi dowodu)", () => {
    const { container } = render(
      <StoreCategoryMenu items={POZYCJE} {...ETYKIETY} currentPath="/kategoria/agregaty" />,
    );
    const biezaca = container.querySelector('a[href="/kategoria/agregaty"]')!;
    expect(biezaca.getAttribute("aria-current")).toBe("page");
    expect(biezaca.className, "aria-current bez wyróżnienia byłby niewidzialny").toContain(
      "aria-[current=page]:font-semibold",
    );
    expect(container.querySelector('a[href="/kategoria/kosiarki"]')!.hasAttribute("aria-current")).toBe(
      false,
    );
  });

  it("„Wszystkie kategorie” dostają aria-current na /katalog", () => {
    const { container } = render(
      <StoreCategoryMenu items={POZYCJE} {...ETYKIETY} currentPath="/katalog" />,
    );
    expect(container.querySelector('a[href="/katalog"]')!.getAttribute("aria-current")).toBe("page");
  });

  it("panel: klamp do kontenera (S-01), do okna w pionie i ZEROWA geometria po zamknięciu", () => {
    const { container } = render(<StoreCategoryMenu items={DZIEWIEC} {...ETYKIETY} />);
    const details = container.querySelector("details[data-store-category-dropdown]")!;
    // Poniżej 64 rem kotwicą jest wiersz belki (`relative` w StoreShellHeader).
    expect(details.className).toContain("static");
    expect(details.className).toContain("@min-[64rem]/site:relative");
    const panel = details.querySelector("div.site-card")!;
    for (const klasa of [
      "left-0",
      "right-0",
      "max-h-[60vh]",
      "overflow-auto",
      "@min-[64rem]/site:left-auto",
      "@min-[64rem]/site:right-0",
      "@min-[64rem]/site:w-64",
    ]) {
      expect(panel.className, `panel listy stracił ${klasa} — wraca wystawanie poza okno`).toContain(
        klasa,
      );
    }
    // Stała szerokość NIE MOŻE stać bezwarunkowo — to ona wystawała (S-01).
    expect(panel.className.split(/\s+/)).not.toContain("w-64");
    /*
      `display:none` na zamkniętym panelu: bez tego Chrome liczy layout treści
      w `content-visibility` i sonda geometrii (bramka overflow w shot.mjs)
      zgłasza wiersze, których nikt nie widzi.
    */
    expect(panel.className, "zamknięty panel zostawia geometrię").toContain("hidden");
    expect(panel.className).toContain("group-open:block");
  });
});

describe("F7b — warianty wyłącznie KONTENEROWE (ADR-085)", () => {
  it("żadna klasa wyzwalacza ani listy nie używa progów viewportowych sm:/md:/lg:", () => {
    const { container } = render(
      <StoreCategoryMenu items={DZIEWIEC} {...ETYKIETY} currentPath="/katalog" />,
    );
    for (const el of container.querySelectorAll("*")) {
      // `getAttribute`, nie `className` — na SVG className to SVGAnimatedString.
      for (const klasa of (el.getAttribute("class") ?? "").split(/\s+/)) {
        expect(
          /^(sm|md|lg|xl):/.test(klasa),
          `klasa viewportowa „${klasa}" w kategoriach — podgląd mierzy kontener, nie okno`,
        ).toBe(false);
      }
    }
  });
});
