/**
 * Prefiks publicznego URL-a bucketa `site-images` (0043) — JEDNO miejsce.
 *
 * Wydzielone przy ADR-160: do tej pory literał budował wyłącznie szew renderu
 * sekcji, ale znak firmy najemcy potrzebuje dokładnie tego samego prefiksu
 * w innej warstwie. Druga kopia tego wyrażenia znaczyłaby, że zmiana ścieżki
 * Storage psuje jedną z nich po cichu — obrazek znika, błędu nie ma.
 */
export function siteImageBaseUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/site-images`;
}
