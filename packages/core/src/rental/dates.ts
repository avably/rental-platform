/**
 * Arytmetyka dat najmu. CAŁA arytmetyka dat mieszka tutaj — nigdy w UI ani
 * w warstwie API. Rozproszenie „+1 dnia" po komponentach jest klasycznym
 * źródłem rozjazdu wyceny z kalendarzem: silnik liczy 7 dni, panel pokazuje 6.
 *
 * Doby, nie momenty. Data to `YYYY-MM-DD` w UTC — bez strefy, bez godziny.
 * Cała arytmetyka idzie przez `Date.UTC`, więc zmiana czasu (DST) nie ma jak
 * przesunąć wyniku o dobę: to nie jest ostrożność na wyrost, tylko powód, dla
 * którego lokalny `new Date("2026-03-29")` jest tu zakazany.
 *
 * Model jest timestamp-ready: gdy dojdą godzinowe najmy, zmienia się TEN
 * moduł, a nie każde miejsce wywołania.
 */

/** Data-tylko w UTC, format `YYYY-MM-DD`. */
export type IsoDate = string;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parsuje `YYYY-MM-DD` do liczby milisekund UTC.
 *
 * Sam regexp nie wystarcza: `2026-02-31` ma poprawny KSZTAŁT, a nie istnieje.
 * `Date.UTC` przepuściłby go, przewijając na 3 marca — najem policzyłby się
 * o dwa dni za krótko i nikt by tego nie zauważył. Stąd porównanie w drugą
 * stronę: dzień musi wrócić z powrotem tym samym zapisem.
 */
function parseIsoDateToUtcMs(value: IsoDate, label: string): number {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    throw new RangeError(`${label}: oczekiwano daty YYYY-MM-DD, otrzymano ${JSON.stringify(value)}`);
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  const ms = Date.UTC(year, month - 1, day);

  if (Number.isNaN(ms) || toIsoDate(ms) !== value) {
    throw new RangeError(`${label}: data nie istnieje w kalendarzu (${value})`);
  }

  return ms;
}

/** Milisekundy UTC → `YYYY-MM-DD`. */
function toIsoDate(utcMs: number): IsoDate {
  const date = new Date(utcMs);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Waliduje datę i zwraca ją w postaci znormalizowanej. */
export function assertIsoDate(value: IsoDate, label = "data"): IsoDate {
  parseIsoDateToUtcMs(value, label);
  return value;
}

/**
 * Przesuwa datę o `days` dób (ujemne = wstecz). Używane do buforów.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) {
    throw new RangeError(`addDays: liczba dób musi być całkowita, otrzymano ${days}`);
  }
  return toIsoDate(parseIsoDateToUtcMs(date, "date") + days * MS_PER_DAY);
}

/**
 * Długość najmu w dobach, zakres INCLUSIVE: 2→8 marca = 7 dni, a najem
 * jednodniowy (start = end) = 1 dzień, nie 0. Ta sama semantyka co CHECK-i
 * w migracji 0007 — kolizje i bufory liczą się tam identycznie.
 */
export function rentalDaysInclusive(start: IsoDate, end: IsoDate): number {
  const startMs = parseIsoDateToUtcMs(start, "start");
  const endMs = parseIsoDateToUtcMs(end, "end");

  if (endMs < startMs) {
    throw new RangeError(`Zakres najmu odwrócony: end (${end}) jest przed start (${start})`);
  }

  return Math.round((endMs - startMs) / MS_PER_DAY) + 1;
}

/**
 * Czy dwa zakresy INCLUSIVE zachodzą na siebie. Warunek jest celowo
 * `start <= bEnd AND end >= bStart` (nie half-open): przy zakresach domkniętych
 * najem kończący się tego samego dnia, którego zaczyna się kolejny, JEST
 * kolizją — jeden egzemplarz nie może być w dwóch miejscach.
 */
export function rangesOverlapInclusive(
  aStart: IsoDate,
  aEnd: IsoDate,
  bStart: IsoDate,
  bEnd: IsoDate,
): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}
