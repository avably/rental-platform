/**
 * KATEGORIE W BELCE SKLEPU — IKONA Z ROZWIJANĄ LISTĄ (F7b).
 *
 * ==================== TRZY FORMY W TRZECH TYGODNIACH ====================
 *
 * ADR-247 dał rozwijane menu przy znaku firmy. F7 zamieniło je na DRUGI RZĄD
 * belki (pozioma listwa + przewijane chipsy na telefonie), bo z benchmarku
 * wyszło, że kategorie mają być widoczne bez kliknięcia. Właściciel obejrzał
 * to na produkcji i rozstrzygnął inaczej: „w belce tylko ikony z jednym
 * wyjątkiem" — listwa i chipsy z belki WYPADAJĄ.
 *
 * To NIE jest powrót do ADR-247 z nazwą F7b. Wniosek z benchmarku został
 * spełniony, tylko w innym miejscu: kategorie widoczne bez kliknięcia stoją
 * teraz w TREŚCI listingu (kolumna po lewej na `/katalog` i `/kategoria/*`,
 * a poniżej progu — przewijany rząd nad sortowaniem; patrz
 * `listing-categories.tsx`). Belka niesie wyłącznie WEJŚCIE do półek, dostępne
 * z każdej trasy sklepu — także z kasy i z dokumentów prawnych, gdzie kolumny
 * listingu nie ma.
 *
 * ==================== DLACZEGO `<details>` ====================
 *
 * Te same powody, co przy ADR-247: trasa bywa statyczna, CSP nie ma
 * `unsafe-inline`, a natywny element daje `aria-expanded`, obsługę klawiatury
 * i stan otwarcia BEZ linijki skryptu — więc serwer i klient nie mają jak się
 * rozjechać na pierwszym renderze. Komponent zostaje serwerowy.
 *
 * Panel w warstwie `absolute` (otwarcie nie przesuwa belki), klampowany
 * techniką S-01: poniżej 64 rem rozpina się na szerokość WIERSZA belki
 * (kotwica `relative` w `StoreShellHeader`), od 64 rem staje pod wyzwalaczem.
 * Rozdział powierzchni robi obrys karty, nie cień.
 *
 * Znacznik `data-store-category-menu` ZOSTAJE na korzeniu — to na nim wiszą
 * kontrakty tras („nawigacja do oferty stoi na każdej trasie", S-30).
 *
 * KOMPONENT JEST GŁUPI: dostaje gotowe pozycje i napisy, nie zna katalogu.
 * Regułę „które kategorie" (guard pustych) trzyma `categoryNavItems`.
 */
import { CATALOG_PATH_SEGMENT } from "@avably/core";
import { StoreGlyph } from "@avably/ui";
import Link from "next/link";

import type { CategoryNavItem } from "@/lib/catalog/category-nav";

/**
 * Wiersz rozwijanej listy: 44 px celu dotykowego (S-15 — text-sm 20 px
 * + 2 × 12 px paddingu), bieżąca półka akcentem i wagą (aria-current, WCAG
 * 2.4.8) — kolor nie jest jedynym nośnikiem stanu.
 */
const ROW =
  "site-menu-link block rounded px-3 py-3 text-sm " +
  "aria-[current=page]:font-semibold aria-[current=page]:text-[color:var(--site-accent-text)]";

function currentFor(href: string, currentPath?: string): "page" | undefined {
  return currentPath !== undefined && currentPath === href ? "page" : undefined;
}

export function StoreCategoryMenu({
  items,
  label,
  allCategoriesLabel,
  currentPath,
}: {
  items: readonly CategoryNavItem[];
  /** Nazwa dostępna wyzwalacza w języku SKLEPU (oś tenancka), np. „Kategorie". */
  label: string;
  /**
   * Napis ostatniej pozycji listy („Wszystkie kategorie") — prowadzi do
   * PEŁNEGO katalogu (`/katalog`). Do F7b brzmiał „Cały katalog"; właściciel
   * nazwał tę pozycję wprost, bo stoi ona pod listą KATEGORII i odpowiada na
   * pytanie „a gdzie reszta półek", nie „gdzie cennik".
   */
  allCategoriesLabel: string;
  /**
   * PUBLICZNA ŚCIEŻKA BIEŻĄCEJ STRONY (S-52) — pozycja o tym adresie dostaje
   * `aria-current="page"`. Podaje ją trasa (tylko ona zna swój adres);
   * brak = lista bez oznaczeń, jak stopka.
   */
  currentPath?: string;
}) {
  // Bez pozycji nie ma wyzwalacza: ikona otwierająca pustą listę obiecywałaby
  // nawigację, której nie ma. Guard stoi też w wołającym (powłoka nie renderuje
  // komponentu dla pustej listy), ale i tutaj — komponent poprawny sam w sobie
  // nie zależy od tego, że ktoś go nie zawołał na próżno.
  if (items.length === 0) return null;

  const catalogHref = `/${CATALOG_PATH_SEGMENT}`;

  return (
    /*
      `<div>`, nie `<nav>` (F7b): landmark nawigacji o nazwie „Kategorie" stoi
      od tego zadania w TREŚCI listingu (kolumna kategorii). Drugi landmark
      o tej samej nazwie w belce byłby dla czytnika ekranu dwoma nawigacjami
      nie do rozróżnienia po nazwie. Wyzwalacz `<details>` jest widgetem
      rozwijanym i nazwę niesie sam (`aria-label` na `<summary>`).
    */
    <div data-store-category-menu className="shrink-0">
      <details data-store-category-dropdown className="group static @min-[64rem]/site:relative">
        {/* Wyzwalacz 44 × 44 px (S-15) — sam znak, z nazwą dostępną. */}
        <summary
          aria-label={label}
          className="site-menu-link flex h-11 w-10 cursor-pointer list-none items-center justify-center rounded @min-[40rem]/site:w-11 [&::-webkit-details-marker]:hidden"
        >
          <StoreGlyph name="categories" className="h-5 w-5" />
        </summary>
        {/*
          PANEL LISTY. `hidden group-open:block` DUBLUJE natywne chowanie
          `details` ŚWIADOMIE (ta sama lekcja, co w panelu wyszukiwania):
          Chrome trzyma treść zamkniętego `details` w `content-visibility`
          i dalej liczy jej layout, przez co sondy geometrii (bramka overflow
          w shot.mjs) widzą „wystające" wiersze, których żaden użytkownik nie
          widzi. `display: none` zeruje geometrię zamkniętego panelu, a po
          otwarciu nie zmienia niczego.

          KLAMP: pionowo `max-h` + przewijanie (katalog o trzydziestu półkach
          nie może wyjechać poza okno), poziomo — patrz docblock pliku.
        */}
        <div className="site-card absolute left-0 right-0 top-full z-40 mt-2 hidden max-h-[60vh] overflow-auto p-1 group-open:block @min-[64rem]/site:left-auto @min-[64rem]/site:right-0 @min-[64rem]/site:w-64">
          <ul className="flex list-none flex-col p-0">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={ROW}
                  aria-current={currentFor(item.href, currentPath)}
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
          {/*
            SEPARATOR PRZED WEJŚCIEM DO KATALOGU: „Wszystkie kategorie" nie
            jest kolejną półką, tylko wyjściem o piętro wyżej — kreska mówi to
            wcześniej niż przeczytanie napisu.
          */}
          <div className="site-rule-top mt-1 pt-1">
            <Link
              href={catalogHref}
              data-store-category-all
              className={ROW}
              aria-current={currentFor(catalogHref, currentPath)}
            >
              {allCategoriesLabel}
            </Link>
          </div>
        </div>
      </details>
    </div>
  );
}
