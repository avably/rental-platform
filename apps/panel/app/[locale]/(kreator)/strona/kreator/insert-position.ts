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
