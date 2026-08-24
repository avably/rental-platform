/**
 * POLE WYSZUKIWANIA KATALOGU (domknięcie B1, ADR-263).
 *
 * ==================== FORMULARZ GET, NIE SKRYPT ====================
 *
 * Zwykły `<form method="get">` celujący w `/katalog`: wysłanie pola robi
 * NAWIGACJĘ pod `/katalog?q=…`, więc wyszukiwanie działa bez JavaScriptu, adres
 * wyników da się wkleić i wrócić do niego wstecz — spójnie z resztą sklepu (SSR,
 * nie SPA), tak jak nawigacja stron (ADR-186) i sort kategorii (ADR-247).
 *
 * NOWE WYSZUKIWANIE WRACA NA STRONĘ PIERWSZĄ. Formularz niesie WYŁĄCZNIE pole
 * `q`, więc wysłanie go NIE dokłada `strona` do adresu — a „strona 3 wyników
 * frazy A" nie ma sensownego odpowiednika po zmianie frazy (jak przy zmianie
 * sortu kategorii, ADR-247). Numer strony dokłada dopiero nawigacja wyników.
 *
 * Wartość pola jest NIEKONTROLOWANA (`defaultValue`) — komponent nie potrzebuje
 * stanu klienta, bo źródłem prawdy jest adres (`?q=`), a nie React.
 */
import { CATALOG_PATH_SEGMENT } from "@avably/core";

import { CATALOG_SEARCH_PARAM } from "@/lib/catalog/catalog-search";
import type { StorefrontCopy } from "@/lib/storefront/copy";

export function CatalogSearch({ copy, query }: { copy: StorefrontCopy; query: string }) {
  return (
    <form
      data-catalog-search
      role="search"
      method="get"
      action={`/${CATALOG_PATH_SEGMENT}`}
      className="mt-6 flex flex-wrap items-center gap-2"
    >
      {/* Etykieta dla czytnika ekranu — placeholder nie jest etykietą (WCAG 3.3.2). */}
      <label htmlFor="catalog-search-q" className="sr-only">
        {copy.catalog.searchLabel}
      </label>
      <input
        id="catalog-search-q"
        type="search"
        name={CATALOG_SEARCH_PARAM}
        defaultValue={query}
        placeholder={copy.catalog.searchPlaceholder}
        autoComplete="off"
        className="site-field h-10 w-full max-w-sm px-3 text-sm"
      />
      <button type="submit" className="site-cta h-10 cursor-pointer px-4 text-sm font-semibold">
        {copy.catalog.searchSubmit}
      </button>
      {query.length > 0 ? (
        // Wyczyść = powrót pod czysty adres katalogu (bez `?q=`).
        <a data-catalog-search-clear href={`/${CATALOG_PATH_SEGMENT}`} className="site-link text-sm underline">
          {copy.catalog.searchClear}
        </a>
      ) : null}
    </form>
  );
}
