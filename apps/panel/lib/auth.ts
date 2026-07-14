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

import type { Role } from "@rental/db";

/**
 * Powód odmowy — rozstrzyga, co ma zrobić wywołujący (patrz
 * lib/superadmin.ts):
 * - `unauthenticated` → 401, przekierowanie na /login,
 * - `forbidden` → 403, brak uprawnień (dla tras /admin: 404, nie ujawniamy
 *   istnienia panelu superadmina),
 * - `mfa_required` → 403, ale user MA czynnik TOTP i jest tylko na aal1:
 *   trzeba go przeprowadzić przez wyzwanie MFA (/bezpieczenstwo/wyzwanie),
 *   a nie odmawiać na głucho,
 * - `mfa_enrollment_required` → 403: superadmin bez ŻADNEGO czynnika 2FA —
 *   musi go najpierw włączyć (/bezpieczenstwo).
 */
export type AuthErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "mfa_required"
  | "mfa_enrollment_required";

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

export interface AuthContext {
  user: { id: string; email: string | null };
  tenantId: string | null;
  role: Role | null;
  superadmin: boolean;
  /** Authentication Assurance Level — "aal2" = po weryfikacji MFA. */
  aal: string;
  supabase: SupabaseClient;
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
    supabase,
  };
}

/**
 * Guard dla API panelu (rdzeń, testowalny). Rzuca `AuthError`:
 * - 401, jeśli brak zalogowanego usera,
 * - 403, jeśli user nie ma przypisanej organizacji (tenant_id null z JWT),
 * - 403, jeśli podano `role` i nie zgadza się z rolą usera w tenancie.
 */
export async function requireMemberWithClient(
  supabase: SupabaseClient,
  role?: Role,
): Promise<AuthContext> {
  const ctx = await getAuthContext(supabase);
  if (!ctx) throw new AuthError(401, "Wymagane zalogowanie.");
  if (!ctx.tenantId) throw new AuthError(403, "Brak przypisanej organizacji.");
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
