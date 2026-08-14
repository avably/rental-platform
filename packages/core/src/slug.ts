/**
 * NORMALIZACJA NAZWY NA ADRES — jedno miejsce dla wszystkich trzech slugów
 * (strona, kategoria, sprzęt) i dla lustra w bazie.
 *
 * DLACZEGO TO WYJECHAŁO DO OSOBNEGO PLIKU. Do ADR-182 ta sama reguła stała
 * dwa razy — w `suggestPageSlug` (site/page-slug.ts) i `suggestCategorySlug`
 * (catalog/categories.ts) — jako dwie kopie o identycznym ciele. Adres sprzętu
 * byłby kopią TRZECIĄ, a trzy kopie jednej reguły rozjeżdżają się nie „jeśli",
 * tylko „kiedy": pierwsza poprawka diakrytyków trafi w jedną z nich i nikt nie
 * zauważy, że dwie pozostałe zostały w tyle. Publiczne nazwy (`suggestPageSlug`,
 * `suggestCategorySlug`, `suggestProductSlug`) ZOSTAJĄ — każda z nich niesie
 * własny limit długości i własny kontekst, a wołający nie ma powodu wiedzieć,
 * że wnętrze jest wspólne.
 *
 * REGUŁA (musi być identyczna z `app.slugify` z migracji 0083):
 *   1. rozkład NFD i zdjęcie znaków łączących — `ą` → `a`, bo `toLowerCase()`
 *      sam z siebie zostawia je nietknięte;
 *   2. `ł` → `l` jawnie: „ł" nie ma postaci rozłożonej, więc bez tej linii
 *      „łódki" dałoby „dki";
 *   3. małe litery;
 *   4. wszystko spoza `[a-z0-9]` na pojedynczy myślnik;
 *   5. przycięcie myślników z brzegów, obcięcie do limitu, ponowne przycięcie
 *      myślnika z końca (obcięcie mogło zostawić go na granicy).
 *
 * Wynikiem MOŻE być pusty string (nazwa złożona wyłącznie ze znaków, które
 * odpadają — np. „???"). Wołający musi to sprawdzić: dla strony pusty slug
 * znaczy stronę główną, dla sprzętu — brak adresu.
 */

/** Normalizacja nazwy na kandydata adresu. Patrz nagłówek pliku. */
export function slugifyName(name: string, maxLength: number): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}
