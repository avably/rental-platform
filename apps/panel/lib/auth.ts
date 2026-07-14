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

export class AuthError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
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
 * uprawnień, nie tylko brak 2FA.
 */
export async function requireSuperadminWithClient(supabase: SupabaseClient): Promise<AuthContext> {
  const ctx = await getAuthContext(supabase);
  if (!ctx) throw new AuthError(401, "Wymagane zalogowanie.");
  if (!ctx.superadmin) throw new AuthError(403, "Wymagane uprawnienia superadmina.");
  if (ctx.aal !== "aal2") {
    throw new AuthError(403, "Wymagane uwierzytelnienie dwuskładnikowe (aal2) dla superadmina.");
  }
  return ctx;
}
