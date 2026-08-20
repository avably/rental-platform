/**
 * Konfiguracja portu Stripe Connect (Z2, ADR-065).
 *
 * SEMANTYKA BRAKU KONFIGURACJI = LUSTRO ADR-033/046, nie ADR-032. Turnstile
 * bez sekretu robi dev-skip i PRZEPUSZCZA, bo brak CAPTCHY w dev jest
 * nieszkodliwy. Tutaj dev-skip byłby cichym sukcesem na osi PIENIĘDZY: panel
 * pokazałby „konto gotowe", konta u dostawcy by nie było, a najemca
 * dowiedziałby się o tym przy pierwszej płatności swojego klienta. Dlatego
 * brak konfiguracji = onboarding JAWNIE niedostępny: `stripeAvailability`
 * gasi przycisk i podaje powód, a wywołanie mimo to kończy się
 * `StripeConfigError`. ZERO trybu awaryjnego, zero atrapy konta.
 *
 * DLACZEGO PREFIKS `AVABLY_` (ADR-049, awaria 2.6c). Przestrzeń `STRIPE_*`
 * należy do DOSTAWCY: oficjalna integracja Stripe↔Vercel wstrzykuje do
 * projektu własne `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` /
 * `STRIPE_WEBHOOK_SECRET`. Dokładnie tak nas przewróciło `VERCEL_PROJECT_ID`:
 * zmienna dostawcy przykryła naszą, objaw był NIEMY, diagnoza kosztowała
 * dzień. Tu stawka jest wyższa — cudza wartość w `STRIPE_SECRET_KEY` oznacza
 * pobieranie pieniędzy na cudze konto platformy.
 *
 * ZERO FALLBACKU NA `STRIPE_*`. Odczyt „jak nie ma naszej, weź dostawcy"
 * przywróciłby tę awarię w wersji trudniejszej do znalezienia, bo „przecież
 * mamy własne nazwy". Brak naszej zmiennej ma gasić przycisk, nie sięgać po
 * cudzą wartość.
 *
 * Nazwy własne:
 *   AVABLY_STRIPE_SECRET_KEY      (sensitive)
 *   AVABLY_STRIPE_PUBLISHABLE_KEY
 *   AVABLY_STRIPE_WEBHOOK_SECRET  (sensitive; powstaje w Z4 — patrz niżej)
 */
import type { StripeAvailability, StripeConfig } from "./types";

export const STRIPE_SECRET_KEY_ENV = "AVABLY_STRIPE_SECRET_KEY";
export const STRIPE_PUBLISHABLE_KEY_ENV = "AVABLY_STRIPE_PUBLISHABLE_KEY";
export const STRIPE_WEBHOOK_SECRET_ENV = "AVABLY_STRIPE_WEBHOOK_SECRET";
/**
 * Sekret podpisu DRUGIEJ destynacji zdarzeń — „Thin" (ADR-222).
 *
 * Zdarzenia v2 „thin" (`v2.core.account.updated`, ADR-218) NIE dają się dodać
 * do istniejącej destynacji Snapshot — Stripe wymaga OSOBNEJ destynacji Thin,
 * a każda destynacja ma WŁASNY sekret `whsec_…`. Ten sam endpoint URL obsługuje
 * obie; route weryfikuje podpis przeciw OBU sekretom (patrz `stripe-webhook.ts`).
 *
 * Prefiks `AVABLY_` z tego samego powodu co reszta rodziny (ADR-049): przestrzeń
 * `STRIPE_*` należy do integracji dostawcy i cudza wartość by nas przykryła.
 */
export const STRIPE_WEBHOOK_SECRET_THIN_ENV = "AVABLY_STRIPE_WEBHOOK_SECRET_THIN";

/**
 * Przestrzeń nazw DOSTAWCY — wymieniona tu WYŁĄCZNIE po to, żeby test
 * mutacyjny miał czego pilnować i żeby czytelnik widział, czego NIE czytamy.
 * Żadna funkcja w tym pliku nie sięga po te nazwy.
 */
export const PROVIDER_NAMESPACE_ENVS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

export class StripeConfigError extends Error {
  constructor(public readonly problems: string[]) {
    // „niedostępna", nie „nieskonfigurowana": bramki niżej zapalają się także
    // przy konfiguracji KOMPLETNEJ, tylko wewnętrznie sprzecznej.
    super(`Integracja płatności jest niedostępna: ${problems.join("; ")}`);
    this.name = "StripeConfigError";
  }
}

export interface StripeConfigOptions {
  /** Jawne wartości (test, wymuszona konfiguracja); domyślnie z env procesu. */
  config?: Partial<StripeConfig> | undefined;
}

/**
 * `in` zamiast `??` — wzorzec `resolveApiKey` z ADR-033 i `readConfig`
 * z portu domen: jawne `config: undefined` to DECYZJA wołającego (test
 * wymuszający brak konfiguracji) i nie może spaść na env procesu, bo wtedy
 * test „brak klucza" przechodziłby zielono na maszynie, która klucz ma.
 */
function readConfig(options: StripeConfigOptions): Partial<StripeConfig> {
  if ("config" in options) return options.config ?? {};
  return {
    secretKey: process.env[STRIPE_SECRET_KEY_ENV],
    publishableKey: process.env[STRIPE_PUBLISHABLE_KEY_ENV],
    webhookSecret: process.env[STRIPE_WEBHOOK_SECRET_ENV],
  };
}

/** Pusty string w env to BRAK konfiguracji, nie wartość. */
function present(value: string | null | undefined): string | undefined {
  return value ? value : undefined;
}

/**
 * Tryb klucza rozpoznany po prefiksie. `null` = nie rozpoznajemy — i wtedy
 * MILCZYMY zamiast zgadywać: bramka, która zapala się przy nieznanym
 * kształcie, wyłączyłaby płatności przy pierwszej zmianie konwencji dostawcy.
 */
function keyMode(key: string): "test" | "live" | null {
  if (/^[a-z]{2}_test_/.test(key)) return "test";
  if (/^[a-z]{2}_live_/.test(key)) return "live";
  return null;
}

/**
 * BRAMKA ZAMIANY KLUCZY. Klucz sekretny wklejony w miejsce publicznego to nie
 * literówka, tylko wyciek: wartość `AVABLY_STRIPE_PUBLISHABLE_KEY` z definicji
 * jedzie do przeglądarki (Z3), a `sk_`/`rk_` daje pełną władzę nad kontem
 * platformy. Odwrotna zamiana jest „tylko" awarią, ale rozpoznaje się tak samo
 * tanio, więc obie są tu obok siebie.
 *
 * Rozpoznajemy po PREFIKSIE, bo to jedyna część klucza, którą wolno oglądać
 * — i którą wolno wymienić w komunikacie idącym na ekran.
 */
function swappedKeyProblems(secretKey: string, publishableKey: string): string[] {
  const problems: string[] = [];
  if (/^pk_/.test(secretKey)) {
    problems.push(`${STRIPE_SECRET_KEY_ENV} zawiera klucz publiczny (prefiks pk_)`);
  }
  if (/^(sk|rk)_/.test(publishableKey)) {
    problems.push(
      `${STRIPE_PUBLISHABLE_KEY_ENV} zawiera klucz sekretny (prefiks sk_/rk_) — ` +
        `ta zmienna trafia do przeglądarki`,
    );
  }
  return problems;
}

/**
 * BRAMKA ROZJAZDU TRYBÓW. Klucz sekretny z trybu testowego i publiczny
 * z produkcyjnego (albo odwrotnie) to awaria NIEMA: serwer utworzy płatność
 * w jednym trybie, przeglądarka potwierdzi ją w drugim, a operator zobaczy
 * „nie znaleziono płatności" bez żadnej wskazówki dlaczego. To ten sam kształt
 * co awaria 2.6c — konfiguracja spójna z osobna, sprzeczna razem.
 */
function modeMismatchProblem(secretKey: string, publishableKey: string): string | null {
  const secretMode = keyMode(secretKey);
  const publishableMode = keyMode(publishableKey);
  if (!secretMode || !publishableMode) return null;
  if (secretMode === publishableMode) return null;
  return (
    `${STRIPE_SECRET_KEY_ENV} (${secretMode}) i ${STRIPE_PUBLISHABLE_KEY_ENV} ` +
    `(${publishableMode}) są z różnych trybów dostawcy`
  );
}

/**
 * Zbiera WSZYSTKIE braki naraz (wzorzec `CourierConfigError`, ADR-031) —
 * operator uzupełnia konfigurację po jednym komunikacie, a nie po serii prób.
 *
 * `webhookSecret` NIE JEST tu wymagany: jego brak nie odbiera portowi Connect
 * niczego, a wymaganie go zablokowałoby Z2 do czasu Z4 (patrz `StripeConfig`).
 * Ścieżka, która go naprawdę potrzebuje, ma własną bramkę niżej.
 */
export function resolveStripeConfig(options: StripeConfigOptions = {}): StripeConfig {
  const raw = readConfig(options);
  const secretKey = present(raw.secretKey);
  const publishableKey = present(raw.publishableKey);

  const problems: string[] = [];
  if (!secretKey) problems.push(`brak ${STRIPE_SECRET_KEY_ENV}`);
  if (!publishableKey) problems.push(`brak ${STRIPE_PUBLISHABLE_KEY_ENV}`);

  // Bramki kształtu dopiero po sprawdzeniu obecności: „brak zmiennej"
  // i „zmienna niesie nie to, co trzeba" to dwa różne komunikaty.
  if (secretKey && publishableKey) {
    problems.push(...swappedKeyProblems(secretKey, publishableKey));
    const mismatch = modeMismatchProblem(secretKey, publishableKey);
    if (mismatch) problems.push(mismatch);
  }

  if (problems.length > 0) throw new StripeConfigError(problems);

  return {
    secretKey: secretKey as string,
    publishableKey: publishableKey as string,
    webhookSecret: present(raw.webhookSecret) ?? null,
  };
}

/**
 * Czy onboarding Connect ma z czym działać. Liczone na SERWERZE — klucz nie
 * schodzi do klienta, schodzi wyłącznie POWÓD (nazwy zmiennych).
 */
export function stripeAvailability(options: StripeConfigOptions = {}): StripeAvailability {
  try {
    resolveStripeConfig(options);
    return { available: true, reason: null };
  } catch (error) {
    if (error instanceof StripeConfigError) return { available: false, reason: error.message };
    throw error;
  }
}

/**
 * BRAMKA WEBHOOKA (dla Z4, egzekwowana od dziś).
 *
 * Sekret podpisu jest nullowalny w konfiguracji dokładnie po to, żeby brak
 * NIEISTNIEJĄCEJ jeszcze zmiennej nie gasił działających ścieżek Connect —
 * ale ścieżka weryfikacji podpisu bez sekretu nie ma sensu: przyjmowałaby
 * dowolne ciało jako pochodzące od dostawcy. Dlatego dostęp do sekretu idzie
 * WYŁĄCZNIE przez tę funkcję, a ona RZUCA. Funkcja i jej test istnieją już
 * teraz, żeby Z4 nie musiało pamiętać o dołożeniu bramki — ma ją zastać.
 */
export function requireStripeWebhookSecret(options: StripeConfigOptions = {}): string {
  const config = resolveStripeConfig(options);
  if (!config.webhookSecret) throw new StripeConfigError([`brak ${STRIPE_WEBHOOK_SECRET_ENV}`]);
  return config.webhookSecret;
}

/** Jawna wartość sekretu Thin (test) albo odczyt z env procesu. */
export interface StripeWebhookSecretThinOptions {
  value?: string | null | undefined;
}

/**
 * SEKRET DRUGIEJ DESTYNACJI (Thin) — LUSTRO `requireStripeWebhookSecret`, ale
 * OPCJONALNE: NIE RZUCA. Brak zwraca `undefined`.
 *
 * To zamierzona różnica semantyki, nie niedopatrzenie. Sekret Snapshot jest
 * WYMAGANY — bez niego endpoint nie ma czym weryfikować niczego i `route.ts`
 * oddaje 500. Sekret Thin jest DODATKOWĄ destynacją, której właściciel może
 * jeszcze nie utworzyć: dopóki go nie ma, v1 (Snapshot) działa bez zmian,
 * a zdarzenia v2 „thin" są ODRZUCANE (zły podpis → 400), dokładnie jak dziś.
 * Wymaganie tego sekretu zgasiłoby CAŁY webhook do czasu konfiguracji drugiej
 * destynacji — czyli zepsułoby v1, żeby przygotować v2.
 *
 * Niezależny od `resolveStripeConfig` (nie przechodzi przez bramki kluczy):
 * obecność sekretu Thin nie ma związku z poprawnością pary secret/publishable,
 * a przepuszczenie go przez `resolveStripeConfig` znaczyłoby, że literówka
 * w innym kluczu wywraca odczyt tego. Pusty string = brak (wzorzec `present`).
 *
 * `"value" in options` (jak `readConfig`): jawne `value: undefined` to DECYZJA
 * wołającego (test wymuszający brak), nie może spaść na env procesu.
 */
export function stripeWebhookSecretThin(
  options: StripeWebhookSecretThinOptions = {},
): string | undefined {
  if ("value" in options) return present(options.value);
  return present(process.env[STRIPE_WEBHOOK_SECRET_THIN_ENV]);
}
