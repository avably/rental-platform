/**
 * ADRES STRONY SPRZĘTU po stronie sklepu (ADR-182) — jedno miejsce, w którym
 * pozycja katalogu zamienia się w ścieżkę.
 *
 * DLACZEGO TO NIE JEST GOŁE `productPathFromSlug`. Rdzeń liczy adres ZE SLUGA;
 * powierzchnie sklepu mają w ręku POZYCJĘ i muszą jeszcze rozstrzygnąć, co
 * zrobić, gdy rejestru adresów nie ma. Ta funkcja jest odpowiedzią na to drugie
 * pytanie i istnieje po to, żeby odpowiedź była JEDNA — kafel katalogu, kafel
 * sekcji, koszyk, sitemapa i kanon nie mogą się w niej rozjechać.
 *
 * DEGRADACJA JEST W STRONĘ ADRESU ZASTANEGO, nie w stronę 404. Rejestr bywa
 * `null` przy chwilowym błędzie odczytu; wtedy link prowadzi pod
 * `/product/{id}`, a tamta trasa dalej renderuje stronę sprzętu (przekierowuje
 * dopiero wtedy, gdy adres ZNA). Odwrotny wybór — link pod adres, którego
 * jeszcze nie znamy — zamieniałby blip odczytu w katalog samych 404.
 */
import { legacyProductPath, productPathFromSlug, productSlugById } from "@avably/core";
import type { ProductSlugRegistry } from "@avably/core";

/** Ścieżka strony sprzętu: adres bieżący, a bez rejestru — adres zastany. */
export function productPath(
  registry: ProductSlugRegistry | null,
  productId: string,
): string {
  const slug = productSlugById(registry, productId);
  return slug ? productPathFromSlug(slug) : legacyProductPath(productId);
}

/**
 * Mapa `id → ścieżka` dla komponentów KLIENCKICH (koszyk).
 *
 * Funkcji nie da się przekazać przez granicę serwer→klient, a przekazanie
 * całego rejestru zmuszałoby każdy taki komponent do powtórzenia reguły
 * degradacji. Mapa niesie już GOTOWĄ odpowiedź dla każdej pozycji, więc reguła
 * zostaje po stronie serwera — tam, gdzie jest jedna.
 */
export function productPaths(
  registry: ProductSlugRegistry | null,
  productIds: readonly string[],
): Record<string, string> {
  return Object.fromEntries(productIds.map((id) => [id, productPath(registry, id)]));
}
