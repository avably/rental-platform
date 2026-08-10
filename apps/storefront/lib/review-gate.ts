/**
 * Bramka narzędzia przeglądu (ADR-071/099/115) po zdjęciu Basic Auth (ADR-128).
 *
 * DLACZEGO TEN PLIK ISTNIEJE. Do 2026-08-10 tryb przeglądu miał na
 * storefroncie DWIE bramki serwerowe: `REVIEW_MODE=1` oraz hasło całego
 * site'u w `proxy.ts`. Komentarze przy nakładce i przy relayu wprost się na
 * to hasło powoływały („storefront nie ma sesji, bo całość siedzi za hasłem").
 * ADR-128 zdejmuje hasło, więc ta przesłanka przestała być prawdziwa —
 * `REVIEW_MODE` zostałby JEDYNĄ obroną, a wystawiony przez pomyłkę
 * w produkcyjnym środowisku otwierałby nakładkę i relay uwag każdemu, kto
 * dopisze `?review=1` do adresu.
 *
 * CO ROBI. Domyka produkcję niezależnie od `REVIEW_MODE`: na Vercelu
 * `VERCEL_ENV` to `production` | `preview` | `development` (zmienna systemowa
 * platformy — patrz lekcja o kolizji prefiksów, dlatego jej NIE dublujemy
 * własną). W produkcji przegląd jest wyłączony na twardo; preview i lokalne
 * uruchomienia (w tym e2e, gdzie `VERCEL_ENV` nie istnieje) działają jak
 * dotąd, więc właściciel dalej ogląda i komentuje deploye podglądowe.
 *
 * FAIL-CLOSED. Warunek jest ścisłą równością z `"1"`, więc `undefined`, `""`,
 * `"0"`, `"true"` czy `"1 "` zamykają bramkę. Sprawdzenie wykonuje się PRZED
 * odczytem sekretu relaya i przed jakimkolwiek żądaniem wychodzącym.
 */
type ReviewEnv = Readonly<Record<string, string | undefined>>;

export function isReviewSurfaceEnabled(env: ReviewEnv = process.env): boolean {
  if (env.REVIEW_MODE !== "1") return false;
  return env.VERCEL_ENV !== "production";
}
