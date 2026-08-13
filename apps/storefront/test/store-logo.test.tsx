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
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DEFAULT_SITE_STYLE, presetContentFor } from "@avably/core/site";
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
    >
      <p>treść podstrony</p>
    </PageShell>,
  );
}

function obrazyZnaku(markup: string): string[] {
  return [...markup.matchAll(/<img[^>]*class="[^"]*site-logo[^"]*"[^>]*>/g)].map(([tag]) => tag);
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
