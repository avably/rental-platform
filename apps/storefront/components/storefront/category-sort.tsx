"use client";

/**
 * SORTOWANIE STRONY KATEGORII — NATYWNY `<select>` (F9; wcześniej ADR-247).
 *
 * ==================== DLACZEGO SELECT, A NIE LINKI ====================
 *
 * Do F9 cztery porządki stały jako rząd podkreślonych odnośników — na 360 px
 * łamały się na dwie linie i wyglądały jak akapit tekstu, nie kontrolka
 * (S-35; mandat właściciela: „sortowanie jako dropdown"). Natywny `<select>`
 * jest najlepszym patternem mobile (systemowa rolka/arkusz), dostępnym
 * z konstrukcji (klawiatura, czytnik, etykieta przez `<label for>`), i zajmuje
 * jeden wiersz niezależnie od liczby porządków.
 *
 * ==================== STAN ZOSTAJE W ADRESIE ====================
 *
 * Zmiana wartości NAWIGUJE pod `?sort=…` (router.push) — adres da się wkleić
 * i zaindeksować, a „wstecz" wraca do poprzedniego porządku; nawigacja stron
 * niesie sort dalej (`categoryPagePath`, bez zmian od ADR-247). ZMIANA SORTU
 * WRACA NA STRONĘ PIERWSZĄ: numer strony liczy się W PORZĄDKU („strona 3 wg
 * ceny" nie ma odpowiednika wg nazwy), więc cel nawigacji zawsze celuje
 * w stronę 1 — dokładnie ta sama reguła, co przy starych odnośnikach.
 *
 * ==================== BEZ JAVASCRIPTU TEŻ DZIAŁA ====================
 *
 * Kontrolka stoi w `<form method="get">` celującym w CZYSTY adres kategorii,
 * a przycisk „Zastosuj" istnieje wyłącznie w `<noscript>`: klient bez skryptów
 * wybiera porządek i wysyła formularz (GET → `?sort=…`), klient ze skryptami
 * nigdy przycisku nie widzi. `?sort=name` z formularza schodzi do adresu
 * czystego przez `parseCategorySortParam` + kanon (ADR-247) — duplikat nie
 * powstaje.
 */
import { useRouter } from "next/navigation";

import {
  categoryBasePath,
  categoryPagePath,
  CATEGORY_SORT_PARAM,
  CATEGORY_SORTS,
  type CategorySort as CategorySortValue,
} from "@/lib/catalog/category-path";
import type { StorefrontCopy } from "@/lib/storefront/copy";

function sortLabel(copy: StorefrontCopy, sort: CategorySortValue): string {
  switch (sort) {
    case "price_asc":
      return copy.category.sortPriceAsc;
    case "price_desc":
      return copy.category.sortPriceDesc;
    case "newest":
      return copy.category.sortNewest;
    case "name":
    default:
      return copy.category.sortName;
  }
}

export function CategorySort({
  copy,
  slug,
  active,
}: {
  copy: StorefrontCopy;
  slug: string;
  active: CategorySortValue;
}) {
  const router = useRouter();
  return (
    <form
      data-category-sort
      method="get"
      action={categoryBasePath(slug)}
      className="flex shrink-0 items-center gap-2"
    >
      {/* Widoczna etykieta kontrolki — „Sortuj:" (dwukropek to interpunkcja). */}
      <label htmlFor="category-sort" className="site-text-muted shrink-0 text-sm">
        {copy.category.sortLabel}:
      </label>
      <select
        data-category-sort-select
        id="category-sort"
        name={CATEGORY_SORT_PARAM}
        value={active}
        onChange={(event) =>
          router.push(categoryPagePath(slug, 1, event.currentTarget.value as CategorySortValue))
        }
        // Tokeny motywu (`site-field`), 44 px wysokości — cel dotykowy WCAG;
        // strzałkę rysuje system (natywny select), stąd zapas `pr-8`.
        className="site-field h-11 cursor-pointer px-3 pr-8 text-sm"
      >
        {CATEGORY_SORTS.map((sort) => (
          <option key={sort} data-category-sort-option={sort} value={sort}>
            {sortLabel(copy, sort)}
          </option>
        ))}
      </select>
      <noscript>
        <button
          type="submit"
          className="site-cta flex h-11 cursor-pointer items-center text-sm font-semibold"
        >
          {copy.category.sortApply}
        </button>
      </noscript>
    </form>
  );
}
