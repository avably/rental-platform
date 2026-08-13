/**
 * ZNAK FIRMY NAJEMCY W SKLEPIE (ADR-160).
 *
 * ==================== CO PILNUJE TEN PLIK ====================
 *
 *   1. STAN BEZ ZNAKU JEST STANEM NORMALNYM — sklep bez logo wygląda CO DO
 *      ZNAKU tak, jak przed tą zmianą: nazwa sklepu w nagłówku, żadnego
 *      placeholdera „tu wstaw logo" i ani jednego `<img>` więcej;
 *   2. JEDNO WGRANIE, DWA MIEJSCA UŻYCIA — ten sam adres pliku ląduje
 *      w nagłówku i w stopce, bez drugiego wgrania i bez drugiej ścieżki;
 *   3. PRZEŁĄCZNIK STOPKI działa i gasi WYŁĄCZNIE stopkę;
 *   4. TEKST ZASTĘPCZY NIGDY NIE JEST PUSTY — bez tekstu najemcy wchodzi
 *      nazwa sklepu (logo bez `alt` to błąd dostępności na KAŻDEJ podstronie);
 *   5. KAŻDA TRASA SKLEPU dostaje znak — powłoka rysuje go tam, gdzie rysuje
 *      nagłówek, więc podstrona nie ma jak go zgubić;
 *   6. PUDEŁKO ZNAKU JEST OGRANICZONE — plik 3000 × 200 nie ma jak rozepchnąć
 *      paska, bo wysokość i górna granica szerokości są w ROLI, nie w pliku.
 *
 * ==================== ANEKS ADR-167: NA JAKIEJ STOPCE TO MIERZYMY ====================
 *
 * Punkty 2 i 3 były do ADR-167 mierzone WYŁĄCZNIE na stopce v1
 * (`presetContentFor("footer")`) — kształcie, którego kreator nie produkuje
 * i którego nie ma ani jeden najemca. Suita była zielona, a przełącznik martwy
 * dla 100 % realnych stopek. Odtąd każdy z tych punktów ma bliźniaczy przypadek
 * na stopce z KREATORA (`sectionCanvasFrom` → płótno v2), a przypadki v1
 * zostają jako zgodność wstecz i są tak nazwane.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DEFAULT_SITE_STYLE, presetContentFor, sectionCanvasFrom } from "@avably/core/site";
import type { PublishedSection, PublishedSite } from "@avably/core/site";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageShell } from "../components/storefront/page-shell";
import { StoreChrome } from "../components/storefront/store-chrome";
import { resolveStoreLogo, type StoreLogo } from "../lib/site/store-logo";
import { getStorefrontCopy } from "../lib/storefront/copy";

const TENANT = "11111111-1111-4111-8111-111111111111";
const UPLOAD = "22222222-2222-4222-8222-222222222222";
const PATH = `${TENANT}/logo/${UPLOAD}.png`;
const SUPABASE_URL = "https://przyklad.supabase.co";
const EXPECTED_SRC = `${SUPABASE_URL}/storage/v1/object/public/site-images/${PATH}`;
const STORE_NAME = "Wypożyczalnia Kontrolna";
/** Prefiks zdjęć sekcji — powłoka podaje go stopce od ADR-172 (wymagany props). */
const BAZA_ZDJEC = `${SUPABASE_URL}/storage/v1/object/public/site-images`;

function stronaZeStopka(): PublishedSite {
  const footer = {
    id: "s-footer",
    position: 0,
    type: "footer",
    content: presetContentFor("footer", "pl"),
  } as unknown as PublishedSection;
  return {
    template: "classic",
    publishedAt: "2026-08-13T00:00:00Z",
    style: {},
    logo: null,
    sections: [footer],
  } as PublishedSite;
}

async function renderPowloki(logo: StoreLogo | null): Promise<string> {
  const copy = await getStorefrontCopy("pl");
  return renderToStaticMarkup(
    <StoreChrome
      style={DEFAULT_SITE_STYLE}
      copy={copy}
      storeName={STORE_NAME}
      site={stronaZeStopka()}
      logo={logo}
      siteImageBase={BAZA_ZDJEC}
    >
      <p>treść</p>
    </StoreChrome>,
  );
}

async function renderPodstrony(logo: StoreLogo | null): Promise<string> {
  const copy = await getStorefrontCopy("pl");
  return renderToStaticMarkup(
    <PageShell
      style={DEFAULT_SITE_STYLE}
      copy={copy}
      storeName={STORE_NAME}
      site={stronaZeStopka()}
      logo={logo}
      siteImageBase={BAZA_ZDJEC}
    >
      <p>treść podstrony</p>
    </PageShell>,
  );
}

/**
 * Strona ze stopką W TYM KSZTAŁCIE, KTÓRY ZAPISUJE KREATOR (ADR-167): treść
 * presetu przepuszczona przez `sectionCanvasFrom`, czyli płótno v2.
 */
function stronaZeStopkaNaPlotnie(obraz?: "wlasny"): PublishedSite {
  const canvas = sectionCanvasFrom("footer", presetContentFor("footer", "pl"));
  const elements = obraz
    ? [
        ...canvas.elements,
        {
          id: "footer-image-1",
          kind: "image",
          source: { kind: "storage", path: `${TENANT}/site/wlasny.png` },
          alt: "Znak wstawiony ręcznie",
          fit: "contain",
          layout: { desktop: { x: 100, y: 12, w: 30, h: 8, z: 1 } },
        },
      ]
    : canvas.elements;
  const footer = {
    id: "s-footer",
    position: 0,
    type: "footer",
    content: { ...canvas, elements },
  } as unknown as PublishedSection;
  return {
    template: "classic",
    publishedAt: "2026-08-13T00:00:00Z",
    style: {},
    logo: null,
    sections: [footer],
  } as PublishedSite;
}

async function renderPowlokiNaPlotnie(
  logo: StoreLogo | null,
  obraz?: "wlasny",
): Promise<string> {
  const copy = await getStorefrontCopy("pl");
  return renderToStaticMarkup(
    <StoreChrome
      style={DEFAULT_SITE_STYLE}
      copy={copy}
      storeName={STORE_NAME}
      site={stronaZeStopkaNaPlotnie(obraz)}
      logo={logo}
      siteImageBase={BAZA_ZDJEC}
    >
      <p>treść</p>
    </StoreChrome>,
  );
}

function obrazyZnaku(markup: string): string[] {
  return [...markup.matchAll(/<img[^>]*class="[^"]*site-logo[^"]*"[^>]*>/g)].map(([tag]) => tag);
}

/** Wycinek dokumentu od `<footer` do końca — stopka jest ostatnia w powłoce. */
function stopkaZ(markup: string): string {
  const start = markup.indexOf("<footer");
  expect(start, "w dokumencie nie ma stopki — dowód liczyłby po pustym zbiorze").toBeGreaterThan(-1);
  return markup.slice(start);
}

describe("resolveStoreLogo — z koperty na render", () => {
  it("bez znaku w kopercie oddaje null", () => {
    expect(resolveStoreLogo(stronaZeStopka(), STORE_NAME, SUPABASE_URL)).toBeNull();
    expect(resolveStoreLogo(null, STORE_NAME, SUPABASE_URL)).toBeNull();
  });

  it("skleja publiczny URL bucketa i podstawia nazwę sklepu za brakujący alt", () => {
    const site = { ...stronaZeStopka(), logo: { path: PATH, inFooter: true } } as PublishedSite;
    expect(resolveStoreLogo(site, STORE_NAME, SUPABASE_URL)).toEqual({
      src: EXPECTED_SRC,
      alt: STORE_NAME,
      inFooter: true,
    });
  });

  it("tekst zastępczy najemcy wygrywa z nazwą sklepu", () => {
    const site = {
      ...stronaZeStopka(),
      logo: { path: PATH, alt: "Znak firmowy", inFooter: false },
    } as PublishedSite;
    expect(resolveStoreLogo(site, STORE_NAME, SUPABASE_URL)?.alt).toBe("Znak firmowy");
  });
});

describe("render znaku w powłoce sklepu", () => {
  it("BEZ ZNAKU: nagłówek pokazuje nazwę sklepu i nie rysuje żadnego obrazu znaku", async () => {
    const markup = await renderPowloki(null);
    expect(markup).toContain(STORE_NAME);
    expect(obrazyZnaku(markup)).toEqual([]);
    // Kontrola pozytywna: stopka JEST w dokumencie, więc brak obrazu nie
    // wynika z tego, że renderujemy pustkę.
    expect(markup).toContain("<footer");
  });

  it("ZE ZNAKIEM: ten sam adres w nagłówku i w stopce — jedno wgranie, dwa miejsca", async () => {
    const markup = await renderPowloki({ src: EXPECTED_SRC, alt: "Znak", inFooter: true });
    const obrazy = obrazyZnaku(markup);
    expect(obrazy).toHaveLength(2);
    for (const tag of obrazy) {
      expect(tag).toContain(`src="${EXPECTED_SRC}"`);
      expect(tag).toContain('alt="Znak"');
    }
    // Nazwa sklepu ZNIKA z nagłówka jako napis (zostaje w tekście zastępczym):
    // ten sam napis dwa razy obok siebie jest dla czytnika powtórzeniem.
    expect(markup).not.toContain(`>${STORE_NAME}<`);
  });

  it("PRZEŁĄCZNIK: `inFooter: false` gasi znak w stopce, a w nagłówku zostawia", async () => {
    const markup = await renderPowloki({ src: EXPECTED_SRC, alt: "Znak", inFooter: false });
    expect(obrazyZnaku(markup)).toHaveLength(1);
    const stopka = markup.slice(markup.indexOf("<footer"));
    expect(obrazyZnaku(stopka)).toEqual([]);
  });

  it("PODSTRONA dostaje znak tą samą drogą, co katalog", async () => {
    const markup = await renderPodstrony({ src: EXPECTED_SRC, alt: "Znak", inFooter: true });
    expect(obrazyZnaku(markup)).toHaveLength(2);
  });

  it("znak stoi POZA `<main>` w obu miejscach", async () => {
    const markup = await renderPodstrony({ src: EXPECTED_SRC, alt: "Znak", inFooter: true });
    const main = markup.slice(markup.indexOf("<main"), markup.indexOf("</main>"));
    expect(obrazyZnaku(main)).toEqual([]);
  });
});

describe("ADR-167 — stopka W KSZTAŁCIE Z KREATORA (płótno v2)", () => {
  it("ZE ZNAKIEM: nagłówek i stopka na płótnie niosą TEN SAM adres", async () => {
    const markup = await renderPowlokiNaPlotnie({
      src: EXPECTED_SRC,
      alt: "Znak",
      inFooter: true,
    });
    expect(obrazyZnaku(markup)).toHaveLength(2);
    const stopka = stopkaZ(markup);
    expect(obrazyZnaku(stopka)).toHaveLength(1);
    expect(obrazyZnaku(stopka)[0]).toContain(`src="${EXPECTED_SRC}"`);
  });

  it("PRZEŁĄCZNIK WYŁĄCZONY: ta sama stopka nie ma znaku, nagłówek go ma", async () => {
    // Druga noga. Jednostronna asercja przepuściłaby render, który rysuje znak
    // ZAWSZE — czyli przełącznik odwrotnie martwy.
    const markup = await renderPowlokiNaPlotnie({
      src: EXPECTED_SRC,
      alt: "Znak",
      inFooter: false,
    });
    expect(obrazyZnaku(markup)).toHaveLength(1);
    expect(obrazyZnaku(stopkaZ(markup))).toEqual([]);
  });

  it("BEZ ZNAKU: stopka na płótnie wygląda tak, jak wyglądała", async () => {
    const markup = await renderPowlokiNaPlotnie(null);
    expect(obrazyZnaku(markup)).toEqual([]);
    expect(markup).toContain("<footer");
  });

  it("STOPKA Z WŁASNYM OBRAZEM: znak do niej NIE wchodzi (bez dwóch znaków)", async () => {
    const markup = await renderPowlokiNaPlotnie(
      { src: EXPECTED_SRC, alt: "Znak", inFooter: true },
      "wlasny",
    );
    const stopka = stopkaZ(markup);
    expect(stopka).not.toContain("data-footer-mark");
    expect(obrazyZnaku(stopka)).toEqual([]);
    /*
      Kontrola pozytywna: element obrazu operatora w tej stopce JEST — brak
      znaku nie wynika z tego, że stopka jest pusta.

      Sprawdzamy ELEMENT, a nie jego adres, i to nie jest osłabienie asercji,
      tylko zapis stanu faktycznego: powłoka sklepu nie podaje stopce
      `siteImageBase` (podają go WYŁĄCZNIE dwie trasy z sekcjami strony), więc
      obraz w stopce rysuje się dziś jako kafel zastępczy. To osobna wada
      z ADR-154 — opisana w ADR-167 jako znalezisko, nie naprawiana tutaj.
      Asercja na adres byłaby więc czerwona z POWODU tamtej wady i maskowałaby
      to, o czym jest ten test.
    */
    expect(stopka).toContain('data-element-kind="image"');
    // W nagłówku znak zostaje: reguła dotyczy stopki, a nie całego sklepu.
    expect(obrazyZnaku(markup)).toHaveLength(1);
  });

  it("znak stoi WEWNĄTRZ `<footer>`, poza `<main>`", async () => {
    const markup = await renderPowlokiNaPlotnie({
      src: EXPECTED_SRC,
      alt: "Znak",
      inFooter: true,
    });
    const stopka = stopkaZ(markup);
    expect(stopka).toContain("data-footer-mark");
    expect(stopka.slice(stopka.indexOf("data-footer-mark"))).toContain("</footer>");
  });
});

describe("pudełko znaku jest ograniczone przez ROLĘ, nie przez plik", () => {
  it("arkusz sklepu wiąże `.site-logo` ze stałą wysokością i górną granicą szerokości", () => {
    // Bez tej reguły logo 3000 × 200 wypchnęłoby koszyk poza ekran, a testy
    // renderu wyżej dalej byłyby zielone: markup jest ten sam, psuje się układ.
    const css = readFileSync(
      resolve(process.cwd(), "../../packages/ui/src/site/site.css"),
      "utf8",
    );
    const rule = css.match(/\.site-logo\s*\{([\s\S]*?)\}/)?.[1];
    expect(rule, "brak reguły .site-logo w arkuszu sklepu").toBeDefined();
    const flat = rule!.replace(/\s+/g, " ");
    expect(flat).toContain("height:");
    expect(flat).toContain("max-width:");
    expect(flat).toContain("width: auto");
    expect(flat).toContain("object-fit: contain");
  });
});
