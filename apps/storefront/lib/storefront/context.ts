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

import type { CurrencyCode } from "@avably/core";
import type { ResolvedSiteStyle } from "@avably/core/site";
import { headers } from "next/headers";

import { getPublicCatalog } from "@/lib/checkout/catalog";
import type { PublicCatalog } from "@/lib/checkout/contract";
import {
  getPublishedLegalDocuments,
  type PublishedLegalDocumentSummary,
} from "@/lib/legal/published";
import { getPublishedSite, publishedSiteStyle, type PublishedSite } from "@/lib/site/published";
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
   * Styl strony po uzupełnieniu braków (K5, ADR-090): szablon, akcent i para
   * fontów. Render zamienia go na zmienne CSS na korzeniu strony — to jedyna
   * droga, którą kolor akcentu wchodzi do sklepu.
   */
  style: ResolvedSiteStyle;
  /** Pełna opublikowana strona (sekcje) — null gdy brak/nieopublikowana. */
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
  supabaseUrl: string;
}

/**
 * `cache` (per-żądanie): layout czyta z tego locale na `<html lang>`, a strona
 * ten sam kontekst na treść — bez dublowania odpytań katalogu/site w jednym
 * żądaniu.
 */
export const loadStorefrontContext = cache(_loadStorefrontContext);

async function _loadStorefrontContext(): Promise<StorefrontContext | null> {
  const tenantId = (await headers()).get(TENANT_ID_HEADER);
  if (!tenantId) return null;

  const [catalog, site, legalDocuments] = await Promise.all([
    getPublicCatalog(tenantId),
    getPublishedSite(tenantId),
    getPublishedLegalDocuments(tenantId),
  ]);
  if (!catalog) return null;

  const locale = normalizeStorefrontLocale(catalog.tenant.locale);
  const copy = await getStorefrontCopy(locale);

  // JEDNO rozstrzygnięcie stylu na żądanie — razem z szablonem. Gdyby szablon
  // dalej szedł wprost z kolumny, a akcent ze stylu, strona po zmianie szablonu
  // w panelu stylu renderowałaby się w starym układzie z nowym kolorem.
  const style = publishedSiteStyle(site);

  return {
    tenantId,
    catalog,
    locale,
    currency: catalog.tenant.currency,
    copy,
    style,
    site,
    legalDocuments,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  };
}
