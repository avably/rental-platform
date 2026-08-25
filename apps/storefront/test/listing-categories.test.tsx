// @vitest-environment jsdom
/**
 * DRZEWO KATEGORII W TREŚCI LISTINGU (F7b, aneks właściciela 2026-08-25).
 *
 * Dyspozycja jest o LICZBIE KLIKNIĘĆ: będąc w kategorii, przełączenie na inną
 * ma kosztować JEDEN klik — nie trzy (otwórz menu → wybierz → czekaj). Stąd
 * lista półek w treści listingu, a nie tylko pod ikoną w belce.
 *
 * Cztery zdania, których pilnuje ten plik:
 *
 *   1. KOLUMNA od 64 rem KONTENERA (ADR-085 — podgląd mierzy własną szerokość),
 *      RZĄD poniżej progu; nigdy oba naraz.
 *   2. Obie formy niosą KOMPLET półek i „Wszystkie kategorie" → `/katalog`.
 *   3. `aria-current="page"` na bieżącej półce, z drugą nogą dowodu.
 *   4. Liczniki „(N)" TYLKO w kolumnie i BEZ udziału w nazwie odnośnika
 *      (`aria-hidden`) — czytnik czyta „Agregaty", nie „Agregaty 12".
 *
 * DOWÓD MUTACYJNY: zdjęcie progu kontenerowego z którejkolwiek formy gasi test
 * rozjazdu; zdjęcie pozycji katalogu gasi test kompletu; zdjęcie `aria-current`
 * gasi test bieżącej półki; dopisanie licznika do rzędu gasi test liczników.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ListingCategoryColumn,
  ListingCategoryRow,
} from "../components/storefront/listing-categories";
import type { CategoryNavItem } from "../lib/catalog/category-nav";

afterEach(cleanup);

const POZYCJE: CategoryNavItem[] = [
  { id: "c-1", name: "Kosiarki", slug: "kosiarki", href: "/kategoria/kosiarki", count: 3 },
  { id: "c-2", name: "Agregaty", slug: "agregaty", href: "/kategoria/agregaty", count: 12 },
];

const ETYKIETY = {
  heading: "Kategorie",
  allCategoriesLabel: "Wszystkie kategorie",
};

describe("F7b — kolumna kategorii (kontener ≥ 64 rem)", () => {
  it("kolumna stoi w SSR i pokazuje się dopiero od 64 rem kontenera", () => {
    const { container } = render(
      <ListingCategoryColumn items={POZYCJE} {...ETYKIETY} currentPath="/katalog" />,
    );
    const kolumna = container.querySelector("[data-listing-categories-column]");
    expect(kolumna, "kolumny kategorii nie ma w dokumencie").not.toBeNull();
    expect(kolumna!.className, "kolumna widoczna na telefonie — zjada pół szerokości wyników").toContain(
      "hidden",
    );
    expect(
      kolumna!.className,
      "kolumna zgubiła próg KONTENEROWY — podgląd mierzy własną szerokość, nie okna",
    ).toContain("@min-[64rem]/site:block");
  });

  it("nazwą nawigacji jest jej WIDOCZNY nagłówek (aria-labelledby, nie drugi napis)", () => {
    const { container } = render(
      <ListingCategoryColumn items={POZYCJE} {...ETYKIETY} currentPath="/katalog" />,
    );
    const kolumna = container.querySelector("[data-listing-categories-column]")!;
    const id = kolumna.getAttribute("aria-labelledby");
    expect(id, "nawigacja bez nazwy — czytnik ekranu ogłasza „nawigacja”").not.toBeNull();
    expect(container.querySelector(`#${id}`)!.textContent).toBe("Kategorie");
  });

  it("„Wszystkie kategorie” otwierają listę i prowadzą na /katalog", () => {
    const { container } = render(
      <ListingCategoryColumn items={POZYCJE} {...ETYKIETY} currentPath="/kategoria/kosiarki" />,
    );
    const linki = container.querySelectorAll("a");
    expect(linki[0]!.getAttribute("href")).toBe("/katalog");
    expect(linki[0]!.textContent).toContain("Wszystkie kategorie");
    // Komplet półek, w kolejności najemcy.
    expect([...linki].map((a) => a.getAttribute("href"))).toEqual([
      "/katalog",
      "/kategoria/kosiarki",
      "/kategoria/agregaty",
    ]);
  });

  it("bieżąca półka niesie aria-current i akcent; sąsiadka NIE (dwie nogi dowodu)", () => {
    const { container } = render(
      <ListingCategoryColumn items={POZYCJE} {...ETYKIETY} currentPath="/kategoria/agregaty" />,
    );
    const biezaca = container.querySelector('a[href="/kategoria/agregaty"]')!;
    expect(biezaca.getAttribute("aria-current")).toBe("page");
    expect(biezaca.className).toContain("aria-[current=page]:text-[color:var(--site-accent-text)]");
    expect(container.querySelector('a[href="/katalog"]')!.hasAttribute("aria-current")).toBe(false);
  });

  it("cel dotykowy wiersza to 44 px (S-15)", () => {
    const { container } = render(
      <ListingCategoryColumn items={POZYCJE} {...ETYKIETY} currentPath="/katalog" />,
    );
    expect(container.querySelector('a[href="/kategoria/kosiarki"]')!.className).toContain("py-3");
  });

  it("licznik pozycji stoi przy półce, ale NIE wchodzi do nazwy odnośnika", () => {
    const { container } = render(
      <ListingCategoryColumn items={POZYCJE} {...ETYKIETY} currentPath="/katalog" />,
    );
    const agregaty = container.querySelector('a[href="/kategoria/agregaty"]')!;
    expect(agregaty.textContent, "licznik zniknął — kolumna traci skalę półek").toContain("12");
    const licznik = agregaty.querySelector('[aria-hidden="true"]');
    expect(licznik, "licznik czytany przez czytnik ekranu jako część nazwy").not.toBeNull();
    expect(licznik!.textContent).toBe("12");
  });
});

describe("F7b — rząd kategorii (kontener < 64 rem)", () => {
  it("rząd jest przewijany poziomo, bez widocznego paska, i znika od 64 rem", () => {
    const { container } = render(
      <ListingCategoryRow items={POZYCJE} {...ETYKIETY} currentPath="/katalog" />,
    );
    const rzad = container.querySelector("[data-listing-categories-row]");
    expect(rzad, "rzędu kategorii nie ma — telefon traci przełączanie półek").not.toBeNull();
    expect(rzad!.className, "rząd dubluje kolumnę na szerokim kontenerze").toContain(
      "@min-[64rem]/site:hidden",
    );
    const pas = rzad!.firstElementChild!;
    for (const klasa of ["overflow-x-auto", "snap-x", "[scrollbar-width:none]"]) {
      expect(pas.className, `pas przewijania stracił ${klasa}`).toContain(klasa);
    }
  });

  it("pastylki mają 44 px, komplet półek i wejście do katalogu na początku", () => {
    const { container } = render(
      <ListingCategoryRow items={POZYCJE} {...ETYKIETY} currentPath="/kategoria/kosiarki" />,
    );
    const linki = [...container.querySelectorAll("a")];
    expect(linki.map((a) => a.getAttribute("href"))).toEqual([
      "/katalog",
      "/kategoria/kosiarki",
      "/kategoria/agregaty",
    ]);
    for (const link of linki) {
      expect(link.className, "pastylka poniżej celu dotykowego").toContain("h-11");
    }
    const biezaca = container.querySelector('a[href="/kategoria/kosiarki"]')!;
    expect(biezaca.getAttribute("aria-current")).toBe("page");
    // Stanu nie niesie sam kolor: obrys akcentu i waga (WCAG 1.4.1).
    expect(biezaca.className).toContain("aria-[current=page]:font-semibold");
  });

  it("rząd NIE niesie liczników — pastylka z „(N)” jest o połowę szersza", () => {
    const { container } = render(
      <ListingCategoryRow items={POZYCJE} {...ETYKIETY} currentPath="/katalog" />,
    );
    expect(container.querySelector('a[href="/kategoria/agregaty"]')!.textContent).toBe("Agregaty");
  });
});

describe("F7b — brak kategorii to brak nawigacji", () => {
  it("pusta lista nie rysuje ani kolumny, ani rzędu (pusty pas obiecywałby półki)", () => {
    const { container } = render(
      <>
        <ListingCategoryColumn items={[]} {...ETYKIETY} currentPath="/katalog" />
        <ListingCategoryRow items={[]} {...ETYKIETY} currentPath="/katalog" />
      </>,
    );
    expect(container.querySelector("[data-listing-categories-column]")).toBeNull();
    expect(container.querySelector("[data-listing-categories-row]")).toBeNull();
  });
});

describe("F7b — warianty wyłącznie KONTENEROWE (ADR-085)", () => {
  it("żadna klasa kolumny ani rzędu nie używa progów viewportowych sm:/md:/lg:", () => {
    const { container } = render(
      <>
        <ListingCategoryColumn items={POZYCJE} {...ETYKIETY} currentPath="/katalog" />
        <ListingCategoryRow items={POZYCJE} {...ETYKIETY} currentPath="/katalog" />
      </>,
    );
    for (const el of container.querySelectorAll("*")) {
      for (const klasa of (el.getAttribute("class") ?? "").split(/\s+/)) {
        expect(
          /^(sm|md|lg|xl):/.test(klasa),
          `klasa viewportowa „${klasa}" w drzewie kategorii — listing mierzy kontener`,
        ).toBe(false);
      }
    }
  });
});
