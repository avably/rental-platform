/**
 * OBRAZ W STOPCE POWŁOKI DOSTAJE PRAWDZIWY ADRES, A NIE SZARY KAFEL (ADR-172).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Od ADR-154 stopkę rysuje POWŁOKA (`StoreChrome`), tym samym rendererem, co
 * sekcje strony. Trasy podawały rendererowi sekcji `siteImageBase` — prefiks
 * publicznego URL-a bucketa `site-images` — ale powłoka NIE PODAWAŁA GO WCALE.
 * Element obrazu na płótnie bez tego prefiksu spada na gałąź kafla zastępczego
 * (`element-canvas`: `source?.kind === "storage" && siteImageBase`), więc
 * zdjęcie w stopce byłoby SZARYM PROSTOKĄTEM na każdej trasie sklepu — bez
 * jednego błędu w konsoli i bez śladu w sieci.
 *
 * Wada była UŚPIONA: żadna stopka na produkcji nie miała jeszcze elementu
 * obrazu, więc nikt jej nie zobaczył. Zapaliłaby się przy pierwszym operatorze,
 * który wstawi do stopki znak, kreskę albo tło.
 *
 * ==================== DLACZEGO FIKSTURA JEST PŁÓTNEM v2 ====================
 *
 * Kreator konwertuje KAŻDĄ dodawaną sekcję na płótno (`sectionCanvasFrom`), więc
 * `"version": 2` to jedyny kształt stopki, jaki mają najemcy. Test zbudowany na
 * `presetContentFor("footer")` badałby generację v1, której nie ma ani jeden
 * najemca — dokładnie ten błąd zostawił martwy przełącznik znaku w stopce przez
 * całe ADR-160 (naprawa: ADR-167). Fikstura jest tu więc taka, jak produkcja,
 * a nie taka, jak wygodnie.
 */
import {
  DEFAULT_SITE_STYLE,
  presetContentFor,
  sectionCanvasFrom,
  type CanvasElement,
  type PublishedSection,
  type PublishedSite,
} from "@avably/core/site";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageShell } from "../components/storefront/page-shell";
import { StoreChrome } from "../components/storefront/store-chrome";
import { getStorefrontCopy } from "../lib/storefront/copy";

const BAZA_ZDJEC = "https://przyklad.supabase.co/storage/v1/object/public/site-images";
const SCIEZKA = "11111111-1111-4111-8111-111111111111/sekcje/stopka-znak.png";
const OCZEKIWANY_SRC = `${BAZA_ZDJEC}/${SCIEZKA}`;

/** Element obrazu wstawiony przez operatora — picker zapisuje dokładnie to. */
const OBRAZ = {
  id: "footer-image-1",
  kind: "image",
  source: { kind: "storage", path: SCIEZKA },
  alt: "Znak firmy w stopce",
  fit: "contain",
  layout: { desktop: { x: 0, y: 0, w: 20, h: 8, z: 0 } },
} as CanvasElement;

/**
 * Strona najemcy ze stopką W KSZTAŁCIE PRODUKCYJNYM: płótno v2 z własnym
 * elementem obrazu.
 */
function stronaZeStopkaZObrazem(): PublishedSite {
  const plotno = sectionCanvasFrom("footer", presetContentFor("footer", "pl"));
  return {
    template: "classic",
    publishedAt: "2026-08-13T00:00:00Z",
    logo: null,
    style: {},
    sections: [
      {
        id: "s-footer",
        position: 0,
        type: "footer",
        content: { ...plotno, elements: [...plotno.elements, OBRAZ] },
      } as unknown as PublishedSection,
    ],
  } as PublishedSite;
}

async function renderKatalogu(base: string): Promise<string> {
  const copy = await getStorefrontCopy("pl");
  return renderToStaticMarkup(
    <StoreChrome
      style={DEFAULT_SITE_STYLE}
      copy={copy}
      storeName="Sklep"
      site={stronaZeStopkaZObrazem()}
      logo={null}
      siteImageBase={base}
    >
      <main>treść katalogu</main>
    </StoreChrome>,
  );
}

async function renderPodstrony(base: string): Promise<string> {
  const copy = await getStorefrontCopy("pl");
  return renderToStaticMarkup(
    <PageShell
      style={DEFAULT_SITE_STYLE}
      copy={copy}
      storeName="Sklep"
      site={stronaZeStopkaZObrazem()}
      logo={null}
      siteImageBase={base}
    >
      <p>treść podstrony</p>
    </PageShell>,
  );
}

/** Wycinek dokumentu od `<footer` w dół — stopka jest ostatnia w powłoce. */
function stopka(markup: string): string {
  const index = markup.indexOf("<footer");
  expect(index, "render bez stopki — asercje niżej byłyby po pustym zbiorze").toBeGreaterThan(-1);
  return markup.slice(index);
}

describe("fikstura jest tym, co ma produkcja", () => {
  it("stopka najemcy to PŁÓTNO v2 z elementem obrazu, nie treść v1", () => {
    const content = stronaZeStopkaZObrazem().sections[0]!.content as {
      version: number;
      elements: { kind: string }[];
    };
    expect(content.version, "fikstura nie jest płótnem — badalibyśmy generację bez najemców").toBe(
      2,
    );
    expect(content.elements.filter((element) => element.kind === "image")).toHaveLength(1);
  });
});

describe("powłoka podaje stopce prefiks zdjęć", () => {
  it("KATALOG: obraz w stopce ma prawdziwy adres, a nie kafel zastępczy", async () => {
    const html = await renderKatalogu(BAZA_ZDJEC);
    const dol = stopka(html);
    // Asercja jest o WARTOŚCI `src`, nie o obecności elementu: kafel zastępczy
    // też jest elementem i przeszedłby test „czy coś się wyrenderowało".
    expect(dol, "obraz w stopce bez adresu — powłoka nie podała prefiksu").toContain(
      `src="${OCZEKIWANY_SRC}"`,
    );
    expect(dol, "obraz w stopce spadł na szary kafel zastępczy").not.toContain("site-placeholder");
  });

  it("PODSTRONA: ta sama stopka i ten sam adres (koszyk, produkt, regulamin)", async () => {
    const dol = stopka(await renderPodstrony(BAZA_ZDJEC));
    expect(dol).toContain(`src="${OCZEKIWANY_SRC}"`);
    expect(dol).not.toContain("site-placeholder");
  });

  it("KONTROLA NEGATYWNA: bez prefiksu ten sam obraz jest kaflem zastępczym", async () => {
    /*
     * Oś dowodu: to jest dokładnie stan sprzed ADR-172 (powłoka nie podawała
     * `siteImageBase`), odtworzony pustą wartością. Bez tej kontroli asercje
     * wyżej byłyby zielone także wtedy, gdyby adres brał się skądinąd.
     */
    const dol = stopka(await renderKatalogu(""));
    expect(dol).not.toContain(`src="${OCZEKIWANY_SRC}"`);
    expect(dol, "bez prefiksu obraz powinien spaść na kafel zastępczy").toContain(
      "site-placeholder",
    );
  });
});
