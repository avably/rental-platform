/**
 * ZNAK FIRMY NAJEMCY W SKLEPIE (ADR-160) — jedno miejsce, w którym z danych
 * robi się to, co dostaje render.
 *
 * Logo przyjeżdża w KOPERCIE opublikowanej strony (`app.get_published_page`,
 * migracja 0076), a nie własnym odczytem — i to jest decyzja bezpieczeństwa,
 * nie wygody. Koperta jest zawężona identyfikatorem najemcy i czytana bez
 * cache'u pośredniego (trasy tenanckie są `force-dynamic`). Osobny odczyt
 * znaczyłby drugi klucz do cache'owania, a klucz cache'u bez najemcy to
 * klasyczne miejsce, w którym znak najemcy A ląduje na sklepie najemcy B.
 *
 * Tu też zapada wybór tekstu zastępczego i decyzja o stopce — żeby nagłówek
 * i stopka nie mogły odpowiedzieć na te pytania inaczej.
 */
import { siteLogoAlt, type PublishedSite } from "@avably/core/site";
import { siteImageUrl, type SiteLogoRender } from "@avably/ui";

import { siteImageBaseUrl } from "@/lib/site/image-base";
import type { StorefrontContext } from "@/lib/storefront/context";

export interface StoreLogo extends SiteLogoRender {
  /** Czy znak ma stanąć także w stopce (przełącznik najemcy, domyślnie tak). */
  inFooter: boolean;
}

/**
 * `null` = najemca nie ma znaku. To jest stan NORMALNY, nie awaria: sklep bez
 * logo wygląda dokładnie tak, jak wyglądał przed tą zmianą, i nie rysuje
 * żadnego placeholdera „tu wstaw logo".
 */
export function resolveStoreLogo(
  site: PublishedSite | null,
  storeName: string,
  supabaseUrl: string,
): StoreLogo | null {
  const logo = site?.logo;
  if (!logo) return null;

  return {
    src: siteImageUrl(siteImageBaseUrl(supabaseUrl), logo.path),
    alt: siteLogoAlt(logo, storeName),
    inFooter: logo.inFooter,
  };
}

/**
 * Wejście dla tras sklepu — jedno wywołanie zamiast trzech argumentów
 * przepisywanych w ośmiu miejscach (i ośmiu okazji, żeby przepisać je inaczej).
 */
export function storeLogo(
  ctx: Pick<StorefrontContext, "site" | "catalog" | "supabaseUrl">,
): StoreLogo | null {
  return resolveStoreLogo(ctx.site, ctx.catalog.tenant.name, ctx.supabaseUrl);
}
