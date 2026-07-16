/**
 * Konwersja kwot między polem formularza a groszami — JEDYNE miejsce tej
 * konwersji w panelu (grosze to kontrakt bazy, patrz 0007: kolumny *_grosze).
 *
 * Zasady:
 *   - wejście w jednostkach głównych, separator dziesiętny "," LUB "."
 *     ("100,50" i "100.50" to ta sama kwota),
 *   - maksymalnie DWA miejsca po separatorze — trzecie miejsce to odrzucenie,
 *     nie zaokrąglenie: zaokrąglona kwota jest inną kwotą, niż wpisał operator,
 *   - bez separatorów tysięcy, bez znaku, bez spacji wewnętrznych — kwota z
 *     panelu to liczba, nie tekst sformatowany,
 *   - render w drugą stronę wyłącznie przez formatMoney z @avably/core
 *     (waluta i locale są DANYMI, nie stałą).
 */

/**
 * "100,50" | "100.50" | "100" → grosze (10050 | 10050 | 10000).
 * `null` = wejście odrzucone (walidacja pokazuje komunikat, nic nie zgaduje).
 */
export function parseMajorToGrosze(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const [major = "", minor = ""] = normalized.split(".");
  const grosze = Number(major) * 100 + Number(minor.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(grosze)) return null;
  return grosze;
}

/**
 * Grosze → wartość pola formularza (defaultValue przy edycji). Kropka jako
 * separator (akceptowana przez parser na równi z przecinkiem); pełne złote
 * bez części dziesiętnej ("100", nie "100.00").
 */
export function groszeToInputValue(grosze: number): string {
  if (!Number.isSafeInteger(grosze) || grosze < 0) {
    throw new RangeError(`groszeToInputValue: oczekiwano całkowitej liczby groszy >= 0, otrzymano ${grosze}`);
  }
  const major = Math.floor(grosze / 100);
  const minor = grosze % 100;
  return minor === 0 ? String(major) : `${major}.${String(minor).padStart(2, "0")}`;
}

/**
 * Mnożnik z pola formularza ("6,5" | "6.5" | "1") → liczba > 0, maks. dwa
 * miejsca dziesiętne. Ta sama dyscyplina wejścia co przy kwotach — mnożnik
 * progu mnoży pieniądze (ADR-018: cena CAŁKOWITA progu w krotności ceny
 * dziennej), więc dowolna precyzja float nie wchodzi w grę.
 */
export function parseMultiplier(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}
