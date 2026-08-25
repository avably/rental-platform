/**
 * TERMIN NAJMU PO LUDZKU (F8, spec 2026-08-25). Jeden formatter dla CAŁEJ
 * ścieżki sklepu: pasek terminu, koszyk, checkout, potwierdzenie. Do F8 klient
 * widział ISO „2026-08-26 → 2026-08-28" (audyt S-10), a fraza łamała się
 * w środku daty („2026-08-/28").
 *
 * ==================== KSZTAŁT WYNIKU ====================
 *
 * „26–28 sie 2026 · 3 dni" — zakres + długość w dobach w JEDNEJ frazie,
 * bo klient wynajmuje NA DOBY, a dopiero potem na daty (wycena mnoży doby).
 * Zakres jest INTELIGENTNY: wspólny miesiąc/rok nie powtarza się
 * („26–28 sie 2026"), różne miesiące rozpisują się w całości
 * („26 sie – 2 wrz 2026"), a najem jednodniowy to jedna data („26 sie 2026").
 * Zapis dat robi `Intl` w locale NAJEMCY — formatter nie zna żadnego języka
 * z osobna, więc trzeci rynek nie dopisze tu gałęzi dat.
 *
 * ==================== FRAZA ATOMOWA (S-10) ====================
 *
 * Wszystkie odstępy WEWNĄTRZ tokenów to NBSP — data i liczba dni nie łamią
 * się w środku na wąskim ekranie. Jedyny dozwolony punkt łamania to zwykła
 * spacja PRZED separatorem „·": wąska pigułka złamie frazę na
 * „26–28 sie 2026" / „· 3 dni", czyli na granicy znaczeń, nigdy w środku daty.
 *
 * ==================== DOBY, NIE MOMENTY ====================
 *
 * Wejście to `YYYY-MM-DD` (kontrakt `dates.ts`), a `Intl` dostaje północ UTC
 * z jawnym `timeZone: "UTC"` — inaczej przeglądarka w strefie ujemnej
 * cofnęłaby wyświetlaną datę o dobę względem tej, którą policzy wycena
 * (to samo ryzyko, które opisuje formatDate w mailach checkoutu).
 */
import { assertIsoDate, rentalDaysInclusive, type IsoDate } from "./dates";

const NBSP = "\u00a0";
const EN_DASH = "–";

/** Wszystkie odstępy (także cienkie z ICU) → NBSP: token nie łamie się w środku. */
function atomize(text: string): string {
  return text.replace(/\s+/gu, NBSP);
}

/**
 * Liczba dób słownie przy liczbie. Odmiana jest tu, a nie w copy najemcy,
 * bo liczbę i słowo skleja formatter — copy nie ma jak odmienić „1 dzień /
 * 3 dni" jedną wartością. Języki spoza listy dostają formę EN (ta sama
 * reguła co DEFAULT_LOCALE w locale.ts).
 */
function daysPhrase(days: number, locale: string): string {
  if (locale === "pl" || locale.startsWith("pl-")) {
    return days === 1 ? `1 dzień` : `${days} dni`;
  }
  return days === 1 ? `1 day` : `${days} days`;
}

/**
 * Zakres najmu po ludzku: „26–28 sie 2026 · 3 dni".
 *
 * Odstępy wokół półpauzy są ZNORMALIZOWANE po naszej regule, nie po ICU:
 * wspólny miesiąc i rok → zwarcie („26–28"), różne miesiące/lata → półpauza
 * z odstępami („26 sie – 2 wrz 2026"). ICU w `pl` skleja drugi przypadek
 * („26 sie–2 wrz"), przez co granica dat ginie w środku frazy.
 *
 * Zakres INCLUSIVE jak w całym silniku (2→8 marca = 7 dni); zakres odwrócony
 * i data spoza kalendarza rzucają `RangeError` z `dates.ts` — formatter nie
 * wymyśla własnej, trzeciej odpowiedzi na złe wejście.
 */
export function formatRentalRange(start: IsoDate, end: IsoDate, locale: string): string {
  assertIsoDate(start, "start");
  assertIsoDate(end, "end");
  const days = rentalDaysInclusive(start, end);

  const formatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);

  let range: string;
  if (start === end) {
    range = formatter.format(startDate);
  } else {
    const sameMonth = start.slice(0, 7) === end.slice(0, 7);
    range = formatter
      .formatRange(startDate, endDate)
      .replace(/\s*[–—-]\s*/u, sameMonth ? EN_DASH : `${NBSP}${EN_DASH}${NBSP}`);
  }

  return `${atomize(range)} ·${NBSP}${atomize(daysPhrase(days, locale))}`;
}
