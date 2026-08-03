/**
 * STYL STRONY DOCIERA DO PUBLICZNEGO RENDERU (K5, ADR-090).
 *
 * Najemca wybiera w kreatorze akcent i parę fontów, a wybór leży w jsonb
 * (`sites.style_published`, migracja 0046) i wraca kopertą `get_published_site`.
 * Między tym zapisem a klientem sklepu stoi cały tor: koperta → parsowanie →
 * `resolveSiteStyle` → zmienne CSS na korzeniu strony. Kontrakt mieszka po
 * stronie SKLEPU, bo sklep jest stroną, która ten tor konsumuje: panel może
 * pokazywać płótno w dowolnym kolorze, a i tak liczy się to, co dostaje
 * anonimowy odwiedzający.
 *
 * Bronione są tu trzy rzeczy, każda z innym trybem awarii:
 *
 *   1. WYBÓR NAPRAWDĘ DZIAŁA — akcent z jsonb wychodzi jako DOKŁADNIE te
 *      wartości, które stoją w `ACCENT_TOKENS`. Asercje idą przeciwko tabeli,
 *      nie przeciwko przepisanym heksom: literał w teście przestaje pilnować
 *      palety w chwili, w której ktoś zmieni odcień w źródle (kontrast liczy
 *      się z tabeli, więc test z literałem broniłby wartości już nieaktualnej).
 *   2. BRAK WYBORU NIE JEST AWARIĄ — `{}` to stan KAŻDEJ strony zaraz po
 *      migracji i musi renderować się jak przed K5: szablon z kolumny zastanej,
 *      akcent domyślny, żadnej różnicy w znacznikach.
 *   3. GRANICA FAIL-SOFT / FAIL-CLOSED BIEGNIE PO STYLU — styl w nieznanym
 *      kształcie degraduje się do domyślnego (najgorszy skutek: strona wygląda
 *      zwyczajnie), ale zła KOPERTA dalej kładzie odczyt na `null`, bo tam
 *      chodzi o granicę draft/publish, a nie o wygląd.
 *
 * Dowód mutacyjny: usunięcie `style` z wywołania renderera w store/page albo
 * podmiana akcentu w `publishedSiteStyle` na stały — czerwone. Dopisanie
 * definicji `--site-accent` do globals.css — czerwone (noga o arkuszu).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  THEME_BAND_KEYS,
  DEFAULT_SITE_STYLE,
  fontPairStacks,
  SITE_THEMES,
  SITE_FONT_PAIRS,
  STYLE_TOKENS,
  bandTokenName,
  themeTokens,
} from "@avably/core/site";
import { SiteRenderer } from "@avably/ui";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getPublishedSite, publishedSiteStyle } from "../lib/site/published";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const SECTION_ID = "00000000-0000-4000-8000-0000000000a1";

/**
 * Klient-atrapa jak w site-published.test.ts — świadomie własny, a nie
 * wyciągnięty do wspólnego helpera: oba pliki opisują INNY kontrakt tej samej
 * funkcji i wspólna atrapa związałaby je ze sobą przy pierwszej zmianie.
 */
function fakeClient(data: unknown): SupabaseClient {
  return {
    schema: (name: string) => {
      if (name !== "app") throw new Error(`nieoczekiwany schemat: ${name}`);
      return { rpc: () => Promise.resolve({ data, error: null }) };
    },
  } as unknown as SupabaseClient;
}

/** Koperta RPC w kształcie, w jakim oddaje ją app.get_published_site (0046). */
function envelope(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    template: "classic",
    published_at: "2026-08-03T10:00:00+00:00",
    sections: [
      {
        id: SECTION_ID,
        type: "hero",
        position: 0,
        content: { heading: "Sprzęt na już", subheading: "Rezerwacja online." },
      },
    ],
    ...patch,
  };
}

/**
 * Przejazd CAŁYM torem sklepu: koperta → getPublishedSite → publishedSiteStyle
 * → render taki, jak w store/page (bez własnej owijki sekcji). Rekonstrukcja
 * samego `resolveSiteStyle` dowodziłaby wyłącznie tego, że rdzeń działa —
 * a pytanie brzmi, czy SKLEP go używa.
 */
async function renderStore(payload: unknown) {
  const site = await getPublishedSite(TENANT_ID, fakeClient(payload));
  const style = publishedSiteStyle(site);
  const html = site
    ? renderToStaticMarkup(
        <SiteRenderer sections={site.sections} style={style} />,
      )
    : "";
  return { site, style, html };
}

/**
 * Zmienne z atrybutu `style` KORZENIA renderu. Czytane z pierwszego znacznika,
 * a nie wyszukiwane po całym dokumencie — token wystawiony gdziekolwiek niżej
 * nie jest tym samym kontraktem (przełącznik pasów działa tylko wtedy, gdy
 * komplet źródłowy stoi NAD wszystkimi sekcjami).
 */
function rootTokens(html: string): Record<string, string> {
  const rootTag = /<[a-z][^>]*>/i.exec(html)?.[0] ?? "";
  const declarations = (/\sstyle="([^"]*)"/.exec(rootTag)?.[1] ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");

  const tokens: Record<string, string> = {};
  for (const declaration of declarations.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    tokens[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
  }
  return tokens;
}

describe("motyw najemcy wychodzi na publiczną stronę", () => {
  for (const theme of SITE_THEMES) {
    it(`motyw „${theme}" wystawia komplet zmiennych KAŻDEGO pasa`, async () => {
      const { style, html } = await renderStore(envelope({ style: { theme } }));

      // Kontrola pozytywna: gdyby render był pusty, wszystkie asercje niżej
      // porównywałyby `undefined` z `undefined` po pustej mapie tokenów.
      expect(style.theme).toBe(theme);
      expect(html).toContain("Sprzęt na już");

      const tokens = rootTokens(html);
      const motyw = themeTokens(theme);
      for (const band of THEME_BAND_KEYS) {
        expect(tokens[bandTokenName(band, "surface")]).toBe(motyw.bands[band].surface);
        expect(tokens[bandTokenName(band, "ink")]).toBe(motyw.bands[band].ink);
        // Trójka akcentu jest już ROZSTRZYGNIĘTA wariantem pasa — arkusz nie ma
        // czego wybierać, bo nie zna pojęcia „papier/atrament" (ADR-090).
        const wariant = motyw.bands[band].accent;
        expect(tokens[bandTokenName(band, "accent-text")]).toBe(
          motyw.accents[motyw.defaultAccent]![wariant]!.text,
        );
      }
    });
  }

  for (const fontPair of SITE_FONT_PAIRS) {
    it(`para krojów „${fontPair}" idzie tym samym szwem`, async () => {
      const { html } = await renderStore(envelope({ style: { fontPair } }));
      const tokens = rootTokens(html);
      const stacks = fontPairStacks(fontPair);

      expect(tokens[STYLE_TOKENS.fontHeading]).toBe(stacks.heading);
      expect(tokens[STYLE_TOKENS.fontBody]).toBe(stacks.body);
    });
  }

  it("KOLOR nie trafia na elementy — korzeń niesie tylko zmienne", async () => {
    const theme = "noir-lux";
    const { html } = await renderStore(envelope({ style: { theme } }));
    const motyw = themeTokens(theme);

    // Heks poza korzeniem znaczyłby, że któryś element dostał kolor na sztywno
    // i przestał słuchać przełącznika pasów — dokładnie ta awaria, przed którą
    // broni dwuwarstwowy kontrakt tokenów (ADR-090).
    const belowRoot = html.slice(html.indexOf(">") + 1);
    expect(belowRoot).not.toContain(motyw.bands.default.surface);
    expect(belowRoot).not.toContain(motyw.accents[motyw.defaultAccent]!.ink!.fill);
  });
});

describe("strona bez zapisanego stylu renderuje się jak przed ADR-090", () => {
  it("pusty styl bierze motyw ZASTANY z kolumny `template`", async () => {
    // Stan każdej strony zaraz po migracji 0046: baza nie dokłada klucza
    // `style` do koperty, dopóki styl jest pusty.
    const { site, style, html } = await renderStore(envelope({ template: "bold" }));

    expect(site?.style).toEqual({});
    expect(style.theme).toBe("bold");
    expect(themeTokens(style.theme).legacy, "motyw zastany musi być oznaczony").toBe(true);
    expect(html).toContain("Sprzęt na już");

    const tokens = rootTokens(html);
    const motyw = themeTokens("bold");
    expect(tokens[bandTokenName("default", "surface")]).toBe(motyw.bands.default.surface);
    expect(tokens[STYLE_TOKENS.fontHeading]).toBe(fontPairStacks(motyw.fontPair).heading);
  });

  it("znaczniki strony BEZ stylu są co do bajtu te, co dla motywu zastanego", async () => {
    const { site, html } = await renderStore(envelope({ template: "bold" }));
    expect(site).not.toBeNull();

    // Render z JAWNYM motywem zastanym musi dać dokładnie ten sam dokument —
    // czyli: strona sprzed ADR-090 nie zmienia ani jednego znacznika.
    const before = renderToStaticMarkup(
      <SiteRenderer
        sections={site!.sections}
        style={{ theme: "bold", accent: themeTokens("bold").defaultAccent, fontPair: themeTokens("bold").fontPair }}
      />,
    );
    expect(html).toBe(before);
  });
});

describe("granica fail-soft (styl) i fail-closed (koperta)", () => {
  const tolerated: [string, unknown][] = [
    ["nazwa akcentu spoza palety", { accent: "neon" }],
    ["pole spoza allowlisty", { accent: "forest", boost: true }],
    ["styl w ogóle nie obiektem", "classic"],
    ["styl jako null", null],
  ];

  for (const [label, style] of tolerated) {
    it(`${label} → styl domyślny, strona ZOSTAJE`, async () => {
      const { site, style: resolved, html } = await renderStore(envelope({ style }));

      // Koperta jest poprawna, więc odczyt ma się udać — degradacja dotyczy
      // wyłącznie wyglądu. Strona wygaszona przez literówkę w jsonb byłaby
      // karą nieproporcjonalną do przewinienia.
      expect(site).not.toBeNull();
      expect(resolved).toEqual(DEFAULT_SITE_STYLE);
      expect(html).toContain("Sprzęt na już");
      const motyw = themeTokens(DEFAULT_SITE_STYLE.theme);
      expect(rootTokens(html)[bandTokenName("default", "surface")]).toBe(motyw.bands.default.surface);
    });
  }

  const broken: [string, Record<string, unknown>][] = [
    ["szablon spoza allowlisty", envelope({ template: "neon" })],
    ["klucz spoza koperty", envelope({ unexpected: true })],
    ["brak znacznika publikacji", { template: "classic", sections: [] }],
  ];

  for (const [label, payload] of broken) {
    it(`ZŁA KOPERTA (${label}) dalej kładzie odczyt na null`, async () => {
      // Tolerancja kończy się na stylu. Koperta w nieznanym kształcie znaczy,
      // że nie wiadomo, CO jest opublikowane — a wtedy nie publikujemy nic.
      expect(await getPublishedSite(TENANT_ID, fakeClient(payload))).toBeNull();
    });
  }

  it("brak strony też ma styl — domyślny, bez `?:` w każdej trasie", () => {
    expect(publishedSiteStyle(null)).toEqual(DEFAULT_SITE_STYLE);
  });
});

describe("arkusz sklepu nie przechwytuje tokenów wspólnego renderera", () => {
  const storefrontRoot = process.cwd();
  const globals = readFileSync(resolve(storefrontRoot, "app/globals.css"), "utf8");

  it("globals.css nie DEFINIUJE ani `--site-*`, ani `--landing-*`", () => {
    // Kontrola pozytywna: pusty plik przepuściłby każdą regułę niżej.
    expect(globals).toContain("@avably/ui/site.css");

    // Mapowanie na przestrzeń kolorów Tailwinda (`--color-landing-*: var(…)`)
    // jest ODCZYTEM i zostaje — szukamy definicji, czyli tokenu po lewej.
    const definitions = [...globals.matchAll(/^\s*(--(?:site|landing)-[a-z0-9-]*)\s*:/gm)].map(
      ([, name]) => name,
    );
    expect(
      definitions,
      "token wspólnego arkusza zdefiniowany w globals.css: import stoi WYŻEJ, " +
        "więc ta definicja wygrywa i rozjeżdża sklep z płótnem kreatora",
    ).toEqual([]);
  });

  it("sklep podaje rendererowi ROZSTRZYGNIĘTY styl, a nie własne kolory", () => {
    const storePage = readFileSync(resolve(storefrontRoot, "app/(tenant)/store/page.tsx"), "utf8");

    // Bez tego noga broniłaby pustego zbioru (przeniesiona trasa = zielono).
    expect(storePage).toContain("SiteRenderer");
    expect(
      /<SiteRenderer[\s\S]*?\sstyle=\{/.test(storePage),
      "trasa sklepu renderuje sekcje bez propsa stylu — strona najemcy wróciłaby " +
        "do wyglądu domyślnego mimo wyboru w kreatorze",
    ).toBe(true);
    // Żadnego heksa w trasie: kolor przychodzi tokenem z rdzenia (ADR-090).
    expect(storePage).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});
