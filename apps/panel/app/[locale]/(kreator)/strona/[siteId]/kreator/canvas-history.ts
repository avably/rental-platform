/**
 * HISTORIA PŁÓTNA — cofnij/ponów (K2, ADR-084; obietnica ADR-083, decyzja 8).
 *
 * Czyste funkcje na trzech listach: co było, co jest, co cofnięto. Stanem jest
 * MAPA szkiców wszystkich sekcji, a nie pojedyncza sekcja — bo operator myśli
 * o „poprzednim stanie strony", a nie o osobnym stosie dla każdej sekcji;
 * przy dwunastu stosach „cofnij" musiałoby jeszcze zgadywać, który z nich
 * miał na myśli.
 *
 * GRANICE (świadome, opisane w ADR-084):
 *   • historia jest PAMIĘCIOWA — żyje tyle, co otwarty kreator; wyjście z trasy
 *     ją kasuje. Trwała historia to wersjonowanie treści, czyli osobna decyzja
 *     o modelu danych, a nie efekt uboczny przycisku w pasku;
 *   • wpisów jest najwyżej {@link HISTORY_LIMIT} — dalej wypada NAJSTARSZY;
 *   • w historii są operacje PŁÓTNA (geometria, warstwa, dodanie i usunięcie
 *     elementu, wysokość i tło sekcji). Operacje na LIŚCIE sekcji (dodanie,
 *     usunięcie, kolejność) idą prosto do bazy i historii nie dotyczą — cofanie
 *     usunięcia sekcji wymagałoby przywrócenia wiersza, a nie stanu w pamięci.
 */

/** Sufit głębokości historii. Pięćdziesiąt kroków to sesja pracy, nie archiwum. */
export const HISTORY_LIMIT = 50;

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export function initialHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] };
}

/**
 * Nowy stan po zmianie. Gałąź „ponów" ZNIKA — po cofnięciu i zrobieniu czegoś
 * innego przyszłość, do której można by wrócić, przestaje istnieć; zostawienie
 * jej dałoby przycisk prowadzący do układu, którego operator nigdy nie widział.
 */
export function commitHistory<T>(
  state: HistoryState<T>,
  next: T,
  limit: number = HISTORY_LIMIT,
): HistoryState<T> {
  if (next === state.present) return state;
  const past = [...state.past, state.present];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
  };
}

/**
 * Podmiana stanu BEZ wpisu do historii — podgląd w trakcie przeciągania.
 * Bez tego każdy piksel ruchu myszą byłby osobnym krokiem „cofnij".
 */
export function replacePresent<T>(state: HistoryState<T>, next: T): HistoryState<T> {
  return next === state.present ? state : { ...state, present: next };
}

export function canUndo<T>(state: HistoryState<T>): boolean {
  return state.past.length > 0;
}

export function canRedo<T>(state: HistoryState<T>): boolean {
  return state.future.length > 0;
}

export function undoHistory<T>(state: HistoryState<T>): HistoryState<T> {
  const previous = state.past.at(-1);
  if (previous === undefined) return state;
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
  };
}

export function redoHistory<T>(state: HistoryState<T>): HistoryState<T> {
  const [next, ...rest] = state.future;
  if (next === undefined) return state;
  return { past: [...state.past, state.present], present: next, future: rest };
}

/**
 * Klucze, których wartość się rozjechała między dwiema mapami — po cofnięciu
 * zapisujemy TYLKO te sekcje, które naprawdę się zmieniły. Porównanie jest
 * referencyjne, bo szkice są niemutowalne: każda zmiana tworzy nowy obiekt,
 * więc równość referencji znaczy „bez zmian", a nie „może bez zmian".
 */
export function changedKeys<T>(before: Record<string, T>, after: Record<string, T>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => before[key] !== after[key]);
}
