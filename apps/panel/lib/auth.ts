/**
 * Guardy autoryzacji panelu (Zadanie 6). Rdzeń (`requireMemberWithClient` /
 * `requireSuperadminWithClient`) przyjmuje gotowego klienta Supabase, dzięki
 * czemu jest testowalny bez kontekstu żądania Next.js (patrz test/auth.test.ts) —
 * `requireMember`/`requireSuperadmin` to cienkie owijki budujące klienta
 * server-side z cookies żądania (next/headers), używane w Server
 * Components/Route Handlers/Server Actions panelu.
 *
 * Źródło tenant_id/role/superadmin: WYŁĄCZNIE claim JWT wstrzyknięty przez
 * hook app.custom_access_token (packages/db/supabase/migrations/0003_auth.sql).
 * `getClaims()` weryfikuje JWT (lokalnie z JWKS albo — dla kluczy
 * symetrycznych, jak w dev — przez zapytanie do serwera Auth), więc claimy
 * są zaufane; NIE czytamy app_metadata z `getUser()`, bo hook modyfikuje
 * wyłącznie token wydawany przy logowaniu, nigdy trwały wiersz auth.users.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { isClosingWindowOpen } from "@avably/core";
import type { Role, TenantStatus } from "@avably/db";

/**
 * Powód odmowy — rozstrzyga, co ma zrobić wywołujący (patrz
 * lib/superadmin.ts):
 * - `unauthenticated` → 401, przekierowanie na /login,
 * - `forbidden` → 403, brak uprawnień (dla tras /admin: 404, nie ujawniamy
 *   istnienia panelu superadmina),
 * - `superadmin_without_org` → 403: superadmin BEZ organizacji na trasie
 *   tenanckiej. Nie ma czego pokazać (RLS bez claimu tenant_id zwraca pusto),
 *   więc guard strony kieruje go do panelu superadmina zamiast na pusty ekran
 *   (dług #52). Kod widzi wyłącznie sesja z claimem superadmin.
 * - `mfa_required` → 403, ale user MA czynnik TOTP i jest tylko na aal1:
 *   trzeba go przeprowadzić przez wyzwanie MFA (/bezpieczenstwo/wyzwanie),
 *   a nie odmawiać na głucho,
 * - `mfa_enrollment_required` → 403: superadmin bez ŻADNEGO czynnika 2FA —
 *   musi go najpierw włączyć (/bezpieczenstwo).
 * - `tenant_suspended` → 403: organizacja jest `suspended`, a okno domykania
 *   (Zasada 8, ADR-138) już się ZAMKNĘŁO (albo zegara nie ma — fail-closed).
 *   Guard strony kieruje operatora na /organizacja-zawieszona (komunikat +
 *   wylogowanie), akcje i handlery po prostu odmawiają.
 * - `tenant_suspended_closing` → 403: organizacja jest `suspended`, okno
 *   domykania JEST otwarte, ale wywołanie NIE ma opt-in `{ closing: true }`
 *   — czyli akcja/strona jest poza allowlistą okna (odmowa domyślna: brak
 *   wpisu = brak dostępu). Guard strony kieruje na /zamowienia (hub
 *   domykania), akcje odmawiają komunikatem o oknie.
 * - `tenant_locked` → 403: blokada platformowa `superadmin_locked`
 *   (antyfraudowa) — zamknięta natychmiast i w całości, okno domykania jej
 *   NIE dotyczy.
 * - `tenant_cancelled` → 403: organizacja zamknięta (`cancelled`) — jak
 *   wyżej, bez okna.
 *   (Do ADR-138 wszystkie trzy statusy szły jednym kodem `tenant_suspended`;
 *   rozdzielenie jest warunkiem okna domykania — wołający musi odróżnić
 *   „domknij najmy" od „koniec". Operator nadal nie dostaje szczegółów
 *   rozliczeniowych, a superadmin widzi prawdę w /admin/tenants.)
 * - `membership_revoked` → 403, ale znaczy „claim JWT jest nieaktualny":
 *   żywy odczyt bazy nie znalazł już członkostwa (albo wpisu superadmina),
 *   a claim wciąż niesie stary tenant_id/superadmin (R12b/H-01, ADR-127).
 *   Guard strony NIE odmawia gołym 403 (na /admin zmapowałby się na 404, na
 *   trasach tenanckich groziłby pętlą przekierowań), tylko kieruje na
 *   /dostep-cofniety → wylogowanie + /login. To JEDYNA droga dla usera
 *   wielotenantowego: dopiero ponowne logowanie każe hookowi przeliczyć claim
 *   na inną, wciąż ważną organizację.
 */
export type AuthErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "superadmin_without_org"
  | "mfa_required"
  | "mfa_enrollment_required"
  | "tenant_suspended"
  | "tenant_suspended_closing"
  | "tenant_locked"
  | "tenant_cancelled"
  | "membership_revoked";

/**
 * Kody odmowy statusowej — wszystkie znaczą „organizacja ma status zamykający
 * tę powierzchnię". Wołający, który dotąd porównywał z `tenant_suspended`,
 * po rozdzieleniu kodów (ADR-138) pyta o CAŁĄ rodzinę.
 */
export const TENANT_STATUS_ERROR_CODES: readonly AuthErrorCode[] = [
  "tenant_suspended",
  "tenant_suspended_closing",
  "tenant_locked",
  "tenant_cancelled",
];

/**
 * Statusy tenanta zamykające panel (ADR-107). `past_due` ŚWIADOMIE
 * przepuszcza: operator musi mieć wejście do panelu, żeby uregulować płatność
 * (przyszły banner, nie blokada). To różnica wobec storefrontu, który wpuszcza
 * wyłącznie trialing|active (migracje 0017/0022) — publiczny sklep niepłacącego
 * najemcy nie przyjmuje zamówień, ale panel zostaje otwarty. Nadzbiór
 * LOCKED_STATUS superadmina (lib/superadmin.ts) — blokada platformy zamyka
 * panel tak samo jak zawieszenie rozliczeniowe.
 *
 * OD ADR-138 z jednym wyjątkiem: `suspended` w otwartym oknie domykania
 * (Zasada 8) przepuszcza wywołania z opt-in `{ closing: true }` — rdzeń niżej
 * rozstrzyga per status, a stała zostaje kontraktem zbioru „zamykających".
 */
export const PANEL_CLOSED_STATUSES: readonly TenantStatus[] = [
  "suspended",
  "cancelled",
  "superadmin_locked",
];

export class AuthError extends Error {
  readonly status: 401 | 403;
  readonly code: AuthErrorCode;

  constructor(status: 401 | 403, message: string, code?: AuthErrorCode) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code ?? (status === 401 ? "unauthenticated" : "forbidden");
  }
}

/**
 * Wpis claimu `amr` (Authentication Methods References) z JWT GoTrue —
 * metoda, którą ustanowiono sesję, i unix-sekundy jej użycia. Claim żyje
 * w ZWERYFIKOWANYM tokenie (getClaims), utrwalany przez GoTrue w
 * auth.amr_claims per sesja: refresh tokenu NIE zmienia ani metody, ani
 * znacznika czasu (zmierzone na GoTrue v2.192.0 — patrz ADR-122).
 */
export interface AmrEntry {
  method: string;
  timestamp: number;
}

export interface AuthContext {
  user: { id: string; email: string | null };
  tenantId: string | null;
  role: Role | null;
  superadmin: boolean;
  /** Authentication Assurance Level — "aal2" = po weryfikacji MFA. */
  aal: string;
  /**
   * Metody uwierzytelnienia sesji (claim `amr`) — wyłącznie wpisy poprawnego
   * kształtu; wpis zdeformowany jest POMIJANY (fail-closed: nie da się nim
   * niczego udowodnić). Puste, gdy dostawca claimu nie wystawił.
   */
  amr: AmrEntry[];
  /**
   * Status organizacji odczytany z bazy przez requireMemberWithClient
   * (ADR-107) — zawsze spoza PANEL_CLOSED_STATUSES, bo statusy zamykające
   * kończą się odmową. `null` w kontekstach bez odczytu (getAuthContext,
   * requireSuperadminWithClient): claim JWT statusu NIE niesie.
   */
  tenantStatus: TenantStatus | null;
  /**
   * Okno domykania (Zasada 8, ADR-138): `true` WYŁĄCZNIE gdy organizacja
   * jest `suspended`, okno jeszcze otwarte, a wywołanie weszło z opt-in
   * `{ closing: true }`. Downstream zawęża wtedy działanie do zamrożonego
   * zbioru (assertClosableOrder) i trybu read-only na ekranach.
   */
  closing: boolean;
  /**
   * `tenants.suspended_at` z tego samego odczytu co status (0067) — punkt
   * zaczepienia zegara okna i licznika banera. `null` poza `suspended`
   * i w kontekstach bez odczytu.
   */
  suspendedAt: string | null;
  supabase: SupabaseClient;
}

/** Opcje guardu członka — opt-in okna domykania (ADR-138). */
export interface RequireMemberOptions {
  /**
   * Wywołanie należy do allowlisty okna domykania: przy `suspended`
   * z otwartym oknem guard PRZEPUSZCZA (ctx.closing = true) zamiast rzucać.
   * Poza `suspended` flaga nie zmienia niczego. Każde użycie jest przypięte
   * inwentarzem-snapshotem (closing-optin-inventory.test.ts) — dopisanie
   * wpisu bez aktualizacji inwentarza pali build.
   */
  closing?: boolean;
}

/**
 * Wpisy `amr` z claimów — tylko elementy poprawnego kształtu. Wartość
 * przychodzi ze ZWERYFIKOWANEGO JWT, ale kształtu i tak nie bierzemy na
 * wiarę: element bez `method`/liczbowego `timestamp` odpada (odpadnięcie
 * jest fail-closed — brak wpisu to brak dowodu, nigdy dowód).
 */
function amrFromClaims(claims: Record<string, unknown>): AmrEntry[] {
  const raw = claims.amr;
  if (!Array.isArray(raw)) return [];
  const entries: AmrEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const method = (item as Record<string, unknown>).method;
    const timestamp = (item as Record<string, unknown>).timestamp;
    if (typeof method !== "string" || typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
      continue;
    }
    entries.push({ method, timestamp });
  }
  return entries;
}

/** Zwraca kontekst auth albo `null`, jeśli brak ważnej sesji. Nie rzuca. */
export async function getAuthContext(supabase: SupabaseClient): Promise<AuthContext | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const claims = data.claims as Record<string, unknown>;
  const appMetadata = (claims.app_metadata ?? {}) as Record<string, unknown>;

  return {
    user: {
      id: claims.sub as string,
      email: (claims.email as string | undefined) ?? null,
    },
    tenantId: (appMetadata.tenant_id as string | null | undefined) ?? null,
    role: (appMetadata.role as Role | null | undefined) ?? null,
    superadmin: Boolean(appMetadata.superadmin),
    aal: (claims.aal as string | undefined) ?? "aal1",
    amr: amrFromClaims(claims),
    tenantStatus: null,
    closing: false,
    suspendedAt: null,
    supabase,
  };
}

/**
 * Okno świeżości dowodu recovery (R14/M-01, ADR-122): 30 minut od
 * skonsumowania jednorazowego tokenu z e-maila. Link recovery żyje godzinę
 * (config `otp_expiry`), a po jego zużyciu użytkownik stoi już na formularzu
 * — pół godziny na wpisanie hasła jest hojne, a ogranicza okno, w którym
 * skradzione COOKIE sesji recovery (nie link!) pozwala ustawić hasło.
 * Znacznik pochodzi z amr_claims dostawcy i NIE przesuwa się przy refreshu
 * tokenu, więc okna nie da się podtrzymywać w nieskończoność.
 */
export const RECOVERY_PROOF_MAX_AGE_SECONDS = 30 * 60;

/** Tolerancja rozjazdu zegarów app ↔ dostawca auth (znacznik z przyszłości). */
const RECOVERY_PROOF_CLOCK_SKEW_SECONDS = 120;

/**
 * Czy sesja ma świeży dowód posiadania skrzynki e-mail (R14/M-01)?
 *
 * ŹRÓDŁO PRAWDY: claim `amr` ze ZWERYFIKOWANEGO JWT (getClaims), nigdy stan
 * aplikacyjny — cookie własnego pomysłu, nagłówek czy parametr dałyby się
 * spreparować, podpisanego tokenu dostawcy nie. GoTrue v2.192.0 zapisuje
 * `method: "otp"` dla sesji ustanowionej PRZEZ JEDNORAZOWY TOKEN Z E-MAILA
 * (verifyOtp type=recovery ORAZ potwierdzenie rejestracji — obie ścieżki
 * dowodzą kontroli nad skrzynką, zmierzone; ADR-122). `"recovery"`
 * akceptujemy na wyrost: stała istnieje w GoTrue i zmiana nazewnictwa w
 * przyszłej wersji nie może po cichu zamknąć legalnego przepływu resetu.
 * Sesja hasłowa (`"password"`), OAuth czy sam TOTP dowodu NIE niosą —
 * dokładnie te sesje napastnik może mieć z przejęcia.
 */
export function hasRecentRecoveryProof(
  amr: readonly AmrEntry[],
  nowMs: number = Date.now(),
): boolean {
  const nowSeconds = Math.floor(nowMs / 1000);
  return amr.some((entry) => {
    if (entry.method !== "otp" && entry.method !== "recovery") return false;
    const age = nowSeconds - entry.timestamp;
    return age >= -RECOVERY_PROOF_CLOCK_SKEW_SECONDS && age <= RECOVERY_PROOF_MAX_AGE_SECONDS;
  });
}

/**
 * Guard dla API panelu (rdzeń, testowalny). Rzuca `AuthError`:
 * - 401, jeśli brak zalogowanego usera,
 * - 403 `superadmin_without_org`, jeśli sesja jest superadminem bez organizacji
 *   (kierowanie do panelu superadmina należy do wołającego — patrz member-page),
 * - 403 `forbidden`, jeśli zwykły user nie ma przypisanej organizacji,
 * - 403 `membership_revoked`, jeśli claim niesie tenant_id, ale żywy odczyt
 *   bazy nie znajduje już członkostwa (odebrane albo tenant/konto skasowane
 *   kaskadą) — patrz niżej,
 * - 403 `tenant_suspended` / `tenant_suspended_closing` / `tenant_locked` /
 *   `tenant_cancelled`, jeśli organizacja ma status zamykający panel
 *   (ADR-107, rozdzielenie kodów: ADR-138) — sprawdzane PRZED rolą:
 *   zawieszenie dotyczy całej organizacji, więc odmowa nazywa zawieszenie,
 *   nie przypadkowy brak roli. WYJĄTEK (okno domykania, Zasada 8):
 *   `suspended` z otwartym oknem (`now() < suspended_at + 30 dni`)
 *   PRZEPUSZCZA wywołania z opt-in `{ closing: true }` — i tylko je,
 * - 403, jeśli podano `role` i nie zgadza się z ŻYWĄ rolą usera w tenancie.
 *
 * ŻYWY ODCZYT CZŁONKOSTWA (R12b/H-01, ADR-127). Do L3 guard pytał tylko o
 * `tenants.status`, a członkostwo i rolę brał z claimu JWT — cofnięty członek
 * wchodził do panelu do wygaśnięcia tokenu. Teraz to samo JEDNO zapytanie
 * (NET ZERO round-tripów wobec ADR-107) czyta WIERSZ `members` żywcem:
 *   * jego OBECNOŚĆ dowodzi członkostwa — brak wiersza = cofnięte,
 *   * `role` z BAZY zamyka cichy downgrade owner→staff (claim go nie widzi),
 *   * zagnieżdżony `tenants(status)` daje status bez drugiego zapytania.
 * Klientem SESJI (RLS `own` z 0001/0007 ogranicza wiersze do własnego tenanta
 * i własnego user_id), bez cache'u między żądaniami. To warstwa APLIKACJI —
 * twardą izolacją danych jest RLS z predykatami live (R12a); guard domyka UX
 * (czyste wylogowanie zamiast cichego 403) i rolę z bazy.
 *
 * Fail-closed z rozróżnieniem przyczyny (kluczowe — inaczej czkawka bazy
 * wylogowuje wszystkich, albo revocation cicho przestaje działać):
 *   * błąd ODCZYTU → `throw Error` (500 strony), nie AuthError: to awaria
 *     infrastruktury, nie decyzja autoryzacyjna,
 *   * brak wiersza → `membership_revoked`: claim jest nieaktualny, wołający
 *     ma wylogować i odesłać na /login (member-page), nie odmawiać na głucho.
 */
export async function requireMemberWithClient(
  supabase: SupabaseClient,
  role?: Role,
  options?: RequireMemberOptions,
): Promise<AuthContext> {
  const ctx = await getAuthContext(supabase);
  if (!ctx) throw new AuthError(401, "Wymagane zalogowanie.");
  if (!ctx.tenantId) {
    // Superadmin organizacji nie ma i mieć nie musi (poza macierzą tenantów —
    // app.superadmins, ADR-002/007). Rozróżniamy go od zwykłego usera bez
    // organizacji, żeby guard strony wysłał go do panelu superadmina zamiast
    // na pusty ekran tenancki (dług #52); dla zwykłego usera zostaje ścieżka
    // zakładania organizacji.
    if (ctx.superadmin) {
      throw new AuthError(
        403,
        "Superadmin bez organizacji — przekierowanie do panelu superadmina.",
        "superadmin_without_org",
      );
    }
    throw new AuthError(403, "Brak przypisanej organizacji.");
  }

  // Jedno zapytanie na obie potrzeby: żywe członkostwo (obecność wiersza + rola
  // z bazy) i status organizacji (zagnieżdżony tenants). Piggyback na odczycie
  // z ADR-107 — nie dokładamy round-tripu.
  // `suspended_at` jedzie TYM SAMYM zapytaniem (ADR-138) — zegar okna
  // domykania nie kosztuje round-tripu.
  const { data: memberRow, error: memberError } = await supabase
    .from("members")
    .select("role, tenants(status, suspended_at)")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (memberError) {
    // NIE AuthError: to awaria infrastruktury, nie decyzja autoryzacyjna —
    // maskowanie jej kodem 403 wylogowywałoby operatora przy zwykłej czkawce
    // bazy. Rzut kończy żądanie błędem 500, czyli i tak fail-closed.
    throw new Error(`Nie udało się zweryfikować członkostwa w organizacji: ${memberError.message}`);
  }
  if (!memberRow) {
    // Brak wiersza = członkostwo cofnięte (albo tenant/konto skasowane
    // kaskadą). Claim JWT wciąż niesie stary tenant_id — jedynym poprawnym
    // wyjściem jest wylogowanie i ponowne logowanie: hook przeliczy claim
    // (user wielotenantowy dostanie drugą org), a user bez żadnej org trafi
    // na /login. Kierowanie tym kodem należy do wołającego (member-page).
    throw new AuthError(403, "Członkostwo w organizacji zostało cofnięte.", "membership_revoked");
  }

  // tenants(status) to relacja to-one; PostgREST zwraca obiekt, ale bierzemy
  // pod uwagę też kształt tablicowy (higiena, jak flattenTenant w superadmin.ts).
  type TenantRead = { status: TenantStatus; suspended_at?: string | null };
  const row = memberRow as {
    role: Role;
    tenants: TenantRead | TenantRead[] | null;
  };
  const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
  if (!tenant) {
    // FK members→tenants gwarantuje rodzica; brak = anomalia infrastruktury,
    // nie decyzja autoryzacyjna → fail-closed przez rzut (500), nie 403.
    throw new Error("Nie udało się zweryfikować statusu organizacji: brak powiązanej organizacji.");
  }
  const tenantStatus = tenant.status;
  const suspendedAt = tenant.suspended_at ?? null;

  // Statusy zamykające panel — rozdzielone kody odmowy (ADR-138).
  // `superadmin_locked` i `cancelled` są zamknięte natychmiast i w całości;
  // okno domykania (Zasada 8) dotyczy WYŁĄCZNIE `suspended`.
  if (tenantStatus === "superadmin_locked") {
    throw new AuthError(
      403,
      "Organizacja jest zablokowana. Skontaktuj się ze wsparciem Avably, aby przywrócić dostęp.",
      "tenant_locked",
    );
  }
  if (tenantStatus === "cancelled") {
    throw new AuthError(
      403,
      "Organizacja została zamknięta. Skontaktuj się ze wsparciem Avably, aby przywrócić dostęp.",
      "tenant_cancelled",
    );
  }
  let closing = false;
  if (tenantStatus === "suspended") {
    // Zegar liczony LENIWIE w guardzie (zero crona): otwarte okno to
    // `now() < suspended_at + 30 dni`, fail-closed przy braku zegara.
    if (!isClosingWindowOpen(suspendedAt)) {
      throw new AuthError(
        403,
        "Organizacja jest zawieszona. Skontaktuj się ze wsparciem Avably, aby przywrócić dostęp.",
        "tenant_suspended",
      );
    }
    if (!options?.closing) {
      // Okno otwarte, ale wywołanie POZA allowlistą domykania — odmowa
      // domyślna (brak wpisu = brak dostępu). Osobny kod, żeby strona mogła
      // odesłać do huba domykania zamiast na ekran „panel zamknięty".
      throw new AuthError(
        403,
        "Organizacja jest zawieszona — w oknie domykania dostępne jest wyłącznie domykanie trwających najmów.",
        "tenant_suspended_closing",
      );
    }
    closing = true;
  }

  // Rola z BAZY nadpisuje rolę z claimu — to ona zamyka cichy downgrade
  // owner→staff (claim, żywy do exp, dalej mówiłby „owner"). Downstream widzi
  // prawdę, a sprawdzenie `role` niżej liczy się względem stanu bazy.
  ctx.role = row.role;
  ctx.tenantStatus = tenantStatus;
  ctx.closing = closing;
  ctx.suspendedAt = tenantStatus === "suspended" ? suspendedAt : null;

  if (role && ctx.role !== role) {
    throw new AuthError(403, `Wymagana rola „${role}".`);
  }
  return ctx;
}

/**
 * Guard superadmina: wymaga claimu `app_metadata.superadmin=true` ORAZ
 * poziomu uwierzytelnienia aal2 (czyli przejścia wyzwania MFA) — superadmin
 * bez skonfigurowanego/zweryfikowanego TOTP jest traktowany jak brak
 * uprawnień, nie tylko brak 2FA. Guard jest fail-closed: aal2 jest twardym
 * warunkiem, a nie „miękką" sugestią.
 *
 * Rozróżnia dwa powody odmowy przy aal1:
 * - superadmin MA zarejestrowany czynnik TOTP (nextLevel = aal2) → kod
 *   `mfa_required`: to POWRACAJĄCY superadmin po świeżym logowaniu, trzeba
 *   go wysłać na wyzwanie MFA, żeby podbił sesję aal1 → aal2,
 * - superadmin nie ma żadnego czynnika → zwykły `forbidden`: musi najpierw
 *   włączyć 2FA (/bezpieczenstwo).
 *
 * ŻYWY ODCZYT SUPERADMINA (R12b/H-01, ADR-127). Dotąd guard ufał WYŁĄCZNIE
 * claimowi `superadmin`, żywemu do wygaśnięcia tokenu — odebrany superadmin
 * zachowywał panel /admin ≤1 h. Teraz po sprawdzeniu claimu dokładamy JEDEN
 * odczyt `app.superadmins` po własnym user_id (RLS `own_or_superadmin_select`
 * z 0003 pozwala widzieć własny wiersz): brak wiersza → `membership_revoked`
 * (wylogowanie, nie 404 maskujące /admin i nie MFA — sprawdzane PRZED aal2,
 * żeby odebranego superadmina nie ciągnąć na wyzwanie 2FA). Błąd odczytu →
 * `throw` (500), fail-closed. Twardą izolacją danych platformy jest i tak RLS
 * z predykatami live (R12a); tu domykamy warstwę aplikacji.
 */
export async function requireSuperadminWithClient(supabase: SupabaseClient): Promise<AuthContext> {
  const ctx = await getAuthContext(supabase);
  if (!ctx) throw new AuthError(401, "Wymagane zalogowanie.");
  if (!ctx.superadmin) throw new AuthError(403, "Wymagane uprawnienia superadmina.");

  // Żywy odczyt wpisu superadmina — obecność wiersza zamiast wiary w claim.
  const { data: superadminRow, error: superadminError } = await supabase
    .schema("app")
    .from("superadmins")
    .select("user_id")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (superadminError) {
    throw new Error(`Nie udało się zweryfikować uprawnień superadmina: ${superadminError.message}`);
  }
  if (!superadminRow) {
    throw new AuthError(403, "Uprawnienia superadmina zostały cofnięte.", "membership_revoked");
  }

  if (ctx.aal !== "aal2") {
    // getAuthenticatorAssuranceLevel() czyta poziomy z sesji (bez round-tripu
    // do Auth): nextLevel = "aal2" oznacza, że user ma zweryfikowany czynnik,
    // którym MOŻE podbić sesję.
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.nextLevel === "aal2" && data.currentLevel !== "aal2") {
      throw new AuthError(
        403,
        "Wymagane potwierdzenie kodem 2FA (podniesienie sesji do aal2).",
        "mfa_required",
      );
    }
    throw new AuthError(
      403,
      "Wymagane włączenie uwierzytelniania dwuskładnikowego dla superadmina.",
      "mfa_enrollment_required",
    );
  }

  return ctx;
}
