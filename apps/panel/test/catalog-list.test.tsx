// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/katalog",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { ProductsTable } = await import("@/app/[locale]/(panel)/katalog/products-table");
const { CatalogToolbar } = await import("@/app/[locale]/(panel)/katalog/catalog-toolbar");
const { CatalogEmptyState, CatalogNoResultsState } = await import(
  "@/app/[locale]/(panel)/katalog/catalog-empty-state"
);
const { filterProductsBySearch, filterProductsByStatus } = await import(
  "@/lib/catalog/product-search"
);
const { resolveProductSort, sortProducts } = await import("@/lib/catalog/product-sort");
const { productsFilterSchema } = await import("@/lib/catalog-validation");

/**
 * Render listy katalogu (U8a) — RTL na jsdom, wzorzec `customers-list.test.tsx`.
 *
 * Kluczowa asercja: ZAWĘŻANIE FAKTYCZNIE ZAWĘŻA. Test przepuszcza wiersze
 * przez tę samą potokę co ekran (`filterProductsByStatus` →
 * `filterProductsBySearch` → `sortProducts`) i renderuje tabelę z wynikiem,
 * więc mutacja wyszukiwarki albo filtra („ignoruj i zwróć wszystko") zapala
 * test: niepasujący produkt pojawiłby się w DOM.
 *
 * Każda asercja ma stronę PRZECIWNĄ (coś zostało / coś zniknęło) — sama
 * obecność dopasowania przeszłaby też przy filtrze, który nic nie robi.
 */

interface Row {
  id: string;
  name: string;
  basePriceDayGrosze: number;
  depositGrosze: number;
  active: boolean;
  unitCount: number;
  deployedToday: number;
  thumbnail: { url: string; alt: string } | null;
}

const RAW: Row[] = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    name: "Rower górski 26",
    basePriceDayGrosze: 6000,
    depositGrosze: 30000,
    active: true,
    unitCount: 6,
    deployedToday: 3,
    thumbnail: {
      url: "http://127.0.0.1:54321/storage/v1/object/public/product-images/t/rower/a.jpg",
      alt: "Rower górski oparty o ścianę",
    },
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    name: "Kajak dwuosobowy",
    basePriceDayGrosze: 12000,
    depositGrosze: 50000,
    active: false,
    unitCount: 2,
    deployedToday: 0,
    thumbnail: null,
  },
  {
    id: "cccccccc-0000-4000-8000-000000000003",
    name: "Namiot 4-osobowy",
    basePriceDayGrosze: 8000,
    depositGrosze: 20000,
    active: true,
    unitCount: 4,
    deployedToday: 4,
    thumbnail: null,
  },
];

/** Odwzorowanie potoki `page.tsx`: parametry URL → filtry → sort → render. */
function renderList(search: Record<string, string | undefined>) {
  const filter = productsFilterSchema.parse(search);
  const sort = resolveProductSort(filter.sort, filter.dir);
  const visible = sortProducts(
    filterProductsBySearch(filterProductsByStatus(RAW, filter.status), filter.q ?? ""),
    sort,
    "pl",
  );
  render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <>
        <CatalogToolbar filter={filter} resultCount={visible.length} />
        {visible.length === 0 ? (
          <CatalogNoResultsState />
        ) : (
          <ProductsTable
            rows={visible}
            currency="PLN"
            locale="pl"
            sort={sort}
            baseParams={{ q: filter.q, status: filter.status, sort: filter.sort, dir: filter.dir }}
          />
        )}
      </>
    </NextIntlClientProvider>,
  );
  return visible;
}

afterEach(() => cleanup());

describe("lista katalogu — wyszukiwarka", () => {
  it("bez frazy pokazuje wszystkie produkty", () => {
    renderList({});
    expect(screen.getByText("Rower górski 26")).toBeTruthy();
    expect(screen.getByText("Kajak dwuosobowy")).toBeTruthy();
    expect(screen.getByText("Namiot 4-osobowy")).toBeTruthy();
  });

  it("fraza ZAWĘŻA listę do dopasowań (i gubi resztę)", () => {
    renderList({ q: "kajak" });
    expect(screen.getByText("Kajak dwuosobowy")).toBeTruthy();
    // Ta asercja pali przy wyszukiwarce ignorującej frazę.
    expect(screen.queryByText("Rower górski 26")).toBeNull();
    expect(screen.queryByText("Namiot 4-osobowy")).toBeNull();
  });

  it("dopasowanie jest częściowe i niewrażliwe na wielkość liter", () => {
    renderList({ q: "GÓRSKI" });
    expect(screen.getByText("Rower górski 26")).toBeTruthy();
    expect(screen.queryByText("Kajak dwuosobowy")).toBeNull();
  });

  it("licznik wyników mówi, ILE zostało po zawężeniu", () => {
    renderList({ q: "kajak" });
    const counter = document.querySelector("[data-catalog-result-count]");
    expect(counter, "brak licznika wyników").not.toBeNull();
    expect(counter!.textContent).toContain("1");
  });

  it("belka wyszukiwarki jest formularzem GET na /katalog (stan mieszka w URL)", () => {
    renderList({ q: "rower", status: "aktywne" });
    const form = document.querySelector("form");
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/katalog");
    // Ukryte pole niesie status, żeby szukanie nie zerowało filtra publikacji.
    const hidden = document.querySelector('input[type="hidden"][name="status"]');
    expect(hidden?.getAttribute("value")).toBe("aktywne");
  });
});

describe("lista katalogu — filtr publikacji", () => {
  it("chip „aktywne” zostawia aktywne i USUWA nieaktywne", () => {
    renderList({ status: "aktywne" });
    expect(screen.getByText("Rower górski 26")).toBeTruthy();
    expect(screen.queryByText("Kajak dwuosobowy")).toBeNull();
  });

  it("chip „nieaktywne” działa w drugą stronę", () => {
    renderList({ status: "nieaktywne" });
    expect(screen.getByText("Kajak dwuosobowy")).toBeTruthy();
    expect(screen.queryByText("Rower górski 26")).toBeNull();
  });

  it("aktywny chip jest oznaczony maszynowo, nie samym kolorem", () => {
    renderList({ status: "aktywne" });
    const chip = document.querySelector('[data-catalog-status-chip="aktywne"]');
    expect(chip?.getAttribute("aria-pressed")).toBe("true");
    expect(
      document.querySelector('[data-catalog-status-chip="wszystkie"]')?.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("chipy są LINKAMI zachowującymi frazę (nie submitem gubiącym parametry)", () => {
    renderList({ q: "rower", status: "aktywne" });
    const chip = document.querySelector('[data-catalog-status-chip="nieaktywne"]');
    expect(chip?.tagName).toBe("A");
    const href = chip!.getAttribute("href")!;
    expect(href).toContain("q=rower");
    expect(href).toContain("status=nieaktywne");
  });

  it("nieznana wartość filtra jest IGNOROWANA, nie wywraca listy", () => {
    // `catch(undefined)` w schemacie: `?status=cokolwiek` = brak filtra.
    const visible = renderList({ status: "cokolwiek", sort: "nieistniejaca", dir: "wzwyz" });
    expect(visible).toHaveLength(RAW.length);
  });
});

describe("lista katalogu — dwa różne puste stany", () => {
  it("filtr bez wyników prowadzi do WYCZYSZCZENIA, nie do dodania produktu", () => {
    renderList({ q: "quad" });
    const empty = document.querySelector('[data-catalog-empty="brak-wynikow"]');
    expect(empty, "brak stanu „nic nie znaleziono”").not.toBeNull();
    expect(screen.getByText(messages.catalog.emptyState.noResultsTitle)).toBeTruthy();
    expect(document.querySelector("[data-catalog-clear-filters]")?.getAttribute("href")).toBe(
      "/katalog",
    );
    // Druga strona: to NIE jest stan „pusty magazyn”. Gdyby ekran pokazał
    // tamten, powiedziałby operatorowi nieprawdę o jego katalogu.
    expect(document.querySelector('[data-catalog-empty="brak-produktow"]')).toBeNull();
    expect(screen.queryByText(messages.catalog.emptyState.title)).toBeNull();
  });

  it("pusty magazyn prowadzi do DODANIA produktu, nie do czyszczenia filtrów", () => {
    render(
      <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
        <CatalogEmptyState />
      </NextIntlClientProvider>,
    );
    expect(document.querySelector('[data-catalog-empty="brak-produktow"]')).not.toBeNull();
    expect(screen.getByText(messages.catalog.emptyState.title)).toBeTruthy();
    expect(document.querySelector("[data-catalog-clear-filters]")).toBeNull();
    expect(screen.queryByText(messages.catalog.emptyState.noResultsTitle)).toBeNull();
  });
});

describe("lista katalogu — miniatury i kolumna „dziś w terenie”", () => {
  it("produkt ze zdjęciem dostaje obraz z publicznego bucketu i alt z opisu", () => {
    renderList({});
    const image = document.querySelector('img[data-product-thumbnail="image"]');
    expect(image, "brak miniatury").not.toBeNull();
    expect(image!.getAttribute("src")).toContain("/storage/v1/object/public/product-images/");
    expect(image!.getAttribute("alt")).toBe("Rower górski oparty o ścianę");
  });

  it("produkt BEZ zdjęcia dostaje placeholder, nie dziurę i nie obraz", () => {
    renderList({ q: "kajak" });
    expect(document.querySelector('[data-product-thumbnail="placeholder"]')).not.toBeNull();
    expect(document.querySelector('img[data-product-thumbnail="image"]')).toBeNull();
  });

  it("kolumna „dziś w terenie” czyta się „3 z 6” i ma własną oś", () => {
    renderList({ q: "rower" });
    const cell = document.querySelector('[data-catalog-axis="deployment"]');
    expect(cell, "brak komórki osi deployment").not.toBeNull();
    expect(cell!.textContent).toBe("3 z 6");
    expect(cell!.getAttribute("data-catalog-value")).toBe("partial");
  });

  it("komplet w terenie i brak wydań mają RÓŻNE wartości osi", () => {
    renderList({ q: "namiot" });
    expect(document.querySelector('[data-catalog-value="all"]')).not.toBeNull();
    renderList({ q: "kajak" });
    expect(document.querySelector('[data-catalog-value="none"]')).not.toBeNull();
  });
});

describe("lista katalogu — sortowanie", () => {
  it("domyślnie alfabetycznie po nazwie", () => {
    const visible = renderList({});
    expect(visible.map((row) => row.name)).toEqual([
      "Kajak dwuosobowy",
      "Namiot 4-osobowy",
      "Rower górski 26",
    ]);
  });

  it("sort po „dziś w terenie” stawia na górze to, czego NIE MA na półce", () => {
    const visible = renderList({ sort: "teren" });
    expect(visible.map((row) => row.deployedToday)).toEqual([4, 3, 0]);
  });

  it("odwrócony kierunek naprawdę odwraca, a nie tylko zmienia strzałkę", () => {
    const visible = renderList({ sort: "teren", dir: "asc" });
    expect(visible.map((row) => row.deployedToday)).toEqual([0, 3, 4]);
  });

  it("sort po cenie porządkuje kwoty, nie napisy", () => {
    const visible = renderList({ sort: "cena" });
    expect(visible.map((row) => row.basePriceDayGrosze)).toEqual([6000, 8000, 12000]);
  });

  it("link nagłówka zachowuje frazę i przełącza kierunek tej samej kolumny", () => {
    renderList({ q: "o", sort: "cena", dir: "asc" });
    const head = document.querySelector('[data-sort-key="cena"]');
    const href = head!.getAttribute("href")!;
    expect(href).toContain("q=o");
    expect(href).toContain("sort=cena");
    expect(href).toContain("dir=desc");
  });
});
