// @vitest-environment jsdom

/**
 * KATEGORIE STRUKTURALNE — KAFLE Z BANEREM I LINK DO STRONY KATEGORII
 * (Faza 7, ADR-259).
 *
 * Sekcja kategorii jest, obok sekcji sprzętu, drugim typem, którego TREŚCIĄ NIE
 * JEST JEJ LISTA: lista niesie wskazania, a nazwa, slug i baner mieszkają w
 * katalogu. Stąd zdania, których nie zobaczy żadna funkcja czysta w rdzeniu:
 *
 *   1. KAFEL Z BANEREM rysuje `<img>` z adresem banera, a kafel BEZ banera —
 *      neutralną płytę zastępczą (nie pusty prostokąt bez znaczenia);
 *   2. KAŻDY kafel jest ODNOŚNIKIEM do strony kategorii (`/kategoria/{slug}`);
 *   3. źródło „katalog" pokazuje WSZYSTKIE kategorie, a wybór ręczny — WSKAZANE
 *      w KOLEJNOŚCI OPERATORA, z wypadnięciem wskazań na kategorię usuniętą;
 *   4. sekcja bez kategorii pokazuje STAN PUSTY, a nie pustą ramkę.
 *
 * Fikstury są RÓŻNICUJĄCE: kategorie mają rozróżnialne nazwy i adresy, więc
 * „pokazano kat-2" znaczy tu „pokazano TĘ kategorię", a nie „coś się narysowało".
 */
import { structuredPresetFor, type CategoriesStructuredContent } from "@avably/core/site";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SITE_LABELS, SiteRenderer } from "./site-renderer";
import type { RenderSection, StorefrontCategory } from "./types";

const L = DEFAULT_SITE_LABELS;

afterEach(cleanup);

/** Kategorie o rozróżnialnych nazwach i adresach — dowód czytelny co do sztuki. */
function kategorie(ile: number): StorefrontCategory[] {
  return Array.from({ length: ile }, (_, index) => ({
    id: `kat-${index + 1}`,
    name: `Kategoria ${index + 1}`,
    imageUrl: `https://cdn.example/baner-${index + 1}.jpg`,
    href: `/kategoria/kategoria-${index + 1}`,
  }));
}

function tresc(patch: Partial<CategoriesStructuredContent> = {}): CategoriesStructuredContent {
  return {
    ...(structuredPresetFor("categories", "pl") as CategoriesStructuredContent),
    ...patch,
  } as CategoriesStructuredContent;
}

function narysuj(content: CategoriesStructuredContent, categories: StorefrontCategory[]) {
  const section = {
    id: "sekcja-kategorii",
    position: 0,
    type: "categories",
    content,
  } as unknown as RenderSection;
  return render(<SiteRenderer sections={[section]} categories={categories} labels={L} />);
}

/** Nazwy kategorii W KOLEJNOŚCI, w jakiej stoją w dokumencie. */
function pokazaneNazwy(): string[] {
  return screen.getAllByText(/^Kategoria \d+$/).map((element) => element.textContent ?? "");
}

describe("kafel kategorii: baner albo płyta zastępcza, zawsze z linkiem", () => {
  it("kafel Z banerem rysuje <img> z adresem banera", () => {
    narysuj(tresc({ source: "catalog" }), [
      { id: "kat-1", name: "Rowery", imageUrl: "https://cdn.example/rowery.jpg", href: "/kategoria/rowery" },
    ]);
    const obraz = screen.getByRole("img", { name: "Rowery" });
    expect(obraz).toHaveAttribute("src", "https://cdn.example/rowery.jpg");
  });

  it("kafel BEZ banera rysuje neutralną płytę zastępczą, nie <img>", () => {
    const { container } = narysuj(tresc({ source: "catalog" }), [
      { id: "kat-1", name: "Rowery", imageUrl: null, href: "/kategoria/rowery" },
    ]);
    expect(screen.queryByRole("img")).toBeNull();
    // Płyta zastępcza to `site-placeholder` (klasa neutralna, nie rola motywu).
    expect(container.querySelector(".site-placeholder")).not.toBeNull();
    // Nazwa kategorii stoi mimo braku banera.
    expect(screen.getByText("Rowery")).toBeInTheDocument();
  });

  it("każdy kafel jest ODNOŚNIKIEM do strony kategorii (/kategoria/{slug})", () => {
    narysuj(tresc({ source: "catalog" }), [
      { id: "kat-1", name: "Rowery", imageUrl: null, href: "/kategoria/rowery" },
    ]);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/kategoria/rowery");
    // Nazwa i baner są WEWNĄTRZ jednego celu kliknięcia.
    expect(within(link).getByText("Rowery")).toBeInTheDocument();
  });

  it("kafel BEZ href (podgląd kreatora) zostaje statyczny — brak linku", () => {
    narysuj(tresc({ source: "catalog" }), [
      { id: "kat-1", name: "Rowery", imageUrl: null },
    ]);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Rowery")).toBeInTheDocument();
  });
});

describe("źródło treści: katalog kontra wybór ręczny", () => {
  it("źródło „katalog” pokazuje WSZYSTKIE kategorie w kolejności katalogu", () => {
    narysuj(tresc({ source: "catalog" }), kategorie(3));
    expect(pokazaneNazwy()).toEqual(["Kategoria 1", "Kategoria 2", "Kategoria 3"]);
  });

  it("wybór ręczny pokazuje WSKAZANE kategorie w KOLEJNOŚCI OPERATORA", () => {
    narysuj(
      tresc({
        source: "picked",
        items: [{ categoryId: "kat-3" }, { categoryId: "kat-1" }],
      }),
      kategorie(3),
    );
    expect(pokazaneNazwy()).toEqual(["Kategoria 3", "Kategoria 1"]);
  });

  it("wskazanie na kategorię USUNIĘTĄ wypada, a reszta sekcji stoi", () => {
    narysuj(
      tresc({
        source: "picked",
        items: [{ categoryId: "kat-2" }, { categoryId: "brak" }, { categoryId: "kat-1" }],
      }),
      kategorie(3),
    );
    expect(pokazaneNazwy()).toEqual(["Kategoria 2", "Kategoria 1"]);
  });
});

describe("stan pusty", () => {
  it("sekcja bez kategorii pokazuje ZDANIE stanu pustego, nie pustą ramkę", () => {
    narysuj(tresc({ source: "catalog" }), []);
    expect(screen.getByText(L.categoriesEmpty)).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("wybór wskazujący same usunięte kategorie też daje stan pusty", () => {
    narysuj(
      tresc({ source: "picked", items: [{ categoryId: "brak-1" }, { categoryId: "brak-2" }] }),
      kategorie(2),
    );
    expect(screen.getByText(L.categoriesEmpty)).toBeInTheDocument();
  });
});
