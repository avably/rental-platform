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
 * WARIANT KRÓTKI (F7b): „26–28 sie · 3 dni" — bez roku, ale WYŁĄCZNIE gdy oba
 * końce zakresu są w roku bieżącym (patrz `RentalRangeOptions`). Używa go
 * pigułka terminu w belce ikonowej, gdzie o szerokość walczy się o piksele;
 * koszyk, kasa i potwierdzenie zostają przy formie pełnej, bo tam data bywa
 * czytana po tygodniach i rok jest jej częścią.
 *
 * ==================== MIESIĄC ZAWSZE SŁOWNY (F12) ====================
 *
 * Do F12 zakres składał `Intl.DateTimeFormat.prototype.formatRange` — i to była
 * wada, która na produkcji dawała klientowi ZUPEŁNIE INNĄ frazę, niż widział
 * autor kodu. `formatRange` nie formatuje dwóch dat naszym żądaniem; oddaje
 * sterowanie WZORCOWI INTERWAŁU z danych CLDR silnika, a ten dla `pl` bywa
 * NUMERYCZNY. Zmierzone tym samym wyrażeniem, tą samą datą:
 *
 *   • V8 (Node 22, Chrome):        „23–25 wrz"     ← to widział autor
 *   • JavaScriptCore (Safari/iOS): „23.09–25.09"   ← to widział właściciel
 *
 * (probe: `jsc -e` na `Intl.DateTimeFormat("pl",{day:"numeric",month:"short"})`;
 * forma pełna z rokiem rozjeżdża się tak samo: „26–28 sie 2026" vs
 * „26–28.08.2026" — czyli ISO wróciło na ekran wszędzie tam, gdzie F8 je
 * zdjęło, i przez jedenaście tygodni nie widział tego nikt, kto testował
 * w Chromie. Ta sama klasa wady, co „in-app browser to Chromium".)
 *
 * Dlatego zakresu NIE SKŁADA JUŻ SILNIK. Składamy go sami z `format`
 * i `formatToParts` — czyli z tych dwóch wywołań, które oba silniki liczą
 * identycznie, bo odpowiadają wprost na nasze `month: "short"`. Reguła
 * odstępów wokół półpauzy była nasza już wcześniej (ICU sklejał „26 sie–2 wrz",
 * gubiąc granicę dat w środku frazy); teraz nasza jest cała fraza.
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
 * WARIANT KRÓTKI — opcje frazy (F7b, korekta właściciela 2026-08-25).
 *
 * Pigułka terminu w belce ikonowej jest JEDYNYM tekstem nagłówka i ma być
 * „nie za szeroka" (dyspozycja właściciela). Rok BIEŻĄCY jest w niej czystym
 * balastem: klient, który wybiera termin dziś, wie, w którym roku żyje —
 * a „2026" zjada w pigułce ~40 px, przez które fraza dobija do `max-w`
 * i ścina się wielokropkiem.
 *
 * Rok znika WYŁĄCZNIE wtedy, gdy OBA końce zakresu są w roku bieżącym.
 * Najem przechodzący przez sylwestra albo zaplanowany na przyszły rok
 * zostaje z rokiem — bez niego „2 sty" byłoby datą dwuznaczną, a to jest
 * dokładnie ta klasa wady, którą F8 zamknął zdejmując ISO z ekranu.
 */
export interface RentalRangeOptions {
  /** `true` = wariant krótki (rok bieżący pomijany) — patrz docblock wyżej. */
  short?: boolean;
  /**
   * DZIŚ jako `YYYY-MM-DD` — wyłącznie po to, żeby wariant krótki dał się
   * przetestować bez zegara systemu (test „w grudniu 2026" nie może zależeć
   * od tego, kiedy się go uruchamia). Brak = zegar systemu.
   */
  today?: IsoDate;
}

/**
 * FRAZA ROZŁOŻONA NA CZŁONY (F12) — bo pigułka belki musi umieć POŚWIĘCIĆ
 * jeden z nich, a nie ściąć oba wielokropkiem.
 *
 * Właściciel zobaczył na telefonie „23.09–25.09 · …": pigułka dobiła do sufitu
 * szerokości i `truncate` uciął frazę w środku informacji — czyli dokładnie
 * tam, gdzie klient patrzy. Rozstrzygnięcie jest takie, że przy braku miejsca
 * NIE ŚCINAMY, tylko ZDEJMUJEMY człon o niższym priorytecie (najpierw doby,
 * potem znak kalendarza), a ZAKRES zostaje w całości zawsze.
 *
 * Żeby wołający mógł to zrobić regułą kontenerową (a nie mierzeniem tekstu
 * w JS), musi dostać człony OSOBNO. Skład pełnej frazy zostaje tutaj — patrz
 * `formatRentalRange` niżej — więc nie ma dwóch miejsc, w których zapada
 * decyzja o separatorze.
 */
export interface RentalRangeParts {
  /** Sam zakres dat, atomowy: „26–28 sie 2026" / „26 sie – 2 wrz". */
  range: string;
  /** Sama długość najmu, atomowa: „3 dni" / „1 dzień" (bez separatora „·"). */
  days: string;
}

/** Rok bieżący jako `YYYY` — z podanego „dziś" albo z zegara systemu. */
function currentYear(today: IsoDate | undefined): string {
  if (today !== undefined) {
    assertIsoDate(today, "today");
    return today.slice(0, 4);
  }
  return String(new Date().getUTCFullYear());
}

/** Formatter jednej daty — `month: "short"` znaczy tu SŁOWO w każdym silniku. */
function dateFormatter(locale: string, withYear: boolean): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
}

/**
 * ZWARCIE ZAKRESU DO SAMYCH DNI („26–28 sie 2026", „Aug 26–28, 2026").
 *
 * Bierzemy CZĘŚCI daty początkowej i podmieniamy w nich WYŁĄCZNIE część `day`
 * na „26–28". Reszta — kolejność członów, separatory, przecinek przed rokiem —
 * zostaje taka, jaką dał `Intl` dla tego języka, więc trzeci rynek nie dopisze
 * tu gałęzi. To jest cała różnica wobec `formatRange`: pytamy silnik o zapis
 * JEDNEJ daty (odpowiada zgodnie z `month: "short"`) i sami wstawiamy drugi
 * dzień, zamiast oddawać mu decyzję o wzorcu całego interwału.
 *
 * `null`, gdy w częściach nie ma dnia — wtedy wołający składa formę
 * dwustronną. Dziś nieosiągalne (prosimy o `day: "numeric"`), ale wynik bez
 * jednego z końców zakresu byłby wadą cichą i kosztowną.
 */
function joinDays(
  formatter: Intl.DateTimeFormat,
  date: Date,
  dayFrom: string,
  dayTo: string,
): string | null {
  const parts = formatter.formatToParts(date);
  if (!parts.some((part) => part.type === "day")) return null;
  return parts
    .map((part) => (part.type === "day" ? `${dayFrom}${EN_DASH}${dayTo}` : part.value))
    .join("");
}

/** Numer dnia tak, jak zapisze go ten język (bez zer wiodących w pl/en). */
function dayNumber(locale: string, date: Date): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(date);
}

/**
 * Zakres i doby OSOBNO — patrz `RentalRangeParts`. Kontrakt dat, wariant
 * krótki i atomowość są wspólne z `formatRentalRange`, bo to ta sama funkcja:
 * pełna fraza jest sklejeniem tych dwóch członów.
 */
export function formatRentalRangeParts(
  start: IsoDate,
  end: IsoDate,
  locale: string,
  options: RentalRangeOptions = {},
): RentalRangeParts {
  assertIsoDate(start, "start");
  assertIsoDate(end, "end");
  const days = rentalDaysInclusive(start, end);

  /*
    ROK ZNIKA TYLKO W WARIANCIE KRÓTKIM I TYLKO DLA ROKU BIEŻĄCEGO — jedno
    miejsce tej decyzji, żeby „krótko" nie znaczyło gdzie indziej „bez roku
    zawsze" (data z przyszłego roku bez roku jest po prostu inną datą).
  */
  const rokBiezacy =
    options.short === true &&
    start.slice(0, 4) === end.slice(0, 4) &&
    start.slice(0, 4) === currentYear(options.today);
  const withYear = !rokBiezacy;

  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const full = dateFormatter(locale, withYear);

  let range: string;
  if (start === end) {
    range = atomize(full.format(startDate));
  } else if (start.slice(0, 7) === end.slice(0, 7)) {
    // Wspólny miesiąc I ROK (te same pierwsze siedem znaków ISO) — zwarcie
    // do samych dni; miesiąc i rok padają w frazie raz.
    const zwarte = joinDays(full, startDate, dayNumber(locale, startDate), dayNumber(locale, endDate));
    range =
      zwarte !== null
        ? atomize(zwarte)
        : `${atomize(full.format(startDate))}${NBSP}${EN_DASH}${NBSP}${atomize(full.format(endDate))}`;
  } else {
    /*
      RÓŻNE MIESIĄCE — obie daty rozpisane, półpauza Z ODSTĘPAMI (NBSP, więc
      fraza dalej nie łamie się w środku daty). Rok pada po lewej TYLKO wtedy,
      gdy lata są różne: „26 sie – 2 wrz 2026" kontra „28 gru 2026 – 3 sty
      2027". Bez tego rozróżnienia najem w jednym roku niósłby rok dwa razy.
    */
    const sameYear = start.slice(0, 4) === end.slice(0, 4);
    const left = sameYear ? dateFormatter(locale, false) : full;
    range = `${atomize(left.format(startDate))}${NBSP}${EN_DASH}${NBSP}${atomize(full.format(endDate))}`;
  }

  return { range, days: atomize(daysPhrase(days, locale)) };
}

/**
 * Zakres najmu po ludzku: „26–28 sie 2026 · 3 dni" (krótko: „26–28 sie · 3 dni").
 *
 * Odstępy wokół półpauzy są ZNORMALIZOWANE po naszej regule, nie po ICU:
 * wspólny miesiąc i rok → zwarcie („26–28"), różne miesiące/lata → półpauza
 * z odstępami („26 sie – 2 wrz 2026"). Miesiąc jest przy tym SŁOWNY w każdym
 * silniku (F12) — patrz docblock pliku.
 *
 * Zakres INCLUSIVE jak w całym silniku (2→8 marca = 7 dni); zakres odwrócony
 * i data spoza kalendarza rzucają `RangeError` z `dates.ts` — formatter nie
 * wymyśla własnej, trzeciej odpowiedzi na złe wejście.
 */
export function formatRentalRange(
  start: IsoDate,
  end: IsoDate,
  locale: string,
  options: RentalRangeOptions = {},
): string {
  const parts = formatRentalRangeParts(start, end, locale, options);
  return `${parts.range} ·${NBSP}${parts.days}`;
}
