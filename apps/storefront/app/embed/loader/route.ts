/**
 * Skrypt osadzający (M3, ADR-120). Trasa bez rozszerzenia w ścieżce, żeby
 * PRZESZŁA przez proxy (matcher wycina ścieżki z kropką) — dzięki temu
 * podlega tej samej wycince z bramki hasła i tej samej polityce nagłówków co
 * reszta embedu, zamiast omijać je po cichu.
 */
import { embedLoaderSource } from "@/lib/embed/loader";

export const runtime = "nodejs";

export function GET(): Response {
  return new Response(embedLoaderSource(), {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // Skrypt jest identyczny dla wszystkich — wolno go trzymać, ale krótko,
      // żeby poprawka bezpieczeństwa nie czekała dobę na cudzym CDN-ie.
      "cache-control": "public, max-age=300",
    },
  });
}
