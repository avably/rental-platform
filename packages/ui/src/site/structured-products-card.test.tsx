// @vitest-environment jsdom

/**
 * KAFEL SPRZĘTU: PODTYTUŁ, CECHY I WŁASNY PRZYCISK (faza 1b, ADR-154).
 *
 * ==================== CO TU JEST NAPRAWDĘ SPRAWDZANE ====================
 *
 * Nie „czy coś się narysowało", tylko czy WSKAZANIE rozwiązuje się do wartości
 * TEJ pozycji katalogu — i wyłącznie do niej. Cała stawka fazy 1b siedzi w tym
 * jednym zdaniu: treść sekcji niesie SAM IDENTYFIKATOR pola, a nie kopię jego
 * wartości, więc kafel nie ma prawa pokazać niczego, czego nie ma przy
 * pozycji podanej do renderu.
 *
 * Fikstury są RÓŻNICUJĄCE: dwie pozycje mają wartości pod TYM SAMYM polem, ale
 * różne. „Pokazano podtytuł" znaczy więc tutaj „pokazano TEN podtytuł", a nie
 * „gdzieś jest jakiś tekst".
 */
import { structuredPresetFor, type ProductsStructuredContent } from "@avably/core/site";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SITE_LABELS, SiteRenderer } from "./site-renderer";
import type { RenderSection, StorefrontProduct, StorefrontProductField } from "./types";

const L = DEFAULT_SITE_LABELS;

afterEach(cleanup);

/** Identyfikatory definicji pól — czytelne, żeby dowód dało się przeczytać. */
const POLE_RODZAJ = "pole-rodzaj";
const POLE_ZASIEG = "pole-zasieg";
const POLE_WAGA = "pole-waga";
/** Pole, którego W OGÓLE nie ma przy żadnej pozycji (wskazanie w próżnię). */
const POLE_NIEZNANE = "pole-nieznane";

function pole(id: string, label: string, value: string): StorefrontProductField {
  return { id, label, value };
}

function sprzet(
  id: string,
  name: string,
  fields: StorefrontProductField[] = [],
): StorefrontProduct {
  return {
    id,
    name,
    description: null,
    priceLabel: `${name} — cena`,
    imageUrl: null,
    imageAlt: name,
    fields,
  };
}

/** Katalog jednego najemcy: dwie pozycje z RÓŻNYMI wartościami tych samych pól. */
function katalog(): StorefrontProduct[] {
  return [
    sprzet("prod-1", "Terminal satelitarny", [
      pole(POLE_RODZAJ, "Rodzaj", "Internet satelitarny"),
      pole(POLE_ZASIEG, "Zasięg", "50 m"),
      pole(POLE_WAGA, "Waga", "1,2 kg"),
    ]),
    sprzet("prod-2", "Agregat prądotwórczy", [
      pole(POLE_RODZAJ, "Rodzaj", "Zasilanie awaryjne"),
      pole(POLE_WAGA, "Waga", "42 kg"),
    ]),
  ];
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

/** Kafel danej pozycji — kotwicą jest `data-products-item`, nie tekst. */
function kafel(productId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-products-item="${productId}"]`);
  expect(element, `kafel pozycji ${productId} nie zamontował się w ogóle`).not.toBeNull();
  return element!;
}

describe("podtytuł: WSKAZANIE pola, a nie napis w treści sekcji", () => {
  it.each(["grid", "list"] as const)(
    "%s: każdy kafel bierze wartość SWOJEJ pozycji spod tego samego wskazania",
    (layout) => {
      narysuj(tresc({ layout, source: "catalog", subtitleField: POLE_RODZAJ }), katalog());

      // Kontrola po pustym zbiorze: najpierw kafle NAPRAWDĘ są na ekranie.
      expect(screen.getByText("Terminal satelitarny")).toBeTruthy();
      expect(screen.getByText("Agregat prądotwórczy")).toBeTruthy();

      expect(
        within(kafel("prod-1")).getByText("Internet satelitarny"),
        "podtytuł pierwszej pozycji",
      ).toBeTruthy();
      expect(
        within(kafel("prod-2")).getByText("Zasilanie awaryjne"),
        "obie pozycje dostały ten sam podtytuł — wartość nie pochodzi z pozycji",
      ).toBeTruthy();
    },
  );

  it("podtytuł niesie SAMĄ WARTOŚĆ — bez etykiety pola", () => {
    narysuj(tresc({ source: "catalog", subtitleField: POLE_RODZAJ }), katalog());
    const napis = within(kafel("prod-1")).getByText("Internet satelitarny");
    expect(napis.textContent).toBe("Internet satelitarny");
  });

  it("bez wskazania kafel NIE MA podtytułu (kafel sprzed fazy 1b)", () => {
    narysuj(tresc({ source: "catalog" }), katalog());
    expect(kafel("prod-1").querySelector("[data-products-subtitle]")).toBeNull();
  });

  it("wskazanie pola, którego TA pozycja nie ma, nie rysuje pustego wiersza", () => {
    narysuj(tresc({ source: "catalog", subtitleField: POLE_ZASIEG }), katalog());
    // Pierwsza pozycja ma „Zasięg", druga nie — i to jest cała różnica.
    expect(kafel("prod-1").querySelector("[data-products-subtitle]")?.textContent).toBe("50 m");
    expect(
      kafel("prod-2").querySelector("[data-products-subtitle]"),
      "pozycja bez wartości dostała pusty podtytuł zamiast żadnego",
    ).toBeNull();
  });
});

describe("cechy: punktory z pól własnych, w kolejności OPERATORA", () => {
  it("rysuje etykietę i wartość, w kolejności wskazania", () => {
    narysuj(
      tresc({ source: "catalog", featureFields: [POLE_WAGA, POLE_RODZAJ] }),
      katalog(),
    );
    const punktory = within(kafel("prod-1"))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(punktory).toEqual(["Waga: 1,2 kg", "Rodzaj: Internet satelitarny"]);
  });

  it("wskazanie BEZ wartości wypada, a reszta cech zostaje", () => {
    narysuj(
      tresc({ source: "catalog", featureFields: [POLE_ZASIEG, POLE_WAGA] }),
      katalog(),
    );
    expect(
      within(kafel("prod-1"))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Zasięg: 50 m", "Waga: 1,2 kg"]);

    // Druga pozycja nie ma „Zasięgu" — zostaje jej sama „Waga".
    expect(
      within(kafel("prod-2"))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
      "sierocą etykietę bez wartości widać na kaflu jak dziurę",
    ).toEqual(["Waga: 42 kg"]);
  });

  it("wskazanie pola, którego nie ma NIGDZIE, nie rysuje listy w ogóle", () => {
    narysuj(tresc({ source: "catalog", featureFields: [POLE_NIEZNANE] }), katalog());
    expect(kafel("prod-1").querySelector("[data-products-features]")).toBeNull();
  });
});

describe("własny przycisk kafla", () => {
  it("etykieta z treści sekcji stoi na KAŻDYM kaflu", () => {
    narysuj(tresc({ source: "catalog", ctaLabel: "Sprawdź dostępność" }), katalog());
    expect(within(kafel("prod-1")).getByText("Sprawdź dostępność")).toBeTruthy();
    expect(within(kafel("prod-2")).getByText("Sprawdź dostępność")).toBeTruthy();
  });

  it("bez etykiety i bez odnośnika (podgląd kreatora) kafel NIE MA przycisku", () => {
    // `katalog()` nie podaje `href` — dokładnie jak podgląd kreatora i miniatura
    // szablonu. Fallback etykiety (ADR-245) tam się NIE pokazuje, bo nie ma dokąd
    // prowadzić — podgląd zostaje bez zmian.
    narysuj(tresc({ source: "catalog" }), katalog());
    expect(kafel("prod-1").querySelector("[data-products-cta]")).toBeNull();
  });

  it("kafel-odnośnik bez etykiety operatora dostaje domyślną etykietę chrome (ADR-245)", () => {
    // `href` podaje WYŁĄCZNIE storefront publiczny — tam każdy kafel ma prowadzić
    // do podstrony pozycji, więc dostaje afordancję nawet bez etykiety operatora.
    const products = katalog().map((product) => ({ ...product, href: `/product/${product.id}` }));
    narysuj(tresc({ source: "catalog" }), products);
    expect(within(kafel("prod-1")).getByText(L.productsCta)).toBeTruthy();
    expect(within(kafel("prod-2")).getByText(L.productsCta)).toBeTruthy();
  });

  it("etykieta operatora WYGRYWA z domyślną, także na kaflu-odnośniku", () => {
    const products = katalog().map((product) => ({ ...product, href: `/product/${product.id}` }));
    narysuj(tresc({ source: "catalog", ctaLabel: "Wypożycz teraz" }), products);
    expect(within(kafel("prod-1")).getByText("Wypożycz teraz")).toBeTruthy();
    expect(kafel("prod-1").textContent).not.toContain(L.productsCta);
  });

  it("przycisk NIE JEST odnośnikiem w odnośniku", () => {
    /*
     * Kafel z podanym `href` jest w całości odnośnikiem. Gdyby przycisk był
     * drugim `<a>` w środku, przeglądarka rozbiłaby drzewo „naprawiając" HTML
     * — i połowa kafla przestałaby być klikalna, bez śladu w konsoli.
     */
    const products = katalog().map((product) => ({ ...product, href: `/product/${product.id}` }));
    narysuj(tresc({ source: "catalog", ctaLabel: "Sprawdź dostępność" }), products);

    const item = kafel("prod-1");
    expect(item.querySelectorAll("a")).toHaveLength(1);
    const przycisk = item.querySelector("[data-products-cta]");
    expect(przycisk, "przycisku w ogóle nie ma — asercja niżej byłaby po pustym zbiorze").not.toBeNull();
    expect(przycisk!.tagName).toBe("SPAN");
  });
});

describe("SONDA BEZPIECZEŃSTWA: sekcja nie wynosi cudzych pozycji", () => {
  /**
   * Katalog przekazany do renderu jest katalogiem JEDNEGO najemcy — bierze się
   * z `app.get_public_catalog(tenant_id z nagłówka)`. Wskazanie identyfikatora
   * spoza tego zbioru (pozycja innego najemcy, zgadnięty UUID) ma dawać kafel,
   * którego NIE MA — a nie kafel zastępczy z identyfikatorem w środku.
   *
   * Sprawdzamy to razem z nowymi polami, bo faza 1b dokłada trzy nowe drogi,
   * którymi coś mogłoby wyciec na kafel: podtytuł, cechy i przycisk.
   */
  const OBCY = "prod-cudzego-najemcy";

  it("wskazana pozycja spoza katalogu nie rysuje ANI nazwy, ANI ceny, ANI wskazań", () => {
    narysuj(
      tresc({
        source: "picked",
        items: [{ productId: OBCY }, { productId: "prod-1" }] as ProductsStructuredContent["items"],
        subtitleField: POLE_RODZAJ,
        featureFields: [POLE_WAGA],
        ctaLabel: "Sprawdź dostępność",
      }),
      katalog(),
    );

    // NAJPIERW dowód, że sekcja w ogóle się narysowała — inaczej wszystkie
    // asercje „nie ma X" niżej byłyby prawdziwe po pustym zbiorze.
    expect(kafel("prod-1")).toBeTruthy();
    expect(within(kafel("prod-1")).getByText("Internet satelitarny")).toBeTruthy();

    expect(
      document.querySelector(`[data-products-item="${OBCY}"]`),
      "wskazanie spoza katalogu wyrenderowało kafel",
    ).toBeNull();
    expect(document.body.textContent).not.toContain(OBCY);
    // Dokładnie jedna pozycja w dokumencie: obca nie doszła żadną z dróg.
    expect(document.querySelectorAll("[data-products-item]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-products-cta]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-products-subtitle]")).toHaveLength(1);
  });

  it("wskazanie POLA rozwiązuje się w polach TEJ pozycji, nie w cudzych", () => {
    /*
     * Dowód, że rozwiązywanie wskazania nie ma dostępu do zbioru globalnego:
     * pozycja BEZ pól nie dostaje wartości od sąsiada, który je ma.
     */
    narysuj(
      tresc({ source: "catalog", subtitleField: POLE_RODZAJ, featureFields: [POLE_WAGA] }),
      [...katalog(), sprzet("prod-3", "Przyczepa")],
    );
    expect(kafel("prod-3")).toBeTruthy();
    expect(kafel("prod-3").querySelector("[data-products-subtitle]")).toBeNull();
    expect(kafel("prod-3").querySelector("[data-products-features]")).toBeNull();
    // A sąsiad ma swoje — czyli mechanizm działa i asercje wyżej nie są puste.
    expect(kafel("prod-1").querySelector("[data-products-subtitle]")?.textContent).toBe(
      "Internet satelitarny",
    );
  });
});
