/**
 * ADRES SPRZĘTU — reguły sluga pozycji katalogu (ADR-182, migracja 0083).
 *
 * ==================== PO CO SPRZĘTOWI WŁASNY ADRES ====================
 *
 * Do fazy 5 strona sprzętu stała pod `/product/{uuid}`. Identyfikator nie
 * niesie ani jednego słowa, po którym ktokolwiek szuka sprzętu, a jest tym
 * fragmentem strony, który wyszukiwarka czyta jako pierwszy — dokument
 * architektury stron nazwał to wprost: „bez sluga strona produktu nie ma szans
 * w Google". Adres jest tu funkcją sprzedażową, nie kosmetyką.
 *
 * ==================== GDZIE STOI BRAMKA ====================
 *
 * W BAZIE, nie w formularzu: surowe API PostgREST ma tę samą drogę do tabeli
 * co panel, a adres nadaje trigger `products_slug_guard` (0083) także wtedy,
 * gdy piszący nie podał żadnego sluga. Reguły tutaj są LUSTREM CHECK-a
 * `products_slug_shape` i funkcji `app.slugify` — po to, żeby formularz nie
 * przepuszczał wartości, którą baza i tak odrzuci surowym 23514. Zgodności obu
 * stron pilnuje `packages/db/test/product-slug.test.ts`.
 *
 * ==================== CZEGO TU NIE MA I DLACZEGO ====================
 *
 * NIE MA LISTY ADRESÓW ZAREZERWOWANYCH. Adres sprzętu jest DRUGIM segmentem
 * ścieżki (`/produkt/{slug}`), a pod `/produkt` nie stoi ani jedna trasa
 * systemowa — `/produkt/cart` nie ma z czym kolidować. Rezerwacja odbierałaby
 * najemcy adres, nie broniąc niczego. Zarezerwowany jest sam segment
 * `produkt`, i to po stronie adresów STRON (RESERVED_CATEGORY_SLUGS →
 * RESERVED_PAGE_SLUGS), bo statyczna trasa Next zawsze wygrywa z dynamiczną.
 *
 * NIE MA WARIANTU „ADRES PUSTY". Strona główna sklepu ma sentinel pustego
 * sluga (`HOME_PAGE_SLUG`), bo jej adresem jest goły `/`. Sprzęt takiego stanu
 * nie ma: pozycja bez adresu byłaby pozycją, do której nie da się dojść.
 */
import { slugifyName } from "../slug";

/** Maksymalna długość adresu — lustro CHECK-a `products_slug_shape` (0083). */
export const PRODUCT_SLUG_MAX_LENGTH = 60;

/**
 * Kształt adresu sprzętu: małe litery ASCII, cyfry i pojedyncze myślniki
 * w środku. LUSTRO CHECK-a `products_slug_shape` z migracji 0083.
 *
 * Bez znaków diakrytycznych świadomie: adres z „ą" w połowie klientów kończy
 * jako procentowa papka w pasku i w linku wklejonym na Facebooku.
 */
export const PRODUCT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Pierwszy segment adresu strony sprzętu. Polski, bo sklep najemcy jest
 * jednojęzyczny — oś marketingowa `/pl` i `/en` to inna powierzchnia.
 */
export const PRODUCT_PATH_SEGMENT = "produkt";

/**
 * Segment adresu SPRZED ADR-182 (`/product/{uuid}`). Zostaje w kodzie jako
 * nazwana stała, a nie literał rozsiany po trasach: pod tym adresem stoją
 * linki wklejone przez klientów najemcy i wpisy w indeksie wyszukiwarki, więc
 * trasa musi dalej istnieć i oddawać 308 — patrz
 * `apps/storefront/app/(tenant)/product/[id]`.
 */
export const LEGACY_PRODUCT_PATH_SEGMENT = "product";

/**
 * ŚCIEŻKA PUBLICZNA strony sprzętu — JEDYNE miejsce, w którym adres powstaje
 * ze sluga.
 *
 * Do ADR-182 każda powierzchnia podawała ścieżkę z ręki (`` `/product/${id}` ``
 * w karcie katalogu, w koszyku, w sitemapie, w kanonie i w JSON-LD). Przy
 * zmianie adresu jedno przeoczenie daje tę samą treść pod dwoma adresami —
 * a duplikat kanoniczny jest dokładnie tą klasą błędu, której najemca nigdy
 * nie zauważy sam.
 */
export function productPathFromSlug(slug: string): string {
  return `/${PRODUCT_PATH_SEGMENT}/${slug}`;
}

/** Adres ZASTANY sprzętu (sprzed ADR-182) — cel 308, nigdy kanon. */
export function legacyProductPath(productId: string): string {
  return `/${LEGACY_PRODUCT_PATH_SEGMENT}/${productId}`;
}

/**
 * Czy adres jest w ogóle zapisywalny w kolumnie `products.slug` — lustro
 * CHECK-a, NIE bramki historii. Pusty string NIE przechodzi (patrz nagłówek).
 */
export function isValidProductSlug(slug: string): boolean {
  return (
    slug.length > 0 && slug.length <= PRODUCT_SLUG_MAX_LENGTH && PRODUCT_SLUG_PATTERN.test(slug)
  );
}

/**
 * Propozycja adresu z nazwy sprzętu — NORMALIZUJE, nie odrzuca.
 *
 * „Rower górski 26"" → `rower-gorski-26`. Reguła jest wspólna dla wszystkich
 * slugów w repo (`slugifyName`) i ma LUSTRO w bazie (`app.slugify`, 0083),
 * bo to baza nadaje adres pozycji wstawionej bez sluga — w oknie wdrożeniowym
 * robi to panel SPRZED tej zmiany, który o adresie nic nie wie.
 *
 * Wynikiem może być pusty string (nazwa złożona wyłącznie ze znaków, które
 * odpadają — np. „???"). Wołający MUSI to sprawdzić: dla sprzętu pusty adres
 * nie jest wartością, tylko brakiem propozycji — baza podstawi wtedy własną
 * (`sprzet`), tak jak robi to `app.product_slug_candidate`.
 */
export function suggestProductSlug(name: string): string {
  return slugifyName(name, PRODUCT_SLUG_MAX_LENGTH);
}

/**
 * Rejestr adresów sprzętu najemcy — koperta `app.get_public_product_slugs`
 * (0083).
 *
 * Osobna koperta, a nie klucz w katalogu: migracje jadą na produkcję PRZED
 * kodem, a koperty publicznego odczytu są po stronie sklepu parsowane
 * `.strict()`. Nowy klucz w kopercie katalogu położyłby sklep KAŻDEGO najemcy
 * na czas okna wdrożeniowego; nowa funkcja nie ma jak niczego zepsuć, bo
 * w oknie NIKT jej nie woła (ten sam argument, co ADR-171 dla wyglądu).
 */
export interface ProductSlugRegistry {
  /** Adresy pozycji obecnych w katalogu publicznym. */
  products: { id: string; slug: string }[];
  /** Stare adresy → adres bieżący; 308. */
  redirects: { from: string; to: string }[];
}

/**
 * Rozstrzygnięcie adresu `/produkt/{slug}` wobec rejestru.
 *
 * Trzy odpowiedzi i ani jednej więcej — to jest cały kontrakt trasy sklepu:
 *   • `product` — adres bieżący, renderujemy pozycję;
 *   • `redirect` — adres STARY, oddajemy 308 pod adres bieżący;
 *   • `null` — adres nieznany, 404.
 *
 * PIERWSZEŃSTWO MA ADRES BIEŻĄCY. Sprzęt, który wrócił pod swój dawny adres,
 * ma go w `products`, a trigger 0083 kasuje wtedy wpis historii — ale gdyby
 * rejestr kiedykolwiek pokazał ten sam slug po obu stronach, pętla
 * „308 sam do siebie" byłaby awarią widoczną dopiero u klienta najemcy.
 * Kolejność sprawdzeń zamyka to z konstrukcji.
 *
 * Funkcja jest CZYSTA i mieszka w rdzeniu, a nie w trasie, bo tę samą decyzję
 * podejmuje trasa zastana (`/product/{uuid}` → 308) i podgląd w panelu.
 */
export type ProductSlugResolution =
  | { kind: "product"; productId: string; slug: string }
  | { kind: "redirect"; slug: string };

export function resolveProductSlug(
  registry: ProductSlugRegistry | null,
  slug: string,
): ProductSlugResolution | null {
  if (!registry) return null;

  const current = registry.products.find((entry) => entry.slug === slug);
  if (current) return { kind: "product", productId: current.id, slug: current.slug };

  const redirect = registry.redirects.find((entry) => entry.from === slug);
  if (redirect) return { kind: "redirect", slug: redirect.to };

  return null;
}

/** Adres bieżący pozycji o danym identyfikatorze — `null`, gdy rejestr go nie zna. */
export function productSlugById(
  registry: ProductSlugRegistry | null,
  productId: string,
): string | null {
  return registry?.products.find((entry) => entry.id === productId)?.slug ?? null;
}
