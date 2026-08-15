/**
 * Taksonomia katalogu — reguły SLUGA kategorii (ADR-155).
 *
 * Kategoria najemcy dostanie w Fazie 7 własny adres w sklepie
 * (`/kategoria/{slug}`), ale jej slug jest niebezpieczny JUŻ TERAZ: gdyby
 * najemca nazwał kategorię `checkout`, `cart` albo `pl`, przejąłby pierwszy
 * segment ścieżki, pod którym storefront trzyma trasę systemową — i to bez
 * żadnego błędu, po cichu, dopiero w chwili wdrożenia stron kategorii.
 *
 * DLACZEGO LISTA JEST TUTAJ, a nie tylko w Zodzie panelu: bramka musi stać
 * W BAZIE (surowe API PostgREST ma tę samą drogę do tabeli co formularz), a
 * baza nie umie zaimportować stałej z TypeScriptu. Stąd ten sam wzorzec, co
 * przy subdomenach platformy (0023, RESERVED_SUBDOMAINS): lista żyje w DWÓCH
 * miejscach — tu i w `app.reserved_store_paths()` — a zgodności obu zbiorów
 * pilnuje `packages/db/test/catalog-categories.test.ts`. Dopisanie wpisu tylko
 * po jednej stronie pali CI.
 *
 * SKĄD SIĘ WZIĘŁY TE WPISY (nie z pamięci — z drzewa tras):
 *   * `apps/storefront/app/(tenant)/*` — trasy sklepu najemcy,
 *   * `api`, `embed` — trasy platformowe stojące w korzeniu KAŻDEGO hosta,
 *   * `en`, `pl` (LOCALES) — dynamiczny segment `[locale]` osi marketingowej
 *     dopasowuje się na każdym hoście, także tenanckim (patrz proxy.ts:
 *     „statyczne segmenty grupy (tenant) wygrywają z dynamicznym [locale]",
 *     czyli segment, którego w (tenant) NIE MA, wpada w gałąź marketingową),
 *   * `kategoria`, `category` — prefiks przyszłych stron kategorii; rezerwacja
 *     z wyprzedzeniem kosztuje jedno słowo, a odebranie najemcy działającego
 *     adresu po fakcie kosztuje jego SEO.
 *
 * Zgodność listy z drzewem tras sprawdza
 * `apps/storefront/test/reserved-category-slugs.test.ts` — nowa trasa sklepu
 * bez wpisu tutaj też pali CI, więc lista nie gnije w miarę rozrostu sklepu.
 */
import { LOCALES } from "../locale";
import { slugifyName } from "../slug";

/**
 * Pierwsze segmenty ścieżki, których slug kategorii nie może przejąć.
 * Posortowana, bez duplikatów — porównanie z bazą jest na ZBIORZE, ale
 * stabilna kolejność ułatwia czytanie diffu.
 */
export const RESERVED_CATEGORY_SLUGS: readonly string[] = [
  "api",
  "cart",
  "category",
  "checkout",
  "embed",
  // [ADR-186] `/katalog` — pełna lista sprzętu ze stronicowaniem. Bez tego
  // wpisu kategoria (a przez nadzbiór także STRONA) o slugu `katalog` przejęłaby
  // trasę, której routing Next i tak rozstrzyga na korzyść segmentu statycznego.
  "katalog",
  "kategoria",
  "privacy",
  "product",
  // [ADR-182] `/produkt/{slug}` — adres strony sprzętu. Angielskie `product`
  // ZOSTAJE: stare adresy dostają 308, więc ta trasa dalej istnieje.
  "produkt",
  "prywatnosc",
  "regulamin",
  "store",
  "terms",
  ...LOCALES,
].sort();

/** Maksymalna długość sluga — lustro CHECK-a `catalog_categories_slug_shape`. */
export const CATEGORY_SLUG_MAX_LENGTH = 60;

/** Maksymalna długość nazwy — lustro CHECK-a `catalog_categories_name_length`. */
export const CATEGORY_NAME_MAX_LENGTH = 80;

/** Maksymalna długość opisu — lustro CHECK-a `catalog_categories_description_length`. */
export const CATEGORY_DESCRIPTION_MAX_LENGTH = 500;

/**
 * Kształt sluga: małe litery ASCII, cyfry i pojedyncze myślniki w środku.
 * LUSTRO CHECK-a `catalog_categories_slug_shape` z migracji 0072 — wzorzec
 * musi być ten sam po obu stronach, inaczej formularz przepuszczałby wartość,
 * którą baza i tak odrzuci surowym 23514.
 *
 * Bez znaków diakrytycznych świadomie: slug jest częścią adresu, a adres
 * z „ą" w połowie klientów kończy jako procentowa papka w pasku i w linku
 * wklejonym na Facebooku.
 */
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Czy slug jest zarezerwowany (porównanie po normalizacji, jak w bazie). */
export function isReservedCategorySlug(slug: string): boolean {
  return RESERVED_CATEGORY_SLUGS.includes(slug.trim().toLowerCase());
}

/**
 * Propozycja sluga z nazwy kategorii — WYŁĄCZNIE podpowiedź dla formularza.
 * Operator może ją nadpisać, a bramką i tak jest baza.
 *
 * Regułę normalizacji niesie `slugifyName` (packages/core/src/slug.ts) —
 * WSPÓLNA z adresem strony i sprzętu od ADR-182. Ta funkcja zostaje jako
 * miejsce, w którym stoi limit długości sluga KATEGORII.
 */
export function suggestCategorySlug(name: string): string {
  return slugifyName(name, CATEGORY_SLUG_MAX_LENGTH);
}
