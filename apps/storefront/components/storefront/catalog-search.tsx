/**
 * POLE WYSZUKIWANIA KATALOGU (domknięcie B1, ADR-263; toolbar listingu — F9).
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
 * ==================== JEDNO POLE, DWIE STRONY LISTINGU (F9) ====================
 *
 * Pole stoi w toolbarze KATALOGU i strony KATEGORII (mandat właściciela:
 * „search widoczny"). Backend wyszukiwania jest GLOBALNY (`p_query` w
 * `get_public_catalog_page`, ADR-263) — funkcja strony kategorii filtra
 * tekstowego nie ma — więc na kategorii pole też celuje w `/katalog`,
 * a placeholder mówi to WPROST („Szukaj w całym katalogu…"), zamiast udawać
 * zawężenie do półki, którego nie będzie.
 *
 * Wartość pola jest NIEKONTROLOWANA (`defaultValue`) — komponent nie potrzebuje
 * stanu klienta, bo źródłem prawdy jest adres (`?q=`), a nie React.
 */
import { CATALOG_PATH_SEGMENT } from "@avably/core";

import { CATALOG_SEARCH_PARAM } from "@/lib/catalog/catalog-search";
import type { StorefrontCopy } from "@/lib/storefront/copy";

export function CatalogSearch({
  copy,
  query,
  placeholder,
}: {
  copy: StorefrontCopy;
  query: string;
  /** Nadpisanie placeholderu (strona kategorii); domyślnie tekst katalogu. */
  placeholder?: string;
}) {
  return (
    <form
      data-catalog-search
      role="search"
      method="get"
      action={`/${CATALOG_PATH_SEGMENT}`}
      // Pole ROŚNIE do szerokości kolumny (na telefonie pełna szerokość),
      // z sufitem na szerokim kontenerze — search ma być widoczny, ale nie
      // ma rozpychać toolbara ponad kolumnę treści (F9).
      className="flex w-full min-w-0 grow items-center gap-2 @min-[40rem]/site:max-w-md"
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
        placeholder={placeholder ?? copy.catalog.searchPlaceholder}
        autoComplete="off"
        // 44 px wysokości — cel dotykowy na równi z selectem sortowania obok.
        className="site-field h-11 w-full min-w-0 px-3 text-sm"
      />
      <button
        type="submit"
        className="site-cta flex h-11 shrink-0 cursor-pointer items-center text-sm font-semibold"
      >
        {copy.catalog.searchSubmit}
      </button>
      {query.length > 0 ? (
        // Wyczyść = powrót pod czysty adres katalogu (bez `?q=`).
        <a
          data-catalog-search-clear
          href={`/${CATALOG_PATH_SEGMENT}`}
          className="site-link shrink-0 text-sm underline"
        >
          {copy.catalog.searchClear}
        </a>
      ) : null}
    </form>
  );
}
