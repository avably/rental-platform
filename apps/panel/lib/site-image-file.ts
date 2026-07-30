/**
 * Kontrakt pliku zdjęcia SEKCJI (0043) — bucket `site-images`. Sam kontrakt
 * obrazu (limit 5 MiB, cztery MIME, sygnatury magicznych bajtów) jest
 * IDENTYCZNY z zdjęciami produktów, więc reużywamy czystych funkcji z
 * `product-image-file.ts` zamiast drugiej kopii sniffowania (jedno źródło
 * prawdy o wykrywaniu typu obrazu). Różni się WYŁĄCZNIE bucket.
 */
export {
  checkProductImageMetadata as checkSiteImageMetadata,
  detectProductImageMime as detectSiteImageMime,
  MAX_PRODUCT_IMAGE_BYTES as MAX_SITE_IMAGE_BYTES,
  PRODUCT_IMAGE_MIME_EXTENSIONS as SITE_IMAGE_MIME_EXTENSIONS,
  type ProductImageExtension as SiteImageExtension,
  type ProductImageFileProblem as SiteImageFileProblem,
  type ProductImageMime as SiteImageMime,
} from "@/lib/product-image-file";

/** Bucket zdjęć sekcji — lustro migracji 0043 i storefrontu (siteImageBase). */
export const SITE_IMAGE_BUCKET = "site-images";
