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
 * - `tenant_suspended` → 403: organizacja ma status zamykający panel
 *   (PANEL_CLOSED_STATUSES — ADR-107). Guard strony kieruje operatora na
 *   /organizacja-zawieszona (komunikat + wylogowanie), akcje i handlery po
 *   prostu odmawiają. Jeden kod dla wszystkich trzech statusów: operator nie
 *   dostaje szczegółów rozliczeniowych, a superadmin i tak widzi prawdę
 *   w /admin/tenants.
 */
export type AuthErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "superadmin_without_org"
  | "mfa_required"
  | "mfa_enrollment_required"
  | "tenant_suspended";

/**
 * Statusy tenanta zamykające panel (ADR-107). `past_due` ŚWIADOMIE
 * przepuszcza: operator musi mieć wejście do panelu, żeby uregulować płatność
 * (przyszły banner, nie blokada). To różnica wobec storefrontu, który wpuszcza
 * wyłącznie trialing|active (migracje 0017/0022) — publiczny sklep niepłacącego
 * najemcy nie przyjmuje zamówień, ale panel zostaje otwarty. Nadzbiór
 * LOCKED_STATUS superadmina (lib/superadmin.ts) — blokada platformy zamyka
 * panel tak samo jak zawieszenie rozliczeniowe.
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
  supabase: SupabaseClient;
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
 * - 403 `tenant_suspended`, jeśli organizacja ma status zamykający panel
 *   (ADR-107) — sprawdzane PRZED rolą: zawieszenie dotyczy całej organizacji,
 *   więc odmowa nazywa zawieszenie, nie przypadkowy brak roli,
 * - 403, jeśli podano `role` i nie zgadza się z rolą usera w tenancie.
 *
 * Odczyt statusu (ADR-107) to JEDYNE zapytanie guardu do bazy: klientem SESJI
 * (RLS `own_select` z 0001 ogranicza wiersz do własnego tenanta — guard nie ma
 * jak odczytać cudzego statusu), bez cache'u między żądaniami (zawieszenie
 * działa od NASTĘPNEGO żądania, stale-while-suspended nie istnieje).
 * Fail-closed: błąd odczytu rzuca (500 strony), brak wiersza przy poprawnym
 * claimie — anomalia (tenant usunięty przy żywej sesji) — daje 403.
 */
export async function requireMemberWithClient(
  supabase: SupabaseClient,
  role?: Role,
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

  const { data: tenantRow, error: statusError } = await supabase
    .from("tenants")
    .select("status")
    .eq("id", ctx.tenantId)
    .maybeSingle();
  if (statusError) {
    // NIE AuthError: to awaria infrastruktury, nie decyzja autoryzacyjna —
    // maskowanie jej kodem 403 wysyłałoby operatora na ekran „organizacja
    // zawieszona" przy zwykłej czkawce bazy. Rzut kończy żądanie błędem 500,
    // czyli i tak fail-closed.
    throw new Error(`Nie udało się zweryfikować statusu organizacji: ${statusError.message}`);
  }
  if (!tenantRow) throw new AuthError(403, "Brak przypisanej organizacji.");
  const tenantStatus = (tenantRow as { status: TenantStatus }).status;
  if (PANEL_CLOSED_STATUSES.includes(tenantStatus)) {
    throw new AuthError(
      403,
      "Organizacja jest zawieszona. Skontaktuj się ze wsparciem Avably, aby przywrócić dostęp.",
      "tenant_suspended",
    );
  }
  ctx.tenantStatus = tenantStatus;

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
 */
export async function requireSuperadminWithClient(supabase: SupabaseClient): Promise<AuthContext> {
  const ctx = await getAuthContext(supabase);
  if (!ctx) throw new AuthError(401, "Wymagane zalogowanie.");
  if (!ctx.superadmin) throw new AuthError(403, "Wymagane uprawnienia superadmina.");

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
