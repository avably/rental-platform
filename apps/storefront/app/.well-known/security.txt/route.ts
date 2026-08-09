/**
 * `/.well-known/security.txt` (RFC 9116, I-01, ADR-123). Treść i uzasadnienie
 * pól: `../../../lib/seo/security-txt.ts`.
 *
 * TRASA PLIKOWA — matcher proxy wyklucza KAŻDĄ ścieżkę z rozszerzeniem
 * (`/((?!_next\/static|_next\/image|favicon.ico|.*\.[\w]+$).*)/`, patrz
 * `proxy.ts`), więc to żądanie NIE przechodzi przez middleware, dokładnie
 * jak `/robots.txt` i `/sitemap.xml` (ADR-044). Skutek: żadna gałąź
 * middleware'u — w tym bramka SITE_PASSWORD (Basic Auth) — nie widzi tego
 * żądania. To WŁAŚCIWE zachowanie, nie luka: RFC 9116 wymaga, żeby kontakt
 * bezpieczeństwa był dostępny BEZ logowania (to kanał awaryjny), a bramka
 * hasła jest i tak tymczasowa (etap przed ogłoszeniem produktu).
 *
 * BEZ kontekstu hosta i tenanta: w przeciwieństwie do `sitemap.xml`/
 * `robots.txt` ta trasa nie czyta `Host`, nie rozwiązuje tenanta i nie łączy
 * się z bazą — treść jest identyczna dla każdej domeny (kontakt PLATFORMY).
 * Stąd też brak `dynamic = "force-dynamic"`: odpowiedź nie zależy od
 * żądania, więc Next może ją traktować jak zasób statyczny.
 *
 * Brak nagłówków CORS — to zwykły plik tekstowy, nie API z danymi do otwarcia.
 */
import { renderSecurityTxt } from "@/lib/seo/security-txt";

const HEADERS = {
  "content-type": "text/plain; charset=utf-8",
} as const;

export async function GET(): Promise<Response> {
  return new Response(renderSecurityTxt(), { headers: HEADERS });
}
