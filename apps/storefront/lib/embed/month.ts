/**
 * Rozstrzyganie dostępności MIESIĄCA dla kalendarza embedu (M3, ADR-120) —
 * bezpośrednia lekcja z ADR-114 (R11, amplifikacja żądań wtyczki WP).
 *
 * PROBLEM. `app.get_public_availability` odpowiada dla ZAKRESU: „ile sztuk jest
 * wolnych przez CAŁY zakres". Kalendarz potrzebuje mapy per dzień. Naiwne
 * przełożenie to pętla po dniach — 30 zapytań na jedno wyświetlenie miesiąca,
 * a przy fali odwiedzających iloczyn tego przez liczbę wyświetleń. Dokładnie
 * ten błąd popełniła iteracja 1 wtyczki (zmierzone: 10 równoległych żądań =
 * 300 wywołań).
 *
 * ROZWIĄZANIE (identyczne co do rachunku jak ADR-114, decyzja 2a). Odpowiedź
 * dodatnia dla zakresu jest DOLNYM OGRANICZENIEM dla każdego dnia zakresu
 * (sztuka wolna przez cały zakres jest wolna każdego dnia), a siatka kalendarza
 * rozstrzyga po `> 0`. Więc pytamy o cały miesiąc JEDNYM wywołaniem i schodzimy
 * podziałami binarnymi wyłącznie w zakresy z wynikiem 0 (zero na zakresie nie
 * przesądza o żadnym dniu z osobna — inna sztuka może być zajęta każdego dnia).
 *
 * RACHUNEK KOSZTU (stąd biorą się liczby, nie z intuicji). Niech n = liczba dni.
 * Każde wywołanie kończy się jednym z trzech wyników:
 *   * zakres wolny  → rozstrzyga L dni jednym wywołaniem  → OSZCZĘDNOŚĆ L−1
 *   * pojedynczy dzień → 1 wywołanie na 1 dzień           → bilans zero
 *   * zakres wielodniowy z zerem → nie rozstrzyga NICZEGO → STRATA 1
 * Stąd `wywołania = n − oszczędności + straty`. Rozstrzyganie startuje z
 * zapasem MONTH_SPLIT_SLACK i sondę ZAKRESOWĄ wolno mu zadać tylko przy
 * dodatnim zapasie; sonda z zerem zapas zjada, zakres wolny go odbudowuje,
 * a po wyczerpaniu zapasu pytamy o POJEDYNCZE dni — co zawsze domyka miesiąc.
 * Z nierówności `zapas_końcowy >= 0` wynika `wywołania <= n + MONTH_SPLIT_SLACK`
 * ZAWSZE. Sufit jest więc zabezpieczeniem, nie narzędziem sterującym.
 *
 * DZIEŃ NIEROZSTRZYGNIĘTY ≠ ZAJĘTY (ADR-114, decyzja 2b). Gdy budżet czasu
 * utnie rozstrzyganie, dni bez odpowiedzi NIE trafiają do mapy `days` — wychodzą
 * listą `unresolved` z flagą `partial`. Malowanie ich na „zajęte" cicho traciłoby
 * rezerwacje; malowanie na „wolne" prowadziłoby do odmowy przy zapisie.
 */

/**
 * Zapas sond zakresowych. 6 to najmniejsza wartość pokrywająca najgłębsze
 * zejście podziałami dla 31 dni (31→16→8→4→2 to pięć sond) z jedną sondą
 * rezerwy — patrz pomiar w ADR-114 (zapas 8 i 12 dają kilka procent mniej
 * wywołań kosztem proporcjonalnie wyższego sufitu).
 */
export const MONTH_SPLIT_SLACK = 6;

/** Budżet czasu na jedno żądanie miesiąca. Sprawdzany PRZED każdym wywołaniem. */
export const MONTH_TIME_BUDGET_MS = 10_000;

/** Sufit wywołań WYPROWADZONY z liczby dni — nigdy zaklepany liczbą. */
export function monthCallCeiling(dayCount: number): number {
  return dayCount + MONTH_SPLIT_SLACK;
}

/** Sonda dostępności zakresu: liczba wolnych sztuk albo `null`, gdy zakres nieosiągalny. */
export type AvailabilityProbe = (
  startDate: string,
  endDate: string,
) => Promise<number | null>;

export interface ResolveMonthOptions {
  /** Zegar wstrzykiwany, żeby scenariusz wolnego API przechodził przez PRODUKCYJNE ciało. */
  now: () => number;
  timeBudgetMs?: number;
}

export interface ResolvedMonth {
  days: Record<string, number>;
  unresolved: string[];
  partial: boolean;
  /** Ile razy sięgnięto do bazy. To jest MIARA amplifikacji — testy patrzą tutaj. */
  calls: number;
}

/** Dni miesiąca `YYYY-MM` jako daty ISO. Liczone w UTC, bo to kalendarz, nie chwila. */
export function monthDays(month: string): string[] {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  const days: string[] = [];
  const cursor = new Date(Date.UTC(year, monthIndex - 1, 1));
  while (cursor.getUTCMonth() === monthIndex - 1) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Czy `YYYY-MM` jest miesiącem, a nie dowolnym tekstem z cudzej strony. */
export function isValidMonth(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2100;
}

export async function resolveMonthDays(
  month: string,
  probe: AvailabilityProbe,
  options: ResolveMonthOptions,
): Promise<ResolvedMonth> {
  const days = monthDays(month);
  const budgetMs = options.timeBudgetMs ?? MONTH_TIME_BUDGET_MS;
  const deadline = options.now() + budgetMs;
  const ceiling = monthCallCeiling(days.length);

  const resolved: Record<string, number> = {};
  let slack = MONTH_SPLIT_SLACK;
  let calls = 0;

  // Kolejka zakresów jako pary indeksów [od, do] w `days` (włącznie).
  const pending: [number, number][] = days.length > 0 ? [[0, days.length - 1]] : [];

  while (pending.length > 0) {
    if (calls >= ceiling) break;
    if (options.now() >= deadline) break;

    const range = pending.shift();
    if (range === undefined) break;
    const [from, to] = range;
    const length = to - from + 1;

    // Sonda ZAKRESOWA wyłącznie przy dodatnim zapasie — inaczej rozbijamy zakres
    // na pojedyncze dni, które zawsze rozstrzygają i nie mogą zjeść budżetu.
    if (length > 1 && slack <= 0) {
      for (let index = from; index <= to; index += 1) pending.push([index, index]);
      continue;
    }

    calls += 1;
    const units = await probe(days[from]!, days[to]!);

    if (units === null) {
      // Zakres nieosiągalny (nieznany produkt / cudzy tenant) — nie zgadujemy.
      // Przerywamy: kolejne sondy dadzą to samo i tylko spalą budżet.
      break;
    }

    if (units > 0) {
      for (let index = from; index <= to; index += 1) {
        resolved[days[index]!] ??= units;
      }
      slack += length - 1;
      continue;
    }

    if (length === 1) {
      resolved[days[from]!] = 0;
      continue;
    }

    // Zero na zakresie wielodniowym nie rozstrzyga NICZEGO — dzielimy na pół.
    slack -= 1;
    const middle = from + Math.floor((to - from) / 2);
    pending.push([from, middle], [middle + 1, to]);
  }

  const unresolved = days.filter((day) => !(day in resolved));

  return {
    days: resolved,
    unresolved,
    partial: unresolved.length > 0,
    calls,
  };
}
