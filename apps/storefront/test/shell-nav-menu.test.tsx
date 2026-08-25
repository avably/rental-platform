// @vitest-environment jsdom
/**
 * MENU KATEGORII NA KAŻDEJ TRASIE SKLEPU (S-30 audytu UX 2026-08-25)
 * + CLAMP PANELU DO KONTENERA (S-01) + CELE DOTYKOWE MENU (S-15).
 *
 * ==================== S-30: CO BYŁO ZEPSUTE ====================
 *
 * Poza stroną główną, katalogiem i kategoriami nagłówek nie miał ŻADNEJ
 * nawigacji do oferty — na PDP, w koszyku, kasie i na dokumentach zostawało
 * samo logo i „Koszyk". Klient z linku zewnętrznego wracał do oferty tylko
 * klikiem w logo. Warunkowość menu była HISTORIĄ PRZEPŁYWU DANYCH (tylko
 * trasy z katalogiem w ręku podawały pozycje), nie decyzją projektową.
 *
 * DOWÓD MUTACYJNY (wymóg F1): odwrócenie naprawy — zdjęcie przekazania
 * `categoryNav` z `PageShell` do `StoreChrome` — gasi test renderu podstrony;
 * zdjęcie propsu z trasy gasi kontrakt wywołań niżej.
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

async function renderPodstrony(categoryNav?: readonly CategoryNavItem[]): Promise<string> {
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
    >
      <p>treść podstrony</p>
    </PageShell>,
  );
}

describe("S-30 — menu kategorii na podstronach (PageShell)", () => {
  it("podstrona z pozycjami niesie menu kategorii w nagłówku", async () => {
    const html = await renderPodstrony(POZYCJE);
    expect(html, "kontrola przyrządu: powłoka się nie wyrenderowała").toContain("treść podstrony");
    expect(html, "menu kategorii nie doszło na podstronę — nagłówek bez nawigacji do oferty").toContain(
      "data-store-category-menu",
    );
    expect(html).toContain('href="/kategoria/kosiarki"');
    expect(html).toContain("Agregaty");
  });

  it("bez pozycji menu NIE staje (pusty wyzwalacz obiecywałby listę, której nie ma)", async () => {
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
      expect(kod, `${trasa} przestała podawać categoryNav — jej nagłówek traci menu`).toContain(
        "categoryNav={",
      );
    }
  });
});

describe("S-01/S-15 — panel menu kategorii", () => {
  it("panel klampuje się do kontenera poniżej 40 rem (kotwica w wierszu belki)", () => {
    const { container } = render(<StoreCategoryMenu items={POZYCJE} label="Kategorie" />);
    const details = container.querySelector("details[data-store-category-menu]");
    expect(details).not.toBeNull();
    /*
      Mechanizm w dwóch połowach (jsdom nie liczy layoutu): <details> jest
      `static` poniżej 40 rem (kotwicą staje się wiersz belki z `relative`
      w StoreShellHeader), a panel rozpina się `left-0 right-0` na jego
      szerokość. Od 40 rem wraca kotwica w wyzwalaczu i stała szerokość.
    */
    expect(details!.className).toContain("static");
    expect(details!.className).toContain("@min-[40rem]/site:relative");
    const panel = container.querySelector("details > div.site-card");
    expect(panel, "menu bez panelu — nie ma czego klampować").not.toBeNull();
    for (const klasa of ["left-0", "right-0", "@min-[40rem]/site:right-auto", "@min-[40rem]/site:w-56"]) {
      expect(panel!.className, `panel stracił ${klasa} — wraca wystawanie poza okno @360`).toContain(
        klasa,
      );
    }
    // Stała szerokość panelu NIE MOŻE stać bezwarunkowo — to ona wystawała.
    expect(panel!.className.split(/\s+/)).not.toContain("w-56");
  });

  it("wyzwalacz i pozycje menu mają cele dotykowe 44 px (S-15)", () => {
    const { container } = render(<StoreCategoryMenu items={POZYCJE} label="Kategorie" />);
    const summary = container.querySelector("summary");
    expect(summary).not.toBeNull();
    for (const klasa of ["py-3", "-my-3"]) {
      expect(summary!.className, `wyzwalacz menu stracił ${klasa}`).toContain(klasa);
    }
    const pozycja = container.querySelector('a[href="/kategoria/kosiarki"]');
    expect(pozycja).not.toBeNull();
    expect(pozycja!.className, "pozycja menu wróciła poniżej celu dotykowego").toContain("py-3");
  });
});
