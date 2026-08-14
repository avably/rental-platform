/**
 * ZNAK FIRMY NAJEMCY W SKLEPIE (ADR-160) — jedno miejsce, w którym z danych
 * robi się to, co dostaje render.
 *
 * Logo przyjeżdża TOREM NAJEMCY (`app.get_tenant_appearance`, ADR-171), a nie
 * kopertą strony głównej, którą czytało do 0079. Powodem zmiany jest stan
 * DOMYŚLNY nowego najemcy: przy nieopublikowanej stronie głównej koperta jest
 * pusta, więc znak nie pojawiał się ani na opublikowanej podstronie, ani na
 * koszyku, ani w kasie — a panel meldował „Ten znak widzą klienci".
 *
 * DECYZJA BEZPIECZEŃSTWA ZOSTAJE TA SAMA, co przy kopercie: odczyt jest
 * zawężony identyfikatorem najemcy w CIELE funkcji i idzie bez cache'u
 * pośredniego (trasy tenanckie są `force-dynamic`). Klucz cache'u bez najemcy
 * to klasyczne miejsce, w którym znak najemcy A ląduje na sklepie najemcy B —
 * i dlatego takiego klucza tu nie ma.
 *
 * Tu też zapada wybór tekstu zastępczego i decyzja o stopce — żeby nagłówek
 * i stopka nie mogły odpowiedzieć na te pytania inaczej.
 */
import { siteLogoAlt, type SiteLogo } from "@avably/core/site";
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
  /**
   * Nośnik znaku — powłoka najemcy (ADR-171) albo koperta strony (ADR-160).
   * Typ jest strukturalny, bo funkcja pyta o JEDNO pole i nie ma powodu
   * wiedzieć, którędy przyjechało.
   */
  source: { logo: SiteLogo | null } | null,
  storeName: string,
  supabaseUrl: string,
): StoreLogo | null {
  const logo = source?.logo;
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
  /*
    KSZTAŁT STRUKTURALNY, nie `Pick<StorefrontContext, …>` (faza 4a, ADR-184).
    Od tej fazy strona sprzętu ma własny, węższy kontekst (bez punktów odbioru
    i metod dostawy), a znak firmy potrzebuje z niego DOKŁADNIE nazwy najemcy.
    Zawężenie do tego, co funkcja naprawdę czyta, wpuszcza oba konteksty bez
    ani jednej zmiany w ośmiu miejscach wywołania.
  */
  ctx: Pick<StorefrontContext, "appearance" | "supabaseUrl"> & {
    catalog: { tenant: { name: string } };
  },
): StoreLogo | null {
  return resolveStoreLogo(ctx.appearance, ctx.catalog.tenant.name, ctx.supabaseUrl);
}
