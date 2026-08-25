/**
 * Formatowanie kwot. Waluta jest DANYMI, nie stałą — PLN jest dziś jedyną
 * walutą rozliczeniową, ale nic w kodzie nie może tego zakładać (EUR/USD
 * dochodzą wraz z rynkami poza PL).
 *
 * Kwoty trzymamy w jednostkach podrzędnych (grosze/cents) jako `int` — liczby
 * zmiennoprzecinkowe nie nadają się do pieniędzy.
 */

export const SUPPORTED_CURRENCIES = ["PLN", "EUR", "USD"] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/** Waluta rozliczeniowa domyślna dla nowych planów (rynek startowy: PL). */
export const DEFAULT_CURRENCY: CurrencyCode = "PLN";

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Ile jednostek podrzędnych mieści się w jednostce głównej. Wszystkie
 * obsługiwane dziś waluty mają wykładnik 2; waluty zerowo-groszowe (JPY) będą
 * wymagały wpisu tutaj, dlatego wartość jest w tabeli, a nie w literale 100.
 */
const MINOR_UNITS_PER_MAJOR: Record<CurrencyCode, number> = {
  PLN: 100,
  EUR: 100,
  USD: 100,
};

/**
 * GRUPOWANIE TYSIĘCY WYMUSZONE, nie „domyślne z locale" (S-48a, audyt UX
 * 2026-08-25). CLDR dla `pl` ma `minimumGroupingDigits=2`, więc `Intl` bez tej
 * opcji grupuje dopiero OD PIĘCIU cyfr: „10 000,00 zł", ale „1000,00 zł" —
 * a polska typografia cen grupuje od czterech („1 000,00 zł"). Wartość
 * `"always"` (Intl.NumberFormat v3, ES2023) znosi próg CLDR i grupuje zawsze,
 * separatorem właściwym dla locale — w `pl` jest nim TWARDA spacja U+00A0,
 * więc kwota zostaje frazą atomową i nie łamie się na końcu wiersza (ta sama
 * lekcja, co S-40/F2). Locale bez progu (en: „1,000.00") nie zmienia zapisu.
 *
 * Rzut typu: lib TS repo to ES2022, w którym `useGrouping` zna tylko boolean;
 * środowiska uruchomieniowe (Node 22, przeglądarki) wartość znają.
 */
const GROUPING_ALWAYS = "always" as unknown as Intl.NumberFormatOptions["useGrouping"];

/**
 * Kwota do wyświetlenia w danym locale. Locale steruje ZAPISEM (separatory,
 * pozycja symbolu), waluta — symbolem: "1 299,00 zł" w `pl`, "PLN 1,299.00"
 * w `en`. To dwie niezależne osie i nie wolno ich sklejać.
 */
export function formatMoney(amountMinor: number, currency: CurrencyCode, locale: string): string {
  const divisor = MINOR_UNITS_PER_MAJOR[currency];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    useGrouping: GROUPING_ALWAYS,
  }).format(amountMinor / divisor);
}

// -----------------------------------------------------------------------
// KWOTA POD KLAWISZAMI OPERATORA (E6, aneks ADR-094)
// -----------------------------------------------------------------------

/**
 * KWOTA W POLU EDYCJI — bez symbolu waluty i bez separatora tysięcy.
 *
 * To NIE JEST {@link formatMoney} z wyciętym symbolem: tamta funkcja składa
 * kwotę DO CZYTANIA (symbol, odstępy tysięcy, zapis locale), a ta wypełnia
 * `<input>`, którego wartość zaraz wróci do {@link parseMoneyAmount}. Separator
 * tysięcy w polu edycji jest wprost szkodliwy — „1 299,00” po jednej poprawce
 * bywa „1 299,0” i przestaje być liczbą, a operator nie ma jak zgadnąć, że
 * spacja była naszym pomysłem, a nie jego literówką.
 *
 * Separator dziesiętny idzie za to Z LOCALE, bo pod nim stoi klawiatura
 * operatora: przecinek w `pl`, kropka w `en`.
 */
export function formatMoneyAmount(amountMinor: number, currency: CurrencyCode, locale: string): string {
  const divisor = MINOR_UNITS_PER_MAJOR[currency];
  return new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / divisor);
}

/**
 * KWOTA WPISANA RĘCZNIE → JEDNOSTKI PODRZĘDNE (`int`), albo `null`, gdy wejście
 * kwotą nie jest.
 *
 * ==================== DLACZEGO PARSER, A NIE `Number()` ====================
 *
 * `Number("120,50")` daje `NaN`, `Number("")` daje `0`, a `parseFloat("120zł")`
 * daje `120` — czyli każde z trzech gotowych narzędzi myli się inaczej i żadne
 * nie odróżnia „operator jeszcze pisze” od „to nie jest kwota”. Cena zapisana
 * do treści sekcji jedzie prosto na opublikowaną stronę, więc pomyłka o rząd
 * wielkości jest tu droższa niż w jakimkolwiek innym polu edytora.
 *
 * ==================== CO PRZYJMUJEMY, A CZEGO NIE ====================
 *
 * Przyjmujemy cyfry z NAJWYŻEJ JEDNYM separatorem dziesiętnym — przecinkiem
 * albo kropką — i najwyżej dwoma miejscami po nim. Oba znaki naraz („1.299,00”)
 * są ODRZUCANE świadomie: rozstrzygnięcie, który z nich był separatorem
 * tysięcy, jest zgadywaniem, a zgadywanie przy cenie kosztuje stukrotność.
 * Odrzucamy też wartość ujemną: cennik z ceną poniżej zera nie jest cennikiem,
 * tylko rabatem, którego model nie zna.
 *
 * Zaokrąglenie idzie przez `Math.round` PO przemnożeniu, i nie jest to
 * ostrożność na zapas: `2.01 * 100` daje w arytmetyce zmiennoprzecinkowej
 * 200.99999999999997, więc `Math.trunc` zamieniłby dwa złote jeden grosz
 * w równe dwa złote. Wartość myląco „okrągła" (12,05) tej różnicy NIE
 * pokazuje — iloczyn wypada tam powyżej liczby całkowitej i obcięcie daje ten
 * sam wynik — więc dowód mutacyjny stoi na 2,01 / 0,29 / 1,13.
 */
export function parseMoneyAmount(raw: string, currency: CurrencyCode): number | null {
  // Spacje są w liczbie szumem, nie znaczeniem. `\s` obejmuje też spacje
  // NIEŁAMLIWE (U+00A0, U+202F), którymi separator tysięcy wkleja się razem
  // z kwotą skopiowaną ze strony dostawcy — a ich pominięcie robiłoby z takiej
  // kwoty wejście „nie jest liczbą" bez żadnego widocznego powodu.
  const trimmed = raw.replace(/\s/g, "");
  if (trimmed === "") return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(trimmed)) return null;

  const major = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(major)) return null;
  return Math.round(major * MINOR_UNITS_PER_MAJOR[currency]);
}
