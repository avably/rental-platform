/**
 * KONTRAKT TRWAŁOŚCI: SEKCJE MIERZĄ KONTENER, NIE OKNO (K1b, ADR-085).
 *
 * Płótno kreatora i sklep publiczny renderuje JEDEN komponent. Dopóki sekcje
 * reagowały na szerokość OKNA (`sm:`/`lg:`, jednostki `vw`), przełącznik
 * „mobile” w kreatorze — który zwęża sam kontener do 390 px — pokazywał układ
 * DESKTOPOWY ściśnięty do szerokości telefonu: teksty wychodziły poza kontener,
 * nagłówki zostawały desktopowe, produkty stały w trzech nieczytelnych
 * kolumnach. Płótno kłamało, a operator projektował stronę, której nie widział.
 *
 * Ten plik pilnuje, żeby nowy kod nie przywrócił tej wady. Broni czterech
 * rzeczy naraz:
 *   1. ŹRÓDŁA — w sekcjach nie ma viewportowych wariantów ani jednostek `vw`;
 *   2. KORZENIA — renderer NAPRAWDĘ wystawia kontener `site` (sprawdzane na
 *      wyrenderowanym elemencie, nie tylko w źródle — `cn()` przepuszcza klasy
 *      przez tailwind-merge i mogłoby ją po drodze zjeść);
 *   3. PROGÓW — warianty kontenerowe łamią się na TYCH SAMYCH liczbach, co
 *      dawne `sm:`/`lg:` (dowód z SKOMPILOWANEGO arkusza, nie z komentarza);
 *   4. ROZSTAWU — wspólny arkusz skal jest importowany przez OBA produkty.
 *
 * Czego ten kontrakt NIE dowodzi: jsdom nie liczy container queries, więc
 * prawdy wizualnej (2 kolumny na 390 px, brak poziomego przewijania) dowodzi
 * weryfikacja w przeglądarce, opisana w dzienniku budowy — nie ten plik.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render } from "@testing-library/react";
import postcss from "postcss";
import tailwindcssPostcss from "@tailwindcss/postcss";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CANVAS_COLUMNS,
  CANVAS_DESIGN_WIDTH_PX,
  ICON_DESIGN_PX,
  ICON_MIN_PX,
  TEXT_SCALES,
  iconPxAt,
  presetContentFor,
  sectionCanvasFrom,
  type TextScale,
} from "@avably/core/site";

import { bleedsToEdges } from "./element-canvas";
import { SiteRenderer } from "./site-renderer";
import type { RenderSection } from "./types";

const packageRoot = process.cwd();
const repositoryRoot = resolve(packageRoot, "../..");

const read = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

/**
 * Komentarze WYPADAJĄ ze skanu. Bez tego każde zdanie o tym, dlaczego `sm:`
 * jest zakazane, samo zapalałoby kontrakt na czerwono — i albo znikłoby
 * wyjaśnienie, albo kontrakt.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SECTION_SOURCES = [
  "packages/ui/src/site/sections.tsx",
  "packages/ui/src/site/template.ts",
] as const;

const SHARED_SHEET = "packages/ui/src/site/site.css";

/** Warianty Tailwinda reagujące na szerokość OKNA (media queries). */
const VIEWPORT_VARIANT = /(?:^|[\s"'`{(])(?:max-)?(?:sm|md|lg|xl|2xl):/;

/** Jednostki viewportu — ta sama wada, tylko w CSS-ie zamiast w klasie. */
const VIEWPORT_UNIT = /\d(?:\.\d+)?(?:vw|vh|svw|svh|lvw|lvh|dvw|dvh)\b/;

/**
 * DOWOLNY wariant kontenerowy Tailwinda: `@`, rozmiar (nazwany albo arbitralny),
 * opcjonalna nazwa kontenera, dwukropek. Łapie zarówno nasze
 * `@min-[40rem]/site:`, jak i formy, których NIE chcemy: obcy próg
 * (`@min-[48rem]/site:`), kontener bezimienny (`@min-[40rem]:`), nazwany
 * rozmiar z motywu (`@lg/site:`) czy zapytanie górnego progu (`@max-[…]/site:`).
 * `@container/site` nie ma dwukropka, więc nie wpada tu jako wariant.
 */
const CONTAINER_VARIANT = /@(?:min-|max-)?(?:\[[^\]]+\]|[a-z0-9]+)(?:\/[a-z0-9-]+)?:/g;

/** Zapytanie `@container` zapisane WPROST w arkuszu (dziś nie ma żadnego). */
const CONTAINER_AT_RULE = /@container\b([^{]*)\{/g;

/**
 * JEDYNE dozwolone warianty kontenerowe. Progi są tu wypisane, bo są tą samą
 * parą liczb, którą noga „PROGI” niżej porównuje z breakpointami viewportu —
 * gdyby w źródłach pojawił się trzeci próg, tamta noga nadal świeciłaby na
 * zielono (kompiluje literały), a sklep układałby się inaczej niż przedtem.
 */
const DOZWOLONE_WARIANTY = [
  "@min-[40rem]/site:",
  "@min-[64rem]/site:",
  /*
   * DOLNA strona progu 40 rem (K4, ADR-088) — zapytanie napisane WPROST
   * w arkuszu, bo podmienia właściwości niestandardowe geometrii płótna, a nie
   * klasę utility. To NIE jest trzeci próg: to ta sama liczba, tylko pytana
   * z drugiej strony. Poniżej niej element bierze geometrię MOBILNĄ.
   */
  "@container site (width < 40rem)",
] as const;
const DOZWOLONE_PROGI = ["40rem", "64rem"] as const;

describe("skan źródeł: sekcje nie mierzą okna", () => {
  it.each(SECTION_SOURCES)("%s ma warianty KONTENEROWE (kontrola pozytywna skanu)", (path) => {
    const source = stripComments(read(path));
    // Bez tej asercji cały plik broniłby pustego zbioru: gdyby ktoś usunął
    // responsywność w ogóle, „brak sm:” byłoby prawdą i nic by się nie stało.
    expect(source.length).toBeGreaterThan(500);
    expect(source, "brak wariantów kontenerowych — skan niżej nie ma czego bronić").toMatch(
      /@min-\[\d+rem\]\/site:/,
    );
  });

  it.each(SECTION_SOURCES)("%s nie używa wariantów viewportowych (sm:/md:/lg:/xl:)", (path) => {
    const lines = stripComments(read(path)).split("\n");
    const offenders = lines
      .map((line, index) => ({ line: index + 1, text: line.trim() }))
      .filter((entry) => VIEWPORT_VARIANT.test(entry.text));
    expect(
      offenders,
      "wariant viewportowy w sekcji — płótno kreatora przestanie mówić prawdę; użyj @min-[..rem]/site:",
    ).toEqual([]);
  });

  it.each([...SECTION_SOURCES, SHARED_SHEET])("%s nie używa jednostek vw/vh", (path) => {
    const lines = stripComments(read(path)).split("\n");
    const offenders = lines
      .map((line, index) => ({ line: index + 1, text: line.trim() }))
      .filter((entry) => VIEWPORT_UNIT.test(entry.text));
    expect(offenders, "jednostka viewportu w skali sekcji — użyj cqw (miara kontenera)").toEqual([]);
  });

  it("źródła używają WYŁĄCZNIE dwóch progów kontenera (40rem i 64rem)", () => {
    // LUKA, którą ta asercja zamyka (recenzja PM do PR #152): noga „PROGI”
    // niżej kompiluje literały wpisane W TEŚCIE, więc dowodzi wyłącznie tego,
    // że `@min-[40rem]/site:` i `@min-[64rem]/site:` łamią się tam, co
    // `sm:`/`lg:`. O progu PRZEMYCONYM DO ŹRÓDŁA (`@min-[48rem]/site:`) nie
    // mówiła nic — przechodził cały kontrakt na zielono. Tu skanujemy to, co
    // naprawdę jest w plikach, i pilnujemy, żeby zbiór progów się nie rozjechał.
    const znalezione = new Map<string, Set<string>>();
    const dopisz = (wariant: string, gdzie: string) => {
      const pliki = znalezione.get(wariant) ?? new Set<string>();
      pliki.add(gdzie);
      znalezione.set(wariant, pliki);
    };

    for (const path of SECTION_SOURCES) {
      for (const [wariant] of stripComments(read(path)).matchAll(CONTAINER_VARIANT)) {
        dopisz(wariant, path);
      }
    }
    // Arkusz może kiedyś dostać zapytanie `@container` napisane wprost —
    // wtedy jest to KOLEJNY próg układu i podlega tej samej regule.
    for (const dopasowanie of stripComments(read(SHARED_SHEET)).matchAll(CONTAINER_AT_RULE)) {
      dopisz(`@container ${(dopasowanie[1] ?? "").trim()}`, SHARED_SHEET);
    }

    // Kontrola pozytywna: skan po pustym zbiorze broniłby niczego.
    expect(znalezione.size, "skan nie znalazł ŻADNEGO wariantu kontenerowego").toBeGreaterThan(0);

    const obce = [...znalezione.entries()]
      .filter(([wariant]) => !DOZWOLONE_WARIANTY.includes(wariant as (typeof DOZWOLONE_WARIANTY)[number]))
      .map(([wariant, pliki]) => `${wariant} (${[...pliki].join(", ")})`);
    expect(
      obce,
      "obcy wariant kontenerowy w źródłach sekcji. Nowy próg układu to ŚWIADOMA decyzja: " +
        "zmienia szerokości, przy których sklep się przełamuje, a noga „PROGI” niżej go NIE widzi " +
        "(kompiluje literały). Dopisz go do DOZWOLONE_WARIANTY/DOZWOLONE_PROGI, dołóż mu parę " +
        "w teście progów i odnotuj w ADR-085.",
    ).toEqual([]);

    const progi = [...znalezione.keys()]
      .map((wariant) => /\[([^\]]+)\]/.exec(wariant)?.[1])
      .filter((prog): prog is string => Boolean(prog));
    expect(new Set(progi)).toEqual(new Set(DOZWOLONE_PROGI));
  });

  it("zapytania `@container` z arkusza celują w NAZWANY kontener i w znany próg", () => {
    /*
     * Wariant Tailwinda niesie nazwę kontenera i próg w samej klasie, więc
     * pilnuje ich skan wyżej. Zapytanie napisane wprost w CSS-ie nie ma tej
     * własności: `@container (width < 40rem)` bez nazwy przechwyciłby pierwszy
     * lepszy kontener po drodze (od K4 płótno JEST kontenerem), a próg wpisany
     * w pikselach rozjechałby się z resztą układu przy pierwszej zmianie bazy
     * fontu. Obie rzeczy sprawdzamy tu wprost.
     */
    const zapytania = [...stripComments(read(SHARED_SHEET)).matchAll(CONTAINER_AT_RULE)].map(
      (dopasowanie) => (dopasowanie[1] ?? "").trim(),
    );
    expect(zapytania.length, "arkusz nie ma ŻADNEGO zapytania kontenera — nie ma czego bronić").toBeGreaterThan(0);
    for (const zapytanie of zapytania) {
      const rozbior = /^([a-z][a-z0-9-]*)\s+\((?:width\s*[<>=]{1,2}\s*)([\d.]+rem)\)$/.exec(zapytanie);
      expect(rozbior, `zapytanie „${zapytanie}" bez nazwy kontenera albo z progiem spoza rem`).not.toBeNull();
      expect(rozbior?.[1], "zapytanie nie celuje w kontener `site`").toBe("site");
      expect(
        DOZWOLONE_PROGI as readonly string[],
        `próg ${rozbior?.[2]} spoza uzgodnionego zbioru — nowy próg to decyzja PM`,
      ).toContain(rozbior?.[2]);
    }
  });

  it("wspólny arkusz naprawdę niesie skale sekcji w jednostkach kontenera", () => {
    const css = read(SHARED_SHEET);
    expect(css).toContain(".landing-display");
    expect(css).toContain(".landing-heading");
    expect(css).toMatch(/font-size:\s*clamp\([^)]*cqw[^)]*\)/);
  });

  it("siatki sekcji nie dają więcej niż 2 kolumny w wąskim kontenerze", () => {
    // Klasa BEZ wariantu obowiązuje od zera w górę, więc to ona decyduje
    // o telefonie. Decyzja właściciela (2026-08-01): maksimum dwie kolumny.
    const offenders: string[] = [];
    for (const path of SECTION_SOURCES) {
      for (const match of stripComments(read(path)).matchAll(
        /(^|[\s"'`])(grid-cols-(\d+))/g,
      )) {
        const columns = Number(match[3]);
        if (columns > 2) offenders.push(`${path}: ${match[2]}`);
      }
    }
    expect(offenders, "siatka bez wariantu daje >2 kolumny — na telefonie karta zrobi się nieczytelna").toEqual([]);
  });

  it("nagłówki hero i sekcji łamią długie słowa", () => {
    const source = stripComments(read("packages/ui/src/site/template.ts"));
    const declarations = [...source.matchAll(/(heroHeading|sectionHeading):\s*"([^"]*)"/g)];
    // Od ADR-090 tablica klas jest JEDNA (wygląd niesie motyw jako zmienne),
    // więc deklaracje są dwie, a nie cztery. Sedno kontraktu bez zmian: oba
    // nagłówki muszą łamać długie słowo, bo najemca wpisze nazwę sprzętu,
    // której nikt nie przewidział.
    expect(declarations).toHaveLength(2);
    for (const [, key, classes] of declarations) {
      expect(classes, `${key} bez break-words — długie słowo wyjdzie poza kontener`).toContain(
        "break-words",
      );
    }
  });
});

describe("korzeń renderera JEST kontenerem zapytań", () => {
  const sections: RenderSection[] = [
    { id: "s1", position: 0, type: "hero", content: { heading: "Wypożyczalnia" } },
  ] as RenderSection[];

  it("źródło renderera deklaruje kontener nazwany `site`", () => {
    expect(read("packages/ui/src/site/site-renderer.tsx")).toContain("@container/site");
  });

  it("wyrenderowany korzeń NIESIE klasę kontenera (po tailwind-merge)", () => {
    // Sedno: `cn()` scala klasy przez tailwind-merge. Sprawdzenie samego źródła
    // przepuściłoby regresję, w której klasa ginie po drodze do DOM-u.
    const { container } = render(<SiteRenderer sections={sections} />);
    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(root?.className.split(/\s+/)).toContain("@container/site");
  });

  it("klasa kontenera przeżywa własny className wołającego", () => {
    const { container } = render(
      <SiteRenderer sections={sections} className="min-h-full" />,
    );
    expect(container.firstElementChild?.className.split(/\s+/)).toContain("@container/site");
  });
});

describe("oba produkty importują wspólny arkusz sekcji", () => {
  it.each(["panel", "storefront"] as const)("%s importuje @avably/ui/site.css", (application) => {
    const globals = read(`apps/${application}/app/globals.css`);
    expect(globals).toContain('@import "@avably/ui/site.css"');
  });

  it("arkusz sekcji WCIĄGA arkusz krojów — jeden import po stronie aplikacji", () => {
    // Warunek ratyfikacji PM (K5 v2): rodziny krojów mają dojechać do OBU
    // produktów tym samym importem, co reszta arkusza sekcji. Osobny import
    // per aplikacja to dokładnie ta wada, przez którą powstał ADR-085: arkusz
    // żyjący w jednym appie nie jest źródłem prawdy, tylko kopią.
    expect(read("packages/ui/src/site/site.css")).toContain('@import "./site-fonts.css"');
  });

  it("KAŻDA rodzina kroju deklaruje `font-display: swap`", () => {
    // Bez `swap` strona najemcy stoi przez pierwsze sekundy bez tekstu —
    // dla strony sprzedażowej to gorszy wybór niż jedno przemalowanie.
    const arkusz = read("packages/ui/src/site/site-fonts.css");
    const faces = arkusz.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces.length, "arkusz krojów bez ani jednej deklaracji (kontrola po pustym zbiorze)").toBeGreaterThan(
      8,
    );
    const bezSwap = faces.filter((face) => !/font-display:\s*swap/.test(face));
    expect(bezSwap.length, `deklaracje bez swap: ${bezSwap.length}`).toBe(0);
  });

  it("skale zniknęły z globals sklepu — jedno źródło prawdy, nie dwa", () => {
    const globals = read("apps/storefront/app/globals.css");
    expect(globals).not.toMatch(/^\.landing-(display|heading|statement|subheading)\s*\{/m);
    expect(globals).not.toMatch(/^\s*--landing-ink:/m);
  });

  it("pakiet wystawia arkusz jako publiczny wpis eksportu", () => {
    const manifest = JSON.parse(read("packages/ui/package.json")) as {
      exports: Record<string, string>;
    };
    expect(manifest.exports["./site.css"]).toBe("./src/site/site.css");
  });
});

/**
 * PŁÓTNO v2 MIERZY KONTENER, NIE OKNO (K2, ADR-084 — rozszerzenie ADR-085).
 *
 * Geometria elementów jest ABSOLUTNA, więc ryzyko jest tu inne niż w sekcjach
 * v1: nie o wariant `sm:`, tylko o pokusę policzenia szerokości płótna z okna
 * (`window.innerWidth`, `visualViewport`, `matchMedia`). Wystarczy jedno takie
 * miejsce, żeby płótno kreatora zwężone do 390 px znowu zaczęło kłamać — tym
 * razem CICHO, bo układ wyglądałby poprawnie w oknie operatora.
 *
 * Te źródła NIE muszą mieć wariantów kontenerowych (absolut ich nie potrzebuje),
 * więc nie wchodzą do `SECTION_SOURCES` — mają własną, węższą regułę.
 */
const CANVAS_SOURCES = [
  "packages/ui/src/site/element-canvas.tsx",
  "packages/core/src/site/geometry.ts",
  "packages/core/src/site/canvas-presets.ts",
  "apps/panel/app/[locale]/(kreator)/strona/kreator/canvas-elements.tsx",
  // Silnik gestów (K2c, ADR-087) przelicza piksele wskaźnika na jednostki — to
  // najbardziej naturalne miejsce, żeby sięgnąć po szerokość okna „na skróty".
  "apps/panel/app/[locale]/(kreator)/strona/kreator/canvas-gesture.ts",
  // Auto-układ mobilny i miary tekstu (K4, ADR-088). Tu pokusa jest największa
  // z całego kreatora: „sprawdźmy, czy to telefon" przez `matchMedia` albo
  // `innerWidth` byłoby o jedną linijkę krótsze niż policzenie tego z treści —
  // i o cały etap gorsze, bo płótno w panelu znowu pokazywałoby desktop.
  "packages/core/src/site/mobile-layout.ts",
  "packages/core/src/site/text-metrics.ts",
] as const;

/** Sposoby zapytania OKNA o rozmiar — każdy z nich obchodzi miarę kontenera. */
const WINDOW_MEASURE = /\b(innerWidth|innerHeight|visualViewport|matchMedia|outerWidth|screen\.width)\b/;

describe("płótno v2: geometria mierzy kontener, nie okno", () => {
  it.each(CANVAS_SOURCES)("%s naprawdę liczy geometrię (kontrola pozytywna skanu)", (path) => {
    const source = stripComments(read(path));
    // Bez tego cały blok broniłby pustego zbioru: plik przepisany na coś
    // innego przechodziłby „bo nie ma w nim window".
    expect(source.length).toBeGreaterThan(500);
    expect(source, "plik nie odwołuje się do jednostek siatki — czy to na pewno geometria płótna?").toMatch(
      /CANVAS_COLUMNS|GRID_UNIT_PX|geometry|Geometry/,
    );
  });

  it.each(CANVAS_SOURCES)("%s nie pyta OKNA o rozmiar", (path) => {
    const offenders = stripComments(read(path))
      .split("\n")
      .map((text, index) => ({ line: index + 1, text: text.trim() }))
      .filter((entry) => WINDOW_MEASURE.test(entry.text));
    expect(
      offenders,
      "miarą płótna jest KONTENER (szerokość elementu nadrzędnego), nie okno — inaczej " +
        "tryb mobilny kreatora znowu pokaże układ desktopowy ściśnięty do 390 px",
    ).toEqual([]);
  });

  it.each(CANVAS_SOURCES)("%s nie używa jednostek vw/vh ani wariantów viewportowych", (path) => {
    const lines = stripComments(read(path)).split("\n");
    expect(lines.filter((line) => VIEWPORT_UNIT.test(line))).toEqual([]);
    expect(lines.filter((line) => VIEWPORT_VARIANT.test(line))).toEqual([]);
  });
});

/**
 * PROGI: warianty kontenerowe łamią się na TYCH SAMYCH liczbach, co dawne
 * `sm:`/`lg:`. Dowód idzie ze SKOMPILOWANEGO arkusza (tym samym silnikiem, co
 * build Next.js), więc przetrwa też zmianę motywu Tailwinda: gdyby ktoś ruszył
 * breakpoint `sm`, ten test pokaże rozjazd zamiast go przemilczeć.
 *
 * CZEGO TA NOGA SAMA NIE DOWODZI (recenzja PM do PR #152): kompiluje LITERAŁY
 * wypisane niżej, a nie to, czego używają źródła — próg przemycony do
 * `template.ts` byłby dla niej niewidzialny. Domyka to skan
 * „źródła używają WYŁĄCZNIE dwóch progów kontenera” wyżej; pierwszy test tego
 * bloku pilnuje, żeby obie listy nie rozjechały się po cichu.
 */
const PARY_PROGOW = [
  { prog: "40rem", okno: ".sm\\:py-20", kontener: ".\\@min-\\[40rem\\]\\/site\\:py-20" },
  { prog: "64rem", okno: ".lg\\:grid-cols-3", kontener: ".\\@min-\\[64rem\\]\\/site\\:grid-cols-3" },
] as const;

describe("progi kontenerowe = dotychczasowe breakpointy viewportu", () => {
  let compiled: string;

  beforeAll(async () => {
    const entry = [
      '@import "tailwindcss";',
      '@source inline("sm:py-20 lg:grid-cols-3 @min-[40rem]/site:py-20 @min-[64rem]/site:grid-cols-3");',
      "",
    ].join("\n");
    const result = await postcss([
      tailwindcssPostcss({ base: packageRoot, optimize: false }),
    ]).process(entry, { from: resolve(packageRoot, "virtual.css") });
    compiled = result.css;
  });

  /** Zapytanie, w którym SILNIK umieścił daną klasę (rodzaj, nazwa, próg). */
  function enclosingQuery(selector: string) {
    const at = compiled.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`Brak reguły ${selector} w skompilowanym arkuszu`);
    const opener = [
      ...compiled
        .slice(0, at)
        .matchAll(/@(media|container)\s+([^{(]*)\(width >= ([\d.]+rem)\)\s*\{/g),
    ].at(-1);
    if (!opener) throw new Error(`Reguła ${selector} nie stoi w żadnym zapytaniu szerokości`);
    return { kind: opener[1], name: (opener[2] ?? "").trim(), threshold: opener[3] };
  }

  it("każdy DOZWOLONY próg ma tu swoją parę viewportową", () => {
    // Spinka między nogami: dopisanie progu do listy dozwolonych bez pary
    // w tym bloku dałoby próg wpuszczony do źródeł, ale nigdy nieporównany
    // z żadnym breakpointem okna.
    expect(PARY_PROGOW.map((para) => para.prog)).toEqual([...DOZWOLONE_PROGI]);
  });

  it.each(PARY_PROGOW.map((para) => [para.prog, para.okno, para.kontener] as const))(
    "próg %s jest identyczny dla okna i dla kontenera",
    (_prog, viewport, container) => {
      const window = enclosingQuery(viewport);
      const site = enclosingQuery(container);

      expect(window.kind).toBe("media");
      expect(site.kind).toBe("container");
      // Sedno migracji: ta sama liczba, inna miara.
      expect(site.threshold).toBe(window.threshold);
      // Zapytanie celuje w NAZWANY kontener — bez nazwy przechwyciłby je pierwszy
      // lepszy `@container` wewnątrz sekcji i sekcja mierzyłaby kartę, nie stronę.
      expect(site.name).toBe("site");
    },
  );
});

/**
 * PŁÓTNO WYBIERA GEOMETRIĘ PO KONTENERZE, NIE PO OKNIE (K4, ADR-088).
 *
 * Sekcja niesie dwa układy naraz — desktopowy i mobilny — a przełącza je CSS.
 * Ryzyko jest tu inne niż w sekcjach v1: nie o wariant `sm:`, tylko o pokusę
 * napisania tego w JavaScripcie („sprawdź szerokość i wybierz układ"). Taki kod
 * działa w sklepie i KŁAMIE w kreatorze, bo tam szerokość okna nie ma nic
 * wspólnego z szerokością płótna.
 *
 * Kontrakt broni trzech rzeczy naraz: że przełącznik JEST w arkuszu, że renderer
 * naprawdę wystawia OBA komplety współrzędnych, i że oba trafiają do DOM-u.
 */
describe("tło pełnoekranowe (aneks do ADR-088) nie łamie miary kontenera", () => {
  // Właściciel odrzucił pasy po bokach hero (2026-08-03): tło ma sięgać krawędzi
  // okna. Rozwiązanie NIE MOŻE sięgnąć po jednostki okna — to jest dokładnie
  // ten błąd, przez który powstał ADR-085 (płótno 390 px pokazywałoby wtedy
  // szerokość monitora, a nie telefonu).
  it("warstwa pełnoekranowa rozciąga się PROCENTEM sekcji, nie szerokością okna", () => {
    const arkusz = stripComments(read("packages/ui/src/site/site.css"));
    const blok = /\.canvas-bleed\s*\{([^}]*)\}/.exec(arkusz);
    expect(blok, "brak reguły tła pełnoekranowego").not.toBeNull();
    expect(blok![1]).toContain("width: 100%");
    expect(blok![1], "tło pełnoekranowe sięgnęło po jednostkę OKNA").not.toMatch(/\d+(vw|vh|dvw|dvh)/);
  });

  it("PION tła idzie tymi samymi zmiennymi co reszta — auto-układ mobilny rządzi nim tak samo", () => {
    // Gdyby warstwa brała pion z własnego wzoru, tło rozjechałoby się z treścią
    // na telefonie, a `mobileLayoutOf` przestałby być jedynym źródłem układu.
    const blok = /\.canvas-bleed\s*\{([^}]*)\}/.exec(stripComments(read("packages/ui/src/site/site.css")))![1];
    expect(blok, "warstwa pełnoekranowa nadpisuje PION").not.toMatch(/(^|\s)(top|height)\s*:/);
  });

  it("tłem jest wyłącznie zdjęcie albo kształt rozciągnięty na CAŁE płótno", () => {
    const hero = sectionCanvasFrom("hero", presetContentFor("hero", "pl"));
    for (const element of hero.elements) {
      // Preset hero nie ma tła pełnoekranowego — kontrola po pustym zbiorze dla
      // reguły niżej (gdyby predykat zwracał `true` dla czegokolwiek, ten
      // przypadek by go złapał).
      expect(bleedsToEdges(element)).toBe(false);
    }
    const tlo = {
      id: "x",
      kind: "image" as const,
      alt: "kadr",
      fit: "cover" as const,
      layout: { desktop: { x: 0, y: 0, w: CANVAS_COLUMNS, h: 40, z: 0 } },
    };
    expect(bleedsToEdges(tlo)).toBe(true);
    expect(bleedsToEdges({ ...tlo, layout: { desktop: { ...tlo.layout.desktop, x: 12, w: 120 } } })).toBe(
      false,
    );
    expect(
      bleedsToEdges({
        id: "t",
        kind: "text" as const,
        text: "szeroki tekst",
        variant: "body" as const,
        align: "left" as const,
        layout: { desktop: { x: 0, y: 0, w: CANVAS_COLUMNS, h: 6, z: 2 } },
      }),
      "tekst rozciągnięty na całą szerokość ma ZOSTAĆ w kolumnie czytelności",
    ).toBe(false);
  });
});

describe("płótno v2: dwa układy przełączane zapytaniem kontenera", () => {
  const sheet = read(SHARED_SHEET);

  it("arkusz przełącza pudełko elementu poniżej progu 40 rem", () => {
    const blok = /@container site \(width < 40rem\) \{([\s\S]*?)\n\}/.exec(sheet)?.[1] ?? "";
    expect(blok.length, "brak zapytania kontenera dla płótna — nie ma czego przełączać").toBeGreaterThan(50);
    // Każda z czterech współrzędnych MUSI mieć swój odpowiednik mobilny.
    for (const [wlasciwosc, zmienna] of [
      ["left", "--el-mx"],
      ["top", "--el-my"],
      ["width", "--el-mw"],
      ["height", "--el-mh"],
    ] as const) {
      expect(blok, `${wlasciwosc} nie przełącza się na wariant mobilny`).toContain(
        `${wlasciwosc}: var(${zmienna})`,
      );
    }
    expect(blok, "wysokość płótna nie przełącza się na mobilną").toContain(
      "aspect-ratio: var(--canvas-ratio-mobile)",
    );
  });

  it("renderer wystawia OBA komplety współrzędnych do DOM-u", () => {
    // Sedno: sam skan źródła przepuściłby regresję, w której komplet mobilny
    // powstaje, ale nie dojeżdża do atrybutu `style`.
    const canvas = sectionCanvasFrom("hero", presetContentFor("hero", "pl"));
    const sections = [{ id: "s1", position: 0, type: "hero", content: canvas }] as RenderSection[];
    const { container } = render(<SiteRenderer sections={sections} />);

    const box = container.querySelector<HTMLElement>("[data-element-id]");
    expect(box, "renderer nie narysował ani jednego elementu").not.toBeNull();
    expect(box!.className.split(/\s+/)).toContain("canvas-box");
    for (const zmienna of ["--el-x", "--el-y", "--el-w", "--el-h", "--el-z"]) {
      expect(box!.style.getPropertyValue(zmienna), `brak ${zmienna}`).not.toBe("");
    }
    for (const zmienna of ["--el-mx", "--el-my", "--el-mw", "--el-mh", "--el-mz"]) {
      expect(box!.style.getPropertyValue(zmienna), `brak ${zmienna}`).not.toBe("");
    }

    const grid = container.querySelector<HTMLElement>("[data-canvas-grid]");
    expect(grid!.style.getPropertyValue("--canvas-ratio")).toBe(`144 / ${canvas.rows}`);
    // Płótno mobilne jest WYŻSZE — jedna kolumna zamiast układu w poziomie.
    const mobilne = grid!.style.getPropertyValue("--canvas-ratio-mobile");
    expect(mobilne).toMatch(/^144 \/ \d+$/);
    expect(Number(mobilne.split("/")[1])).toBeGreaterThan(canvas.rows);
  });

  it("wybór układu NIE przechodzi przez JavaScript renderera", () => {
    // Kontrola negatywna dla całej tezy tego bloku: gdyby renderer wybierał
    // układ sam, w źródle stałby warunek na szerokości.
    const source = stripComments(read("packages/ui/src/site/element-canvas.tsx"));
    expect(source).toContain("--el-m");
    expect(source, "renderer sam wybiera układ — to zadanie arkusza").not.toMatch(
      /if\s*\([^)]*(width|breakpoint)[^)]*<\s*\d/,
    );
  });
});

/**
 * SKALE TYPOGRAFII PŁÓTNA = LICZBY, KTÓRYMI MIERZY AUTO-UKŁAD (K4, ADR-088).
 *
 * Wysokość pudełka na telefonie liczy `text-metrics.ts` z rozmiaru fontu, jaki
 * ten tekst NAPRAWDĘ dostanie. Arkusz i estymator muszą więc mówić dokładnie to
 * samo — rozjazd nie wywala żadnego testu sam z siebie, tylko po cichu wylewa
 * akapit poza pudełko na 390 px. Dlatego porównujemy je wprost, para po parze.
 */
describe("typografia płótna: arkusz i estymator mówią to samo", () => {
  const sheet = read(SHARED_SHEET);

  /** `clamp(min, Kcqw, max)` z arkusza → trzy liczby w pikselach. */
  function clampOf(scale: TextScale): { min: number; per: number; max: number } {
    const rule = new RegExp(
      `\\.canvas-type-${scale}\\s*\\{[^}]*font-size:\\s*clamp\\(([^,]+),([^,]+),([^)]+)\\)`,
    ).exec(sheet);
    if (!rule) throw new Error(`Brak skali .canvas-type-${scale} w arkuszu`);
    const rem = (value: string) => Number.parseFloat(value) * 16;
    return {
      min: rem(rule[1]!),
      per: Number.parseFloat(rule[2]!),
      max: rem(rule[3]!),
    };
  }

  const scales = Object.keys(TEXT_SCALES) as TextScale[];

  it("estymator zna wszystkie skale (kontrola po pustym zbiorze)", () => {
    expect(scales.length).toBe(6);
  });

  it.each(scales)("skala %s: dolny zacisk = rozmiar czytelny z estymatora", (scale) => {
    expect(clampOf(scale).min).toBeCloseTo(TEXT_SCALES[scale].minPx, 2);
  });

  it.each(scales)("skala %s: górny zacisk = rozmiar projektowy z estymatora", (scale) => {
    expect(clampOf(scale).max).toBeCloseTo(TEXT_SCALES[scale].designPx, 2);
  });

  it.each(scales)("skala %s: przy szerokości projektowej `cqw` daje rozmiar projektowy", (scale) => {
    // `100cqw` to szerokość płótna, więc przy szerokości projektowej
    // `K cqw` = K × 1152 / 100. Ta liczba MUSI wyjść na rozmiar projektowy —
    // inaczej tekst na płótnie 1152 px byłby inny niż w skali szablonu.
    const { per } = clampOf(scale);
    expect((per * CANVAS_DESIGN_WIDTH_PX) / 100).toBeCloseTo(TEXT_SCALES[scale].designPx, 1);
  });

  it("skale płótna są jednostkami KONTENERA, nie okna", () => {
    const kanwa = sheet.slice(sheet.indexOf(".canvas-type-display"));
    expect(kanwa).toMatch(/cqw/);
    expect(kanwa, "skala płótna w jednostkach okna").not.toMatch(/\d(?:vw|vh)\b/);
  });
});

/**
 * KAFELEK IKONY SKALUJE SIĘ Z PŁÓTNEM (K4, ADR-088).
 *
 * Ikona miała dokładnie ten sam błąd, co typografia, tylko trudniejszy do
 * zauważenia: bok w `rem` nie malał razem z płótnem, więc kafelek wyliczony na
 * sześć jednostek (48 px przy szerokości projektowej, 32 px przy 768 px)
 * wychodził poza swoje miejsce i wchodził na tytuł pod sobą. Arkusz i estymator
 * muszą mówić tu to samo, tak jak przy skalach tekstu.
 */
describe("kafelek ikony: arkusz i estymator mówią to samo", () => {
  const sheet = read(SHARED_SHEET);

  it("arkusz niesie skalę kafelka w jednostkach kontenera", () => {
    const rule = /\.canvas-icon\s*\{[^}]*width:\s*clamp\(([^,]+),([^,]+),([^)]+)\)/.exec(sheet);
    expect(rule, "brak skali kafelka ikony w arkuszu").not.toBeNull();
    const rem = (value: string) => Number.parseFloat(value) * 16;
    expect(rem(rule![1]!)).toBeCloseTo(ICON_MIN_PX, 2);
    expect(rem(rule![3]!)).toBeCloseTo(ICON_DESIGN_PX, 2);
    expect((Number.parseFloat(rule![2]!) * CANVAS_DESIGN_WIDTH_PX) / 100).toBeCloseTo(
      ICON_DESIGN_PX,
      1,
    );
  });

  it("estymator zna tę samą krzywą, co arkusz", () => {
    expect(iconPxAt(CANVAS_DESIGN_WIDTH_PX)).toBe(ICON_DESIGN_PX);
    expect(iconPxAt(390)).toBe(ICON_MIN_PX);
    // 768 px to dokładnie ta szerokość, przy której kafelek zrównuje się
    // z sześcioma jednostkami siatki — tam wada była widoczna gołym okiem.
    expect(iconPxAt(768)).toBe(ICON_MIN_PX);
  });
});
