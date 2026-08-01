/**
 * HISTORIA PŁÓTNA (K2, ADR-084) — funkcje czyste, bez DOM-u.
 *
 * „Cofnij" jest obietnicą, że da się wrócić do stanu, który operator widział
 * na własne oczy. Ten plik pilnuje trzech rzeczy, które tę obietnicę łamią
 * najczęściej: gałęzi „ponów", która przeżyła nową zmianę; sufitu, który
 * wyrzuca NAJNOWSZY zamiast najstarszego; i zapisu, który po cofnięciu
 * przepisuje wszystkie sekcje zamiast tych naprawdę ruszonych.
 */
import { describe, expect, it } from "vitest";

import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  changedKeys,
  commitHistory,
  initialHistory,
  redoHistory,
  replacePresent,
  undoHistory,
} from "@/app/[locale]/(kreator)/strona/kreator/canvas-history";

describe("stos cofnij/ponów", () => {
  it("świeża historia nie ma czego cofnąć ani ponowić", () => {
    const state = initialHistory("a");
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
  });

  it("cofnięcie wraca do POPRZEDNIEGO stanu i otwiera „ponów”", () => {
    const state = redoHistory(undoHistory(commitHistory(commitHistory(initialHistory("a"), "b"), "c")));
    // a → b → c, cofnij → b, ponów → c.
    expect(state.present).toBe("c");
    expect(undoHistory(state).present).toBe("b");
  });

  it("nowa zmiana KASUJE gałąź „ponów”", () => {
    // Inaczej przycisk prowadziłby do układu, którego operator nigdy nie widział.
    const after = commitHistory(undoHistory(commitHistory(initialHistory("a"), "b")), "c");
    expect(canRedo(after)).toBe(false);
    expect(after.present).toBe("c");
  });

  it("zmiana na TEN SAM stan nie dokłada kroku", () => {
    const state = commitHistory(initialHistory("a"), "a");
    expect(canUndo(state)).toBe(false);
  });

  it("podgląd (replacePresent) NIE dokłada kroku", () => {
    const state = replacePresent(initialHistory("a"), "b");
    expect(state.present).toBe("b");
    expect(canUndo(state)).toBe(false);
  });

  it("sufit wyrzuca NAJSTARSZY krok, a nie najnowszy", () => {
    let state = initialHistory(0);
    for (let step = 1; step <= HISTORY_LIMIT + 5; step += 1) state = commitHistory(state, step);
    expect(state.past).toHaveLength(HISTORY_LIMIT);
    expect(state.present).toBe(HISTORY_LIMIT + 5);
    // Najstarszy zachowany krok jest o `HISTORY_LIMIT` wstecz — gdyby sufit
    // wycinał od końca, byłoby tu 0.
    expect(state.past[0]).toBe(HISTORY_LIMIT + 5 - HISTORY_LIMIT);
  });

  it("cofnięcie po dobiciu do sufitu nadal działa", () => {
    let state = initialHistory(0);
    for (let step = 1; step <= HISTORY_LIMIT + 5; step += 1) state = commitHistory(state, step);
    expect(undoHistory(state).present).toBe(HISTORY_LIMIT + 4);
  });

  it("cofnięcie pustej historii nie wywraca stanu", () => {
    const state = initialHistory("a");
    expect(undoHistory(state)).toBe(state);
    expect(redoHistory(state)).toBe(state);
  });
});

describe("co zapisać po cofnięciu", () => {
  const a = { rows: 10 };
  const b = { rows: 20 };

  it("wskazuje TYLKO klucze, których wartość się rozjechała", () => {
    expect(changedKeys({ x: a, y: b }, { x: a, y: { rows: 30 } })).toEqual(["y"]);
  });

  it("dodanie i usunięcie klucza też jest zmianą", () => {
    expect(changedKeys({ x: a }, { x: a, y: b }).sort()).toEqual(["y"]);
    expect(changedKeys({ x: a, y: b }, { x: a })).toEqual(["y"]);
  });

  it("identyczna zawartość pod NOWĄ referencją liczy się jako zmiana", () => {
    // Świadome: szkice są niemutowalne, więc nowa referencja znaczy „ktoś to
    // przepisał". Porównywanie głębokie kosztowałoby przy każdym ruchu myszy.
    expect(changedKeys({ x: { rows: 10 } }, { x: { rows: 10 } })).toEqual(["x"]);
  });
});
