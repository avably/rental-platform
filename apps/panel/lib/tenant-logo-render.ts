/**
 * ZNAK FIRMY W POWIERZCHNIACH PANELU (ADR-160) — z wartości kolumny na to,
 * co dostaje renderer.
 *
 * Panel czyta znak z DWÓCH kolumn i pokazuje je w dwóch różnych miejscach:
 * `logo_draft` w podglądzie szkicu (bo podgląd odpowiada na pytanie „co
 * dostanie klient PO publikacji"), `logo_published` w karcie ekranu strony
 * (bo tam pada pytanie „co klient widzi TERAZ"). Reguła sklejania adresu
 * i wyboru tekstu zastępczego jest wspólna — i dlatego stoi tutaj, a nie
 * dwa razy w komponentach.
 */
import { parseSiteLogo, siteLogoAlt, type SiteLogo } from "@avably/core/site";
import type { SiteLogoRender } from "@avably/ui";

import { siteImagePublicBase } from "@/lib/site-image-base";

export function tenantLogo(value: unknown): SiteLogo | null {
  return parseSiteLogo(value);
}

export function tenantLogoRender(logo: SiteLogo | null, storeName: string): SiteLogoRender | null {
  if (!logo) return null;
  return {
    src: `${siteImagePublicBase()}/${logo.path}`,
    alt: siteLogoAlt(logo, storeName),
  };
}
