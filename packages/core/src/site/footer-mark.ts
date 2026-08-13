/**
 * CZY ZNAK FIRMY WEJDZIE DO TEJ STOPKI (ADR-167) — JEDNA ODPOWIEDŹ NA DWA
 * PYTANIA ZADAWANE W DWÓCH WARSTWACH.
 *
 * ==================== SKĄD SIĘ WZIĄŁ TEN PLIK ====================
 *
 * ADR-160 dał najemcy przełącznik „pokaż znak także w stopce", a render
 * zastosował go WYŁĄCZNIE w stopce v1 — przy założeniu, że to jedyny kształt
 * stopki, jaki kreator produkuje. Założenie było odwrotne do prawdy: kreator
 * konwertuje KAŻDĄ dodawaną sekcję na płótno v2 (`sectionCanvasFrom`), więc
 * stopka v1 nie powstaje w ogóle. Przełącznik był widoczny, zaznaczalny,
 * publikowalny — i martwy dla każdej realnej stopki.
 *
 * ==================== DLACZEGO PREDYKAT, A NIE `if` W RENDERZE ====================
 *
 * Naprawa renderu zamyka połowę wady. Druga połowa jest taka, że po naprawie
 * DALEJ zostaje kształt stopki, do którego znak nie wchodzi (patrz niżej) —
 * a przełącznik bez skutku jest gorszy niż jego brak dokładnie wtedy, gdy
 * ekran o tym milczy. Ekran musi więc umieć powiedzieć to samo, co robi render,
 * i musi to być TA SAMA funkcja: dwie kopie reguły to dwie okazje, żeby ekran
 * obiecał coś, czego render nie zrobi (albo odwrotnie — straszył bez powodu).
 *
 * Funkcja jest tu, a nie w pakiecie UI, bo czytają ją dwie warstwy naraz:
 * render sklepu (`@avably/ui`) i ekran „Strona sklepu" w panelu. Rdzeń jest
 * jedynym miejscem, które widzą obie.
 */
import { isSectionCanvas } from "./elements";

/**
 * Czy do stopki o tej treści wejdzie znak firmy najemcy.
 *
 * Trzy kształty stopki, trzy odpowiedzi:
 *
 * ① **v1 (`FooterContent`)** — TAK. Stopka v1 ma dla znaku miejsce z projektu:
 *    pudełko nad nazwą firmy w lewej kolumnie (`FooterSection`).
 *
 * ② **płótno v2 BEZ własnego obrazu** — TAK. Znak dostaje własny pas pod siatką
 *    płótna. Pas jest w PRZEPŁYWIE, a nie na współrzędnych, i to nie jest
 *    wygoda implementacji: geometria płótna jest ABSOLUTNA, więc każde miejsce
 *    wskazane wewnątrz siatki jest zgadywaniem — sąsiada nie odsuwa, tylko go
 *    przykrywa. Pas nie ma jak wejść na cudzy element, bo leży poza siatką.
 *
 * ③ **płótno v2 Z WŁASNYM OBRAZEM** — NIE. To jest jedyny wyjątek i ma
 *    konkretną przyczynę: przez cały czas życia ADR-160 przełącznik był martwy,
 *    więc JEDYNĄ drogą do znaku w stopce było wstawienie go tam RĘCZNIE, jako
 *    zwykłego elementu obrazu. Wstrzyknięcie pasa takiej stopce dałoby dwa
 *    znaki obok siebie — i dałoby je w chwili WDROŻENIA, bez żadnego ruchu
 *    operatora, czyli na sklepie, który wyglądał dobrze. Regres wywołany
 *    naszym deployem jest gorszy niż ograniczenie, o którym mówimy wprost.
 *
 * Rodzaju obrazu nie rozróżniamy i nie da się go rozróżnić: znak firmy,
 * odznaka płatności i zdjęcie lokalu są w treści tym samym elementem. Dlatego
 * reguła jest zbiorcza, a ekran nazywa strony, których dotyczy — operator
 * usuwa swój obraz i znak wchodzi.
 *
 * Treść przychodzi jako `unknown`, bo panel czyta ją prosto z kolumny `jsonb`
 * (bez schematu), a sklep — po sparsowaniu. Obie drogi mają dać tę samą
 * odpowiedź, więc kształt sprawdzamy tutaj, a nie u wołających.
 */
export function footerAcceptsMark(content: unknown): boolean {
  if (!isSectionCanvas(content)) return true;
  const elements = (content as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return true;
  return !elements.some(
    (element) =>
      typeof element === "object" &&
      element !== null &&
      (element as { kind?: unknown }).kind === "image",
  );
}
