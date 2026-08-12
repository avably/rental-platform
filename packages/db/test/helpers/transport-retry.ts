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
 * DRUGA KLASA AWARII (dopisana po serii losowych czerwieni w jobie `rls` —
 * legal-documents, order-gates, lifecycle-guards, zawsze na zasiewaniu
 * użytkownika): zasiewanie idzie przez GoTrue, a GoTrue trzyma WŁASNĄ pulę
 * połączeń do Postgresa. Gdy vitest zasypie go równoległymi
 * `auth.admin.createUser`, pula przekracza `max_connections` i Postgres
 * odpowiada `FATAL: sorry, too many clients already`. GoTrue zamienia to na
 * HTTP **500** z ciałem
 * `{"code":500,"error_code":"unexpected_failure","msg":"Database error creating new user"}`.
 * Dwie rzeczy szły wtedy nie tak:
 *   1. status 500 był POZA bramką 502/503/504 — czyli poza retry;
 *   2. komunikat w logu brzmiał `{}`, bo @supabase/auth-js dla statusów 5xx
 *      w ogóle NIE CZYTA ciała: `handleError` (auth-js/lib/fetch.ts) skacze
 *      na `AuthRetryableFetchError(_getErrorMessage(response), status)`
 *      z obiektem `Response`, a `_getErrorMessage` kończy na
 *      `JSON.stringify(response)` — a to dla Response daje dokładnie `"{}"`.
 *      Ta sama odpowiedź ze statusem 4xx niesie pełny `msg`. Sam `{}` w logu
 *      jest więc dowodem, że status był 5xx.
 * Stąd polityka bramki uwierzytelniania (`authGateway`) niżej: dla ścieżek
 * `/auth/…` czytamy ciało nieprzejrzystych 5xx, ponawiamy klasę przejściową
 * i doklejamy do wyczerpanej odpowiedzi pole `msg` — auth-js sięga po nie
 * PRZED `JSON.stringify`, więc test dostaje status i treść zamiast `{}`.
 *
 * GRANICE RETRY (świadomie wąskie — retry NIE MA PRAWA połknąć sygnału testu):
 *   - retry WYŁĄCZNIE dla żądań do bramki lokalnego Supabase
 *     (SUPABASE_LOCAL_API_URL) — cudze URL-e i fetch mockowany per-test
 *     przechodzą nietknięte,
 *   - retry odpowiedzi WYŁĄCZNIE dla statusów 502/503/504 (warstwa bramki;
 *     PostgREST oddaje odmowy jako 4xx z JSON-em, a 500 może nieść błąd
 *     funkcji SQL — NIGDY nie jest ponawiane),
 *   - JEDEN wyjątek od zakazu 500, zawężony trzema warunkami naraz: ścieżka
 *     `/auth/…` bramki + status nieprzejrzysty dla auth-js + ciało z
 *     `error_code: "unexpected_failure"`. GoTrue nie odmawia przez 500
 *     (odmowy jadą 4xx z `msg`), więc ta trójka nie może przykryć sygnału
 *     testu; 500 z `/rest/…` zostaje nieponawialny jak był,
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
 * JEDNO ŹRÓDŁO DLA WSZYSTKICH SUIT (2026-08-12). Do tej pory helper istniał
 * w dwóch kopiach — tutaj i w apps/panel/test/helpers — bo job `rls` uruchamia
 * oba pakiety. Kopie były bajt w bajt identyczne i dokładnie to nas ugryzło
 * przy PR #284: poprawka wylądowała w jednej, druga milczała, a przenosiny
 * robiliśmy ręcznie. Teraz plik jest jeden i mieszka w pakiecie, który jest
 * WŁAŚCICIELEM tej wiedzy: granice retry są opisane w kategoriach bramki
 * lokalnego Supabase (Kong, PostgREST, GoTrue, SUPABASE_LOCAL_API_URL), a to
 * powierzchnia @avably/db. Suity aplikacji są konsumentami tej samej żywej
 * instancji i wskazują tutaj — nigdy odwrotnie. Storefront dopnie się tak
 * samo, gdy jego suity integracyjne zaczną łapać tę czkawkę.
 *
 * Konsumenci: packages/db/test/setup-transport-retry.ts (i cienki plik panelu,
 * który go importuje) oraz test/helpers/transport-retry-suite.ts z asercjami
 * uruchamianymi w OBU pakietach.
 */

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface TransportRetryOptions {
  /** Łączna liczba podejść (1 = brak retry). Domyślnie 3. */
  attempts?: number;
  /** Odstępy między podejściami; ostatni obowiązuje dla dalszych. Domyślnie [250, 750]. */
  backoffMs?: readonly number[];
  /** Wstrzykiwalne czekanie — testy podają no-op zamiast realnego timera. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Polityka bramki uwierzytelniania (ścieżki `/auth/…`): czytaj ciało
   * nieprzejrzystych 5xx, ponawiaj `unexpected_failure`, doklej `msg`.
   * Domyślnie WYŁĄCZONA — dla PostgREST 500 jest sygnałem testu, a jego
   * ciało czyta już postgrest-js, więc nie ma czego ratować.
   */
  authGateway?: boolean;
}

export const DEFAULT_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_MS: readonly number[] = [250, 750];

/**
 * Bramka uwierzytelniania dostaje WŁASNY, dłuższy harmonogram. Czkawka Konga
 * to pojedyncze mrugnięcie (250/750 ms wystarcza), a wyczerpanie puli połączeń
 * GoTrue→Postgres to awaria POJEMNOŚCIOWA: w sondzie 256 równoległych
 * `admin.createUser` seria 500-tek ciągnęła się ~4 s. Okno 250+750+1500 ms
 * plus czas czterech żądań przykrywa ten rząd wielkości.
 */
export const AUTH_ATTEMPTS = 4;
export const AUTH_BACKOFF_MS: readonly number[] = [250, 750, 1500];

/**
 * Statusy, dla których @supabase/auth-js NIE czyta ciała odpowiedzi
 * (`NETWORK_ERROR_CODES` w auth-js/dist/module/lib/fetch.js) i buduje
 * komunikat z obiektu `Response` — czyli `JSON.stringify(response)` → `"{}"`.
 * To jedyne statusy, przy których prawda o awarii ginie i trzeba ją odzyskać.
 */
export const AUTH_OPAQUE_STATUSES: ReadonlySet<number> = new Set([
  500, 501, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530,
]);

/**
 * Jedyny kod błędu GoTrue kwalifikujący 500 do ponowienia. GoTrue oddaje
 * odmowy biznesowe jako 4xx z własnym `msg` (auth-js je wtedy parsuje), a
 * `unexpected_failure` rezerwuje na awarie wewnętrzne — u nas: „Database
 * error checking email" / „Database error creating new user", czyli
 * `FATAL: sorry, too many clients already` po stronie Postgresa.
 */
const AUTH_TRANSIENT_ERROR_CODE = "unexpected_failure";

/**
 * Pola, w których GoTrue niesie kod błędu — DWA kształty tej samej awarii:
 *   - `{"code":500,"error_code":"unexpected_failure","msg":"…"}` — odpowiedź
 *     bez negocjacji wersji (goły curl/fetch),
 *   - `{"code":"unexpected_failure","message":"…"}` — odpowiedź dla klienta
 *     wysyłającego `X-Supabase-Api-Version: 2024-01-01`, czyli dla KAŻDEGO
 *     wywołania przez supabase-js.
 * Klasyfikator patrzy na oba, bo produkcyjną ścieżką jest ta druga — sonda
 * na gołym fetchu pokazuje pierwszą i łatwo na tym polec.
 */
const AUTH_ERROR_CODE_FIELDS = ["error_code", "code"] as const;

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

/** Odczyt ciała bez wywracania wołającego — `null` znaczy „nie udało się". */
async function readBodyText(response: Response): Promise<string | null> {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Odpowiedź po odczytaniu ciała jest zużyta — wołający dostaje jej wierną
 * kopię (ten sam status i nagłówki), żeby nadal mógł zrobić `.json()`.
 */
function replayResponse(response: Response, body: string | null): Response {
  if (body === null) return response;
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Czy ciało 5xx GoTrue niesie awarię przejściową (a nie trwały błąd)? */
function isAuthTransientBody(body: string | null): boolean {
  if (!body) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const fields = parsed as Record<string, unknown>;
  return AUTH_ERROR_CODE_FIELDS.some((field) => fields[field] === AUTH_TRANSIENT_ERROR_CODE);
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Komunikat, który auth-js pokaże ZAMIAST `{}` — status, ścieżka, ciało. */
export function describeOpaqueAuthFailure(
  url: string,
  method: string,
  status: number,
  body: string | null,
  attempts: number,
): string {
  const trimmed = (body ?? "").trim();
  const shown = trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed || "(puste ciało)";
  const podejscia = attempts === 1 ? "1 podejściu" : `${attempts} podejściach`;
  return `GoTrue ${status} ${method} ${pathOf(url)} po ${podejscia}: ${shown}`;
}

/**
 * Dokleja komunikat jako pole `msg` odpowiedzi. To NIE jest ozdoba:
 * `_getErrorMessage` w auth-js sprawdza `response.msg` PRZED zejściem do
 * `JSON.stringify(response)`, więc to jedyny sposób, żeby prawda o statusie
 * 5xx dojechała do `error.message` w teście. Pole jest nieprzeliczalne, żeby
 * nie zmieniać kształtu odpowiedzi przy serializacji.
 */
function withDiagnosticMessage(response: Response, message: string): Response {
  Object.defineProperty(response, "msg", {
    value: message,
    enumerable: false,
    configurable: true,
  });
  return response;
}

/**
 * Opakowuje `fetch` w wąski retry transportowy. Nie zna URL-i — zasięg
 * (tylko bramka Supabase) nakłada transportRetryFetchForGateway.
 */
export function withTransportRetry(base: FetchLike, options: TransportRetryOptions = {}): FetchLike {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const authGateway = options.authGateway ?? false;
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

      // Ciało czytamy WYŁĄCZNIE tam, gdzie auth-js je wyrzuca — czyli dla
      // nieprzejrzystych 5xx bramki uwierzytelniania. Wszystko inne (2xx,
      // 4xx, całe PostgREST) dostaje odpowiedź nietkniętą, jak dotąd.
      const opaque = authGateway && AUTH_OPAQUE_STATUSES.has(response.status);
      const body = opaque ? await readBodyText(response) : null;
      const retryable =
        RETRYABLE_STATUSES.has(response.status) || (opaque && isAuthTransientBody(body));

      if (attempt >= attempts || !retryable) {
        if (!opaque) return response;
        return withDiagnosticMessage(
          replayResponse(response, body),
          describeOpaqueAuthFailure(
            requestUrl(input),
            init?.method ?? "GET",
            response.status,
            body,
            attempt,
          ),
        );
      }
      // Porzucaną odpowiedź domykamy, żeby undici nie trzymał gniazda.
      // (Gdy ciało już odczytaliśmy, strumienia nie ma czego domykać.)
      if (!opaque) {
        try {
          await response.body?.cancel();
        } catch {
          // nic — odpowiedź i tak idzie do kosza
        }
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
 *
 * Ścieżki `/auth/…` dostają osobną instancję z polityką bramki
 * uwierzytelniania (dłuższy harmonogram, klasa `unexpected_failure`,
 * czytelny komunikat). Rozdział idzie po URL-u, nie po treści — dzięki temu
 * 500 z `/rest/…` zostaje nieponawialne, cokolwiek by niosło.
 */
export function transportRetryFetchForGateway(
  base: FetchLike,
  apiUrl: string,
  options: TransportRetryOptions = {},
): FetchLike {
  const retrying = withTransportRetry(base, options);
  const retryingAuth = withTransportRetry(base, {
    ...options,
    authGateway: true,
    attempts: options.attempts ?? AUTH_ATTEMPTS,
    backoffMs: options.backoffMs ?? AUTH_BACKOFF_MS,
  });
  const prefix = apiUrl.replace(/\/+$/, "");
  return (input, init) => {
    const url = requestUrl(input);
    if (url.startsWith(`${prefix}/auth/`)) return retryingAuth(input, init);
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
