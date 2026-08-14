/**
 * OKNO DOSTĘPNOŚCI — jedna liczba na cały produkt (ADR-179).
 *
 * Kalendarz sprzętu pyta bazę o mapę „dzień → wolne sztuki". To jedyna
 * z publicznych funkcji dostępności, której ROZMIAR ODPOWIEDZI rośnie
 * z argumentem: okno o szerokości n dni każe policzyć n zakresów jednodniowych
 * na każdą sztukę. Bez sufitu jedno żądanie z datą końcową w 2099 roku jest
 * legalnym żądaniem.
 *
 * Sufit stoi w DWÓCH miejscach i to nie jest duplikat:
 *
 *   • `app.get_public_availability_days` (migracja 0081) ODMAWIA okna
 *     szerszego — to jest bramka, bo argumenty przychodzą do PostgREST-a
 *     wprost z sieci i interfejs nie ma nad nimi władzy;
 *   • ta stała rządzi HORYZONTEM kalendarza — najdalszym dniem, do którego
 *     klient może przewinąć siatkę.
 *
 * Wiąże je DOWÓD ZACHOWANIA, a nie porównanie tekstów: bramka
 * `packages/db/test/public-availability-calendar.test.ts` woła funkcję oknem
 * o szerokości WYLICZONEJ Z TEJ STAŁEJ i oknem o jeden dzień szerszym.
 * Rozjazd którejkolwiek ze stron pali ten test — porównanie literału w SQL-u
 * z tą liczbą paliłoby się tylko wtedy, gdyby literał został PRZEPISANY,
 * a nie przeniesiony.
 */

import { addDays, assertIsoDate, rentalDaysInclusive, type IsoDate } from "./dates";

/**
 * Ile DNI (INCLUSIVE) najszerzej wolno objąć jednym pytaniem o dostępność
 * dzienną. 90 to trzy pełne miesiące siatki — tyle, ile klient realnie
 * przegląda planując najem, i na tyle mało, żeby odpowiedź mieściła się
 * w jednym żądaniu bez stronicowania.
 *
 * Okno jednodniowe ma szerokość 1, więc okno o dokładnie tej szerokości
 * jeszcze PRZECHODZI — sufit jest granicą włączną.
 */
export const AVAILABILITY_WINDOW_MAX_DAYS = 90;

/**
 * Ostatni dzień, o który kalendarz ma prawo zapytać, licząc od `from`
 * WŁĄCZNIE. Dla sufitu 90 i `from` = 1 stycznia wychodzi 31 marca, czyli
 * dziewięćdziesiąty dzień okna — nie dziewięćdziesiąty pierwszy.
 *
 * To jest HORYZONT interfejsu: dzień, poza który przycisk „następny miesiąc"
 * nie przewija. Nie jest bramką i nie udaje bramki — bramka stoi w bazie.
 */
export function availabilityWindowEnd(from: IsoDate): IsoDate {
  return addDays(assertIsoDate(from, "from"), AVAILABILITY_WINDOW_MAX_DAYS - 1);
}

/**
 * Czy zakres mieści się w suficie — LUSTRO warunku, którym odmawia baza.
 *
 * Zakres odwrócony NIE MIEŚCI SIĘ (zamiast rzucać): wołający pyta „czy mogę
 * o to zapytać", a na to pytanie odwrócony zakres ma odpowiedź „nie", a nie
 * wyjątek. Kształt daty pozostaje twardym błędem, bo śmieć w dacie jest wadą
 * wołającego, a nie stanem, o który wolno pytać.
 */
export function isWithinAvailabilityWindow(start: IsoDate, end: IsoDate): boolean {
  assertIsoDate(start, "start");
  assertIsoDate(end, "end");
  if (end < start) return false;
  return rentalDaysInclusive(start, end) <= AVAILABILITY_WINDOW_MAX_DAYS;
}
