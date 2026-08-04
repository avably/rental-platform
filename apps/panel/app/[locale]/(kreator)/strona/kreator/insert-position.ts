/**
 * Pozycja wstawienia sekcji na płótnie kreatora (K1, ADR-083) — czysta funkcja,
 * testowalna bez DOM-u i bez bazy.
 *
 * Kreator dodaje sekcję DOKŁADNIE TAM, gdzie operator kliknął „+" — a akcja
 * `upsertSection` (2.3a) zawsze dopisuje na KOŃCU, bo nie zna pojęcia „między".
 * Miejsce powstaje więc dopiero tutaj: świeże id wchodzi w komplet pozycji na
 * żądanym indeksie, a `reorderSections` zapisuje ten komplet jednym przebiegiem
 * (ta sama akcja co przeciąganie — drugiej ścieżki zapisu kolejności nie ma).
 *
 * Dlaczego to osobny moduł, a nie trzy linijki w komponencie: to jedyne miejsce
 * w K1, w którym „+ w środku strony" różni się od „+ na końcu". Wpięte w
 * komponent dałoby się sprawdzić tylko przez render, a różnica jest czysto
 * arytmetyczna.
 */

/**
 * Komplet id w kolejności PO wstawieniu `newId` na pozycję `index`.
 *
 * `index` liczony jest w skali listy BEZ nowego elementu: 0 = przed pierwszą
 * sekcją, `existingIds.length` = na końcu. Wartości spoza zakresu przycinamy do
 * krawędzi (klik w „+" na liście, która właśnie zmieniła długość, ma dołożyć
 * sekcję na brzegu, a nie wywrócić zapisu).
 *
 * `newId` jest najpierw usuwane z wejścia: po `upsertSection` świeża sekcja
 * bywa już w kompletach odczytanych z serwera, a zapis z DUPLIKATEM id znaczyłby
 * dwie pozycje dla jednego wiersza.
 */
export function orderWithInsertedAt(
  existingIds: readonly string[],
  newId: string,
  index: number,
): string[] {
  const without = existingIds.filter((id) => id !== newId);
  const at = Math.max(0, Math.min(Math.trunc(index), without.length));
  return [...without.slice(0, at), newId, ...without.slice(at)];
}

/**
 * Pudełko sekcji na płótnie, zmierzone w oknie. Tyle, ile potrzeba, żeby
 * odpowiedzieć na pytanie „przed którą sekcją stanie ta upuszczona" — i ani
 * pola więcej, bo wszystko poza tym jest już wiedzą o DOM-ie.
 */
export interface SectionBand {
  /** Pozycja sekcji na liście (0 = pierwsza). */
  index: number;
  /** Górna i dolna krawędź w układzie okna (`getBoundingClientRect`). */
  top: number;
  bottom: number;
}

/**
 * MIEJSCE WSTAWIENIA POD KURSOREM (K6, ADR-092) — czysta funkcja.
 *
 * Do K6 sekcja z palety lądowała ZAWSZE na końcu strony: paleta nie znała
 * pojęcia „gdzie". Przeciąganie kafla wymaga odpowiedzi na to pytanie w każdej
 * klatce ruchu, a nie tylko przy puszczeniu — bo podświetlony slot ma
 * OBIECYWAĆ wynik, a nie zgadywać go po fakcie.
 *
 * Reguła jest najprostsza z możliwych i celowo taka zostaje: liczy się POŁOWA
 * WYSOKOŚCI sekcji, nad którą stoi kursor. Powyżej połowy — sekcja wejdzie
 * przed nią, poniżej — za nią. Alternatywa „najbliższa krawędź" daje ten sam
 * wynik przy sekcjach równej wysokości, ale przy sekcji bardzo wysokiej
 * (hero pełnokadrowe) zachowuje się nieprzewidywalnie: kursor w środku hero
 * jest wtedy bliżej krawędzi górnej, choć wizualnie stoi pośrodku.
 *
 * `maxIndex` przycina wynik od góry i jest tym, przez co stopka nie da się
 * podkopać: strona ze stopką ma o jedno miejsce mniej niż sekcji (patrz
 * `insertableSlots` w @avably/core/site).
 *
 * Kursor POZA wszystkimi sekcjami (nad pierwszą albo pod ostatnią) daje
 * odpowiednio 0 i `maxIndex` — upuszczenie tuż obok płótna ma dołożyć sekcję
 * na brzegu, a nie odmówić.
 */
export function insertIndexAtPointer(
  bands: readonly SectionBand[],
  pointerY: number,
  maxIndex: number,
): number {
  const limit = Math.max(0, Math.trunc(maxIndex));
  if (bands.length === 0) return 0;

  const ordered = [...bands].sort((first, second) => first.index - second.index);
  for (const band of ordered) {
    if (pointerY >= band.bottom) continue;
    const middle = band.top + (band.bottom - band.top) / 2;
    const at = pointerY < middle ? band.index : band.index + 1;
    return Math.max(0, Math.min(at, limit));
  }
  // Kursor pod ostatnią sekcją — koniec strony (albo tuż nad stopką).
  return limit;
}
