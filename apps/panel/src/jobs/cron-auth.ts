/**
 * Bramka wejścia tras zadań cyklicznych — JEDNA implementacja (ADR-130).
 *
 * ================== DLACZEGO TO MIESZKA W JEDNYM MIEJSCU ==================
 *
 * Do ADR-130 ta sama funkcja stała PIĘCIOKROTNIE przepisana w plikach tras.
 * Kopie były zgodne co do znaku, ale zgodność kopii jest stanem chwilowym,
 * nie własnością: nic nie pilnowało, żeby piąta nie osunęła się do zwykłego
 * `===`. Osunięcie się NIE MA OBJAWU — odmowa wygląda identycznie, wszystkie
 * testy świecą na zielono, a różnicę widać wyłącznie w czasie odpowiedzi.
 * Jedna implementacja to jedno miejsce, którego trzeba pilnować.
 *
 * ================== CZEGO NIE DA SIĘ DOWIEŚĆ TESTEM ==================
 *
 * Stałoczasowości NIE MOŻNA wykazać behawioralnie: `===` i `timingSafeEqual`
 * zwracają to samo dla każdego wejścia, a różnica rzędu nanosekund tonie
 * w szumie pomiaru. Dlatego dowód jest DWUCZĘŚCIOWY (`cron-auth.test.ts`):
 * zachowanie bramki sprawdza test zwykły, a użycie `timingSafeEqual`
 * — kontrakt źródła czytany PO USUNIĘCIU KOMENTARZY, żeby literał
 * przeniesiony do komentarza nie zwiódł bramki.
 */
import { timingSafeEqual } from "node:crypto";

/**
 * Czy nagłówek niesie poprawny sekret harmonogramu.
 *
 * Różnica długości kończy się `false` BEZ wołania `timingSafeEqual` — ta rzuca
 * przy buforach różnej długości, a rzucony wyjątek zamieniłby odmowę (401)
 * w błąd serwera (500). Sama długość sekretu i tak nie jest tajemnicą.
 */
export function cronAuthorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
