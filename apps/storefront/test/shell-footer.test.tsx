/**
 * STOPKA JEST WŁASNOŚCIĄ POWŁOKI, NIE STRONY (faza 0, ADR-154).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Stopka zbudowana w kreatorze renderowała się WYŁĄCZNIE na `/store`, bo była
 * zwykłą sekcją listy, a listę sekcji rysowała tylko trasa katalogu. Klient
 * najemcy wchodził na kartę produktu i stopka znikała — razem z adresem,
 * telefonem i odnośnikami do dokumentów, czyli z tym, czego szuka dokładnie
 * w chwili, w której zaczyna sprawdzać, komu płaci.
 *
 * ==================== CZTERY ZDANIA, KTÓRYCH PILNUJE TEN PLIK ====================
 *
 *   1. PODSTRONA MA STOPKĘ — powłoka rysuje ją bez udziału trasy;
 *   2. KATALOG MA JĄ DOKŁADNIE RAZ — przeniesienie do powłoki nie może jej
 *      zdublować, a duplikat `<footer>` to dwa landmarki `contentinfo`;
 *   3. STOPKA STOI POZA `<main>` — landmark treści głównej nie zawiera
 *      landmarku stopki (do fazy 0 zawierał);
 *   4. KOTWICE PROWADZĄ DO CELU — `#kontakt` na podstronie, gdzie sekcji
 *      kontaktu nie ma, staje się `/store#kontakt`. Odnośnik, który nie robi
 *      nic, jest awarią CICHĄ: bez błędu, bez zmiany adresu, bez śladu.
 */
import { DEFAULT_SITE_STYLE, presetContentFor } from "@avably/core/site";
import type { PublishedSection, PublishedSite } from "@avably/core/site";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageShell } from "../components/storefront/page-shell";
import { StoreChrome } from "../components/storefront/store-chrome";
import { pageSections, shellSections, withAnchorBase } from "../lib/site/page-sections";
import { getStorefrontCopy } from "../lib/storefront/copy";

const NAZWA_FIRMY = "Wypożyczalnia Kontrolna sp. z o.o.";

function sekcja(id: string, type: "hero" | "products" | "footer"): PublishedSection {
  return {
    id,
    position: 0,
    type,
    content: presetContentFor(type, "pl"),
  } as unknown as PublishedSection;
}

/** Strona najemcy: hero + sprzęt + stopka z ROZPOZNAWALNĄ nazwą firmy. */
function strona(): PublishedSite {
  const footer = sekcja("s-footer", "footer");
  return {
    template: "classic",
    publishedAt: "2026-08-12T00:00:00Z",
    style: {},
    sections: [
      sekcja("s-hero", "hero"),
      sekcja("s-products", "products"),
      {
        ...footer,
        position: 2,
        content: { ...(footer.content as object), businessName: NAZWA_FIRMY },
      } as PublishedSection,
    ],
  } as PublishedSite;
}

async function renderPodstrony(site: PublishedSite | null): Promise<string> {
  const copy = await getStorefrontCopy("pl");
  return renderToStaticMarkup(
    <PageShell style={DEFAULT_SITE_STYLE} copy={copy} storeName="Sklep" site={site}>
      <p>treść podstrony</p>
    </PageShell>,
  );
}

describe("podział sekcji: strona kontra powłoka", () => {
  it("stopka wypada z sekcji STRONY i wpada do sekcji POWŁOKI", () => {
    const site = strona();
    expect(site.sections, "fikstura bez sekcji — asercje niżej byłyby puste").toHaveLength(3);
    expect(pageSections(site).map((section) => section.type)).toEqual(["hero", "products"]);
    expect(shellSections(site).map((section) => section.type)).toEqual(["footer"]);
  });

  it("brak strony nie wywraca podziału", () => {
    expect(pageSections(null)).toEqual([]);
    expect(shellSections(null)).toEqual([]);
  });
});

describe("powłoka podstrony rysuje stopkę", () => {
  it("podstrona (koszyk, produkt, regulamin) niesie stopkę najemcy", async () => {
    const html = await renderPodstrony(strona());
    // Kontrola pozytywna: powłoka NAPRAWDĘ się wyrenderowała.
    expect(html).toContain("treść podstrony");
    expect(html, "stopka nie doszła na podstronę — defekt sprzed fazy 0 wrócił").toContain(
      NAZWA_FIRMY,
    );
    expect(html.match(/<footer\b/g) ?? []).toHaveLength(1);
  });

  it("strona bez stopki nie rysuje pustej ramki", async () => {
    const site = strona();
    const html = await renderPodstrony({ ...site, sections: pageSections(site) });
    expect(html).toContain("treść podstrony");
    expect(html.match(/<footer\b/g) ?? []).toHaveLength(0);
  });

  it("brak opublikowanej strony to podstrona bez stopki, a nie awaria", async () => {
    const html = await renderPodstrony(null);
    expect(html).toContain("treść podstrony");
    expect(html.match(/<footer\b/g) ?? []).toHaveLength(0);
  });

  it("stopka stoi POZA `<main>` — landmark treści jej nie połyka", async () => {
    const html = await renderPodstrony(strona());
    const main = /<main\b[\s\S]*?<\/main>/.exec(html)?.[0];
    expect(main, "render bez `<main>` — asercja niżej byłaby po pustym zbiorze").toBeTruthy();
    expect(main!).not.toContain("<footer");
    expect(main!).not.toContain(NAZWA_FIRMY);
  });
});

describe("kotwice stopki poza stroną z sekcjami", () => {
  it("czysta kotwica dostaje adres strony katalogu", () => {
    const [przepisana] = withAnchorBase(shellSections(strona()), "/store");
    const tresc = JSON.stringify(przepisana?.content ?? {});
    expect(tresc, "stopka presetu przestała nieść kotwice — dowód byłby pusty").toContain("href");
    expect(tresc).not.toMatch(/"href":"#/);
    expect(tresc).toContain('"href":"/store#');
  });

  it("adres, który już wie, dokąd prowadzi, zostaje NIETKNIĘTY", () => {
    const sekcje = [
      {
        id: "s-footer",
        position: 0,
        type: "footer",
        content: {
          businessName: NAZWA_FIRMY,
          legal: "NIP 000-000-00-00",
          links: [
            { label: "Kotwica", href: "#kontakt" },
            { label: "Regulamin", href: "/regulamin" },
            { label: "Zewnętrzny", href: "https://example.test/x#sekcja" },
          ],
        },
      } as unknown as PublishedSection,
    ];
    const [przepisana] = withAnchorBase(sekcje, "/store");
    const links = (przepisana!.content as { links: { href: string }[] }).links;
    expect(links.map((link) => link.href)).toEqual([
      "/store#kontakt",
      "/regulamin",
      "https://example.test/x#sekcja",
    ]);
  });

  it("przepisanie NIE RUSZA treści z bazy (funkcja jest czysta)", () => {
    const sekcje = shellSections(strona());
    const przed = JSON.stringify(sekcje);
    withAnchorBase(sekcje, "/store");
    expect(JSON.stringify(sekcje)).toBe(przed);
  });

  it("na stronie katalogu kotwice zostają kotwicami", async () => {
    const copy = await getStorefrontCopy("pl");
    // Trasa katalogu woła powłokę BEZ `footerAnchorBase` — cele kotwic stoją
    // na niej, więc `/store#kontakt` byłoby przeładowaniem strony zamiast skoku.
    const html = renderToStaticMarkup(
      <StoreChrome style={DEFAULT_SITE_STYLE} copy={copy} storeName="Sklep" site={strona()}>
        <main>treść katalogu</main>
      </StoreChrome>,
    );
    expect(html).toContain(NAZWA_FIRMY);
    expect(html, "kotwica stopki zamieniła się w adres bezwzględny na własnej stronie").toContain(
      'href="#',
    );
    expect(html).not.toContain('href="/store#');
  });
});
