/**
 * Wąski retry transportowy dla testów integracyjnych na współdzielonym
 * self-hosted runnerze (mac-pm).
 *
 * PROBLEM: po przejściu CI na jeden współdzielony Mac efemeryczny Supabase
 * (Kong → PostgREST/GoTrue) pod obciążeniem potrafi oddać pojedynczą czkawkę
 * transportową — `An invalid response was received from the upstream server`
 * (Kong 502), ECONNRESET, 503 — a rerun jest zielony. Jednej nocy identyczną
 * sygnaturą padły trzy różne pliki (order-extension, order-gates,
 * stripe-webhook). Testy NIE mają wspólnej fabryki klientów (każdy plik woła
 * `createClient` sam, ~130 miejsc), ale mają wspólną warstwę niżej:
 * supabase-js rozwiązuje `fetch` LENIWIE z globalThis przy każdym wywołaniu
 * (`resolveFetch` → `(...args) => fetch(...args)`), więc opakowanie
 * `globalThis.fetch` w pliku setup vitest łapie KAŻDE wywołanie PostgREST/
 * GoTrue/Storage wszystkich klientów testowych bez dotykania call site'ów.
 *
 * GRANICE RETRY (świadomie wąskie — retry NIE MA PRAWA połknąć sygnału testu):
 *   - retry WYŁĄCZNIE dla żądań do bramki lokalnego Supabase
 *     (SUPABASE_LOCAL_API_URL) — cudze URL-e i fetch mockowany per-test
 *     przechodzą nietknięte,
 *   - retry odpowiedzi WYŁĄCZNIE dla statusów 502/503/504 (warstwa bramki;
 *     PostgREST oddaje odmowy jako 4xx z JSON-em, a 500 może nieść błąd
 *     funkcji SQL — NIGDY nie jest ponawiane),
 *   - retry rzutu WYŁĄCZNIE dla awarii sieciowych (ECONNRESET itd.); błąd
 *     niosący kod w kształcie SQLSTATE (42501, 23505…) albo PGRSTxxx jest
 *     SYGNAŁEM TESTU i wraca natychmiast — rozstrzyga kod, nie treść
 *     komunikatu; AbortError to decyzja wołającego, też bez retry,
 *   - ciała-strumienie nie są odtwarzalne → pojedyncze podejście,
 *   - 3 podejścia łącznie, backoff 250/750 ms.
 *
 * ŚWIADOMY KOMPROMIS: ponawiamy też POST/PATCH. 502 od Konga może teoretycznie
 * przyjść PO wykonaniu mutacji przez PostgREST (wtedy powtórka da np. 23505),
 * ale obserwowana klasa awarii to odmowa połączenia upstream PRZED wykonaniem
 * — a bez retry na mutacjach seed/walkTo czkawka wraca dokładnie tam, gdzie
 * ją widzieliśmy.
 *
 * Kopia żyje w packages/db/test/helpers i apps/panel/test/helpers — suity
 * testowe pakietów i apek nie współdzielą kodu (wzorzec integration-env.ts);
 * zmiany wprowadzać w OBU kopiach razem z ich testami przypinającymi
 * (test/transport-retry.test.ts). Storefront dostanie kopię, gdy jego suity
 * integracyjne zaczną łapać tę czkawkę.
 */

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface TransportRetryOptions {
  /** Łączna liczba podejść (1 = brak retry). Domyślnie 3. */
  attempts?: number;
  /** Odstępy między podejściami; ostatni obowiązuje dla dalszych. Domyślnie [250, 750]. */
  backoffMs?: readonly number[];
  /** Wstrzykiwalne czekanie — testy podają no-op zamiast realnego timera. */
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_MS: readonly number[] = [250, 750];

/**
 * Statusy ponawialne = wyłącznie warstwa bramki (Kong/gateway). Kong oddaje
 * „An invalid response was received from the upstream server" jako 502.
 * ŻADNEGO 4xx i ŻADNEGO 500: odmowy PostgREST (42501/23xxx/PGRST1xx) jadą
 * w 4xx z JSON-em, a 500 może nieść nieobsłużony błąd funkcji SQL — retry
 * na nich maskowałby to, co test właśnie mierzy.
 */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** Kody błędów sieciowych Node/undici — jednoznacznie transportowe. */
const TRANSPORT_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_CLOSED",
]);

/**
 * Kod w kształcie sygnału testowego: SQLSTATE (5 znaków [0-9A-Z], np. 42501,
 * 23505, 23P01, P0001) albo PGRSTxxx. Uwaga: EPIPE też ma 5 znaków — dlatego
 * członkostwo w TRANSPORT_ERROR_CODES jest sprawdzane PRZED tym kształtem.
 */
const REFUSAL_CODE_SHAPE = /^(?:[0-9A-Z]{5}|PGRST\d+)$/;

/**
 * Sygnatury tekstowe awarii transportu — używane dopiero, gdy w łańcuchu
 * błędów nie ma ŻADNEGO kodu rozstrzygającego (undici często niesie kod
 * w `cause`, ale nie każda warstwa go przepisuje).
 */
const TRANSPORT_MESSAGE_SIGNATURE =
  /an invalid response was received from the upstream server|socket hang up|other side closed|fetch failed|network error|econn(?:reset|refused|aborted)|etimedout|epipe/i;

interface ErrorShape {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  errors?: unknown;
}

/** Spłaszcza łańcuch error→cause (+ AggregateError.errors) z bezpiecznikiem na cykle. */
function errorChain(root: unknown): ErrorShape[] {
  const chain: ErrorShape[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [root];
  while (queue.length > 0 && chain.length < 16) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const shaped = current as ErrorShape;
    chain.push(shaped);
    if (shaped.cause) queue.push(shaped.cause);
    if (Array.isArray(shaped.errors)) queue.push(...(shaped.errors as unknown[]));
  }
  return chain;
}

/**
 * Czy rzucony błąd to awaria TRANSPORTU (ponawialna), a nie sygnał testu?
 *
 * Kolejność rozstrzygania jest częścią kontraktu (przypięta testami):
 *   1. AbortError gdziekolwiek w łańcuchu → NIE (decyzja wołającego),
 *   2. kod z TRANSPORT_ERROR_CODES gdziekolwiek → TAK,
 *   3. kod w kształcie SQLSTATE/PGRST gdziekolwiek → NIE (odmowa ma
 *      pierwszeństwo przed dopasowaniem treści komunikatu — fail-safe:
 *      wątpliwość rozstrzygamy przeciwko retry),
 *   4. inaczej: sygnatura tekstowa w którymkolwiek komunikacie.
 */
export function isTransportError(error: unknown): boolean {
  const chain = errorChain(error);
  if (chain.length === 0) return false;

  let sawTransportCode = false;
  let sawRefusalCode = false;
  for (const item of chain) {
    if (item.name === "AbortError" || item.code === "ABORT_ERR") return false;
    if (typeof item.code === "string") {
      if (TRANSPORT_ERROR_CODES.has(item.code)) sawTransportCode = true;
      else if (REFUSAL_CODE_SHAPE.test(item.code)) sawRefusalCode = true;
    }
  }
  if (sawRefusalCode) return false;
  if (sawTransportCode) return true;

  return chain.some(
    (item) => typeof item.message === "string" && TRANSPORT_MESSAGE_SIGNATURE.test(item.message),
  );
}

/** Ciało da się wysłać ponownie? Strumieni nie zbuforujemy — bez retry. */
function isReplayable(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof ReadableStream !== "undefined" && init?.body instanceof ReadableStream) return false;
  // Request z ciałem konsumuje swój strumień przy pierwszym fetch()u —
  // powtórka rzuciłaby „body already used". supabase-js woła (url, init),
  // więc to czysto defensywna furtka.
  if (typeof Request !== "undefined" && input instanceof Request && input.body !== null) return false;
  return true;
}

/**
 * Opakowuje `fetch` w wąski retry transportowy. Nie zna URL-i — zasięg
 * (tylko bramka Supabase) nakłada transportRetryFetchForGateway.
 */
export function withTransportRetry(base: FetchLike, options: TransportRetryOptions = {}): FetchLike {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const backoffFor = (attempt: number): number =>
    backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0;

  return async (input, init) => {
    if (!isReplayable(input, init)) return base(input, init);

    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await base(input, init);
      } catch (error) {
        if (attempt >= attempts || !isTransportError(error)) throw error;
        await sleep(backoffFor(attempt));
        continue;
      }
      if (attempt >= attempts || !RETRYABLE_STATUSES.has(response.status)) return response;
      // Porzucaną odpowiedź domykamy, żeby undici nie trzymał gniazda.
      try {
        await response.body?.cancel();
      } catch {
        // nic — odpowiedź i tak idzie do kosza
      }
      await sleep(backoffFor(attempt));
    }
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Retry ZAWĘŻONY do bramki lokalnego Supabase: żądania pod `apiUrl` idą
 * przez retry transportowy, cała reszta — nietkniętym `base`. To jest
 * bezpiecznik dla testów, które mockują fetch albo mierzą inne serwisy.
 */
export function transportRetryFetchForGateway(
  base: FetchLike,
  apiUrl: string,
  options: TransportRetryOptions = {},
): FetchLike {
  const retrying = withTransportRetry(base, options);
  const prefix = apiUrl.replace(/\/+$/, "");
  return (input, init) => {
    const url = requestUrl(input);
    if (url === prefix || url.startsWith(`${prefix}/`)) return retrying(input, init);
    return base(input, init);
  };
}

/** Znacznik idempotencji — podwójny setup nie może opakować fetcha dwa razy. */
const INSTALLED_MARKER = Symbol.for("avably.testTransportRetryInstalled");

/**
 * Instaluje retry na globalThis.fetch (wołane z pliku setup vitest).
 * No-op (false), gdy nie ma SUPABASE_LOCAL_API_URL (przebieg jednostkowy bez
 * lokalnego Supabase), nie ma globalnego fetcha albo retry już zainstalowano.
 */
export function installTransportRetry(options: TransportRetryOptions = {}): boolean {
  const apiUrl = process.env.SUPABASE_LOCAL_API_URL;
  if (!apiUrl || typeof globalThis.fetch !== "function") return false;
  const current = globalThis.fetch as FetchLike & { [INSTALLED_MARKER]?: boolean };
  if (current[INSTALLED_MARKER]) return false;

  const base: FetchLike = current.bind(globalThis);
  const routed = transportRetryFetchForGateway(base, apiUrl, options) as FetchLike & {
    [INSTALLED_MARKER]?: boolean;
  };
  routed[INSTALLED_MARKER] = true;
  globalThis.fetch = routed as typeof globalThis.fetch;
  return true;
}
