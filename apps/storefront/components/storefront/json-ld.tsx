/**
 * Blok schema.org (JSON-LD) na stronie tenanta — Zadanie 2.7, ADR-044.
 *
 * BEZ NONCE — i to jest decyzja SPRAWDZONA, nie przeoczenie. CSP storefrontu ma
 * `script-src` oparty na nonce, bez 'unsafe-inline' (@avably/security), więc
 * pierwsza wersja nadawała nonce także temu blokowi. Pomiar w przeglądarce
 * pokazał dwie rzeczy:
 *   1. bez nonce NIE MA naruszenia CSP — `type="application/ld+json"` to blok
 *      DANYCH, a nie skrypt do wykonania, i `script-src` go nie obejmuje;
 *   2. z nonce pojawia się błąd hydratacji: przeglądarka po sparsowaniu
 *      CZYŚCI atrybut `nonce` w DOM (wymóg HTML), więc klient widzi `nonce=""`
 *      tam, gdzie serwer wyrenderował wartość, i React zgłasza rozjazd.
 * Nonce nic tu nie chronił, a psuł hydratację — dlatego go nie ma.
 *
 * `dangerouslySetInnerHTML` jest ŚWIADOME i bezpieczne — ale wyłącznie dlatego,
 * że wejście przechodzi przez `serializeJsonLd`, które ucieka `<`, `>`, `&` i
 * separatory U+2028/U+2029 (patrz lib/seo/jsonld.ts). Bez tego `</script>` w
 * nazwie produktu wyszedłby z kontekstu skryptu. Zwykłe dziecko tekstowe NIE
 * jest alternatywą: React eskejpuje je encjami HTML, a te wewnątrz `<script>`
 * nie są rozwijane — JSON przestałby się parsować.
 */
import { serializeJsonLd } from "@/lib/seo/jsonld";

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
