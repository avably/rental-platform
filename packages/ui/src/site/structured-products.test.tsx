// @vitest-environment jsdom

/**
 * SPRZĘT STRUKTURALNY — WYBÓR POZYCJI I PRÓG KATALOGU (E7, aneks ADR-094).
 *
 * Sekcja sprzętu jest jedynym typem, którego TREŚCIĄ NIE JEST JEJ LISTA:
 * lista niesie wskazania, a nazwy, ceny i zdjęcia mieszkają w katalogu. Stąd
 * trzy zdania, których nie zobaczy żadna funkcja czysta w rdzeniu:
 *
 *   1. CO SEKCJA ODDAJE DO DOKUMENTU przy każdym z dwóch źródeł — i że wybór
 *      ręczny zachowuje KOLEJNOŚĆ OPERATORA, a nie kolejność katalogu;
 *   2. WSKAZANIE, DO KTÓREGO NIE MA PRODUKTU, wypada bez śladu (pozycja
 *      usunięta z katalogu nie może położyć strony ani zostawić pustego kafla);
 *   3. ODNOŚNIK DO KATALOGU pojawia się DOKŁADNIE na progu — zmierzony po obu
 *      stronach, bo warunek „więcej niż" i warunek „co najmniej" różnią się
 *      jednym znakiem i jedną sytuacją, w której odwiedzający nie dowiaduje
 *      się, że oferta ma ciąg dalszy.
 *
 * Fikstury są RÓŻNICUJĄCE: produkty mają rozróżnialne nazwy i ceny, więc
 * „pokazano trzy" znaczy tu „pokazano TE trzy", a nie „coś się narysowało".
 */
import {
  PRODUCTS_CATALOG_HREF,
  structuredPresetFor,
  type ProductsStructuredContent,
} from "@avably/core/site";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SITE_LABELS, SiteRenderer } from "./site-renderer";
import type { RenderSection, StorefrontProduct } from "./types";

const L = DEFAULT_SITE_LABELS;

afterEach(cleanup);

/** Katalog o rozróżnialnych pozycjach — `id` czytelne, żeby dowód był czytelny. */
function katalog(ile: number): StorefrontProduct[] {
  return Array.from({ length: ile }, (_, index) => ({
    id: `prod-${index + 1}`,
    name: `Sprzęt ${index + 1}`,
    description: null,
    priceLabel: `${(index + 1) * 10},00 zł / doba`,
    imageUrl: null,
    imageAlt: `Sprzęt ${index + 1}`,
  }));
}

/**
 * Katalog z PRZYPISANIEM kategorii (ADR-254) — pozycje nieparzyste do „kat-a",
 * parzyste do „kat-b", żeby „pokazano kat-a" znaczyło TE pozycje, a nie „coś".
 */
function katalogZKategoriami(): StorefrontProduct[] {
  return katalog(6).map((product, index) => ({
    ...product,
    categoryIds: index % 2 === 0 ? ["kat-a"] : ["kat-b"],
  }));
}

function tresc(patch: Partial<ProductsStructuredContent> = {}): ProductsStructuredContent {
  return {
    ...(structuredPresetFor("products", "pl") as ProductsStructuredContent),
    ...patch,
  } as ProductsStructuredContent;
}

function narysuj(content: ProductsStructuredContent, products: StorefrontProduct[]) {
  const section = {
    id: "sekcja-sprzetu",
    position: 0,
    type: "products",
    content,
  } as unknown as RenderSection;
  return render(<SiteRenderer sections={[section]} products={products} labels={L} />);
}

/** Nazwy pozycji W KOLEJNOŚCI, w jakiej stoją w dokumencie. */
function pokazaneNazwy(): string[] {
  return screen
    .getAllByText(/^Sprzęt \d+$/)
    .map((element) => element.textContent ?? "");
}

describe("źródło treści: katalog kontra wybór ręczny", () => {
  it("źródło „katalog” pokazuje POCZĄTEK katalogu, przycięty do limitu", () => {
    narysuj(tresc({ source: "catalog", limit: 4 }), katalog(10));
    expect(pokazaneNazwy()).toEqual(["Sprzęt 1", "Sprzęt 2", "Sprzęt 3", "Sprzęt 4"]);
  });

  it("wybór ręczny pokazuje WSKAZANE pozycje w KOLEJNOŚCI OPERATORA", () => {
    narysuj(
      tresc({
        source: "picked",
        limit: 8,
        items: [{ productId: "prod-7" }, { productId: "prod-2" }, { productId: "prod-5" }],
      }),
      katalog(10),
    );
    /*
     * Kolejność jest DECYZJĄ, a nie przypadkiem alfabetu: operator ustawił ją
     * w szufladzie uchwytem i strzałkami. Posortowanie jej „po katalogu"
     * skasowałoby tę pracę bez słowa — i byłoby niewidoczne przy fiksturze
     * wskazującej pozycje po kolei.
     */
    expect(pokazaneNazwy()).toEqual(["Sprzęt 7", "Sprzęt 2", "Sprzęt 5"]);
  });

  it("wskazanie BEZ produktu wypada, a reszta sekcji stoi", () => {
    narysuj(
      tresc({
        source: "picked",
        limit: 8,
        items: [{ productId: "prod-1" }, { productId: "prod-999" }, { productId: "prod-3" }],
      }),
      katalog(3),
    );
    expect(
      pokazaneNazwy(),
      "pozycja usunięta z katalogu zostawiła po sobie kafel albo położyła sekcję",
    ).toEqual(["Sprzęt 1", "Sprzęt 3"]);
  });

  it("wybór wskazujący SAME nieistniejące pozycje daje stan pusty, a nie pustkę", () => {
    narysuj(tresc({ source: "picked", items: [{ productId: "prod-999" }] }), katalog(3));
    expect(screen.getByText(L.productsEmpty)).toBeTruthy();
    expect(screen.queryAllByText(/^Sprzęt \d+$/)).toHaveLength(0);
  });

  it("pusty katalog daje stan pusty także przy źródle „katalog”", () => {
    narysuj(tresc({ source: "catalog" }), []);
    expect(screen.getByText(L.productsEmpty)).toBeTruthy();
  });
});

describe("źródło treści: kategoria katalogu (ADR-254)", () => {
  it("„kategoria” + categoryId pokazuje TYLKO pozycje tej kategorii", () => {
    narysuj(tresc({ source: "category", categoryId: "kat-a", limit: 8 }), katalogZKategoriami());
    expect(pokazaneNazwy()).toEqual(["Sprzęt 1", "Sprzęt 3", "Sprzęt 5"]);
  });

  it("limit tnie DOPIERO po odsianiu kategorii (slice po filtrze)", () => {
    narysuj(tresc({ source: "category", categoryId: "kat-a", limit: 2 }), katalogZKategoriami());
    // kat-a to Sprzęt 1, 3, 5; limit 2 zostawia dwa PIERWSZE Z KATEGORII,
    // a nie dwie pierwsze pozycje katalogu (te są kat-a i kat-b na przemian).
    expect(pokazaneNazwy()).toEqual(["Sprzęt 1", "Sprzęt 3"]);
  });

  it("„kategoria” bez wskazania daje stan pusty, a nie cały katalog", () => {
    narysuj(tresc({ source: "category", limit: 8 }), katalogZKategoriami());
    expect(screen.getByText(L.productsEmpty)).toBeTruthy();
    expect(screen.queryAllByText(/^Sprzęt \d+$/)).toHaveLength(0);
  });

  it("kategoria niedopasowana do żadnej pozycji daje stan pusty", () => {
    narysuj(tresc({ source: "category", categoryId: "kat-nieznana", limit: 8 }), katalogZKategoriami());
    expect(screen.getByText(L.productsEmpty)).toBeTruthy();
  });

  it("źródła ROZŁĄCZNE: „kategoria” czyta categoryId i NIE tyka ręcznej listy", () => {
    const produkty = katalogZKategoriami();
    // Jedna treść niosąca OBA pola — categoryId (kat-b) i ręczną listę (prod-1).
    const wspolna = tresc({ categoryId: "kat-b", items: [{ productId: "prod-1" }], limit: 8 });

    // Przy „kategorii” liczy się WYŁĄCZNIE categoryId: pokazują się pozycje
    // kat-b, a prod-1 (kat-a) się NIE pojawia — ręczna lista jest ignorowana.
    const { unmount } = narysuj({ ...wspolna, source: "category" }, produkty);
    expect(pokazaneNazwy()).toEqual(["Sprzęt 2", "Sprzęt 4", "Sprzęt 6"]);
    unmount();

    // Ta SAMA treść przełączona na „ręcznie” pokazuje prod-1: lista przeżyła
    // wycieczkę do kategorii nietknięta, a categoryId jest teraz bez skutku.
    narysuj({ ...wspolna, source: "picked" }, produkty);
    expect(pokazaneNazwy()).toEqual(["Sprzęt 1"]);
  });
});

describe("odnośnik „Zobacz cały sprzęt” — próg zmierzony po OBU stronach", () => {
  it("katalog RÓWNY temu, co widać → odnośnika NIE MA", () => {
    narysuj(tresc({ source: "catalog", limit: 8 }), katalog(8));
    expect(pokazaneNazwy()).toHaveLength(8);
    expect(
      screen.queryByRole("link", { name: L.productsCatalog }),
      "odnośnik do katalogu przy pełnej ofercie odsyła tam, gdzie odwiedzający już jest",
    ).toBeNull();
  });

  it("katalog WIĘKSZY o jeden → odnośnik JEST i prowadzi na STRONĘ KATALOGU", () => {
    narysuj(tresc({ source: "catalog", limit: 8 }), katalog(9));
    const link = screen.getByRole("link", { name: L.productsCatalog });
    // Adres bierze się ze STAŁEJ RDZENIA, nie z literału: do ADR-186 odnośnik
    // wskazywał `/store`, czyli tę samą stronę, z której klient klikał. Literał
    // w teście przeżyłby tę poprawkę i pilnowałby wady zamiast kontraktu.
    expect(link.getAttribute("href")).toBe(PRODUCTS_CATALOG_HREF);
    expect(PRODUCTS_CATALOG_HREF, "odnośnik znów prowadzi na stronę główną").not.toBe("/store");
  });

  it("wybór ręczny pokazujący wycinek katalogu też odsyła po resztę", () => {
    narysuj(
      tresc({ source: "picked", limit: 8, items: [{ productId: "prod-2" }] }),
      katalog(6),
    );
    expect(screen.getByRole("link", { name: L.productsCatalog })).toBeTruthy();
  });

  it("stan pusty nie udaje, że oferta się skończyła — odnośnik zostaje", () => {
    narysuj(tresc({ source: "picked", items: [{ productId: "prod-999" }] }), katalog(4));
    expect(
      screen.getByRole("link", { name: L.productsCatalog }),
      "sekcja bez ani jednej pozycji przy niepustym katalogu zataja, że katalog istnieje",
    ).toBeTruthy();
  });
});

describe("oba układy czytają tę samą treść", () => {
  it.each(["grid", "list"] as const)("%s: limit tnie listę, a odnośnik liczy się tak samo", (layout) => {
    narysuj(tresc({ layout, source: "catalog", limit: 3 }), katalog(9));
    expect(pokazaneNazwy()).toEqual(["Sprzęt 1", "Sprzęt 2", "Sprzęt 3"]);
    expect(screen.getByRole("link", { name: L.productsCatalog })).toBeTruthy();
  });

  it("siatka niesie klasę reguły pełnych rzędów, a lista jej nie potrzebuje", () => {
    const { container, unmount } = narysuj(tresc({ layout: "grid", source: "catalog" }), katalog(5));
    expect(
      container.querySelector("[data-products-grid]")?.className,
      "siatka bez klasy reguły zostawia wiszący kafel przy pięciu i ośmiu pozycjach",
    ).toContain("site-product-grid");
    unmount();

    narysuj(tresc({ layout: "list", source: "catalog" }), katalog(5));
    expect(screen.getByText("Sprzęt 5")).toBeTruthy();
  });

  it("cena i nazwa pochodzą z KATALOGU, a nie z treści sekcji", () => {
    narysuj(tresc({ source: "picked", items: [{ productId: "prod-3" }] }), katalog(4));
    const kafel = screen.getByText("Sprzęt 3").closest("li")!;
    expect(within(kafel).getByText("30,00 zł / doba")).toBeTruthy();
  });
});
