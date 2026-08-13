// @vitest-environment jsdom

/**
 * WIĄZANIE PRZY RENDERZE — WARTOŚĆ Z KATALOGU, WĘZEŁ WYCIĘTY NA SERWERZE
 * (faza 3, ADR-163).
 *
 * ==================== CO TU JEST NAPRAWDĘ SPRAWDZANE ====================
 *
 * Trzy zdania, na których stoi cała faza:
 *
 *   1. Element ZWIĄZANY pokazuje wartość TEJ pozycji katalogu, a nie napis
 *      zapisany w treści strony — i pokazuje INNĄ wartość, gdy katalog poda
 *      inną. Fikstury są różnicujące: napis projektowy jest w treści przez cały
 *      czas i ani razu nie ma prawa się pojawić.
 *   2. Wskazanie POZYCJI SPOZA KATALOGU podanego do renderu nie oddaje NICZEGO.
 *      Dowód nie wisi na RLS: obie fikstury przechodzą tę samą drogę renderu,
 *      a różni je wyłącznie to, czy pozycja stoi w podanej liście.
 *   3. Węzeł bez wartości ZNIKA Z DOKUMENTU, a nie jest ukryty stylem — sklep
 *      renderuje się na serwerze, więc „ukryty" znaczyłby treść wysłaną do
 *      klienta i zaindeksowaną.
 *
 * Renderowanie idzie przez `SiteRenderer`, czyli tę samą drogę, którą wchodzi
 * strona publiczna — a nie przez wewnętrzną funkcję, którą sklep mógłby omijać.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SiteRenderer } from "./site-renderer";
import type { RenderSection, StorefrontProduct } from "./types";

afterEach(cleanup);

const NASZ = "11111111-1111-4111-8111-111111111111";
const CUDZY = "22222222-2222-4222-8222-222222222222";

/** Napis, który STOI W TREŚCI strony i ani razu nie ma prawa się pokazać. */
const NAPIS_PROJEKTOWY = "Napis wpisany w kreatorze";

function sprzet(over: Partial<StorefrontProduct> = {}): StorefrontProduct {
  return {
    id: NASZ,
    name: "Terminal satelitarny",
    description: "Internet tam, gdzie nie ma zasięgu.",
    priceLabel: "od 120,00 zł / doba",
    imageUrl: "https://przyklad/zdjecie-terminala.jpg",
    imageAlt: "Terminal na statywie",
    ...over,
  };
}

/** Katalog CUDZEGO najemcy — ta sama struktura, inna pozycja. */
function cudzyKatalog(): StorefrontProduct[] {
  return [sprzet({ id: CUDZY, name: "Sprzęt innego najemcy", priceLabel: "od 999,00 zł / doba" })];
}

function sekcja(elements: unknown[]): RenderSection[] {
  return [
    {
      id: "sekcja-1",
      position: 0,
      type: "hero",
      content: {
        version: 2,
        rows: 24,
        background: "default",
        elements,
      },
    } as unknown as RenderSection,
  ];
}

function napisZwiazany(field: string, extra: Record<string, unknown> = {}, productId = NASZ) {
  return {
    id: "napis",
    kind: "heading",
    text: NAPIS_PROJEKTOWY,
    level: 2,
    align: "left",
    layout: { desktop: { x: 0, y: 0, w: 48, h: 6, z: 0 } },
    bindings: {
      text: { record: { kind: "product", productId }, field, whenEmpty: "hide", ...extra },
    },
  };
}

// -----------------------------------------------------------------------
// 1. Wartość przychodzi z katalogu, nie z treści
// -----------------------------------------------------------------------

describe("element związany bierze wartość z katalogu", () => {
  it("pokazuje cenę z katalogu, a napisu z treści nie pokazuje ani razu", () => {
    render(<SiteRenderer sections={sekcja([napisZwiazany("price")])} products={[sprzet()]} />);
    expect(screen.getByText("od 120,00 zł / doba")).toBeTruthy();
    expect(screen.queryByText(NAPIS_PROJEKTOWY)).toBeNull();
  });

  /**
   * TEZA CAŁEJ FAZY W JEDNYM TEŚCIE: ta sama, NIEZMIENIONA treść strony
   * (`sections` liczone raz) pokazuje inną wartość, gdy katalog poda inną.
   * Zmiana ceny w katalogu zmienia stronę BEZ dotykania treści strony.
   */
  it("ta sama treść pokazuje nową cenę, gdy zmieni się katalog", () => {
    const sections = sekcja([napisZwiazany("price")]);

    const { unmount } = render(<SiteRenderer sections={sections} products={[sprzet()]} />);
    expect(screen.getByText("od 120,00 zł / doba")).toBeTruthy();
    unmount();

    render(
      <SiteRenderer sections={sections} products={[sprzet({ priceLabel: "od 159,00 zł / doba" })]} />,
    );
    expect(screen.getByText("od 159,00 zł / doba")).toBeTruthy();
    expect(screen.queryByText("od 120,00 zł / doba")).toBeNull();
  });

  it("nazwa i opis idą tą samą drogą", () => {
    render(<SiteRenderer sections={sekcja([napisZwiazany("name")])} products={[sprzet()]} />);
    expect(screen.getByText("Terminal satelitarny")).toBeTruthy();
    cleanup();

    render(<SiteRenderer sections={sekcja([napisZwiazany("description")])} products={[sprzet()]} />);
    expect(screen.getByText("Internet tam, gdzie nie ma zasięgu.")).toBeTruthy();
  });

  it("zdjęcie związane bierze adres I opis alternatywny z katalogu", () => {
    const element = {
      id: "foto",
      kind: "image",
      alt: "Opis wpisany w kreatorze",
      fit: "cover",
      layout: { desktop: { x: 0, y: 0, w: 48, h: 12, z: 0 } },
      bindings: { source: { record: { kind: "product", productId: NASZ }, field: "image", whenEmpty: "hide" } },
    };
    render(<SiteRenderer sections={sekcja([element])} products={[sprzet()]} />);
    const img = screen.getByAltText("Terminal na statywie") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://przyklad/zdjecie-terminala.jpg");
    expect(screen.queryByAltText("Opis wpisany w kreatorze")).toBeNull();
  });

  it("etykieta przycisku bierze wartość, a ADRES zostaje przy operatorze", () => {
    const element = {
      id: "cta",
      kind: "button",
      label: "Etykieta z kreatora",
      href: "/store",
      variant: "solid",
      align: "left",
      layout: { desktop: { x: 0, y: 0, w: 24, h: 4, z: 0 } },
      bindings: { label: { record: { kind: "product", productId: NASZ }, field: "name", whenEmpty: "hide" } },
    };
    render(<SiteRenderer sections={sekcja([element])} products={[sprzet()]} />);
    const link = screen.getByRole("link", { name: "Terminal satelitarny" });
    expect(link.getAttribute("href")).toBe("/store");
  });
});

// -----------------------------------------------------------------------
// 2. Sonda izolacji — wskazanie spoza katalogu najemcy
// -----------------------------------------------------------------------

describe("sonda izolacji: wskazanie nie jest drogą do cudzych danych", () => {
  /**
   * KONTROLA POZYTYWNA I NEGATYWNA W JEDNYM PRZEBIEGU. Ten sam identyfikator,
   * ta sama treść — różni je WYŁĄCZNIE to, w czyim katalogu render szuka.
   * Gdyby zawężenie do podanej listy zniknęło, pierwszy przypadek dalej byłby
   * zielony, a drugi zapaliłby się z imienia.
   */
  it("identyfikator spoza podanego katalogu nie oddaje ANI JEDNEJ wartości", () => {
    render(
      <SiteRenderer sections={sekcja([napisZwiazany("price", {}, CUDZY)])} products={[sprzet()]} />,
    );
    expect(screen.queryByText("od 999,00 zł / doba")).toBeNull();
    expect(screen.queryByText("Sprzęt innego najemcy")).toBeNull();
    expect(screen.queryByText(NAPIS_PROJEKTOWY)).toBeNull();
    expect(document.querySelector('[data-element-id="napis"]')).toBeNull();
  });

  it("kontrola pozytywna: TEN SAM identyfikator w SWOIM katalogu oddaje wartość", () => {
    render(
      <SiteRenderer
        sections={sekcja([napisZwiazany("price", {}, CUDZY)])}
        products={cudzyKatalog()}
      />,
    );
    expect(screen.getByText("od 999,00 zł / doba")).toBeTruthy();
  });

  it("pusty katalog nie ma jak niczego oddać", () => {
    render(<SiteRenderer sections={sekcja([napisZwiazany("name")])} products={[]} />);
    expect(screen.queryByText("Terminal satelitarny")).toBeNull();
    expect(screen.queryByText(NAPIS_PROJEKTOWY)).toBeNull();
  });
});

// -----------------------------------------------------------------------
// 3. Wycięcie węzła po stronie serwera
// -----------------------------------------------------------------------

describe("warunek WYCINA węzeł, a nie ukrywa go stylem", () => {
  /**
   * DOWÓD IDZIE PO KODZIE STRONY WYPRODUKOWANYM NA SERWERZE
   * (`renderToStaticMarkup`), bo o to dokładnie chodzi: element bez wartości nie
   * ma dojechać do przeglądarki. Sprawdzenie po DOM-ie po hydracji pokazałoby to
   * samo także wtedy, gdyby węzeł jechał i był chowany klasą.
   */
  function markup(elements: unknown[], products: StorefrontProduct[]): string {
    return renderToStaticMarkup(<SiteRenderer sections={sekcja(elements)} products={products} />);
  }

  it("wycięty element nie zostawia po sobie ANI ŚLADU w kodzie strony", () => {
    const html = markup([napisZwiazany("description")], [sprzet({ description: null })]);
    expect(html).not.toContain('data-element-id="napis"');
    expect(html).not.toContain(NAPIS_PROJEKTOWY);
    /*
      Siatka płótna jest PUSTA — nie „ma dziecko z klasą ukrywającą". Gdyby
      warunek chował element stylem, ten sam kod strony niósłby dalej pudełko
      elementu razem z jego zmiennymi geometrii.
    */
    expect(html).toMatch(/<div data-canvas-grid[^>]*><\/div>/);
    // Kontrola pozytywna tego samego przebiegu: z wartością węzeł JEST.
    expect(markup([napisZwiazany("description")], [sprzet()])).toContain('data-element-id="napis"');
  });

  it("wartość zastępcza rysuje węzeł zamiast go wycinać", () => {
    const html = markup(
      [napisZwiazany("description", { whenEmpty: "fallback", fallback: "Opis w przygotowaniu" })],
      [sprzet({ description: null })],
    );
    expect(html).toContain("Opis w przygotowaniu");
    expect(html).toContain('data-element-id="napis"');
  });

  it("zdjęcie bez fotografii w katalogu znika, zamiast pokazać kafel zastępczy", () => {
    const element = {
      id: "foto",
      kind: "image",
      alt: "Opis wpisany w kreatorze",
      fit: "cover",
      layout: { desktop: { x: 0, y: 0, w: 48, h: 12, z: 0 } },
      bindings: { source: { record: { kind: "product", productId: NASZ }, field: "image", whenEmpty: "hide" } },
    };
    const html = markup([element], [sprzet({ imageUrl: null })]);
    expect(html).not.toContain('data-element-id="foto"');
    expect(html).not.toContain("site-placeholder");
  });

  /**
   * WIĄZANIE DO REKORDU STRONY (faza 5) na stronie, która na żadnym rekordzie
   * nie stoi. Zachowanie ma być takie samo, jak przy pozycji, której nie ma —
   * a nie „pokaż treść statyczną", bo to dałoby stronę, która wygląda dobrze
   * dokładnie tam, gdzie jest źle skonfigurowana.
   */
  it("wiązanie do rekordu strony wycina węzeł, gdy strona rekordu nie ma", () => {
    const element = { ...napisZwiazany("name") };
    (element.bindings as Record<string, Record<string, unknown>>)["text"]!.record = {
      kind: "pageProduct",
    };
    expect(markup([element], [sprzet()])).not.toContain('data-element-id="napis"');
  });

  it("rekord strony podany propsem oddaje wartość", () => {
    const element = { ...napisZwiazany("name") };
    (element.bindings as Record<string, Record<string, unknown>>)["text"]!.record = {
      kind: "pageProduct",
    };
    const html = renderToStaticMarkup(
      <SiteRenderer sections={sekcja([element])} products={[]} record={sprzet()} />,
    );
    expect(html).toContain("Terminal satelitarny");
  });
});

// -----------------------------------------------------------------------
// 4. Element niezwiązany nie zmienia się ani o bajt
// -----------------------------------------------------------------------

describe("element bez wiązania zostaje sobą", () => {
  it("napis bez wiązania pokazuje treść strony", () => {
    const element = {
      id: "napis",
      kind: "heading",
      text: NAPIS_PROJEKTOWY,
      level: 2,
      align: "left",
      layout: { desktop: { x: 0, y: 0, w: 48, h: 6, z: 0 } },
    };
    render(<SiteRenderer sections={sekcja([element])} products={[sprzet()]} />);
    expect(screen.getByText(NAPIS_PROJEKTOWY)).toBeTruthy();
  });
});
