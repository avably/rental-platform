// @vitest-environment jsdom

/**
 * KONTRAKT REZERWACJI WYSOKOŚCI OBRAZÓW SEKCJI (naprawa celności kotwic).
 *
 * Problem zmierzony przy odbiorze gałęzi kotwic (2026-08-06): obraz
 * z `loading="lazy"` bez zarezerwowanej wysokości ma przed wczytaniem 0 px,
 * więc na zimnym cache dokument ROŚNIE w trakcie przejazdu kotwicznego
 * (~417 px na szablonie budowlanym), a cel skoku ląduje o tyle za wysoko.
 * Kotwica liczy położenie w dokumencie, jaki JEST w chwili skoku — jedyną
 * obroną jest strona, której wysokość nie zależy od stanu wczytania zdjęć.
 *
 * Schemat treści NIE niesie wymiarów kadru (`imageSourceSchema` to adres
 * i atrybucja; kuracja pinuje tylko szerokość `w=1080`), więc rezerwację
 * niesie STAŁA PROPORCJA KAFLA per układ — klasa proporcji albo stałego
 * wymiaru na KAŻDEJ powierzchni obrazu: na `<img>` i na jego bliźniaku
 * zastępczym (ta sama klasa idzie na oba, więc strona bez Storage trzyma
 * tę samą geometrię co strona ze zdjęciami).
 *
 * Czego ten plik dowodzi i czego nie dowodzi: jsdom nie liczy layoutu, więc
 * sprawdzamy MECHANIZM (klasa wymiaru na powierzchni), a prawdy pikselowej
 * („dokument ma tę samą wysokość przed i po wczytaniu") dowodzi pomiar
 * w przeglądarce opisany w dzienniku gałęzi. Powiększenie (`<dialog>`) stoi
 * POZA kontraktem: warstwa nad stroną nie zmienia wysokości dokumentu,
 * a jej obraz celowo trzyma proporcje naturalne (`object-contain`).
 */
import {
  structuredPresetFor,
  withStructuredLayout,
  type GalleryStructuredContent,
  type ProductsStructuredContent,
} from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { SiteRenderer } from "./site-renderer";
import type { RenderSection, StorefrontProduct } from "./types";

const BAZA = "https://przyklad.supabase.test/storage/v1/object/public/site-images";

beforeAll(() => {
  // Karuzela wyrównuje pas obserwatorem rozmiaru — atrapa wycisza montowanie,
  // bo jsdom nie mierzy szerokości i nie ma czego wyrównywać.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

/**
 * Czy klasa REZERWUJE wysokość pudełka niezależnie od wczytania obrazu:
 * proporcja (`aspect-*` — wysokość liczy się z szerokości kafla) albo wymiar
 * stały (`size-N`/`h-N` ze skali rozstawu). `h-auto`, `h-full` i `size-full`
 * NIE rezerwują niczego: auto czeka na piksele obrazu, a procent dziedziczy
 * wysokość rodzica, którą w przepływie dokumentu i tak nadaje dopiero obraz.
 */
function rezerwujeWysokosc(element: Element): boolean {
  const tokeny = (element.getAttribute("class") ?? "").split(/\s+/);
  return tokeny.some(
    (token) => token.startsWith("aspect-") || /^size-\d+$/.test(token) || /^h-\d+$/.test(token),
  );
}

/**
 * Powierzchnie obrazu W PRZEPŁYWIE DOKUMENTU: `<img>` i kafle zastępcze,
 * z pominięciem wnętrza powiększenia (dialog jest warstwą nad stroną).
 */
function powierzchnieObrazu(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll("img, .site-placeholder")).filter(
    (element) => element.closest("dialog") === null,
  );
}

/** Wspólne zdanie kontraktu — z opisem powierzchni, żeby czerwień mówiła GDZIE. */
function sprawdzRezerwacje(container: HTMLElement, minimum: number) {
  const powierzchnie = powierzchnieObrazu(container);
  // Skan po pustym zbiorze niczego nie broni — najpierw dowód, że fikstura
  // naprawdę wystawiła powierzchnie obrazu.
  expect(powierzchnie.length, "fikstura nie wystawiła powierzchni obrazu").toBeGreaterThanOrEqual(
    minimum,
  );
  for (const powierzchnia of powierzchnie) {
    expect(
      rezerwujeWysokosc(powierzchnia),
      `powierzchnia bez rezerwacji wysokości: <${powierzchnia.tagName.toLowerCase()} class="${powierzchnia.getAttribute("class") ?? ""}">`,
    ).toBe(true);
  }
}

function galeria(): GalleryStructuredContent {
  const preset = structuredPresetFor("gallery", "pl") as GalleryStructuredContent;
  const [pierwszy, ...reszta] = preset.items;
  // Obok kadrów dostawcy staje plik z NASZEGO bucketa — obie gałęzie
  // `GalleryImage` (hotlink i `siteImageUrl`) wchodzą do dowodu.
  return {
    ...preset,
    items: [
      { ...pierwszy!, image: { kind: "storage", path: "tenant-a/site/kadr.jpg" } },
      ...reszta,
    ],
  } as GalleryStructuredContent;
}

function sekcjaGalerii(layout: GalleryStructuredContent["layout"], siteImageBase?: string) {
  const sections = [
    { id: "g1", position: 0, type: "gallery", content: withStructuredLayout(galeria(), layout) },
  ] as unknown as RenderSection[];
  return render(<SiteRenderer sections={sections} siteImageBase={siteImageBase} />);
}

/** Katalog z JEDNĄ pozycją bez zdjęcia — kafel zastępczy wchodzi do dowodu. */
function katalog(ile: number): StorefrontProduct[] {
  return Array.from({ length: ile }, (_, index) => ({
    id: `prod-${index + 1}`,
    name: `Sprzęt ${index + 1}`,
    description: null,
    priceLabel: `${(index + 1) * 10},00 zł / doba`,
    imageUrl: index === 0 ? null : `${BAZA}/tenant-a/produkty/p${index + 1}.jpg`,
    imageAlt: `Sprzęt ${index + 1}`,
  }));
}

function sekcjaSprzetu(layout: ProductsStructuredContent["layout"]) {
  const content = {
    ...(structuredPresetFor("products", "pl") as ProductsStructuredContent),
    layout,
    source: "catalog",
    limit: 4,
  } as ProductsStructuredContent;
  const sections = [
    { id: "p1", position: 0, type: "products", content },
  ] as unknown as RenderSection[];
  return render(<SiteRenderer sections={sections} products={katalog(4)} />);
}

describe("galeria strukturalna trzyma wysokość przed wczytaniem zdjęć", () => {
  it.each(["grid", "masonry", "carousel"] as const)(
    "układ %s: każdy obraz ma rezerwację wysokości",
    (layout) => {
      const { container } = sekcjaGalerii(layout, BAZA);
      sprawdzRezerwacje(container, 3);
    },
  );

  it.each(["grid", "masonry", "carousel"] as const)(
    "układ %s bez adresu Storage: kafle zastępcze trzymają tę samą geometrię",
    (layout) => {
      const { container } = sekcjaGalerii(layout, undefined);
      // Preset ma kadry dostawcy (hotlink renderuje się bez bazy) — kafel
      // zastępczy dostaje wyłącznie pozycja z naszego bucketa.
      expect(
        container.querySelector(".site-placeholder"),
        "fikstura nie wystawiła kafla zastępczego",
      ).not.toBeNull();
      sprawdzRezerwacje(container, 3);
    },
  );
});

describe("sprzęt strukturalny trzyma wysokość przed wczytaniem zdjęć", () => {
  it.each(["grid", "list"] as const)("układ %s: obrazy i kafel zastępczy mają rezerwację", (layout) => {
    const { container } = sekcjaSprzetu(layout);
    expect(
      container.querySelector(".site-placeholder"),
      "fikstura nie wystawiła kafla zastępczego",
    ).not.toBeNull();
    sprawdzRezerwacje(container, 4);
  });
});

describe("sekcje v1 trzymają wysokość przed wczytaniem zdjęć", () => {
  it("galeria v1: obrazy z rezerwacją, kafle zastępcze z tą samą geometrią", () => {
    const content = {
      heading: "Realizacje",
      items: [
        { imagePath: "tenant-a/site/a.jpg", alt: "Pierwsza realizacja" },
        { imagePath: "tenant-a/site/b.jpg", alt: "Druga realizacja" },
      ],
    };
    const sections = [
      { id: "v1g", position: 0, type: "gallery", content },
    ] as unknown as RenderSection[];

    const zBaza = render(<SiteRenderer sections={sections} siteImageBase={BAZA} />);
    sprawdzRezerwacje(zBaza.container, 2);
    cleanup();

    const bezBazy = render(<SiteRenderer sections={sections} />);
    sprawdzRezerwacje(bezBazy.container, 2);
  });

  it("karty katalogu v1: obraz i kafel zastępczy mają rezerwację", () => {
    const sections = [
      { id: "v1p", position: 0, type: "products", content: { heading: "Sprzęt" } },
    ] as unknown as RenderSection[];
    const { container } = render(<SiteRenderer sections={sections} products={katalog(3)} />);
    sprawdzRezerwacje(container, 3);
  });
});
