/**
 * KONTRAKT PLIKU LOGO NAJEMCY (ADR-160) — panelowa strona granicy.
 *
 * Typy pliku są te same, co dla zdjęć sekcji (allowlista bucketa `site-images`),
 * ale SUFIT jest inny: 512 KiB zamiast 5 MiB. Liczba nie mieszka tu — mieszka
 * w `@avably/core/site` razem ze schematem znaku, żeby panel, baza (CHECK
 * `site_image_uploads_logo_size_check`) i dokumentacja mówiły jedną wartością.
 */
import { MAX_SITE_LOGO_BYTES } from "@avably/core/site";

import { SITE_IMAGE_MIME_EXTENSIONS, type SiteImageMime } from "@/lib/site-image-file";

export { MAX_SITE_LOGO_BYTES };

export type TenantLogoMime = SiteImageMime;

/** Te same cztery problemy, co przy zdjęciu sekcji — inny próg pod `size`. */
export type TenantLogoFileProblem = "missing" | "empty" | "size" | "type";

export function checkTenantLogoMetadata(
  file: { size: number; type: string } | null | undefined,
): TenantLogoFileProblem | null {
  if (!file) return "missing";
  if (file.size <= 0) return "empty";
  if (file.size > MAX_SITE_LOGO_BYTES) return "size";
  if (!(file.type in SITE_IMAGE_MIME_EXTENSIONS)) return "type";
  return null;
}
