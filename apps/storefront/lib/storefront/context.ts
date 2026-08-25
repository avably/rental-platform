/**
 * Kontekst renderu strony storefrontu tenanta (2.4b) — wspólny dla katalogu,
 * podstrony produktu, koszyka i checkoutu. Zbiera to, czego każda z tych stron
 * i tak potrzebuje: tenant_id z nagłówka, publiczny katalog, opublikowany
 * szablon site'u i locale/copy tenanta.
 *
 * BRAMKA (jak store/page 2.3b): tenant_id WYŁĄCZNIE z nagłówka wstrzykniętego
 * przez middleware (ADR-039). Brak = wejście spoza gałęzi tenanckiej → null,
 * wołający daje notFound(). Katalog null (tenant nieaktywny — nieosiągalny już
 * przez middleware, ale fail-closed) też → null.
 */
import { cache } from "react";

import {
  CATALOG_PAGE_SIZE,
  catalogPageCount,
  catalogPageOffset,
  type CurrencyCode,
  type ProductSlugRegistry,
} from "@avably/core";
import type { ResolvedSiteStyle } from "@avably/core/site";
import { headers } from "next/headers";

import {
  getCachedCatalog,
  resolvePublicCatalog,
  setCachedCatalog,
} from "@/lib/catalog/catalog-cache";
import {
  getPublicCatalog,
  getPublicCatalogPage,
  getPublicCategoryNav,
  getPublicCategoryPage,
  getPublicProduct,
  getPublicProductSlugs,
} from "@/lib/checkout/catalog";
import type {
  PublicCatalog,
  PublicCatalogProduct,
  PublicCategoryMeta,
} from "@/lib/checkout/contract";
import { categorySortToDb, type CategorySort } from "@/lib/catalog/category-path";
import { navItemsFromCounts, type CategoryNavItem } from "@/lib/catalog/category-nav";
import {
  getPublishedLegalDocuments,
  type PublishedLegalDocumentSummary,
} from "@/lib/legal/published";
import {
  getPublishedSite,
  getTenantAppearance,
  tenantAppearanceStyle,
  type PublishedSite,
  type TenantAppearance,
} from "@/lib/site/published";
import { getPublicStoreFlags, type StoreFlags } from "@/lib/site/store-flags";
import { getStorefrontCopy, type StorefrontCopy } from "@/lib/storefront/copy";
import { normalizeStorefrontLocale, type StorefrontLocale } from "@/lib/storefront/locale";
import { TENANT_ID_HEADER } from "@/lib/tenant/headers";

export interface StorefrontContext {
  tenantId: string;
  catalog: PublicCatalog;
  locale: StorefrontLocale;
  currency: CurrencyCode;
  copy: StorefrontCopy;
  /**
   * Styl SKLEPU po uzupełnieniu braków (K5, ADR-090; tor najemcy od ADR-171):
   * szablon, akcent i para fontów. Render zamienia go na zmienne CSS na
   * korzeniu strony — to jedyna droga, którą kolor akcentu wchodzi do sklepu.
   */
  style: ResolvedSiteStyle;
  /**
   * POWŁOKA NAJEMCY — znak firmy i wygląd (ADR-171). Czytana WPROST z wiersza
   * najemcy, a nie z koperty strony głównej: najemca z opublikowaną podstroną
   * i nieopublikowaną stroną główną ma mieć znak i motyw, a trasy bez wiersza
   * `sites` (koszyk, kasa, dokumenty prawne) nie mają skąd wziąć koperty
   * w ogóle.
   */
  appearance: TenantAppearance;
  /**
   * FLAGI POWŁOKI — przełączniki ZACHOWANIA (ADR-203, 0090), osobno od
   * `appearance` (wyglądu), bo to dwa różne kontrakty o dwóch różnych
   * odbiorcach: styl konsumuje render, flagi konsumują trasy. Na start:
   * `termCalendarEnabled` — globalna pigułka terminu w pasku (ADR-194,
   * faza B). Pole WYMAGANE jak reszta kontekstu: trasa, która by o nim
   * zapomniała, ma dostać błąd typów, a nie pigułkę wbrew ustawieniu
   * najemcy. Nieudany odczyt = domyślne `true` (fail-soft, zero regresu).
   */
  storeFlags: StoreFlags;
  /**
   * Pełna opublikowana STRONA GŁÓWNA (sekcje) — null gdy brak/nieopublikowana.
   * Po ADR-171 odpowiada wyłącznie za treść strony głównej i za sekcje POWŁOKI,
   * które naprawdę są jej własnością (stopka, ADR-154). Znaku ani wyglądu już
   * stąd nie czyta ani jedna trasa.
   */
  site: PublishedSite | null;
  /**
   * SPIS opublikowanych dokumentów prawnych — BEZ treści (B4, ADR-129).
   * Siedzi w kontekście, a nie w stronie checkoutu, bo odpowiada na pytanie
   * zadawane w kilku miejscach naraz („czy jest do czego linkować i pod jaką
   * etykietą"), a jako czwarty człon Promise.all nie kosztuje ani jednej
   * dodatkowej podróży w czasie odpowiedzi. Pusta tablica = stan każdego
   * najemcy tuż po migracji: sklep działa dokładnie jak wcześniej.
   */
  legalDocuments: PublishedLegalDocumentSummary[];
  /**
   * ADRESY SPRZĘTU — bieżące i stare (0083, ADR-182). Siedzi w kontekście,
   * a nie w trasie sprzętu, bo pytanie „pod jakim adresem stoi ta pozycja"
   * zadaje KAŻDA powierzchnia budująca link do sprzętu: kafle katalogu, kafle
   * sekcji na stronie treściowej, koszyk, sitemapa i kanon.
   *
   * `null` = adresów nie znamy (błąd odczytu albo najemca poza oknem
   * handlowym). To NIE gasi sklepu: linki spadają wtedy na adres ZASTANY
   * (`/product/{id}`), który dalej renderuje stronę sprzętu — patrz
   * `productPath`.
   */
  productSlugs: ProductSlugRegistry | null;
  supabaseUrl: string;
}

/**
 * KATALOG STRONY SPRZĘTU — DOKŁADNIE JEDNA POZYCJA (faza 4a, ADR-185).
 *
 * To NIE jest zawężony `PublicCatalog`, tylko własny typ — i to jest cała
 * różnica. Gdyby strona sprzętu dostawała `PublicCatalog` z jednoelementową
 * listą, każdy przyszły odczyt `ctx.catalog.pickup_locations` na tej trasie
 * oddawałby po cichu pustą listę: punkty odbioru zniknęłyby z ekranu bez ani
 * jednego błędu. Typ mający TRZY klucze zamienia to przeoczenie w błąd
 * kompilacji — ta sama technika, co wymagane propsy powłoki (ADR-154/160/172).
 */
export interface ProductPageCatalog {
  tenant: PublicCatalog["tenant"];
  custom_fields: PublicCatalog["custom_fields"];
  /** Pozycja spod adresu — jedna. Nie „katalog najemcy". */
  products: [PublicCatalogProduct];
}

/**
 * KONTEKST STRONY SPRZĘTU (faza 4a, ADR-185) — powłoka najemcy plus JEDNA
 * pozycja, bez katalogu i bez rejestru adresów.
 *
 * ==================== JEDNO ŹRÓDŁO POZYCJI, NIE DWA ====================
 *
 * ADR-180 postawił warunek: rekord, z którego renderuje się strona sprzętu,
 * ma pochodzić z TEJ SAMEJ listy, z której rysują się kafle — inaczej nazwa
 * i cena na stronie mogą rozjechać się z kaflem obok. Ten kontekst spełnia go
 * MOCNIEJ niż stan zastany: na stronie sprzętu nie ma już DRUGIEJ listy, z którą
 * cokolwiek mogłoby się rozjechać. `seam.products`, pasek terminu i rekord
 * wiązań czytają jedną i tę samą tablicę jednoelementową, która przyjechała
 * jedną koperta z bazy.
 *
 * Że koperta wąska niesie pozycję W TYM SAMYM KSZTAŁCIE, co katalog, nie jest
 * deklaracją: pilnuje tego test porównujący obie koperty na prawdziwej bazie
 * (`packages/db/test/public-product.test.ts`).
 *
 * ==================== REJESTR ADRESÓW MA JEDEN WPIS ====================
 *
 * `productSlugs` zostaje w kształcie rejestru, bo `productPath` jest jednym
 * wyrażeniem dla kafla, koszyka, sitemapy i kanonu (ADR-182) i nie ma powodu
 * uczyć go drugiej reprezentacji. Wpis jest jeden, bo strona sprzętu buduje
 * adres DOKŁADNIE jednej pozycji — swojej.
 */
export interface ProductPageContext extends Omit<StorefrontContext, "catalog"> {
  catalog: ProductPageCatalog;
}

/**
 * KATALOG STRONY `/katalog` — JEDNA STRONA WYNIKÓW (faza 4b, ADR-186).
 *
 * Ten sam wzorzec, co `ProductPageCatalog` z ADR-185 i z tego samego powodu:
 * własny typ o TRZECH kluczach zamienia przyszły odczyt
 * `ctx.catalog.pickup_locations` na tej trasie w błąd kompilacji, zamiast
 * w cichą pustą listę na ekranie.
 */
export interface CatalogPageCatalog {
  tenant: PublicCatalog["tenant"];
  custom_fields: PublicCatalog["custom_fields"];
  /** Pozycje TEJ strony wyników — nie „katalog najemcy". */
  products: PublicCatalogProduct[];
}

/**
 * KONTEKST STRONY KATALOGU (faza 4b, ADR-186) — powłoka najemcy plus JEDNA
 * strona wyników i jej rachunek.
 *
 * ==================== CENA PRZYJĘTA ŚWIADOMIE ====================
 *
 * Pasek terminu dostaje pozycje TEJ STRONY, a nie cały katalog, więc panel
 * konfliktu koszyka nazywa po imieniu pozycje widoczne na ekranie, a pozostałe
 * — identyfikatorem (`byId.get(id) ?? id`). To jest DOKŁADNIE ta sama cena,
 * którą ADR-185 przyjął na stronie sprzętu, i płaci się ją za to samo: odsłona
 * przestaje kosztować cały katalog. Naprawa bez powrotu do odczytu O(N) wymaga,
 * żeby koszyk niósł nazwy pozycji, i jest osobną pracą.
 */
export interface CatalogPageContext extends Omit<StorefrontContext, "catalog"> {
  catalog: CatalogPageCatalog;
  /** Numer strony wyników (1-based) — ten, który stoi w adresie. */
  page: number;
  /** Ile stron ma katalog przy bieżącym rozmiarze strony; zawsze ≥ 1. */
  pageCount: number;
  /**
   * Liczba pozycji: całego katalogu, a przy aktywnym wyszukiwaniu (`query`
   * niepuste) — pozycji PASUJĄCYCH do zapytania (0107, ADR-263). Nagłówek mówi
   * z niej klientowi, ile jest oferty / ile znaleziono.
   */
  total: number;
  /**
   * NORMALIZOWANE zapytanie wyszukiwania (`?q=`) albo pusty łańcuch, gdy
   * wyszukiwania nie ma (ADR-263). Trasa czyta je do wartości pola, licznika
   * wyników, stanu pustego i adresów nawigacji stron; przy pustym — katalog
   * zachowuje się jak przed wyszukiwarką.
   */
  query: string;
  /**
   * MENU KATEGORII POWŁOKI (ADR-247/266) — gotowe pozycje wejść do stron
   * kategorii, w kolejności najemcy (`position`) i z licznikiem po PEŁNYM
   * katalogu, z pominięciem kategorii pustych (`categoryNavItems`, guard
   * pustych). Trasa `/katalog` przekazuje je do `StoreChrome`, żeby menu stało
   * na niej tak samo, jak na stronie głównej — a nie znikało, gdy klient zaczyna
   * przeglądać. Pusta tablica = brak wyzwalacza (nie rysujemy „Kategorie" bez
   * ani jednej półki), także po nieudanym odczycie katalogu (fail-soft).
   */
  categoryNav: readonly CategoryNavItem[];
}

/**
 * Wynik rozstrzygnięcia adresu strony katalogu. Rozdzielony od kontekstu z tego
 * samego powodu, co przy stronie sprzętu: trasa musi odróżnić „najemca poza
 * oknem handlowym" od „numer strony spoza zakresu" ZANIM cokolwiek wyrenderuje,
 * a obie odpowiedzi są 404 o różnym uzasadnieniu.
 */
export type CatalogPageResolution =
  | { kind: "page"; ctx: CatalogPageContext }
  | { kind: "none" };

/**
 * KATALOG STRONY `/kategoria/{slug}` — JEDNA STRONA jednej kategorii (faza C,
 * ADR-247). Ten sam wzorzec, co `CatalogPageCatalog`, i z tego samego powodu:
 * własny typ o TRZECH kluczach zamienia przyszły odczyt
 * `ctx.catalog.pickup_locations` na tej trasie w błąd kompilacji, a nie w cichą
 * pustą listę na ekranie.
 */
export interface CategoryPageCatalog {
  tenant: PublicCatalog["tenant"];
  custom_fields: PublicCatalog["custom_fields"];
  /** Pozycje TEJ strony wyników kategorii — nie „katalog najemcy". */
  products: PublicCatalogProduct[];
}

/**
 * KONTEKST STRONY KATEGORII (faza C, ADR-247) — powłoka najemcy plus JEDNA
 * strona wyników kategorii, jej rachunek i META kategorii.
 *
 * `category` jest NIE-NULLowalny z konstrukcji: kontekst powstaje WYŁĄCZNIE gdy
 * kategoria istnieje (slug znany). Stan „slug nieznany" nie ma kontekstu —
 * rozstrzyga go `CategoryPageResolution` przed renderem (trasa: 404).
 *
 * Cena przyjęta świadomie jest ta sama, co na `/katalog` (ADR-186): pasek
 * terminu dostaje pozycje TEJ STRONY, więc panel konfliktu koszyka nazywa po
 * imieniu pozycje widoczne, a pozostałe identyfikatorem.
 */
export interface CategoryPageContext extends Omit<StorefrontContext, "catalog"> {
  catalog: CategoryPageCatalog;
  /** META kategorii spod adresu (id, nazwa, slug, opis, baner). */
  category: PublicCategoryMeta;
  /** Numer strony wyników (1-based) — ten, który stoi w adresie. */
  page: number;
  /** Ile stron ma kategoria przy bieżącym rozmiarze strony; zawsze >= 1. */
  pageCount: number;
  /** Liczba WSZYSTKICH aktywnych pozycji kategorii — nagłówek mówi, ile jest oferty. */
  total: number;
  /** Wybrany porządek — do zaznaczenia w przełączniku i do budowy adresów stron. */
  sort: CategorySort;
  /**
   * MENU KATEGORII POWŁOKI (ADR-247/266) — jak w `CatalogPageContext`: pozycje
   * wejść do stron kategorii w kolejności najemcy, z licznikiem po PEŁNYM
   * katalogu i guardem pustych. Trasa `/kategoria/{slug}` przekazuje je do
   * `StoreChrome`, żeby klient przeglądający półkę nie tracił nawigacji między
   * kategoriami. Pusta tablica = brak wyzwalacza (także fail-soft po nieudanym
   * odczycie katalogu).
   */
  categoryNav: readonly CategoryNavItem[];
}

/**
 * Wynik rozstrzygnięcia adresu strony kategorii. Rozdzielony od kontekstu jak
 * przy katalogu: trasa musi odróżnić „najemca poza oknem / slug nieznany /
 * numer strony spoza zakresu" (wszystkie → 404) od „renderuj" ZANIM cokolwiek
 * wyrenderuje. Trzy powody 404 schodzą do jednego `none`, bo trasa reaguje na
 * nie identycznie (`notFound`); różnicę uzasadnień niesie funkcja bazy.
 */
export type CategoryPageResolution =
  | { kind: "page"; ctx: CategoryPageContext }
  | { kind: "none" };

/**
 * `cache` (per-żądanie): layout czyta z tego locale na `<html lang>`, a strona
 * ten sam kontekst na treść — bez dublowania odpytań katalogu/site w jednym
 * żądaniu.
 */
export const loadStorefrontContext = cache(_loadStorefrontContext);

/**
 * Kontekst strony sprzętu: pięć odczytów równolegle, ani jeden O(N).
 *
 * `cache` per-żądanie z TEGO SAMEGO powodu, co wyżej — trasa woła to raz
 * z `generateMetadata` i raz z renderu, a Next liczy oba równolegle.
 */
export const loadProductPageContext = cache(_loadProductPageContext);

/**
 * Kontekst strony katalogu: pięć odczytów równolegle, ani jeden O(katalogu).
 *
 * `cache` per-żądanie z tego samego powodu, co wyżej — trasa woła to raz
 * z `generateMetadata` i raz z renderu. Argument WCHODZI do klucza memoizacji
 * `cache` Reacta, więc dwa różne numery strony w jednym żądaniu (stan
 * nieosiągalny w trasie, ale osiągalny w teście) nie zjadłyby sobie wyniku.
 */
export const loadCatalogPageContext = cache(_loadCatalogPageContext);

/**
 * Kontekst strony kategorii: pięć odczytów równolegle, ani jeden O(katalogu).
 *
 * `cache` per-żądanie z tego samego powodu, co wyżej — trasa woła to raz
 * z `generateMetadata` i raz z renderu. Argumenty (slug, strona, sort) WCHODZĄ
 * do klucza memoizacji `cache` Reacta, więc dwa różne wywołania w jednym
 * żądaniu nie zjadłyby sobie wyniku.
 */
export const loadCategoryPageContext = cache(_loadCategoryPageContext);

/**
 * Wynik rozstrzygnięcia adresu sprzętu. Rozdzielony od kontekstu, bo trasa
 * musi rozróżnić „nie ma takiego adresu" (404) od „adres się wyprowadził"
 * (308) ZANIM cokolwiek wyrenderuje.
 */
export type ProductPageResolution =
  | { kind: "product"; ctx: ProductPageContext }
  | { kind: "redirect"; slug: string }
  | { kind: "none" };

async function _loadProductPageContext(
  target: { slug: string } | { productId: string },
): Promise<ProductPageResolution> {
  const tenantId = (await headers()).get(TENANT_ID_HEADER);
  if (!tenantId) return { kind: "none" };

  // Flagi powłoki PIĄTYM członem (ADR-203) — równolegle, więc zero
  // dodatkowych podróży w czasie odpowiedzi (ten sam rachunek, co ADR-171).
  const [envelope, appearance, site, legalDocuments, storeFlags] = await Promise.all([
    getPublicProduct(tenantId, target),
    getTenantAppearance(tenantId),
    getPublishedSite(tenantId),
    getPublishedLegalDocuments(tenantId),
    getPublicStoreFlags(tenantId),
  ]);

  // Najemca poza oknem handlowym / błąd odczytu — fail-closed jak katalog.
  if (!envelope) return { kind: "none" };

  if (envelope.match === "redirect" && envelope.slug) {
    return { kind: "redirect", slug: envelope.slug };
  }
  if (envelope.match !== "current" || !envelope.product || !envelope.slug) {
    return { kind: "none" };
  }

  const locale = normalizeStorefrontLocale(envelope.tenant.locale);
  const copy = await getStorefrontCopy(locale);
  const style = tenantAppearanceStyle(appearance);

  return {
    kind: "product",
    ctx: {
      tenantId,
      catalog: {
        tenant: envelope.tenant,
        custom_fields: envelope.custom_fields,
        products: [envelope.product],
      },
      locale,
      currency: envelope.tenant.currency,
      copy,
      style,
      appearance,
      storeFlags,
      site,
      legalDocuments,
      productSlugs: {
        products: [{ id: envelope.product.id, slug: envelope.slug }],
        redirects: [],
      },
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    },
  };
}

/**
 * MENU KATEGORII dla tras `/katalog` i `/kategoria/{slug}` (ADR-266).
 *
 * ==================== DLACZEGO WŁASNY, WĄSKI ODCZYT, A NIE PEŁNY KATALOG ====================
 *
 * Menu potrzebuje WSZYSTKICH kategorii najemcy (w kolejności `position`) i
 * liczby pozycji per kategoria po CAŁYM katalogu — a stronicowana koperta trasy
 * (`get_public_catalog_page`) świadomie nie niesie ani kategorii, ani pełnej
 * listy przypisań (ADR-186: „czego tu nie ma"). Kuszące „doczytaj pełny katalog
 * (`get_public_catalog`) i policz w pamięci" wraca DOKŁADNIE do kosztu, który
 * stronicowanie zdjęło z tych tras: pozycja spoza strony wyników przyjechałaby
 * do procesu, choć nie ma jej na ekranie (bramka `koszt-odslony.integration`).
 * Dlatego menu jedzie WĄSKĄ funkcją bazy `app.get_public_category_nav` (0109),
 * która liczy pozycje per kategoria PO STRONIE BAZY i oddaje same liczby — koszt
 * O(kategorii), a nie O(katalogu), i ani jednej nazwy pozycji w ruchu.
 *
 * FAIL-SOFT: nieudany odczyt (najemca poza oknem / błąd transportu) → puste
 * menu, nie błąd trasy — jak guard pustych w `categoryNavItems`. Izolację niesie
 * sam odczyt: funkcja jest SECURITY DEFINER z jawnym filtrem `tenant_id`, więc
 * menu najemcy A nie może nieść kategorii B (dowód: `packages/db/test/category-nav.test.ts`).
 */
async function loadCategoryNav(tenantId: string): Promise<CategoryNavItem[]> {
  const entries = await getPublicCategoryNav(tenantId);
  return entries ? navItemsFromCounts(entries) : [];
}

async function _loadCatalogPageContext(
  page: number,
  query = "",
): Promise<CatalogPageResolution> {
  const tenantId = (await headers()).get(TENANT_ID_HEADER);
  if (!tenantId) return { kind: "none" };

  // Flagi powłoki PIĄTYM członem (ADR-203) — patrz kontekst strony sprzętu.
  // [0107] `query` PIĄTYM argumentem odczytu katalogu (ADR-263): puste = pełny
  // katalog jak przed wyszukiwarką; niepuste zawęża okno i `total` w bazie.
  // [ADR-266] Menu kategorii SZÓSTYM członem — równolegle, buforowane; patrz
  // `loadCategoryNav`.
  const [envelope, appearance, site, legalDocuments, storeFlags, categoryNav] = await Promise.all([
    getPublicCatalogPage(tenantId, catalogPageOffset(page), CATALOG_PAGE_SIZE, query),
    getTenantAppearance(tenantId),
    getPublishedSite(tenantId),
    getPublishedLegalDocuments(tenantId),
    getPublicStoreFlags(tenantId),
    loadCategoryNav(tenantId),
  ]);

  // Najemca poza oknem handlowym / błąd odczytu — fail-closed jak katalog.
  if (!envelope) return { kind: "none" };

  /*
    NUMER STRONY SPOZA ZAKRESU TO 404, NIE PUSTA SIATKA (ADR-186).

    Pusta siatka pod `?strona=99` byłaby stroną bez treści, którą wyszukiwarka
    ma prawo zaindeksować — a katalog o dwóch stronach produkowałby wtedy
    nieskończenie wiele adresów z tym samym, pustym ekranem. Wyjątkiem jest
    strona PIERWSZA: „katalog w przygotowaniu" jest treścią, którą trzeba
    pokazać pod adresem, do którego prowadzą linki najemcy.
  */
  const pageCount = catalogPageCount(envelope.total, CATALOG_PAGE_SIZE);
  if (page > pageCount) return { kind: "none" };

  const locale = normalizeStorefrontLocale(envelope.tenant.locale);
  const copy = await getStorefrontCopy(locale);
  const style = tenantAppearanceStyle(appearance);

  return {
    kind: "page",
    ctx: {
      tenantId,
      catalog: {
        tenant: envelope.tenant,
        custom_fields: envelope.custom_fields,
        products: envelope.products,
      },
      page,
      pageCount,
      total: envelope.total,
      query,
      categoryNav,
      locale,
      currency: envelope.tenant.currency,
      copy,
      style,
      appearance,
      storeFlags,
      site,
      legalDocuments,
      /*
        REJESTR ADRESÓW MA WPISY TEJ STRONY. `productPath` jest jednym
        wyrażeniem dla kafla, koszyka, mapy strony i kanonu (ADR-182) i nie ma
        powodu uczyć go drugiej reprezentacji — a adresu potrzebują wyłącznie
        pozycje, które ta strona naprawdę rysuje. `redirects` jest tu pusta
        z konstrukcji: kafel buduje link do adresu BIEŻĄCEGO, a przekierowania
        rozstrzyga trasa sprzętu.
      */
      productSlugs: { products: envelope.slugs, redirects: [] },
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    },
  };
}

async function _loadCategoryPageContext(
  slug: string,
  page: number,
  sort: CategorySort,
): Promise<CategoryPageResolution> {
  const tenantId = (await headers()).get(TENANT_ID_HEADER);
  if (!tenantId) return { kind: "none" };

  // Flagi powłoki PIĄTYM członem (ADR-203) — jak przy stronie katalogu.
  // [ADR-266] Menu kategorii SZÓSTYM członem — równolegle, buforowane; patrz
  // `loadCategoryNav`.
  const [envelope, appearance, site, legalDocuments, storeFlags, categoryNav] = await Promise.all([
    getPublicCategoryPage(tenantId, slug, page, CATALOG_PAGE_SIZE, categorySortToDb(sort)),
    getTenantAppearance(tenantId),
    getPublishedSite(tenantId),
    getPublishedLegalDocuments(tenantId),
    getPublicStoreFlags(tenantId),
    loadCategoryNav(tenantId),
  ]);

  // Najemca poza oknem handlowym / błąd odczytu — fail-closed jak katalog.
  if (!envelope) return { kind: "none" };

  /*
    SLUG NIEZNANY TO 404, NIE PUSTY WIDOK (ADR-244, rozstrzygnięcie 2). Obecność
    obiektu `category` — a NIE pusta lista pozycji — rozstrzyga różnicę między
    „nie ma takiej kategorii" (404) a „kategoria istnieje, lecz pusta" (pusty
    widok pod istniejącym adresem).
  */
  if (!envelope.category) return { kind: "none" };

  /*
    NUMER STRONY SPOZA ZAKRESU TO 404 (jak `/katalog`, ADR-186). Wyjątkiem jest
    strona PIERWSZA: kategoria pusta ma stronę pierwszą i pokazuje na niej
    „w tej kategorii nie ma jeszcze produktów" — treść pod adresem, do którego
    prowadzą linki, a nie 404.
  */
  const pageCount = catalogPageCount(envelope.total, CATALOG_PAGE_SIZE);
  if (page > pageCount) return { kind: "none" };

  const locale = normalizeStorefrontLocale(envelope.tenant.locale);
  const copy = await getStorefrontCopy(locale);
  const style = tenantAppearanceStyle(appearance);

  return {
    kind: "page",
    ctx: {
      tenantId,
      catalog: {
        tenant: envelope.tenant,
        custom_fields: envelope.custom_fields,
        products: envelope.products,
      },
      category: envelope.category,
      page,
      pageCount,
      total: envelope.total,
      sort,
      categoryNav,
      locale,
      currency: envelope.tenant.currency,
      copy,
      style,
      appearance,
      storeFlags,
      site,
      legalDocuments,
      // Rejestr adresów niesie WPISY TEJ STRONY (jak katalog): kafel buduje link
      // do adresu bieżącego, a przekierowania rozstrzyga trasa sprzętu.
      productSlugs: { products: envelope.slugs, redirects: [] },
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    },
  };
}

async function _loadStorefrontContext(): Promise<StorefrontContext | null> {
  const tenantId = (await headers()).get(TENANT_ID_HEADER);
  if (!tenantId) return null;

  /*
    POWŁOKA JEDZIE WŁASNYM CZŁONEM, a nie doklejką do koperty strony (ADR-171).
    Koszt jest jawny i policzony: jedno dodatkowe wywołanie RPC na żądanie,
    RÓWNOLEGLE z pozostałymi trzema, więc nie dokłada ani jednej podróży
    w czasie odpowiedzi. Cena za to, że znak i motyw przestają zależeć od tego,
    czy najemca zdążył opublikować akurat stronę główną.
  */
  const [catalog, appearance, site, legalDocuments, productSlugs, storeFlags] = await Promise.all([
    /*
      KATALOG PRZEZ CACHE MIĘDZYŻĄDANIOWY (faza 4a, ADR-185). `cache` z Reacta
      na całej tej funkcji deduplikuje odczyty w obrębie JEDNEGO żądania;
      dopiero ten wpis sprawia, że drugi odwiedzający nie płaci za katalog od
      nowa. Unieważnia go JAWNIE panel przy zmianie katalogu — patrz nagłówek
      `lib/catalog/catalog-cache.ts`.
    */
    resolvePublicCatalog(tenantId, {
      getCache: getCachedCatalog,
      setCache: setCachedCatalog,
      lookup: (id) => getPublicCatalog(id),
    }),
    getTenantAppearance(tenantId),
    getPublishedSite(tenantId),
    getPublishedLegalDocuments(tenantId),
    getPublicProductSlugs(tenantId),
    // Flagi powłoki SZÓSTYM członem (ADR-203) — równolegle, zero dodatkowych
    // podróży; nieudany odczyt = domyślne `true` (pigułka jak przed 0090).
    getPublicStoreFlags(tenantId),
  ]);
  if (!catalog) return null;

  const locale = normalizeStorefrontLocale(catalog.tenant.locale);
  const copy = await getStorefrontCopy(locale);

  // JEDNO rozstrzygnięcie stylu na żądanie — razem z szablonem. Gdyby szablon
  // dalej szedł wprost z kolumny, a akcent ze stylu, strona po zmianie szablonu
  // w panelu stylu renderowałaby się w starym układzie z nowym kolorem.
  const style = tenantAppearanceStyle(appearance);

  return {
    tenantId,
    catalog,
    locale,
    currency: catalog.tenant.currency,
    copy,
    style,
    appearance,
    storeFlags,
    site,
    legalDocuments,
    productSlugs,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  };
}
