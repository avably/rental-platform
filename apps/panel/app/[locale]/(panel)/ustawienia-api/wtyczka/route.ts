/**
 * GET /{locale}/ustawienia-api/wtyczka — pobranie paczki instalacyjnej
 * wtyczki WordPress (M2, ADR-110).
 *
 * ROUTE HANDLER, nie plik statyczny: paczka ma wyjść z nagłówkami
 * `Content-Disposition` (nazwa z wersją) i `no-store`, a wejście ma być za
 * bramką sesji jak reszta panelu. Zawartość pochodzi z modułu generowanego
 * ze źródeł repo (`scripts/build-wp-plugin-zip.mjs`), więc trasa niczego nie
 * czyta z dysku — na hostingu serwerless nie ma pliku, który mógłby zniknąć
 * ze śladu bundlera.
 *
 * GET, nie POST: to pobranie zasobu bez skutków ubocznych, a operator ma móc
 * kliknąć zwykły link (i ponowić go z historii przeglądarki).
 */
import { AuthError } from "@/lib/auth";
import { requireMember } from "@/lib/supabase-server";
import {
  WORDPRESS_PLUGIN_FILENAME,
  wordpressPluginZip,
} from "@/lib/wordpress/plugin-package";

export async function GET(): Promise<Response> {
  // Guard przed jakąkolwiek pracą — anonim nie dostaje nawet bajtu.
  try {
    await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return new Response(null, { status: err.status });
    throw err;
  }

  const zip = wordpressPluginZip();
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${WORDPRESS_PLUGIN_FILENAME}"`,
      "content-length": String(zip.length),
      "cache-control": "private, no-store",
    },
  });
}
