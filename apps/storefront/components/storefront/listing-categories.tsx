/**
 * DRZEWO KATEGORII W TREŚCI LISTINGU (F7b, aneks właściciela 2026-08-25).
 *
 * ==================== PO CO, SKORO KATEGORIE SĄ W BELCE ====================
 *
 * Wyzwalacz w belce (`store-category-menu.tsx`) odpowiada na pytanie „gdzie są
 * półki" z KAŻDEJ trasy sklepu — także z kasy i z regulaminu. Nie odpowiada na
 * pytanie, które klient zadaje, stojąc już NA półce: „a co jeszcze macie".
 * Dyspozycja właściciela z benchmarku jest jednoznaczna: będąc w kategorii,
 * przełączenie na inną ma być JEDNYM klikiem — nie trzema (otwórz menu →
 * wybierz → czekaj).
 *
 * Dlatego lista półek stoi TU, w treści listingu, i to jest jedyne miejsce,
 * w którym kategorie widać bez otwierania czegokolwiek. F7 miało je w belce
 * (listwa + chipsy) i to właśnie zdjął właściciel — nie sam pomysł widocznych
 * kategorii, tylko ich miejsce.
 *
 * ==================== DWIE FORMY, JEDEN ZBIÓR POZYCJI ====================
 *
 *   • KOLUMNA (kontener ≥ 64 rem): pas ~15 rem po lewej stronie siatki
 *     wyników, z nagłówkiem i pionową listą. Nagłówek jest prawdziwym
 *     nagłówkiem sekcji (`h2` byłby drugim tytułem strony — S-36 — więc rolę
 *     nazwy niesie `aria-labelledby` na `<nav>`, a napis stoi jako zwykły
 *     element z klasą etykiety).
 *   • RZĄD (poniżej progu): przewijane poziomo pastylki NAD toolbarem sortu.
 *     Kolumna 15 rem na telefonie zjadłaby pół szerokości wyników, a lista
 *     pionowa zepchnęłaby ofertę pod ekran.
 *
 * Obie formy stoją w SSR; widoczną wybiera zapytanie KONTENEROWE
 * `@min-[64rem]/site:` (ADR-085) — podgląd i wąskie konteksty mierzą własną
 * szerokość, nie okno. Formy są dwie, bo element nie może stać w dwóch
 * miejscach dokumentu naraz; treść ma jedno źródło (`items`), więc nie mają
 * jak się rozjechać.
 *
 * ==================== LICZNIKI BEZ NOWEGO ODCZYTU ====================
 *
 * Pozycja nawigacji niesie już `count` (liczbę pozycji półki) — liczy go
 * `categoryNavItems` z `category_ids` katalogu albo oddaje wprost wąski odczyt
 * `app.get_public_category_nav` (ADR-266). Licznik rysuje więc KOLUMNA, gdzie
 * jest na niego miejsce, i ani jedno zapytanie nie dochodzi. W rzędzie
 * pastylek liczników NIE MA: pastylka „Agregaty (12)" jest o połowę szersza,
 * a rząd przewijany poziomo płaci za każdą literę jednym kliknięciem palca.
 *
 * KOMPONENT JEST GŁUPI: dostaje gotowe pozycje i napisy, nie zna katalogu.
 */
import { CATALOG_PATH_SEGMENT } from "@avably/core";
import { cn } from "@avably/ui";
import Link from "next/link";

import type { CategoryNavItem } from "@/lib/catalog/category-nav";

/** Wiersz kolumny: 44 px celu dotykowego (S-15), bieżąca półka akcentem. */
const COLUMN_LINK =
  "site-menu-link flex items-center justify-between gap-2 rounded px-3 py-3 text-sm " +
  "aria-[current=page]:font-semibold aria-[current=page]:text-[color:var(--site-accent-text)]";

/**
 * Pastylka rzędu: 44 px wysokości (h-11), obrys `--site-border`; bieżąca
 * dostaje obrys akcentu I wagę — kolor nie jest jedynym nośnikiem stanu.
 */
const ROW_LINK =
  "site-menu-link inline-flex h-11 shrink-0 snap-start items-center whitespace-nowrap " +
  "rounded-full border border-[color:var(--site-border)] px-4 text-sm " +
  "aria-[current=page]:font-semibold aria-[current=page]:border-[color:var(--site-accent)] " +
  "aria-[current=page]:text-[color:var(--site-accent-text)]";

function currentFor(href: string, currentPath: string): "page" | undefined {
  return currentPath === href ? "page" : undefined;
}

export interface ListingCategoriesProps {
  items: readonly CategoryNavItem[];
  /** Napis nagłówka/nazwy nawigacji („Kategorie") w języku SKLEPU. */
  heading: string;
  /** Napis wejścia do pełnego katalogu („Wszystkie kategorie") → `/katalog`. */
  allCategoriesLabel: string;
  /**
   * PUBLICZNA ŚCIEŻKA BIEŻĄCEJ STRONY — pozycja o tym adresie dostaje
   * `aria-current="page"` i wyróżnienie. Wymagana (nie opcjonalna, jak
   * w chrome): listing bez oznaczonej bieżącej półki byłby listą, w której
   * klient nie wie, gdzie stoi — a to jest cała wartość tej kolumny.
   */
  currentPath: string;
}

/** Identyfikator nagłówka kolumny — nazwa nawigacji przez `aria-labelledby`. */
const HEADING_ID = "listing-categories-heading";

/**
 * KOLUMNA KATEGORII (kontener ≥ 64 rem) — pierwsza kolumna siatki listingu.
 * Poniżej progu znika w całości (`hidden`), a jej rolę przejmuje `CategoryRow`.
 */
export function ListingCategoryColumn({
  items,
  heading,
  allCategoriesLabel,
  currentPath,
}: ListingCategoriesProps) {
  if (items.length === 0) return null;
  const catalogHref = `/${CATALOG_PATH_SEGMENT}`;

  return (
    <nav
      data-listing-categories-column
      aria-labelledby={HEADING_ID}
      className="hidden @min-[64rem]/site:block"
    >
      <p id={HEADING_ID} className="site-label px-3 text-sm">
        {heading}
      </p>
      <ul className="mt-1 flex list-none flex-col p-0">
        {/*
          „WSZYSTKIE KATEGORIE" NA GÓRZE, nie na dole (inaczej niż w belce):
          kolumna czyta się jak drzewo — korzeń pierwszy, półki pod nim. W belce
          ta sama pozycja domyka listę, bo tam jest wyjściem z rozwiniętego menu.
        */}
        <li>
          <Link
            href={catalogHref}
            className={COLUMN_LINK}
            aria-current={currentFor(catalogHref, currentPath)}
          >
            {allCategoriesLabel}
          </Link>
        </li>
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className={COLUMN_LINK}
              aria-current={currentFor(item.href, currentPath)}
            >
              <span className="min-w-0 truncate">{item.name}</span>
              {/*
                Licznik jest DANĄ POMOCNICZĄ, nie częścią nazwy odnośnika —
                stąd `aria-hidden`: czytnik ekranu czyta „Agregaty", nie
                „Agregaty 12". Liczba i tak stoi w nagłówku półki po wejściu.
              */}
              <span aria-hidden="true" className="site-text-muted shrink-0 text-xs tabular-nums">
                {item.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * RZĄD KATEGORII (kontener < 64 rem) — przewijane pastylki NAD toolbarem sortu.
 * Pasek przewijania schowany w obu silnikach; przewijalność sygnalizuje ścięta
 * pastylka na krawędzi, nie belka przewijania.
 */
export function ListingCategoryRow({
  items,
  heading,
  allCategoriesLabel,
  currentPath,
}: ListingCategoriesProps) {
  if (items.length === 0) return null;
  const catalogHref = `/${CATALOG_PATH_SEGMENT}`;

  return (
    <nav
      data-listing-categories-row
      aria-label={heading}
      className="@min-[64rem]/site:hidden"
    >
      <div
        className={cn(
          "flex snap-x gap-2 overflow-x-auto",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        <Link
          href={catalogHref}
          className={ROW_LINK}
          aria-current={currentFor(catalogHref, currentPath)}
        >
          {allCategoriesLabel}
        </Link>
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={ROW_LINK}
            aria-current={currentFor(item.href, currentPath)}
          >
            {item.name}
          </Link>
        ))}
      </div>
    </nav>
  );
}
