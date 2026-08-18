/**
 * `/.well-known/security.txt` na hoście PANELU (RFC 9116, L-SEC-01, ADR-193)
 * — lustro trasy storefrontu (I-01, ADR-123), która do tej naprawy była
 * jedynym miejscem serwującym plik: `app.avably.io/.well-known/security.txt`
 * odpowiadało 404, choć to panel jest powierzchnią z logowaniem i sekretami,
 * czyli tą, dla której badacz bezpieczeństwa szuka kontaktu najpierw.
 *
 * JEDNO ŹRÓDŁO TREŚCI. Renderer i stałe (`Contact`/`Expires`/`Canonical`)
 * importujemy WPROST z modułu storefrontu — celowo nie kopiujemy literałów:
 * dwa pliki z tą samą datą `Expires` rozjadą się przy pierwszym odświeżeniu
 * (RFC 9116 §2.5.5 wymaga okresowej podmiany daty przez człowieka — patrz
 * docblock źródła). Import między aplikacjami jest tu świadomym wyjątkiem:
 * treść jest kontaktem PLATFORMY (identyczna dla każdego hosta), pas panelu
 * nie może edytować `apps/storefront`, a `packages/core` jej dziś nie niesie
 * — gdy treść przeprowadzi się do core, oba route'y przepinają import bez
 * zmiany zachowania.
 *
 * TRASA PLIKOWA — matcher proxy panelu wyklucza każdą ścieżkę z rozszerzeniem
 * (`/((?!_next\/static|_next\/image|favicon.ico|.*\.[\w]+$).*)/`, patrz
 * `proxy.ts`), więc żądanie NIE przechodzi przez middleware (brak redirectu
 * locale — dokładnie jak w storefroncie przy `robots.txt`, ADR-044). Nagłówki
 * bezpieczeństwa dokłada podłoga z `next.config.headers()`. RFC 9116 wymaga
 * dostępności BEZ logowania — ominięcie middleware'u jest właściwym
 * zachowaniem, nie luką.
 *
 * BEZ kontekstu sesji i tenanta: trasa nie czyta `Host`, nie dotyka bazy
 * i zwraca tę samą treść każdemu — stąd brak `dynamic = "force-dynamic"`
 * (odpowiedź nie zależy od żądania) i brak nagłówków CORS (zwykły plik
 * tekstowy, nie API).
 */
import { renderSecurityTxt } from "../../../../storefront/lib/seo/security-txt";

const HEADERS = {
  "content-type": "text/plain; charset=utf-8",
} as const;

export async function GET(): Promise<Response> {
  return new Response(renderSecurityTxt(), { headers: HEADERS });
}
