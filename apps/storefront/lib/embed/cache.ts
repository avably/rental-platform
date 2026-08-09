/**
 * Cache i SKLEJANIE ŻĄDAŃ W LOCIE dla miesiąca embedu (M3, ADR-120).
 *
 * To jest odpowiedź na właściwą część problemu R11 (ADR-114). Kosztem nie było
 * pojedyncze żądanie, tylko WSPÓŁBIEŻNOŚĆ: wtyczka zapisywała cache DOPIERO PO
 * pętli, więc dziesięć żądań w locie nie widziało się nawzajem i płaciło pełną
 * cenę każde (zmierzone: 10 × 30 = 300 wywołań).
 *
 * Wtyczka mogła obronić się tylko wpisem-blokadą na `transient` — a `get/set`
 * nie jest atomowe, więc świadomie łapała falę TYPOWĄ, nie doskonały wyścig.
 * Tutaj jesteśmy we WŁASNYM procesie i mamy prymityw, którego WordPress nie
 * daje: obietnicę. Rejestrujemy JĄ, zanim ruszy praca, więc drugi wołający
 * dostaje tę samą obietnicę zamiast zacząć własne rozstrzyganie. Fala N
 * równoległych wyświetleń tego samego miesiąca kosztuje tyle, co jedno —
 * bez wyścigu i bez odmowy `busy`, którą musiała wysyłać wtyczka.
 *
 * ZASIĘG: pamięć procesu. Przy wielu instancjach każda liczy własny pierwszy
 * przebieg — świadomie, bo cache współdzielony wymagałby migracji (poza
 * zakresem M3), a bez niego i tak schodzimy z N×n do (instancje)×n. Twardym
 * sufitem dla ruchu spoza przeglądarki jest dławienie, nie ten cache.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Wynik kompletny wolno trzymać długo — miesiąc bez rezerwacji nie zmienia się co sekundę. */
export const MONTH_CACHE_TTL_MS = 300_000;

/**
 * Wynik CZĘŚCIOWY (degradacja) żyje krótko. Dalej zbija falę współbieżną, ale
 * niepełny kalendarz nie wisi pięciu minut — lekcja ADR-114.
 */
export const MONTH_DEGRADED_CACHE_TTL_MS = 30_000;

const entries = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/** Klucz NIE niesie sekretu — sekretu tu nie ma; niesie wszystko, co zmienia wynik. */
export function monthCacheKey(tenantId: string, productId: string, month: string): string {
  return `${tenantId}:${productId}:${month}`;
}

export interface CoalesceOptions<T> {
  now: () => number;
  /** TTL wyliczany z WYNIKU — częściowy dostaje krótszy. */
  ttlMs: (value: T) => number;
}

/**
 * Jedna praca na klucz. Kolejność jest tu istotna i celowa: obietnica trafia do
 * mapy SYNCHRONICZNIE, przed pierwszym `await` w środku `work()`, więc między
 * sprawdzeniem a rejestracją nie ma punktu przełączenia — to jest ta różnica
 * względem nieatomowego `transient` z ADR-114.
 */
export async function coalesce<T>(
  key: string,
  work: () => Promise<T>,
  options: CoalesceOptions<T>,
): Promise<T> {
  const cached = entries.get(key);
  if (cached !== undefined && cached.expiresAt > options.now()) {
    return cached.value as T;
  }

  const running = inFlight.get(key);
  if (running !== undefined) return running as Promise<T>;

  const promise = (async () => {
    try {
      const value = await work();
      entries.set(key, { value, expiresAt: options.now() + options.ttlMs(value) });
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/** Czyszczenie między testami — stan modułu nie może przeciekać między przypadkami. */
export function __resetEmbedCacheForTests(): void {
  entries.clear();
  inFlight.clear();
}
