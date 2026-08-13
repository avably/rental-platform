/**
 * WYSPA REACTA W PRZENIESIONYM SZABLONIE — bramka kształtu (ADR-162).
 *
 * `MarketingPageView` TNIE wyrenderowany HTML na znaczniku `<!--avably-island-->`
 * i podaje obie połówki osobnym `dangerouslySetInnerHTML`. To znaczy, że
 * znacznik nie jest zwykłym miejscem w dokumencie: musi stać między
 * rodzeństwem NAJWYŻSZEGO poziomu, bo tylko wtedy obie połówki są zamkniętym
 * drzewem.
 *
 * Kiedy siedział w środku siatki `.legal-halves`, pierwsza połówka kończyła się
 * niedomkniętymi elementami, parser zamykał je sam, a treść dokumentu lądowała
 * jako rodzeństwo `.marketing-static` — poza `.main-container`, czyli przy
 * krawędzi ekranu. Zmierzone przy 375 px: akapity polityki zaczynały się od
 * x = 0 px, choć plakietka i tytuł strony miały x = 16 px. Awaria była
 * NIEWIDOCZNA dla wszystkich dotychczasowych bramek: tokeny miały pokrycie,
 * treść była w DOM, testy renderu komponentu przechodziły.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import * as cheerio from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PrivacyContent } from "@/components/marketing/privacy-content";
import { TermsContent } from "@/components/marketing/terms-content";
import en from "@/messages/en.json";
import pl from "@/messages/pl.json";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const strony = readdirSync(path.join(root, "marketing")).filter((plik) => plik.endsWith(".html"));

const ZNACZNIK = "avably-island";

interface Wezel {
  type: string;
  data?: string;
  children?: Wezel[];
}

/**
 * Głębokość znacznika wyspy: 0 = rodzeństwo najwyższego poziomu.
 * `null` = strona bez wyspy. Wydzielone, żeby dało się na tym zrobić kontrolę
 * pozytywną — detektor, którego nikt nie zapalił, nie jest dowodem.
 */
export function glebokoscWyspy(html: string): number | null {
  const $ = cheerio.load(html, null, false);
  let znaleziona: number | null = null;
  const chodz = (wezly: Wezel[], glebokosc: number) => {
    for (const wezel of wezly) {
      if (wezel.type === "comment" && wezel.data?.trim() === ZNACZNIK) znaleziona = glebokosc;
      if (wezel.children) chodz(wezel.children, glebokosc + 1);
    }
  };
  chodz($.root().contents().toArray() as unknown as Wezel[], 0);
  return znaleziona;
}

describe("znacznik wyspy w przeniesionych stronach", () => {
  it("stoi między sekcjami, nigdy w środku drzewa", () => {
    const zle: string[] = [];
    for (const plik of strony) {
      const glebokosc = glebokoscWyspy(read(path.join("marketing", plik)));
      if (glebokosc !== null && glebokosc !== 0) zle.push(`${plik}: głębokość ${glebokosc}`);
    }
    expect(zle, zle.join(" | ")).toEqual([]);
  });

  it("dokumenty prawne mają wyspę — bez niej strona jest samym nagłówkiem", () => {
    for (const plik of ["privacy.html", "terms.html"]) {
      expect(glebokoscWyspy(read(path.join("marketing", plik))), plik).toBe(0);
    }
  });

  /** KONTROLA POZYTYWNA: detektor musi zapalić się na kształcie sprzed naprawy. */
  it("detektor widzi znacznik schowany w środku drzewa", () => {
    const przed = '<section><div class="body-legal"><!--avably-island--></div></section>';
    const po = '<section><div class="body-legal"></div></section>\n<!--avably-island-->';

    expect(glebokoscWyspy(przed)).toBe(2);
    expect(glebokoscWyspy(po)).toBe(0);
    expect(glebokoscWyspy("<section></section>")).toBeNull();
  });

  /**
   * Szablon nie może zostawić DRUGIEGO, pustego `.body-legal` — kontener treści
   * wnosi dziś wyspa i dublet znaczyłby dwa pudełka o tej samej roli, z których
   * jedno jest puste (i to ono zbierałoby style dopisane „do dokumentu").
   */
  it("nie zostaje pusty kontener treści po stronie szablonu", () => {
    for (const plik of ["privacy.html", "terms.html"]) {
      const $ = cheerio.load(read(path.join("marketing", plik)), null, false);
      expect($(".body-legal").length, `${plik}: szablon wciąż niesie własny .body-legal`).toBe(0);
    }
  });
});

describe("wyspa dokumentu prawnego wnosi własny kontener", () => {
  const DOKUMENT = {
    version_id: "11111111-1111-4111-8111-111111111111",
    version_no: 1,
    version_label: "v1",
    title_pl: "Regulamin",
    body_pl: "Akapit.",
    title_en: "Terms",
    body_en: "Paragraph.",
    sha256_pl: "0123456789abcdef".repeat(4),
    sha256_en: "fedcba9876543210".repeat(4),
    published_at: "2026-08-11T10:00:00.000Z",
    effective_from: "2026-09-01T00:00:00.000Z",
    current: true,
  } as const;

  const przypadki = [
    { nazwa: "polityka prywatności (pl)", html: () => renderToStaticMarkup(<PrivacyContent copy={pl.privacy} />) },
    { nazwa: "polityka prywatności (en)", html: () => renderToStaticMarkup(<PrivacyContent copy={en.privacy} />) },
    {
      nazwa: "regulamin platformy",
      html: () => renderToStaticMarkup(<TermsContent copy={pl.terms} document={DOKUMENT} locale="pl" />),
    },
  ];

  for (const { nazwa, html } of przypadki) {
    it(`${nazwa}: sekcja → kontener strony → treść`, () => {
      const $ = cheerio.load(html(), null, false);
      const tresc = $(".body-legal");

      expect(tresc.length, "wyspa bez pudełka treści").toBe(1);
      // Kontener MUSI być tym samym, którego używa nagłówek strony — inaczej
      // dokument i jego tytuł stoją na dwóch różnych krawędziach.
      const kontener = tresc.parent();
      expect(kontener.hasClass("main-container"), "treść poza kontenerem strony").toBe(true);
      expect(kontener.parent().is("section.legal-body-section"), "brak własnej sekcji").toBe(true);
      // Zawężenie długości wiersza siedzi w arkuszu, na `.body-legal` — tu
      // pilnujemy, że pudełko, którego on dotyczy, naprawdę powstaje.
      expect(tresc.children().length).toBeGreaterThan(0);
    });
  }

  it("arkusz ogranicza długość wiersza dokumentu", () => {
    const css = read("public/forerunner/css/avably-marketing.css").replace(/\s+/g, " ");
    expect(css).toMatch(/\.body-legal \{[^}]*max-width:\s*720px/);
  });
});
