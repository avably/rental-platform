import { SITE_IMAGE_BUCKET } from "@/lib/site-image-file";

/**
 * Prefiks publicznego URL-a bucketa `site-images` (0043) po stronie panelu —
 * podgląd sekcji i miniatury w edytorze budują z niego adres zdjęcia, tak jak
 * storefront z ctx.supabaseUrl. NEXT_PUBLIC_SUPABASE_URL jest wstrzykiwane
 * build-time (stała w bundlu klienta).
 */
export function siteImagePublicBase(): string {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return `${url}/storage/v1/object/public/${SITE_IMAGE_BUCKET}`;
}
