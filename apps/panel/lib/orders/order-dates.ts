/**
 * Arytmetyka dat listy zamówień (kafle nagłówka + presety terminu) — czyste
 * funkcje na łańcuchach `YYYY-MM-DD`, zero I/O.
 *
 * „Dziś" liczymy w strefie Europe/Warsaw, bo okno „start w ciągu 3 dni" i
 * presety miesięcy to pojęcia operatora, nie serwera: północ UTC potrafi
 * cofnąć dzień o jeden względem tego, co operator widzi na zegarze.
 * Przesunięcia dni robimy w UTC, żeby zmiana czasu (DST) nie gubiła ani nie
 * dublowała dnia — daty są DNIOWE, godzina nie istnieje.
 */

/** Dzisiejsza data w Europe/Warsaw jako `YYYY-MM-DD` (format en-CA). */
export function warsawToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** `iso` przesunięte o `days` dni (może być ujemne), wynik `YYYY-MM-DD`. */
export function addIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
