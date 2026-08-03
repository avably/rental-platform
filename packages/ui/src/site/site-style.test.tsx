/**
 * MOTYW STRONY: WYGLĄD JEST TOKENEM, NIE KLASĄ (K5, ADR-090).
 *
 * Galeria szablonów obiecuje operatorowi sześć RÓŻNYCH ŚWIATÓW wizualnych
 * i czytelną stronę w każdym z nich. Drugiej obietnicy broni WYCZERPUJĄCA
 * bramka w core (`contrast-contract.test.ts`) — ale broni jej na LICZBACH,
 * przy założeniu, że kolor naprawdę przychodzi z rejestru motywów przez
 * zmienną, a wariant akcentu wybiera PAS. Ten plik jest drugą połową tego
 * dowodu: sprawdza, że render zachowuje się tak, jak tamta bramka zakłada.
 *
 * Pięć rzeczy, których nie widać ani w rejestrze, ani w arkuszu z osobna:
 *
 *   1. KORZEŃ NIESIE ZMIENNE ŹRÓDŁOWE każdego pasa, a nie gotowy kolor — bo
 *      w chwili renderu (serwer) nie wiadomo, na jakim pasie stanie element;
 *   2. MOTYW NIE JEST ZESTAWEM KLAS — dwa różne motywy dają render różniący się
 *      WYŁĄCZNIE wartościami zmiennych; ani jedna klasa się nie zmienia. To jest
 *      teza ADR-090 („dopisanie motywu nr 7 nie dotyka kodu") jako zdanie
 *      sprawdzalne;
 *   3. WARIANT AKCENTU WYBIERAJĄ DANE, nie arkusz. Motyw, w którym pas
 *      odwrócony jest JAŚNIEJSZY od strony, dostaje na nim komplet papierowy —
 *      i wynika to z pola w rejestrze, a nie z reguły `.dark` w CSS;
 *   4. STRONA NAJEMCY NIE DZIEDZICZY PALETY PANELU. Jedna klasa `bg-card`
 *      w warstwie renderu wraca do stanu sprzed ADR-090 po cichu — skan źródeł
 *      jest jedynym miejscem, w którym to widać;
 *   5. KROJE SĄ NASZE. Rodzina z rejestru bez `@font-face`, `@font-face` bez
 *      pliku i jakikolwiek obcy host w arkuszu krojów są czerwone.
 *
 * Czego ten plik NIE dowodzi: jsdom nie kaskaduje arkusza, więc o tym, którą
 * regułę wybierze przeglądarka, wnioskujemy z ODCZYTU arkusza, a nie
 * z obliczonego stylu. Prawdy wizualnej dowodzi weryfikacja w przeglądarce,
 * opisana w dzienniku budowy.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ACTIVE_TOKENS,
  DEFAULT_SITE_STYLE,
  ELEMENT_COLORS,
  FONT_FAMILIES,
  SECTION_BACKGROUNDS,
  SECTION_TYPES,
  SITE_THEMES,
  STYLE_TOKENS,
  THEME_BAND_KEYS,
  accentsOf,
  bandTokenName,
  presetContentFor,
  sectionCanvasFrom,
  themeTokens,
  type ElementColor,
  type ResolvedSiteStyle,
  type SectionCanvas,
  type SiteThemeId,
} from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SiteRenderer } from "./site-renderer";
import { siteStyles } from "./template";
import type { RenderSection } from "./types";

// Ten pakiet nie ma auto-cleanup RTL (brak `globals`), a niżej renderujemy po
// kilka drzew w jednym teście — sprzątamy jawnie.
afterEach(cleanup);

const repositoryRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

const ARKUSZ = "packages/ui/src/site/site.css";
const ARKUSZ_KROJOW = "packages/ui/src/site/site-fonts.css";
const SZABLON = "packages/ui/src/site/template.ts";
const PLOTNO = "packages/ui/src/site/element-canvas.tsx";
const SEKCJE = "packages/ui/src/site/sections.tsx";

/**
 * Komentarze WYPADAJĄ ze skanu — tak samo, jak w kontrakcie kontenera. Bez tego
 * zdanie tłumaczące, dlaczego `bg-card` jest zakazane, samo wywracałoby test,
 * który tego zakazu pilnuje.
 */
function bezKomentarzy(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function stylZ(nadpisanie: Partial<ResolvedSiteStyle>): ResolvedSiteStyle {
  return { ...DEFAULT_SITE_STYLE, ...nadpisanie };
}

/** Styl motywu w jego WŁASNYM domyślnym ustawieniu (akcent i para z rejestru). */
function stylMotywu(theme: SiteThemeId): ResolvedSiteStyle {
  const tokens = themeTokens(theme);
  return { theme, accent: tokens.defaultAccent, fontPair: tokens.fontPair };
}

const SEKCJA_HERO: RenderSection[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    type: "hero",
    position: 0,
    content: sectionCanvasFrom("hero", presetContentFor("hero", "pl")) as SectionCanvas,
  },
];

function korzen(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>(".site-root");
  if (!root) throw new Error("render nie wystawił korzenia strony");
  return root;
}

/** Zmienne źródłowe, których korzeń MUSI nieść komplet — wyprowadzone z rejestru. */
const ROLE_PASA = ["surface", "ink", "ink-muted", "border", "accent", "accent-contrast", "accent-text"] as const;

describe("korzeń strony niesie ZMIENNE motywu, a nie kolory", () => {
  it("komplet zmiennych KAŻDEGO pasa dla KAŻDEGO motywu z rejestru", () => {
    // Pętla po rejestrze, nie po liście przypadków: motyw dopisany bez kompletu
    // wartości jest czerwony tutaj, zanim ktokolwiek zobaczy dziurę na stronie.
    for (const theme of SITE_THEMES) {
      const { container } = render(<SiteRenderer sections={SEKCJA_HERO} style={stylMotywu(theme)} />);
      const style = korzen(container).getAttribute("style") ?? "";
      for (const band of THEME_BAND_KEYS) {
        for (const rola of ROLE_PASA) {
          expect(style, `motyw ${theme}: brak ${bandTokenName(band, rola)}`).toContain(
            `${bandTokenName(band, rola)}:`,
          );
        }
      }
      cleanup();
    }
  });

  it("wartości pasów są DOKŁADNIE tym, co stoi w rejestrze motywu", () => {
    for (const theme of SITE_THEMES) {
      const tokens = themeTokens(theme);
      const { container } = render(<SiteRenderer sections={SEKCJA_HERO} style={stylMotywu(theme)} />);
      const style = korzen(container).getAttribute("style") ?? "";
      for (const band of THEME_BAND_KEYS) {
        expect(style.toLowerCase()).toContain(
          `${bandTokenName(band, "surface")}: ${tokens.bands[band].surface.toLowerCase()}`,
        );
      }
      cleanup();
    }
  });

  it("WARIANT AKCENTU pasa wybierają DANE — także wtedy, gdy pas odwrócony jest jasny", () => {
    // To jest jedyny test, który broni mechanizmu z ADR-090: arkusz nie zna
    // pojęcia „papier/atrament" i nie ma reguły per motyw, więc trójka akcentu
    // MUSI przyjechać z renderu już rozstrzygnięta polem `accent` pasa.
    // `industrial-noir` ma pas odwrócony JAŚNIEJSZY od strony i jest tu
    // przypadkiem granicznym — ale pętla i tak idzie po całym rejestrze.
    for (const theme of SITE_THEMES) {
      const tokens = themeTokens(theme);
      const styl = stylMotywu(theme);
      const { container } = render(<SiteRenderer sections={SEKCJA_HERO} style={styl} />);
      const style = (korzen(container).getAttribute("style") ?? "").toLowerCase();
      for (const band of THEME_BAND_KEYS) {
        const wariant = tokens.bands[band].accent;
        const oczekiwany = tokens.accents[styl.accent]![wariant]!;
        expect(
          style,
          `motyw ${theme}, pas ${band}: akcent powinien być wariantem ${wariant}`,
        ).toContain(`${bandTokenName(band, "accent-text")}: ${oczekiwany.text.toLowerCase()}`);
      }
      cleanup();
    }
  });

  it("zmienne CZYNNE nie stoją w atrybucie style — ich wybór należy do arkusza", () => {
    const { container } = render(<SiteRenderer sections={SEKCJA_HERO} />);
    const style = korzen(container).getAttribute("style") ?? "";
    for (const token of Object.values(ACTIVE_TOKENS)) {
      // `--site-accent` jest prefiksem `--site-accent-text`, więc porównujemy
      // z dwukropkiem: inaczej test przechodziłby przez przypadek.
      expect(style, `zmienna czynna ${token} nie ma prawa stać w renderze`).not.toContain(`${token}:`);
    }
  });

  it("korzeń niesie klasę arkusza, identyfikator motywu i wypełnienie przycisku", () => {
    for (const theme of SITE_THEMES) {
      const { container } = render(<SiteRenderer sections={SEKCJA_HERO} style={stylMotywu(theme)} />);
      const root = korzen(container);
      expect(root.className).toContain("site-root");
      expect(root.getAttribute("data-site-theme")).toBe(theme);
      expect(root.getAttribute("data-site-button")).toBe(themeTokens(theme).shape.buttonFill);
      cleanup();
    }
  });

  it("bez propsu `style` korzeń dostaje motyw ZASTANY — strona sprzed ADR-090 się nie zmienia", () => {
    const { container } = render(<SiteRenderer sections={SEKCJA_HERO} />);
    const root = korzen(container);
    expect(root.getAttribute("data-site-theme")).toBe(DEFAULT_SITE_STYLE.theme);
    expect(themeTokens(DEFAULT_SITE_STYLE.theme).legacy).toBe(true);
  });
});

describe("zmiana motywu rusza WYŁĄCZNIE zmienne", () => {
  it("dwa skrajnie różne motywy dają IDENTYCZNE klasy i różne wartości", () => {
    const sekcje: RenderSection[] = SECTION_TYPES.map((type, index) => ({
      id: `2222222${index}-2222-4222-8222-222222222222`.slice(0, 36),
      type,
      position: index,
      content: sectionCanvasFrom(type, presetContentFor(type, "pl")) as SectionCanvas,
    }));

    const klasy = (theme: SiteThemeId) => {
      const { container } = render(<SiteRenderer sections={sekcje} style={stylMotywu(theme)} />);
      const wynik = [...container.querySelectorAll<HTMLElement>("*")].map((node) => node.className);
      cleanup();
      return wynik;
    };

    // Motywy dobrane maszynowo: pierwszy i ostatni NIEZASTANY wpis rejestru.
    const wybieralne = SITE_THEMES.filter((id) => !themeTokens(id).legacy);
    const pierwszy = wybieralne[0]!;
    const ostatni = wybieralne[wybieralne.length - 1]!;
    expect(pierwszy).not.toBe(ostatni);
    expect(klasy(pierwszy)).toEqual(klasy(ostatni));
  });

  it("zmiana akcentu w obrębie motywu też nie rusza ani jednej klasy", () => {
    const motyw = SITE_THEMES.find((id) => accentsOf(id).length > 1)!;
    const [a, b] = accentsOf(motyw);
    const klasy = (accent: string) => {
      const { container } = render(
        <SiteRenderer sections={SEKCJA_HERO} style={stylZ({ theme: motyw, accent })} />,
      );
      const wynik = [...container.querySelectorAll<HTMLElement>("*")].map((node) => node.className);
      cleanup();
      return wynik;
    };
    expect(klasy(a!)).toEqual(klasy(b!));
  });
});

describe("żaden element nie niesie koloru ani kroju w atrybucie style", () => {
  it("kolor wpisany wprost w element wypadłby spod bramki kontrastu", () => {
    const sekcje: RenderSection[] = SECTION_TYPES.map((type, index) => ({
      id: `3333333${index}-3333-4333-8333-333333333333`.slice(0, 36),
      type,
      position: index,
      content: sectionCanvasFrom(type, presetContentFor(type, "pl")) as SectionCanvas,
    }));
    const { container } = render(<SiteRenderer sections={sekcje} style={stylMotywu("noir-lux")} />);

    const winne: string[] = [];
    for (const node of container.querySelectorAll<HTMLElement>("*")) {
      if (node.classList.contains("site-root")) continue; // korzeń NIESIE zmienne — to jego rola
      const style = node.getAttribute("style") ?? "";
      if (/(^|;)\s*(color|background|background-color|font-family)\s*:/.test(style)) {
        winne.push(`${node.tagName}: ${style}`);
      }
    }
    expect(winne, `elementy z kolorem/krojem w atrybucie style:\n${winne.join("\n")}`).toEqual([]);
  });
});

describe("arkusz jest lustrem rejestru pasów", () => {
  it("każde tło sekcji z modelu treści ma klasę pasa w arkuszu", () => {
    const arkusz = bezKomentarzy(read(ARKUSZ));
    for (const background of SECTION_BACKGROUNDS) {
      if (background === "default") continue; // pas domyślny to korzeń, nie klasa
      expect(arkusz, `brak reguły .site-band-${background}`).toContain(`.site-band-${background} {`);
    }
  });

  it("KAŻDA klasa pasa ustawia KOMPLET zmiennych czynnych", () => {
    // Pas, który ustawia tło, a zapomina o akcencie, daje napis w kolorze
    // sąsiedniego pasa — czyli dokładnie ten przypadek, którego bramka
    // kontrastu nie zobaczy, bo liczy wartości z rejestru, a nie z ekranu.
    const arkusz = bezKomentarzy(read(ARKUSZ));
    const reguly = ["\\.site-root", "\\.site-band-muted", "\\.site-band-inverted", "\\.site-card"];
    for (const selektor of reguly) {
      const blok = new RegExp(`${selektor} \\{([^}]*)\\}`).exec(arkusz);
      expect(blok, `nie znaleziono reguły ${selektor}`).not.toBeNull();
      for (const token of Object.values(ACTIVE_TOKENS)) {
        expect(blok![1], `${selektor} nie ustawia ${token}`).toContain(`${token}:`);
      }
    }
  });

  it("kontrola po pustym zbiorze: rejestr pasów i lista ról nie są puste", () => {
    expect(THEME_BAND_KEYS.length).toBeGreaterThan(2);
    expect(Object.values(ACTIVE_TOKENS).length).toBe(7);
  });
});

describe("strona najemcy nie dziedziczy palety panelu", () => {
  it("warstwa renderu strony nie używa ANI JEDNEGO tokenu motywu aplikacji", () => {
    // Jedna klasa `bg-card` wraca do stanu sprzed ADR-090 po cichu: strona
    // wygląda jak panel i zmienia się razem z nim, a motyw przestaje być danymi.
    const zakazane = [
      "bg-background",
      "bg-card",
      "bg-muted",
      "bg-foreground",
      "bg-primary",
      "bg-secondary",
      "bg-border",
      "text-foreground",
      "text-background",
      "text-muted-foreground",
      "text-primary",
      "border-border",
    ];
    const winne: string[] = [];
    for (const plik of [SZABLON, PLOTNO, SEKCJE]) {
      const zrodlo = bezKomentarzy(read(plik));
      for (const klasa of zakazane) {
        if (new RegExp(`["' ]${klasa}[ "'\`]`).test(zrodlo)) winne.push(`${plik}: ${klasa}`);
      }
    }
    expect(winne, `tokeny motywu aplikacji w warstwie strony:\n${winne.join("\n")}`).toEqual([]);
  });

  it("kontrola po pustym zbiorze: skan naprawdę czyta te pliki", () => {
    for (const plik of [SZABLON, PLOTNO, SEKCJE]) {
      expect(read(plik).length, `${plik} pusty?`).toBeGreaterThan(500);
    }
  });
});

describe("kroje są nasze i są w repozytorium", () => {
  it("każda rodzina z rejestru ma @font-face i PLIKI na dysku", () => {
    const arkusz = read(ARKUSZ_KROJOW);
    for (const [id, rodzina] of Object.entries(FONT_FAMILIES)) {
      if (rodzina.slug === null) continue; // rodzina systemowa stron zastanych
      expect(arkusz, `rodzina ${id} bez @font-face`).toContain(`font-family: "${rodzina.family}"`);
      for (const subset of ["latin", "latin-ext"]) {
        const plik = `packages/ui/fonts/${rodzina.slug}-${subset}.woff2`;
        expect(arkusz, `${id}: brak subsetu ${subset} w arkuszu`).toContain(
          `${rodzina.slug}-${subset}.woff2`,
        );
        expect(existsSync(resolve(repositoryRoot, plik)), `brak pliku ${plik}`).toBe(true);
      }
      expect(
        existsSync(resolve(repositoryRoot, `packages/ui/fonts/${rodzina.license}`)),
        `rodzina ${id} bez pliku licencji — OFL wymaga jej przy redystrybucji`,
      ).toBe(true);
    }
  });

  it("arkusz krojów nie wskazuje ŻADNEGO obcego hosta (ADR-082)", () => {
    const arkusz = bezKomentarzy(read(ARKUSZ_KROJOW));
    expect(arkusz).not.toMatch(/https?:\/\//);
    expect(arkusz).not.toContain("@import");
  });

  it("arkusz zaczepia krój nagłówkowy na SKALACH, a nie na dowolnych elementach", () => {
    const arkusz = bezKomentarzy(read(ARKUSZ));
    expect(arkusz).toContain(".site-root .landing-display");
    expect(arkusz).toContain(".site-root .canvas-type-display");
    expect(arkusz).toContain(`font-family: var(${STYLE_TOKENS.fontHeading})`);
    expect(arkusz).toContain(`font-family: var(${STYLE_TOKENS.fontBody})`);
  });
});

describe("rola koloru treści dojeżdża do elementu", () => {
  it("lista ról nie jest pusta (kontrola po pustym zbiorze)", () => {
    expect(ELEMENT_COLORS.length).toBeGreaterThan(1);
  });

  it("każda rola poza domyślną celuje w klasę arkusza opartą o zmienną motywu", () => {
    const arkusz = bezKomentarzy(read(ARKUSZ));
    const klasy: Record<Exclude<ElementColor, "default">, string> = {
      muted: "site-text-muted",
      accent: "site-text-accent",
      inverted: "site-text-inverted",
      onScrim: "site-text-on-scrim",
    };
    for (const [rola, klasa] of Object.entries(klasy)) {
      const blok = new RegExp(`\\.${klasa} \\{([^}]*)\\}`).exec(arkusz);
      expect(blok, `rola ${rola}: brak reguły .${klasa}`).not.toBeNull();
      expect(blok![1], `rola ${rola}: kolor spoza zmiennych motywu`).toMatch(/color: var\(--site-/);
    }
  });

  it("klasy szablonu istnieją w arkuszu — inaczej element zostaje bez wyglądu", () => {
    const arkusz = bezKomentarzy(read(ARKUSZ));
    const styles = siteStyles();
    const wlasne = new Set(
      Object.values(styles)
        .join(" ")
        .split(/\s+/)
        .filter((klasa) => klasa.startsWith("site-")),
    );
    for (const klasa of wlasne) {
      expect(arkusz, `klasa ${klasa} użyta w szablonie, ale nieopisana w arkuszu`).toContain(`.${klasa}`);
    }
    expect(wlasne.size).toBeGreaterThan(5);
  });
});
