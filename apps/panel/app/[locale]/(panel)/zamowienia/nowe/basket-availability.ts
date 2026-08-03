/**
 * Dostępność KOSZYKA dzień po dniu (R3, pinezka o kalendarzu terminu).
 *
 * Do R3 kreator malował osobny pasek dostępności per produkt. Kalendarz jest
 * jeden, więc potrzebna jest JEDNA odpowiedź na pytanie „czy tego dnia da się
 * wynająć TO, co mam w koszyku". Ta odpowiedź to koniunkcja: dzień jest wolny
 * dokładnie wtedy, gdy KAŻDY produkt koszyka jest tego dnia dostępny — jeden
 * zajęty produkt blokuje cały termin, bo zamówienie jest niepodzielne.
 *
 * Moduł jest CZYSTY i nie zna dat: operuje na gotowych mapach dni z silnika
 * (`buildDayMap`, ADR-022), a dzień porównuje jako string `YYYY-MM-DD`. Cała
 * arytmetyka kalendarzowa — łącznie z buforami logistycznymi — siedzi
 * w silniku i tu nie jest powtarzana.
 */
import type { DayAvailability } from "../pricing";

/**
 * Scalenie map dni w jedną mapę koszyka.
 *
 * PUSTY koszyk daje PUSTĄ mapę, a nie „wszystko wolne": brak produktów to
 * brak wiedzy o zajętości, a kalendarz malujący wtedy same wolne dni
 * obiecywałby dostępność, której nikt nie sprawdził.
 *
 * Mapy mogą mieć różne zakresy (produkt dodany później liczony od innego
 * dnia nie jest niemożliwy) — wynik obejmuje SUMĘ dni, a dzień nieobecny
 * w którejś mapie liczy się jako NIEZNANY, czyli niedostępny. Zgadywanie
 * w drugą stronę pokazywałoby wolny termin na podstawie braku danych.
 */
export function mergeDayMaps(dayMaps: readonly DayAvailability[][]): DayAvailability[] {
  if (dayMaps.length === 0) return [];

  const days = new Set<string>();
  for (const map of dayMaps) {
    for (const entry of map) days.add(entry.day);
  }

  const byDay = dayMaps.map((map) => new Map(map.map((entry) => [entry.day as string, entry.available])));

  return [...days]
    .sort()
    .map((day) => ({
      day: day as DayAvailability["day"],
      available: byDay.every((map) => map.get(day) === true),
    }));
}

/** Dni ZAJĘTE z mapy — wejście modyfikatora kalendarza. */
export function blockedDays(dayMap: readonly DayAvailability[]): string[] {
  return dayMap.filter((entry) => !entry.available).map((entry) => entry.day);
}

/**
 * Czy WYBRANY zakres jest w całości wolny wg mapy koszyka.
 *
 * Odpowiedź „nie wiem" (dzień poza mapą) traktujemy jak zajęty — z tego
 * samego powodu co wyżej. Zakres odwrócony (koniec przed początkiem) nie
 * jest terminem i nie ma jak być wolny.
 */
export function rangeIsFree(
  dayMap: readonly DayAvailability[],
  start: string,
  end: string,
): boolean {
  if (start === "" || end === "" || end < start) return false;
  const known = new Map(dayMap.map((entry) => [entry.day as string, entry.available]));
  for (const entry of dayMap) {
    if (entry.day >= start && entry.day <= end && !entry.available) return false;
  }
  // Zakres wystający poza znaną mapę = nieznana zajętość na krańcu.
  return known.has(start) && known.has(end);
}
