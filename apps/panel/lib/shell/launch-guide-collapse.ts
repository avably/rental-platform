/**
 * Zwinięcie sticky paska przewodnika uruchomienia (ADR-229).
 *
 * BEZ MIGRACJI I BEZ BAZY: „zwinięty / rozwinięty" to stan interfejsu jednego
 * urządzenia, więc mieszka w CIASTECZKU, nie w kolumnie tenanta. Ciasteczko, a
 * nie `localStorage`, bo pasek renderuje SERWER (layout) — musi znać stan PRZED
 * pierwszym malowaniem, żeby oddać od razu poprawny wariant (rozwinięty albo
 * hairline) i NIE mrugnąć rozwiniętym paskiem przy każdej nawigacji. Odczyt
 * po stronie serwera (`cookies()` w layoucie) daje SSR-spójny stan bez skryptu
 * startowego: hydracja klienta zaczyna od tej samej wartości, więc różnicy nie
 * ma czego pogodzić (inaczej niż motyw/sidebar, które wiszą na `<html>` i muszą
 * lecieć skryptem przed parsowaniem powłoki).
 *
 * Nie jest poświadczeniem — nic wrażliwego, więc `HttpOnly` byłoby tylko
 * przeszkodą (przełącznik zapisuje je z klienta).
 */

export const LAUNCH_GUIDE_COOKIE = "avably-guide";
export const LAUNCH_GUIDE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type LaunchGuideCollapse = "expanded" | "collapsed";

/** Stan z surowej wartości ciasteczka — wszystko poza `"collapsed"` to rozwinięty. */
export function launchGuideCollapseFrom(
  raw: string | null | undefined,
): LaunchGuideCollapse {
  return raw === "collapsed" ? "collapsed" : "expanded";
}
