// @vitest-environment jsdom
/**
 * LISTWA KATEGORII W NAGŁÓWKU (F7; wcześniej menu ADR-247) + KONTRAKT S-30
 * („nawigacja do oferty stoi na każdej trasie").
 *
 * ==================== CZEGO PILNUJE TEN PLIK ====================
 *
 * 1. S-30 BEZ REGRESU: każda trasa powłoki dalej PODAJE `categoryNav`,
 *    a powłoka z pozycjami dalej rysuje nawigację kategorii (znacznik
 *    `data-store-category-menu` — ten sam, na którym stoją testy tras).
 * 2. F7: nawigacja jest LISTWĄ (drugi rząd nagłówka), nie dropdownem:
 *    pozioma listwa od 48 rem KONTENERA, chipsy przewijane poniżej —
 *    wyłącznie na trasach katalogowych; na kasie/koszyku listwy nie ma.
 * 3. `> 8` kategorii → nadmiar w „Więcej ▾" (details, panel klampowany).
 * 4. `aria-current="page"` na bieżącej kategorii i na „Cały katalog".
 * 5. Cele dotykowe 44 px i warianty KONTENEROWE (bez `sm:`/`md:`/`lg:` —
 *    ADR-085: podgląd mierzy własną szerokość, nie okna).
 *
 * DOWÓD MUTACYJNY (wymóg F7): zdjęcie listwy z powłoki gasi testy S-30
 * niżej; zdjęcie chipsów gasi test chipsów; zdjęcie „Więcej" gasi test
 * nadmiaru; zdjęcie `aria-current` gasi test bieżącej kategorii.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DEFAULT_SITE_STYLE } from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { PageShell } from "../components/storefront/page-shell";
import { StoreCategoryMenu } from "../components/storefront/store-category-menu";
import type { StoreHeaderMode } from "../components/storefront/store-chrome";
import type { CategoryNavItem } from "../lib/catalog/category-nav";
import { getStorefrontCopy } from "../lib/storefront/copy";

afterEach(cleanup);

const BAZA_ZDJEC = "https://storage.test/storage/v1/object/public/site-images";

const POZYCJE: CategoryNavItem[] = [
  { id: "c-1", name: "Kosiarki", slug: "kosiarki", href: "/kategoria/kosiarki", count: 3 },
  { id: "c-2", name: "Agregaty", slug: "agregaty", href: "/kategoria/agregaty", count: 2 },
];

/** Dziewięć kategorii — jedna PONAD limit listwy (spec F7: > 8 → „Więcej"). */
const DZIEWIEC: CategoryNavItem[] = Array.from({ length: 9 }, (_, i) => ({
  id: `c-${i + 1}`,
  name: `Kategoria ${i + 1}`,
  slug: `kat-${i + 1}`,
  href: `/kategoria/kat-${i + 1}`,
  count: 1,
}));

const ETYKIETY = {
  label: "Kategorie",
  allCatalogLabel: "Cały katalog",
  moreLabel: "Więcej",
};

async function renderPodstrony(
  categoryNav?: readonly CategoryNavItem[],
  headerMode?: StoreHeaderMode,
): Promise<string> {
  const copy = await getStorefrontCopy("pl");
  return renderToStaticMarkup(
    <PageShell
      style={DEFAULT_SITE_STYLE}
      copy={copy}
      storeName="Sklep"
      site={null}
      logo={null}
      siteImageBase={BAZA_ZDJEC}
      term={null}
      {...(categoryNav ? { categoryNav } : {})}
      {...(headerMode ? { headerMode } : {})}
    >
      <p>treść podstrony</p>
    </PageShell>,
  );
}

describe("S-30 — nawigacja kategorii na podstronach (PageShell)", () => {
  it("podstrona z pozycjami niesie listwę kategorii w nagłówku", async () => {
    const html = await renderPodstrony(POZYCJE);
    expect(html, "kontrola przyrządu: powłoka się nie wyrenderowała").toContain("treść podstrony");
    expect(html, "listwa kategorii nie doszła na podstronę — nagłówek bez nawigacji do oferty").toContain(
      "data-store-category-menu",
    );
    expect(html).toContain('href="/kategoria/kosiarki"');
    expect(html).toContain("Agregaty");
    // „Cały katalog" domyka listwę (spec F7 pkt 2).
    expect(html, "listwa bez odnośnika do pełnego katalogu").toContain('href="/katalog"');
  });

  it("bez pozycji listwa NIE staje (pusty rząd obiecywałby nawigację, której nie ma)", async () => {
    const html = await renderPodstrony();
    expect(html).toContain("treść podstrony");
    expect(html).not.toContain("data-store-category-menu");
  });

  it("tryb KASOWY zdejmuje listwę mimo podanych pozycji (F7 pkt 4)", async () => {
    const html = await renderPodstrony(POZYCJE, "checkout");
    expect(html).toContain("treść podstrony");
    expect(html, "kasa dostała listwę kategorii — dystrakcja wróciła").not.toContain(
      "data-store-category-menu",
    );
  });

  it("tryb TREŚCIOWY (domyślny) nie dokłada chipsów mobilnych (F7 pkt 3)", async () => {
    const html = await renderPodstrony(POZYCJE);
    expect(html).toContain("data-store-category-menu");
    expect(html, "chipsy weszły na stronę treściową — spec daje je trasom katalogowym").not.toContain(
      "data-store-category-chips",
    );
  });

  it("tryb KATALOGOWY dokłada chipsy mobilne (F7 pkt 3)", async () => {
    const html = await renderPodstrony(POZYCJE, "catalog");
    expect(html).toContain("data-store-category-chips");
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

  it("koszyk i cała ścieżka /checkout/* deklarują tryb KASOWY (kontrakt wywołań)", () => {
    const kasowe = [
      "app/(tenant)/cart/page.tsx",
      "app/(tenant)/checkout/page.tsx",
      "app/(tenant)/checkout/platnosc/page.tsx",
      "app/(tenant)/checkout/platnosc/status/page.tsx",
    ];
    for (const trasa of kasowe) {
      const zrodlo = readFileSync(resolve(process.cwd(), trasa), "utf8");
      expect(zrodlo, `${trasa} zgubiła tryb kasowy — listwa i pole wracają do kasy`).toContain(
        'headerMode="checkout"',
      );
    }
  });
});

describe("F7 — listwa kategorii (forma szeroka)", () => {
  it("listwa jest ukryta poniżej 48 rem KONTENERA i pozioma powyżej", () => {
    const { container } = render(<StoreCategoryMenu items={POZYCJE} {...ETYKIETY} />);
    const bar = container.querySelector("[data-store-category-bar]");
    expect(bar, "listwy nie ma w dokumencie").not.toBeNull();
    for (const klasa of ["hidden", "@min-[48rem]/site:flex"]) {
      expect(bar!.className, `listwa straciła ${klasa} — rozjazd form robi kontener, nie viewport`).toContain(
        klasa,
      );
    }
  });

  it("odnośniki listwy mają cele dotykowe 44 px (S-15: text-sm + py-3)", () => {
    const { container } = render(<StoreCategoryMenu items={POZYCJE} {...ETYKIETY} />);
    const pozycja = container.querySelector('[data-store-category-bar] a[href="/kategoria/kosiarki"]');
    expect(pozycja).not.toBeNull();
    expect(pozycja!.className, "odnośnik listwy poniżej celu dotykowego").toContain("py-3");
  });

  it("bieżąca kategoria niesie aria-current i akcent; pozostałe NIE (dwie nogi dowodu)", () => {
    const { container } = render(
      <StoreCategoryMenu items={POZYCJE} {...ETYKIETY} currentPath="/kategoria/agregaty" />,
    );
    const biezaca = container.querySelector('[data-store-category-bar] a[href="/kategoria/agregaty"]');
    expect(biezaca!.getAttribute("aria-current")).toBe("page");
    expect(biezaca!.className, "aria-current bez wyróżnienia byłby niewidzialny").toContain(
      "aria-[current=page]:font-semibold",
    );
    const inna = container.querySelector('[data-store-category-bar] a[href="/kategoria/kosiarki"]');
    expect(inna!.hasAttribute("aria-current")).toBe(false);
  });

  it("„Cały katalog” stoi na końcu listwy i dostaje aria-current na /katalog", () => {
    const { container } = render(
      <StoreCategoryMenu items={POZYCJE} {...ETYKIETY} currentPath="/katalog" />,
    );
    const linki = container.querySelectorAll("[data-store-category-bar] a");
    const ostatni = linki[linki.length - 1]!;
    expect(ostatni.getAttribute("href")).toBe("/katalog");
    expect(ostatni.textContent).toBe("Cały katalog");
    expect(ostatni.getAttribute("aria-current")).toBe("page");
  });

  it("przy ≤ 8 kategoriach „Więcej” NIE staje (wyzwalacz bez nadmiaru byłby pusty)", () => {
    const { container } = render(<StoreCategoryMenu items={DZIEWIEC.slice(0, 8)} {...ETYKIETY} />);
    expect(container.querySelector("[data-store-category-more]")).toBeNull();
    expect(container.querySelectorAll("[data-store-category-bar] a")).toHaveLength(9); // 8 + katalog
  });

  it("przy > 8 kategoriach nadmiar idzie do „Więcej ▾”, a wprost stoi 6 (spec F7 + klamp rzędu)", () => {
    const { container } = render(<StoreCategoryMenu items={DZIEWIEC} {...ETYKIETY} />);
    const more = container.querySelector("details[data-store-category-more]");
    expect(more, "dziewiąta kategoria nie dostała „Więcej” — listwa rośnie bez końca").not.toBeNull();
    expect(more!.querySelector("summary")!.textContent).toContain("Więcej");
    // Pozycje 7–9 stoją W PANELU, nie w listwie wprost.
    for (const n of [7, 8, 9]) {
      expect(
        more!.querySelector(`a[href="/kategoria/kat-${n}"]`),
        `kategoria ${n} wypadła z panelu`,
      ).not.toBeNull();
    }
    /*
      Wprost: 6 pozycji + „Cały katalog" (poza details) — świadome odstępstwo
      od literalnych ośmiu: 8 + „Więcej" + „Cały katalog" NIE mieści się
      w kolumnie 60 rem i łamało listwę w dwa wiersze (patrz docblock
      `INLINE_WITH_MORE` w komponencie).
    */
    const bar = container.querySelector("[data-store-category-bar]")!;
    const wprost = [...bar.querySelectorAll("a")].filter((a) => a.closest("details") === null);
    expect(wprost).toHaveLength(7);
    expect(wprost.some((a) => a.getAttribute("href") === "/kategoria/kat-7")).toBe(false);
  });

  it("panel „Więcej” klampuje się do kontenera (technika S-01) i do okna w pionie", () => {
    const { container } = render(<StoreCategoryMenu items={DZIEWIEC} {...ETYKIETY} />);
    const more = container.querySelector("details[data-store-category-more]")!;
    // Poniżej 64 rem kotwicą jest wiersz listwy (`relative` na jej pudełku).
    expect(more.className).toContain("static");
    expect(more.className).toContain("@min-[64rem]/site:relative");
    expect(container.querySelector("[data-store-category-bar]")!.className).toContain("relative");
    const panel = more.querySelector("div.site-card")!;
    for (const klasa of [
      "left-0",
      "right-0",
      "max-h-[60vh]",
      "overflow-auto",
      "@min-[64rem]/site:right-0",
      "@min-[64rem]/site:w-56",
    ]) {
      expect(panel.className, `panel „Więcej" stracił ${klasa} — wraca wystawanie poza okno`).toContain(
        klasa,
      );
    }
    // Stała szerokość NIE MOŻE stać bezwarunkowo — to ona wystawała (S-01).
    expect(panel.className.split(/\s+/)).not.toContain("w-56");
  });
});

describe("F7 — chipsy kategorii (forma wąska, trasy katalogowe)", () => {
  it("chipsy: przewijane poziomo, scroll-snap, bez paska, ukryte od 48 rem", () => {
    const { container } = render(<StoreCategoryMenu items={POZYCJE} {...ETYKIETY} chips />);
    const chips = container.querySelector("[data-store-category-chips]");
    expect(chips, "trasa katalogowa bez chipsów — telefon traci nawigację półek").not.toBeNull();
    for (const klasa of ["overflow-x-auto", "snap-x", "[scrollbar-width:none]"]) {
      expect(chips!.className, `rząd chipsów stracił ${klasa}`).toContain(klasa);
    }
    expect(
      chips!.parentElement!.className,
      "chipsy widoczne na szerokim kontenerze — dublują listwę",
    ).toContain("@min-[48rem]/site:hidden");
  });

  it("chips ma 44 px wysokości (h-11), snap-start i aria-current na bieżącej", () => {
    const { container } = render(
      <StoreCategoryMenu items={POZYCJE} {...ETYKIETY} chips currentPath="/kategoria/kosiarki" />,
    );
    const chip = container.querySelector('[data-store-category-chips] a[href="/kategoria/kosiarki"]')!;
    for (const klasa of ["h-11", "snap-start", "whitespace-nowrap"]) {
      expect(chip.className, `chips stracił ${klasa}`).toContain(klasa);
    }
    expect(chip.getAttribute("aria-current")).toBe("page");
    // „Cały katalog" jest też chipsem — telefon nie traci wejścia do pełnej oferty.
    expect(container.querySelector('[data-store-category-chips] a[href="/katalog"]')).not.toBeNull();
  });

  it("bez `chips` rzędu nie ma (strony treściowe) — druga noga dowodu trybu", () => {
    const { container } = render(<StoreCategoryMenu items={POZYCJE} {...ETYKIETY} />);
    expect(container.querySelector("[data-store-category-chips]")).toBeNull();
  });
});

describe("F7 — warianty wyłącznie KONTENEROWE (ADR-085)", () => {
  it("żadna klasa listwy/chipsów nie używa progów viewportowych sm:/md:/lg:", () => {
    const { container } = render(
      <StoreCategoryMenu items={DZIEWIEC} {...ETYKIETY} chips currentPath="/katalog" />,
    );
    for (const el of container.querySelectorAll("*")) {
      // `getAttribute`, nie `className` — na SVG className to SVGAnimatedString.
      for (const klasa of (el.getAttribute("class") ?? "").split(/\s+/)) {
        expect(
          /^(sm|md|lg|xl):/.test(klasa),
          `klasa viewportowa „${klasa}" w listwie — podgląd w panelu mierzy kontener, nie okno`,
        ).toBe(false);
      }
    }
  });
});
