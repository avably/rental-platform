// @vitest-environment jsdom

/**
 * EDYCJA W MIEJSCU: BRAMA DOM → RUNY (K3, ADR-086).
 *
 * `contenteditable` przyjmuje wszystko, co operator wklei. Ten plik dowodzi,
 * że z drzewa wychodzi WYŁĄCZNIE to, co rozumiemy — tekst plus pogrubienie,
 * pochylenie i link. Wszystko inne jest przezroczyste: wchodzimy w dzieci i
 * bierzemy z nich sam tekst.
 *
 * To jest allowlista, nie czyszczenie. Różnica jest praktyczna: czyszczenie
 * trzeba aktualizować o każdy nowy wektor, a allowlista nie potrafi wypisać
 * niczego, czego nie zna — i nowy wektor nie jest dla niej nowy.
 */
import { describe, expect, it } from "vitest";

import { runsEqual, runsFromDom } from "@/app/[locale]/(kreator)/strona/kreator/inline-text";

function dom(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

describe("formatowanie, które rozumiemy", () => {
  it("goły tekst daje jeden run", () => {
    expect(runsFromDom(dom("Sprzęt na już"))).toEqual([{ text: "Sprzęt na już" }]);
  });

  it.each(["b", "strong"])("znacznik %s daje pogrubienie", (tag) => {
    expect(runsFromDom(dom(`<${tag}>mocno</${tag}>`))).toEqual([{ text: "mocno", bold: true }]);
  });

  it.each(["i", "em"])("znacznik %s daje pochylenie", (tag) => {
    expect(runsFromDom(dom(`<${tag}>skos</${tag}>`))).toEqual([{ text: "skos", italic: true }]);
  });

  it("link niesie swój adres", () => {
    expect(runsFromDom(dom('<a href="/cennik">cennik</a>'))).toEqual([
      { text: "cennik", href: "/cennik" },
    ]);
  });

  it("zagnieżdżone cechy składają się", () => {
    expect(runsFromDom(dom('<a href="/x"><strong><em>tak</em></strong></a>'))).toEqual([
      { text: "tak", bold: true, italic: true, href: "/x" },
    ]);
  });

  it("mieszany akapit rozpada się na runy w kolejności czytania", () => {
    expect(runsFromDom(dom("Sprzęt <strong>na już</strong> i <em>tanio</em>"))).toEqual([
      { text: "Sprzęt " },
      { text: "na już", bold: true },
      { text: " i " },
      { text: "tanio", italic: true },
    ]);
  });

  it("łamanie wiersza zostaje znakiem nowej linii", () => {
    expect(runsFromDom(dom("góra<br>dół"))).toEqual([{ text: "góra\ndół" }]);
  });

  it("sąsiedzi o tym samym formatowaniu są SKLEJANI", () => {
    // Edytor produkuje run per węzeł DOM — bez sklejania jedno zdanie
    // rozpadłoby się na kilkanaście kawałków i dobiło do sufitu runów.
    expect(runsFromDom(dom("<span>Sprzęt </span><span>na już</span>"))).toEqual([
      { text: "Sprzęt na już" },
    ]);
  });
});

describe("czego brama NIE wypuszcza", () => {
  it("wklejony skrypt wnosi co najwyżej swój TEKST, nigdy znacznika", () => {
    const runs = runsFromDom(dom("<script>alert(1)</script>"));
    expect(runs).toEqual([{ text: "alert(1)" }]);
    // Sedno: żaden run nie niesie znacznika ani atrybutu zdarzenia.
    expect(JSON.stringify(runs)).not.toContain("script");
  });

  it("wklejony obrazek z obsługą błędu nie wnosi NICZEGO", () => {
    expect(runsFromDom(dom('<img src="x" onerror="alert(1)">'))).toEqual([]);
  });

  it("style i klasy wklejone z obcej strony znikają, tekst zostaje", () => {
    const runs = runsFromDom(
      dom('<span style="color:red" class="obce" onclick="alert(1)">czerwone</span>'),
    );
    expect(runs).toEqual([{ text: "czerwone" }]);
  });

  it("nagłówki i listy wklejone z zewnątrz spłaszczają się do tekstu", () => {
    expect(runsFromDom(dom("<h1>Tytuł</h1><ul><li>raz</li></ul>"))).toEqual([{ text: "Tytułraz" }]);
  });

  it("podkreślenie i przekreślenie NIE są formatowaniem — zostaje sam tekst", () => {
    // Zbiór cech jest zamknięty (bold/italic/link). Nowa cecha to zmiana
    // schematu i renderu, a nie cicha akceptacja kolejnego znacznika.
    expect(runsFromDom(dom("<u>pod</u><s>prze</s>"))).toEqual([{ text: "podprze" }]);
  });

  it("wrogi adres wychodzi z DOM-u i odpada DOPIERO na schemacie", () => {
    // Świadome: jedna reguła adresów na cały system (Zod), nie druga kopia
    // w przeglądarce. Ten test pilnuje, że brama go nie „przepuszcza cicho" —
    // niesie go jawnie, a schemat go odrzuca (rich-text.test.ts w core).
    const runs = runsFromDom(dom('<a href="javascript:alert(1)">klik</a>'));
    expect(runs).toEqual([{ text: "klik", href: "javascript:alert(1)" }]);
  });
});

describe("porównanie runów", () => {
  it("identyczne runy są równe", () => {
    expect(runsEqual([{ text: "a", bold: true }], [{ text: "a", bold: true }])).toBe(true);
  });

  it("brak cechy i cecha fałszywa to TO SAMO", () => {
    expect(runsEqual([{ text: "a" }], [{ text: "a", bold: false }])).toBe(true);
  });

  it("różny tekst, cecha albo adres to różnica", () => {
    expect(runsEqual([{ text: "a" }], [{ text: "b" }])).toBe(false);
    expect(runsEqual([{ text: "a" }], [{ text: "a", italic: true }])).toBe(false);
    expect(runsEqual([{ text: "a", href: "/x" }], [{ text: "a", href: "/y" }])).toBe(false);
  });

  it("pusta i niezdefiniowana lista to TO SAMO", () => {
    expect(runsEqual(undefined, [])).toBe(true);
  });
});
