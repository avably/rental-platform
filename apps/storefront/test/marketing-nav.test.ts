/**
 * Bramki NAWIGACJI osi marketingowej (ADR-162).
 *
 * Trzy rzeczy, z których każda umiała już zniknąć po cichu:
 *
 *  1. POZYCJE MENU NA TELEFONIE. Arkusz szablonu chowa `.nav-link` poniżej
 *     991 px, bo w oryginale nawigację prowadziło mega-menu, którego nasze
 *     przeniesienie nie ma. Kontrakt jest DWUSTRONNY: pilnujemy i tego, że
 *     szablon nadal chowa (bo wtedy delta jest potrzebna), i tego, że delta
 *     pokazuje — w tym samym progu. Zniknięcie którejkolwiek połowy zmienia
 *     wynik na ekranie, a nie widać go w żadnym logu.
 *  2. DROGA DO PANELU. Odnośnik do logowania jest jedynym wyjściem istniejącego
 *     najemcy ze strony sprzedażowej; adres MUSI pochodzić z konfiguracji.
 *  3. KONTRAST POZYCJI. Wariant `.light` maluje napis kolorem tła każdej belki
 *     poza przezroczystą — tak przez pół roku znikał przełącznik języka.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import * as cheerio from "cheerio";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const strony = readdirSync(path.join(root, "marketing")).filter((plik) => plik.endsWith(".html"));

/**
 * Zawartość WSZYSTKICH bloków `@media` o podanym warunku, sklejona.
 *
 * Dwie pułapki, obie już raz zapaliły ten test na fałszywy kolor:
 *   · arkusze mają po kilka bloków tego samego progu (szablon eksportuje je
 *     tematycznie) — czytanie pierwszego znalezionego mówi o czymś innym;
 *   · komentarz CSS-a bywa nieodróżnialny od reguły. Ten plik OPISUJE regułę
 *     szablonu (`.nav-link { display: none }`) w komentarzu delty, więc bramka
 *     bez zdjęcia komentarzy świeciłaby na własnej dokumentacji.
 */
function blokMedia(css: string, warunek: string): string {
  const bezKomentarzy = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const czesci: string[] = [];
  let szukajOd = 0;
  for (;;) {
    const start = bezKomentarzy.indexOf(`@media ${warunek}`, szukajOd);
    if (start < 0) break;
    const otwarcie = bezKomentarzy.indexOf("{", start);
    let glebokosc = 0;
    let i = otwarcie;
    for (; i < bezKomentarzy.length; i += 1) {
      if (bezKomentarzy[i] === "{") glebokosc += 1;
      else if (bezKomentarzy[i] === "}") {
        glebokosc -= 1;
        if (glebokosc === 0) break;
      }
    }
    czesci.push(bezKomentarzy.slice(otwarcie + 1, i));
    szukajOd = i + 1;
  }
  return czesci.join("\n");
}

/**
 * Pozycje `.nav-link` z klasą `light` w belce, która NIE jest przezroczysta.
 * Wydzielone z testu, żeby dało się na tym zrobić kontrolę pozytywną.
 */
function jasnePozycjeNaJasnymTle(html: string): string[] {
  const $ = cheerio.load(html, null, false);
  const winne: string[] = [];
  $(".navbar").each((_, belka) => {
    const $belka = $(belka);
    if ($belka.hasClass("blured")) return;
    $belka.find("a.nav-link.light").each((__, link) => {
      winne.push(`${$belka.attr("class")} → ${$(link).attr("href")}`);
    });
  });
  return winne;
}

describe("menu mobilne: pozycje nawigacji", () => {
  const szablon = read("public/forerunner/css/forerunner-template.webflow.css");
  const delta = read("public/forerunner/css/avably-marketing.css");
  const PROG = "screen and (max-width: 991px)";

  it("szablon nadal chowa pozycje w progu telefonu (bez tego delta jest zbędna)", () => {
    const blok = blokMedia(szablon, PROG);
    expect(blok, "nie znaleziono bloku 991 px w arkuszu szablonu").not.toBe("");
    expect(
      blok.replace(/\s+/g, " "),
      "szablon przestał chować .nav-link — delta w avably-marketing.css jest do zdjęcia",
    ).toMatch(/\.nav-link\s*\{[^}]*display:\s*none/);
  });

  it("delta pokazuje pozycje w TYM SAMYM progu, swoistością zamiast !important", () => {
    const blok = blokMedia(delta, PROG);
    expect(blok, "delta zgubiła blok 991 px").not.toBe("");
    const regula = blok.replace(/\s+/g, " ").match(/\.nav-menu-inner \.nav-link \{[^}]*\}/);
    expect(regula, "delta nie pokazuje .nav-link w menu — telefon zostaje bez nawigacji").toBeTruthy();
    expect(regula?.[0]).toMatch(/display:\s*flex/);
    // `!important` byłby przyznaniem, że nie wiemy, co wygrywa — a wiemy:
    // selektor dwuklasowy bije jednoklasową regułę szablonu.
    expect(regula?.[0]).not.toContain("!important");
  });

  it("napis pozycji nie zostaje biały na białym tle rozwiniętego menu", () => {
    const blok = blokMedia(delta, PROG).replace(/\s+/g, " ");
    expect(blok).toMatch(/\.nav-menu-inner \.nav-link\.light[^{]*\{[^}]*color:/);
  });

  /**
   * Nazwa przycisku menu jest NIEWIDOCZNA na ekranie — istnieje tylko dla
   * czytnika. `MarketingPageView` pali render przy jej braku (tak samo jak
   * przy brakującym tokenie szablonu), ale bez tej bramki nikt by tego nie
   * zauważył przed wejściem na stronę.
   */
  it("przycisk menu ma nazwę w treści obu locale", () => {
    for (const [locale, messages] of [
      ["pl", pl],
      ["en", en],
    ] as const) {
      expect(typeof messages.marketing.nav.menuLabel, locale).toBe("string");
      expect(messages.marketing.nav.menuLabel.trim().length, locale).toBeGreaterThan(0);
    }
    expect(pl.marketing.nav.menuLabel).not.toBe(en.marketing.nav.menuLabel);
  });
});

describe("odnośnik do logowania", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@avably/core");
  });

  it("stoi w KAŻDYM menu każdej strony, obok przełącznika języka", () => {
    for (const plik of strony) {
      const $ = cheerio.load(read(path.join("marketing", plik)), null, false);
      const menu = $(".nav-menu-inner");
      expect(menu.length, `${plik}: brak menu nawigacji`).toBeGreaterThan(0);
      menu.each((indeks, el) => {
        const $menu = $(el);
        expect(
          $menu.find('a[href="{{link.login}}"]').length,
          `${plik}: menu #${indeks} bez odnośnika do logowania`,
        ).toBe(1);
        expect(
          $menu.find("a[hreflang]").length,
          `${plik}: menu #${indeks} bez przełącznika języka`,
        ).toBe(1);
      });
    }
  });

  it("niesie etykietę z treści, a nie wpisany napis", () => {
    for (const plik of strony) {
      const $ = cheerio.load(read(path.join("marketing", plik)), null, false);
      $('.nav-menu-inner a[href="{{link.login}}"]').each((_, el) => {
        // Maska napisu szablonu niesie DWIE warstwy tego samego tekstu (efekt
        // najechania) — obie muszą być tokenem, bo podmiana jednej z nich
        // zostawiłaby na stronie polski napis w wersji angielskiej.
        expect($(el).text().replace(/\s+/g, " ").trim(), `${plik}: napis logowania spoza treści`).toBe(
          "{{nav.login}} {{nav.login}}",
        );
      });
      // Stopka niosła ten odnośnik od początku — nagłówek nie. Obie drogi mają
      // zostać: gość na dole strony nie ma po co wracać na górę.
      expect(
        $('.footer-links-column a[href="{{link.login}}"]').length,
        `${plik}: stopka zgubiła odnośnik do logowania`,
      ).toBe(1);
    }
  });

  /**
   * KONTRAKT DWUKIERUNKOWY, NIE SKAN. Sam warunek „href równa się
   * `${PANEL_URL}/pl/login`" niczego nie broni: przy zmianie konfiguracji obie
   * strony równania jadą razem i literał przeszedłby bez mrugnięcia. Dlatego
   * test SAM podmienia konfigurację na wartość, której nie ma prawa być
   * w żadnym literale, i sprawdza, czy adres za nią poszedł.
   */
  it("adres panelu bierze z konfiguracji — podmieniona wartość zmienia wynik", async () => {
    const INNY_PANEL = "https://panel.probna.invalid";
    vi.resetModules();
    vi.doMock("@avably/core", async () => ({
      ...(await vi.importActual<typeof import("@avably/core")>("@avably/core")),
      PANEL_URL: INNY_PANEL,
    }));

    const { marketingLinks } = await import("@/lib/marketing/template");
    expect(marketingLinks("pl").link.login).toBe(`${INNY_PANEL}/pl/login`);
    expect(marketingLinks("en").link.login).toBe(`${INNY_PANEL}/en/login`);
    // Rejestracja jedzie tą samą drogą — gdyby ktoś rozwiązał logowanie
    // literałem, ta noga zostałaby zielona i nic by nie powiedziała.
    expect(marketingLinks("pl").link.register).toBe(`${INNY_PANEL}/pl/register`);
  });

  it("zgodnie z konfiguracją produkcyjną trafia w panel, nie w stronę sprzedażową", async () => {
    vi.resetModules();
    const { PANEL_URL, CANONICAL_SITE_URL } = await import("@avably/core");
    const { marketingLinks } = await import("@/lib/marketing/template");
    const login = marketingLinks("pl").link.login;

    expect(login).toBe(`${PANEL_URL}/pl/login`);
    expect(login.startsWith(CANONICAL_SITE_URL), "logowanie prowadzi na stronę sprzedażową").toBe(
      false,
    );
  });
});

describe("kontrast pozycji nawigacji", () => {
  it("wariant jasny występuje wyłącznie na belce przezroczystej", () => {
    const winne = strony.flatMap((plik) =>
      jasnePozycjeNaJasnymTle(read(path.join("marketing", plik))).map((opis) => `${plik}: ${opis}`),
    );
    expect(winne, winne.join(" | ")).toEqual([]);
  });

  /**
   * KONTROLA POZYTYWNA. Bez niej powyższa bramka świeciłaby na zielono także
   * wtedy, gdyby detektor pytał o klasę, której w plikach w ogóle nie ma.
   */
  it("detektor naprawdę widzi jasną pozycję na jasnej belce", () => {
    const jasnaBelka =
      '<div class="navbar static w-nav"><a href="/x" class="nav-link light w-inline-block">x</a></div>';
    const przezroczysta =
      '<div class="navbar static blured w-nav"><a href="/x" class="nav-link light w-inline-block">x</a></div>';

    expect(jasnePozycjeNaJasnymTle(jasnaBelka)).toHaveLength(1);
    expect(jasnePozycjeNaJasnymTle(przezroczysta)).toEqual([]);
  });
});

describe("widoczny fokus i rozmiar celu", () => {
  const layout = read("app/[locale]/layout.tsx");

  it("osoba korzystająca z klawiatury widzi przejście do treści i obrys odnośników", () => {
    expect(layout).toContain(".marketing-skip-link:focus-visible");
    expect(layout).toMatch(/:where\([^)]*\.nav-link[^)]*\.footer-link[^)]*\):focus-visible/);
    expect(layout).toMatch(/outline:\s*3px solid currentColor/);
  });

  it("główne wezwania i odnośniki stopki mają cel co najmniej 44 px", () => {
    expect(layout).toMatch(
      /:where\(\.cta-main,\s*\.footer-link\)[^{]*\{[^}]*min-height:\s*44px/,
    );
  });
});
