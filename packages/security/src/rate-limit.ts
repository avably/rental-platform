/**
 * Rate-limit — JEDNO źródło prawdy dla panelu i storefrontu. Licznik żyje w
 * Postgresie (migracja 0052, app.check_rate_limit — SECURITY DEFINER, okno
 * stałe), więc jest WSPÓŁDZIELONY między instancjami/regionami hostingu
 * bezstanowego bez dodatkowego dostawcy (ADR-106; wcześniejsza ścieżka
 * Upstash usunięta — nigdy nie miała skonfigurowanego konta i była martwym
 * kodem).
 *
 * Mieszka w pakiecie z tego samego powodu co polityka CSP (patrz docblock
 * src/index.ts): rate-limit jest prymitywem security-krytycznym, a cichy
 * rozjazd jego mechaniki między apkami byłby regresją niewidoczną w code
 * review. Wcześniej istniał jako dwie bliźniacze kopie w `lib/` obu apek.
 *
 * OSOBNY entrypoint: `@avably/security/rate-limit`. Reszta pakietu opiera się
 * o `next/server`, a limit nie potrzebuje Next.js — import z korzenia
 * wciągałby framework do modułu, który go nie używa (wzorzec: `@avably/db/service`).
 *
 * TRANSPORT: prosty `fetch` do PostgREST (wzorzec
 * apps/storefront/lib/tenant/lookup.ts) z kluczem anon — funkcja ma grant
 * dla anon, bo limituje trasy PRZED zalogowaniem. Bez klienta `@supabase/ssr`
 * (adapter cookies jest tu zbędny) i bez service-role (bramka
 * scripts/audit-service-role.sh zakazuje go poza webhookami/jobami).
 *
 * DEGRADACJA: brak konfiguracji bazy (env) ALBO błąd/timeout PostgREST →
 * licznik in-memory. To świadomie miękka zapora (per instancja), ale lepsza
 * niż fail-open na czas awarii i jedyna opcja w dev/CI bez bazy. Decyzja i
 * konsekwencje: ADR-106.
 *
 * NIECICHY SYGNAŁ (aneks ADR-039/ADR-106, 2026-08-10): degradacja BEZ
 * konfiguracji bazy (env kompletnie brak, nie tylko chwilowa awaria) była
 * do tej pory całkowicie cicha — łącznie z uruchomieniem na Vercelu, gdzie
 * per-instancyjny licznik NIE chroni globalnie i NIKT tego nie widział.
 * Rozróżniamy „świadomie in-memory (dev/test/lokalny build)" od „produkcja
 * bez bazy = cichy brak ochrony": przy braku env NA VERCELU (`isVercelRuntime`)
 * leci jednorazowy `console.warn`, dev/CI zostaje ciche jak dotąd. Ten sam
 * wzorzec i to samo ograniczenie dotyczy `@upstash/redis` w
 * apps/storefront/lib/tenant/cache.ts (cache host→tenant, ADR-039) — TAM
 * degradacja jest poprawnościowo bezpieczna (tylko mniej skuteczna), więc
 * świadomie zostaje cicha; nie zmieniamy tego pliku. Zobacz
 * docs/audyty/2026-08-10-audyt-env-rate-limit.md.
 */
import {
  SUPABASE_PUBLISHABLE_KEY_ENV,
  readSupabasePublishableKey,
} from "@avably/core/supabase-env";

/**
 * Prefiksy przestrzeni kluczy. Limity publiczne i limity auth panelu NIE mogą
 * ich dzielić — inaczej ruch anonima na storefroncie zjadałby budżet logowania
 * do panelu. Stałe stoją tutaj, a nie przy wywołaniach, żeby wartość prefiksu
 * nie mogła rozjechać się między call site'ami.
 */
export const PANEL_AUTH_RATE_LIMIT_PREFIX = "panel-auth-rl";
export const STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX = "storefront-public-rl";
/**
 * Publiczne API maszynowe /api/v1 (M1, ADR-108) — osobna przestrzeń: ruch
 * wtyczek/serwerów najemców nie może zjadać budżetu formularzy storefrontu
 * (ani odwrotnie), bo to inne populacje klientów o innych profilach ruchu.
 */
export const STOREFRONT_API_RATE_LIMIT_PREFIX = "storefront-api-rl";
/**
 * Embed rezerwacji na cudzej stronie (M3, ADR-120) — trzecia, osobna
 * przestrzeń. Za jednym IP stoi tu POJEDYNCZY odwiedzający strony najemcy
 * (inaczej niż w /api/v1, gdzie za jednym IP stoi cały serwer WordPressa),
 * więc progi są z innego rzędu i nie mogą dzielić kubełka ani z API
 * maszynowym, ani z formularzami storefrontu.
 */
export const STOREFRONT_EMBED_RATE_LIMIT_PREFIX = "storefront-embed-rl";
/**
 * Publiczny zapis uwag przeglądu produktu (ADR-206) — czwarta, osobna
 * przestrzeń. Po zdjęciu superadmina z ZAPISU uwag bramką anty-spamową
 * endpointu jest właśnie ten limit (obok kill-switcha REVIEW_MODE), więc
 * jego budżet nie może być współdzielony z formularzami auth panelu:
 * seria komentarzy właściciela w trakcie przeglądu nie ma prawa zjeść
 * budżetu logowania — ani odwrotnie. Narzędzie znika na go-live razem
 * z REVIEW_MODE, a z nim ta przestrzeń.
 */
export const REVIEW_COMMENT_RATE_LIMIT_PREFIX = "review-comment-rl";
/**
 * Wyszukiwanie firmy po NIP w MF Białej liście / GUS BIR1.1 (ADR-234) —
 * piąta, osobna przestrzeń. MF ogranicza wyszukiwania do 100/dobę
 * (globalnie, po stronie dostawcy) — limit per-user tutaj chroni TEN budżet
 * przed jednym rozklikanym formularzem, niezależnie od limitu logowania
 * panelu (onboarding jest PRZED założeniem organizacji, więc dzieli
 * przestrzeń z panel-auth tylko przypadkiem klucza `p_key`, nie budżetu —
 * osobny prefiks eliminuje kolizję).
 */
export const NIP_LOOKUP_RATE_LIMIT_PREFIX = "nip-lookup-rl";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
}

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  /** Przestrzeń kluczy — patrz stałe *_RATE_LIMIT_PREFIX. */
  prefix: string;
  /** Transport do testów; domyślnie globalny fetch. */
  fetchFn?: typeof fetch;
}

interface MemoryEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();

function memoryRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: Math.max(0, limit - 1) };
  }
  entry.count += 1;
  return { success: entry.count <= limit, remaining: Math.max(0, limit - entry.count) };
}

interface DbRateLimitConfig {
  url: string;
  anonKey: string;
}

/**
 * Konfiguracja czytana per wywołanie (nie w stałej modułu): `NEXT_PUBLIC_*`
 * jest wmurowywane build-time w aplikacjach Next, ale ten moduł biega też w
 * testach node'owych, gdzie env zmienia się w trakcie procesu.
 * `SUPABASE_LOCAL_*` to harness testów integracyjnych (CI job `rls`).
 */
function firstNonEmptyEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    // Pusty string traktujemy jak brak — `VAR=""` to w praktyce „wyłączone",
    // a `??` przepuściłby go dalej jako wartość.
    if (value) return value;
  }
  return undefined;
}

function getDbConfig(): DbRateLimitConfig | null {
  const url = firstNonEmptyEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_LOCAL_API_URL"]);
  // Klucz publikowalny z warstwy ADR-142 (nowa nazwa sb_publishable_… →
  // fallback legacy, statyczne odczyty pod wmurowanie build-time), a dopiero
  // za nią harness testów integracyjnych (SUPABASE_LOCAL_*, CI job `rls`).
  const anonKey = readSupabasePublishableKey() ?? firstNonEmptyEnv(["SUPABASE_LOCAL_ANON_KEY"]);
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Rozróżnia „dev/test/lokalny build" od „uruchomienie NA platformie Vercel"
 * — czyli DOKŁADNIE środowisko wielo-instancyjne/wieloregionowe, w którym
 * licznik in-memory przestaje realnie chronić.
 *
 * ŚWIADOMIE NIE `NODE_ENV`: `next start` ustawia `NODE_ENV=production` także
 * przy uruchomieniu LOKALNYM (ten sam błąd znaleziony wcześniej empirycznie
 * w apps/panel/.../payments-config.ts — `NODE_ENV` odpowiada „jak zbudowano",
 * nie „gdzie to działa"). `VERCEL` to zmienna WYSTAWIANA PRZEZ PLATFORMĘ
 * (build i runtime), więc nie da się jej ustawić przez pomyłkę lokalnym
 * `next build && next start`.
 */
function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1";
}

let warnedDbFallback = false;
let warnedNoDbConfigOnVercel = false;

/**
 * Wywołanie app.check_rate_limit przez PostgREST. Zwraca null przy KAŻDYM
 * problemie (transport, nie-2xx, niespodziewany kształt) — wołający schodzi
 * na licznik in-memory. Timeout jest krótki: limit stoi na gorącej ścieżce
 * logowania i nie może dokładać sekund oczekiwania na wiszącą bazę.
 */
async function dbRateLimit(
  config: DbRateLimitConfig,
  fetchFn: typeof fetch,
  bucketKey: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult | null> {
  try {
    const res = await fetchFn(`${config.url}/rest/v1/rpc/check_rate_limit`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        // Funkcja żyje w schemacie `app` (wystawiony w config.toml).
        "Content-Profile": "app",
      },
      body: JSON.stringify({
        p_key: bucketKey,
        p_limit: opts.limit,
        p_window_seconds: opts.windowSeconds,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;

    // returns table(...) → PostgREST oddaje tablicę z jednym wierszem.
    const data: unknown = await res.json();
    const row = Array.isArray(data) ? (data[0] as unknown) : null;
    if (
      row === null ||
      typeof row !== "object" ||
      typeof (row as { success?: unknown }).success !== "boolean" ||
      typeof (row as { remaining?: unknown }).remaining !== "number"
    ) {
      return null;
    }
    const parsed = row as { success: boolean; remaining: number };
    return { success: parsed.success, remaining: parsed.remaining };
  } catch {
    return null;
  }
}

/**
 * @param key np. `login:ip:<ip>` albo `waitlist:ip:<ip>` — segmentowany per
 *   akcja, żeby limit jednej ścieżki nie blokował innych.
 *
 * Prefiks wchodzi do klucza NIEZALEŻNIE od backendu — w bazie i w mapie
 * in-memory przestrzenie panelu i storefrontu muszą być rozłączne przy tym
 * samym `key` (patrz komentarz przy stałych prefiksów).
 */
export async function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const bucketKey = `${opts.prefix}:${key}`;
  const config = getDbConfig();
  if (config) {
    const result = await dbRateLimit(config, opts.fetchFn ?? fetch, bucketKey, opts);
    if (result) return result;
    if (!warnedDbFallback) {
      console.warn(
        "[rate-limit] app.check_rate_limit niedostępne — licznik in-memory (per instancja) do czasu powrotu bazy.",
      );
      warnedDbFallback = true;
    }
  } else if (isVercelRuntime() && !warnedNoDbConfigOnVercel) {
    // Brak KOMPLETNEJ konfiguracji bazy na Vercelu — w odróżnieniu od gałęzi
    // wyżej (baza skonfigurowana, ale chwilowo niedostępna) to nie jest
    // przejściowa awaria: nikt nie ustawił env, więc licznik będzie in-memory
    // (per instancja) NA STAŁE, dopóki ktoś tego nie zauważy. Na Vercelu to
    // realnie oznacza brak globalnej ochrony (ADR-039/ADR-106, aneks
    // 2026-08-10) — sygnał raz na proces, nie per żądanie, żeby nie zalać
    // logów na gorącej ścieżce auth/checkout.
    console.warn(
      "[rate-limit] Brak konfiguracji bazy rate-limitu (NEXT_PUBLIC_SUPABASE_URL / " +
        `${SUPABASE_PUBLISHABLE_KEY_ENV}) na Vercelu — licznik in-memory jest PER INSTANCJA ` +
        "i na wielo-instancyjnym/wieloregionowym hostingu NIE chroni globalnie. Ustaw zmienne " +
        "środowiskowe bazy. Patrz docs/audyty/2026-08-10-audyt-env-rate-limit.md.",
    );
    warnedNoDbConfigOnVercel = true;
  }
  return memoryRateLimit(bucketKey, opts.limit, opts.windowSeconds * 1000);
}

/** Reset stanu in-memory — WYŁĄCZNIE do testów. */
export function __resetMemoryRateLimitForTests(): void {
  memoryStore.clear();
  warnedDbFallback = false;
  warnedNoDbConfigOnVercel = false;
}
