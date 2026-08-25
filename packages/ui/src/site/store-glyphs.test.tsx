/**
 * ZNAKI CHROME SKLEPU — JEDEN ZESTAW, JEDNA GRAMATYKA (F7b) I CZYTELNA
 * KONWENCJA KATEGORII (F12).
 *
 * ==================== CZEGO PILNUJE TEN PLIK ====================
 *
 *   1. F12: znak kategorii to TRZY KRESKI, a nie siatka kafli. Właściciel
 *      obejrzał belkę na telefonie i orzekł „ikonka kategorii nic nie mówi";
 *      kafle wróciłyby po cichu przy każdym „poprawmy ikonki", bo argument
 *      za nimi (siatka = zbiór rzeczy) jest w kodzie i brzmi rozsądnie.
 *      Test koduje ROZSTRZYGNIĘCIE: w belce działa wyłącznie konwencja, którą
 *      odwiedzający już zna.
 *   2. WSPÓLNA GRAMATYKA: każdy znak zestawu jedzie na siatce 24, kreską 2,
 *      bez wypełnień i bez ani jednej klasy koloru — rozmiar podaje wołający.
 *      To jest cały powód, dla którego znaki mieszkają w jednym module.
 *   3. ZNAK NIE JEST NAZWĄ: `aria-hidden` + `focusable="false"` na każdym.
 *      Bez tego belka ikonowa byłaby dla czytnika ekranu rzędem bezimiennych
 *      przystanków (nazwy niosą `aria-label`/`sr-only` na kontrolkach).
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StoreGlyph, type StoreGlyphName } from "./store-glyphs";

// jsdom: bez sprzątania kolejny `querySelector` patrzy w drzewo poprzedniego
// testu (lekcja: jsdom-id-selector-needs-cleanup).
afterEach(cleanup);

const ZESTAW: StoreGlyphName[] = ["search", "categories", "cart", "calendar"];

function svg(name: StoreGlyphName): SVGSVGElement {
  const { container } = render(<StoreGlyph name={name} className="h-5 w-5" />);
  const el = container.querySelector("svg");
  expect(el, `znak „${name}" się nie wyrenderował`).not.toBeNull();
  return el as SVGSVGElement;
}

describe("F12 — kategorie jako TRZY KRESKI, nie siatka kafli", () => {
  /*
    CO MUSIAŁOBY SIĘ ZEPSUĆ: powrót czterech `rect` (forma F7b). Na telefonie
    właściciela znaczyła ona dla odwiedzającego dokładnie nic — a rozumowanie,
    które ją wybrało („półki oferty, nie nawigacja dokumentu"), jest wciąż
    w repozytorium i samo z siebie nie zniknie.
  */
  it("znak kategorii rysują TRZY poziome kreski na wspólnej siatce", () => {
    const el = svg("categories");
    expect(
      el.querySelectorAll("rect"),
      "siatka kafli wróciła do belki — właściciel zdjął ją jako nieczytelną",
    ).toHaveLength(0);
    const d = el.querySelector("path")!.getAttribute("d")!;
    // Trzy przebiegi poziome: ten sam start i ta sama długość, trzy wysokości.
    const kreski = [...d.matchAll(/M(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)h(\d+(?:\.\d+)?)/gu)];
    expect(kreski, `znak kategorii ma ${kreski.length} kresek zamiast trzech`).toHaveLength(3);
    const [x] = kreski.map((k) => k[1]);
    const dlugosci = kreski.map((k) => k[3]);
    expect(new Set(kreski.map((k) => k[1])).size, "kreski nie zaczynają się w jednej linii").toBe(1);
    expect(new Set(dlugosci).size, "kreski mają różne długości — znak przestaje być hamburgerem").toBe(
      1,
    );
    // Wcięcie symetryczne w kwadracie 24: start x i koniec (x + długość).
    const start = Number(x);
    expect(start + Number(dlugosci[0]), "znak nie jest wyśrodkowany w siatce 24").toBe(24 - start);
    // Trzy RÓŻNE wysokości, w równych odstępach — inaczej to nie są trzy kreski.
    const y = kreski.map((k) => Number(k[2])).sort((a, b) => a - b);
    expect(new Set(y).size).toBe(3);
    expect(y[1]! - y[0]!, "odstępy między kreskami nierówne").toBe(y[2]! - y[1]!);
  });
});

describe("F7b — wspólna gramatyka zestawu", () => {
  it.each(ZESTAW)("znak „%s”: siatka 24, kreska 2, bez wypełnienia", (name) => {
    const el = svg(name);
    expect(el.getAttribute("viewBox"), "znak zszedł ze wspólnej siatki 24").toBe("0 0 24 24");
    expect(el.getAttribute("stroke-width"), "rozjazd grubości kreski w belce").toBe("2");
    expect(el.getAttribute("fill")).toBe("none");
    expect(el.getAttribute("stroke")).toBe("currentColor");
    for (const koniec of ["stroke-linecap", "stroke-linejoin"]) {
      expect(el.getAttribute(koniec), `znak „${name}" ma inne zakończenia niż zestaw`).toBe("round");
    }
  });

  it.each(ZESTAW)("znak „%s” nie jest nazwą kontrolki (aria-hidden, focusable=false)", (name) => {
    const el = svg(name);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.getAttribute("focusable")).toBe("false");
  });

  /*
    ZERO KLAS ROLI: kolor chrome sklepu wynika z pasa, na którym stoi belka,
    więc nie ma prawa być decyzją znaku. Klasa, którą znak nosi, jest DOKŁADNIE
    tą, którą podał wołający — nic ponad.
  */
  it.each(ZESTAW)("znak „%s” nosi wyłącznie klasę wołającego (rozmiar), zero koloru", (name) => {
    expect(svg(name).getAttribute("class")).toBe("h-5 w-5");
  });
});
