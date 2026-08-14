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

import type { CurrencyCode, ProductSlugRegistry } from "@avably/core";
import type { ResolvedSiteStyle } from "@avably/core/site";
import { headers } from "next/headers";

import {
  getCachedCatalog,
  resolvePublicCatalog,
  setCachedCatalog,
} from "@/lib/catalog/catalog-cache";
import { getPublicCatalog, getPublicProduct, getPublicProductSlugs } from "@/lib/checkout/catalog";
import type { PublicCatalog, PublicCatalogProduct } from "@/lib/checkout/contract";
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
 * `cache` (per-żądanie): layout czyta z tego locale na `<html lang>`, a strona
 * ten sam kontekst na treść — bez dublowania odpytań katalogu/site w jednym
 * żądaniu.
 */
export const loadStorefrontContext = cache(_loadStorefrontContext);

/**
 * Kontekst strony sprzętu: cztery odczyty równolegle, ani jeden O(N).
 *
 * `cache` per-żądanie z TEGO SAMEGO powodu, co wyżej — trasa woła to raz
 * z `generateMetadata` i raz z renderu, a Next liczy oba równolegle.
 */
export const loadProductPageContext = cache(_loadProductPageContext);

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

  const [envelope, appearance, site, legalDocuments] = await Promise.all([
    getPublicProduct(tenantId, target),
    getTenantAppearance(tenantId),
    getPublishedSite(tenantId),
    getPublishedLegalDocuments(tenantId),
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
  const [catalog, appearance, site, legalDocuments, productSlugs] = await Promise.all([
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
    site,
    legalDocuments,
    productSlugs,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  };
}
