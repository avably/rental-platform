/**
 * Adres strony najemcy — reguły SLUGA (Faza 2 kreatora, ADR-157).
 *
 * Do 0072 wiersz `sites` był WERSJĄ jednej strony sklepu (kolumna `name`
 * opisana wprost jako „nazwa wersji widoczna wyłącznie w panelu"). Od 0073
 * wiersz jest STRONĄ i ma własny adres: `/{slug}`. Ta zmiana znaczenia jest
 * darmowa dokładnie tak długo, jak długo nie ma płacącego najemcy.
 *
 * DLACZEGO LISTA ZAREZERWOWANA MUSI ISTNIEĆ. W routingu Next statyczny
 * segment ZAWSZE wygrywa z dynamicznym. Strona najemcy o slugu `koszyk` czy
 * `regulamin` nie wyświetliłaby się nigdy — bez błędu, bez logu, bez żadnego
 * sygnału dla operatora, który przecież widzi ją w panelu jako opublikowaną.
 * Odmowa musi paść w POLU FORMULARZA, z uzasadnieniem, zanim cokolwiek
 * zostanie zapisane.
 *
 * DLACZEGO LISTA ŻYJE TU, a nie tylko w Zodzie panelu: bramka musi stać
 * W BAZIE (surowe API PostgREST ma tę samą drogę do tabeli co formularz),
 * a baza nie umie zaimportować stałej z TypeScriptu. Stąd ten sam wzorzec, co
 * przy subdomenach platformy (0023) i slugach kategorii (0072): lista żyje
 * w DWÓCH miejscach — tu i w `app.reserved_page_slugs()` — a zgodności obu
 * zbiorów pilnuje `packages/db/test/site-page-slugs.test.ts`.
 */
import { RESERVED_CATEGORY_SLUGS } from "../catalog/categories";

/**
 * Slug STRONY GŁÓWNEJ sklepu — pusty string, bo jej adresem jest goły `/`.
 *
 * DLACZEGO SENTINEL, A NIE KOLUMNA `kind`. Strona główna musi dać się odróżnić
 * od stron treściowych, bo `/` rewrite'uje się na nią, a `/{slug}` na resztę.
 * Rozważone i odrzucone: kolumna `kind` (dana WIDOCZNA PUBLICZNIE, więc kosztuje
 * bliźniaka `*_published`, wpis u strażnika i test — komplet, którego pusty
 * string nie potrzebuje) oraz `tenants.home_site_id` (ta sama cena plus klucz
 * obcy w drugą stronę). Pusty slug niesie dokładnie tę samą informację i mieści
 * się w kolumnie, która i tak musiała powstać.
 *
 * Konsekwencja, na którą trzeba uważać: unikat `(tenant_id, slug_published)`
 * po stronie żywej daje najwyżej JEDNĄ żywą stronę główną na najemcę — czyli
 * dokładnie ten niezmiennik, który do 0072 wisiał na
 * `sites_one_live_per_tenant_idx`.
 */
export const HOME_PAGE_SLUG = "";

/** Maksymalna długość sluga — lustro CHECK-a `sites_slug_shape` (0073). */
export const PAGE_SLUG_MAX_LENGTH = 60;

/**
 * Kształt sluga strony: małe litery ASCII, cyfry i pojedyncze myślniki
 * w środku. LUSTRO CHECK-a `sites_slug_shape` z migracji 0073 — wzorzec musi
 * być ten sam po obu stronach, inaczej formularz przepuszczałby wartość,
 * którą baza i tak odrzuci surowym 23514.
 *
 * Wzorzec NIE dopuszcza pustego stringa: `HOME_PAGE_SLUG` jest osobną gałęzią
 * i w bazie, i tutaj (patrz `isValidPageSlug`). Inaczej pusty slug wpadłby do
 * formularza jako „poprawny" i operator wyprodukowałby drugą stronę główną.
 */
export const PAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Pierwsze segmenty ścieżki, których slug strony nie może przejąć.
 *
 * Zbiór jest NADZBIOREM `RESERVED_CATEGORY_SLUGS` i to nie jest przypadek:
 * tamta lista jest pilnowana przez
 * `apps/storefront/test/reserved-category-slugs.test.ts`, który czyta DRZEWO
 * TRAS sklepu. Dziedzicząc ją, strony dostają tę samą bramkę anty-gnilną za
 * darmo — nowa trasa `app/(tenant)/rezerwacja` pali tamten test, wpis trafia
 * do listy kategorii, a strony są chronione bez osobnego przypomnienia.
 *
 * Dziś oba zbiory są RÓWNE i to jest stan docelowy, nie niedoróbka: pierwszy
 * segment ścieżki jest jeden dla całego sklepu, więc kategoria i strona biją
 * się dokładnie o te same słowa. Osobna stała (i osobna funkcja w bazie)
 * istnieje, bo cykle życia obu list są różne — strony kategorii z Fazy 7
 * schodzą piętro niżej (`/kategoria/{slug}`) i przestaną rezerwować korzeń,
 * a strony treściowe będą go rezerwować dalej. Nadzbiór pilnuje testem
 * `packages/core/src/site/page-slug.test.ts`.
 *
 * Czego tu świadomie NIE MA: `/sitemap.xml`, `/robots.txt`, `/favicon.ico`,
 * `/.well-known/*` i `/_next/*`. Kropka i podkreślenie nie przechodzą przez
 * `PAGE_SLUG_PATTERN`, więc żaden slug nigdy się z nimi nie zetknie — wpis
 * odbierałby najemcy adres, nie broniąc niczego.
 */
export const RESERVED_PAGE_SLUGS: readonly string[] = [...RESERVED_CATEGORY_SLUGS].sort();

/** Czy slug jest zarezerwowany (porównanie po normalizacji, jak w bazie). */
export function isReservedPageSlug(slug: string): boolean {
  return RESERVED_PAGE_SLUGS.includes(slug.trim().toLowerCase());
}

/**
 * Czy slug jest w ogóle zapisywalny w kolumnie `sites.slug` — lustro CHECK-a,
 * NIE bramki rezerwacji. Strona główna (pusty slug) przechodzi.
 */
export function isValidPageSlug(slug: string): boolean {
  if (slug === HOME_PAGE_SLUG) return true;
  return slug.length <= PAGE_SLUG_MAX_LENGTH && PAGE_SLUG_PATTERN.test(slug);
}

/**
 * Propozycja sluga z nazwy strony — NORMALIZUJE, nie odrzuca.
 *
 * „Rowery górskie" → `rowery-gorskie`. Diakrytyki rozkładamy przez NFD
 * i zdejmujemy znaki łączące (`ą` → `a`), bo `toLowerCase()` sam z siebie
 * zostawia je nietknięte. „ł" nie ma postaci rozłożonej i wymaga jawnego
 * podstawienia — inaczej „łódki" dałoby „dki".
 *
 * Wynikiem może być pusty string (nazwa złożona wyłącznie ze znaków, które
 * odpadają — np. „???"). Wołający MUSI to sprawdzić: pusty slug znaczy stronę
 * główną, a nie „dowolny adres".
 */
export function suggestPageSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PAGE_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * ŚCIEŻKA PUBLICZNA strony — JEDYNE miejsce, w którym adres strony powstaje
 * ze sluga.
 *
 * Do Fazy 2 każda trasa sklepu podawała swoją ścieżkę z ręki
 * (`pathname: "/store"`, `` `/product/${id}` ``). Przy N stronach jedno
 * przeoczenie daje tę samą treść pod dwoma adresami — a duplikat kanoniczny
 * jest dokładnie tą klasą błędu, której najemca nigdy nie zauważy sam.
 * Kanon, sitemapa i „zobacz stronę" w panelu liczą adres TĄ funkcją.
 */
export function pagePathFromSlug(slug: string): string {
  return slug === HOME_PAGE_SLUG ? "/" : `/${slug}`;
}

/**
 * WEWNĘTRZNA trasa renderująca stronę treściową — cel rewrite'u z proxy.
 *
 * Trasy `app/(tenant)/[slug]` NIE DA SIĘ dodać obok `app/[locale]`: Next 16
 * rzuca twardy błąd builda przy dwóch różnych nazwach parametru na tym samym
 * poziomie ścieżki. Dlatego cel rewrite'u siedzi PIĘTRO NIŻEJ, pod segmentem,
 * który i tak jest zarezerwowany (`store`) — i nie dokłada ani jednego nowego
 * słowa do listy rezerwacji.
 *
 * Adres wewnętrzny nigdy nie jest adresem publicznym: proxy oddaje neutralne
 * 404 na bezpośrednie wejście w `/store/<cokolwiek>`, a kanon strony liczy
 * `pagePathFromSlug`.
 */
export function internalPagePathname(slug: string): string {
  return `${INTERNAL_PAGE_PREFIX}/${slug}`;
}

/** Prefiks trasy wewnętrznej — patrz `internalPagePathname`. */
export const INTERNAL_PAGE_PREFIX = "/store";
