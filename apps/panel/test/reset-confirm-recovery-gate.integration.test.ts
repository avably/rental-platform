/**
 * Sondy SUROWE bramki recovery (R14, audyt M-01, ADR-122) — żywy lokalny GoTrue.
 *
 * Suita jednostkowa (reset-confirm-recovery-gate.test.ts) pracuje na payloadach
 * zdjętych z realnych JWT; TA suita wywołuje PRAWDZIWĄ akcję przeciw
 * PRAWDZIWEMU dostawcy (lokalny Supabase), z pominięciem formularza — jak w
 * bezpiecznej reprodukcji audytu. Trzy sondy z brief-u:
 *
 *   1. BEZ SESJI        → odmowa; hasło niezmienione (stare loguje).
 *   2. SESJA ZWYKŁA     → odmowa; hasło niezmienione (stare loguje, nowe nie).
 *   3. SESJA RECOVERY   → zmiana; stare hasło martwe, nowe działa, refresh
 *                         token pozostałej sesji unieważniony, claimy tenanta
 *                         IDENTYCZNE przed i po (zero przecieku między
 *                         tenantami przy zmianie hasła).
 *
 * Sesję recovery ustanawia verifyOtp(type=recovery, token_hash) — DOKŁADNIE
 * ta ścieżka, którą przechodzi produkcyjny callback app/auth/confirm/route.ts.
 * Mockowane są wyłącznie warstwy żądania Next (headers/redirect/intl) i
 * limiter (ma własną suitę anti-abuse); klient Supabase, getAuthContext,
 * claim `amr` i zapis hasła są PRAWDZIWE.
 *
 * Dane wyłącznie SYNTETYCZNE (user/tenant tworzone i sprzątane tutaj), na
 * WSPÓLNYM lokalnym Supabase — bez resetu bazy, bez dotykania cudzych seedów.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

// Transport e-maili ma zostać JAWNIE niedostępny (powiadomienie nie może
// wywrócić przepływu) — klucz z env dewelopera nie może wysłać niczego w świat.
delete process.env.RESEND_API_KEY;

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  permanentRedirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "pl",
  getTranslations: async () => (key: string) => `[${key}]`,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-for", "203.0.113.99"]]),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

vi.mock("@avably/security/rate-limit", () => ({
  PANEL_AUTH_RATE_LIMIT_PREFIX: "panel-auth-rl",
  checkRateLimit: async () => ({ success: true, remaining: 1 }),
}));

/** Klient „żądania" — sonda podstawia go per przypadek. */
let currentClient: SupabaseClient | null = null;
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => {
    if (!currentClient) throw new Error("sonda nie ustawiła klienta");
    return currentClient;
  },
}));

const { resetConfirmAction } = await import("@/app/[locale]/(auth)/reset/confirm/actions");

const UNIFORM_REFUSAL = "Sesja resetu wygasła lub link jest nieprawidłowy. Poproś o nowy link.";

const PASSWORD_START = "SondaR14!poczatek";
const PASSWORD_HIJACK = "SondaR14!napastnik";
const PASSWORD_FINAL = "SondaR14!po-recovery";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function runConfirm(password: string): Promise<{ error?: string } | { url: string }> {
  const form = new FormData();
  form.set("password", password);
  try {
    return await resetConfirmAction({}, form);
  } catch (error) {
    if (error instanceof RedirectSignal) return { url: error.url };
    throw error;
  }
}

/** Logowanie hasłem na świeżym kliencie — wyrocznia „czy hasło obowiązuje". */
async function passwordWorks(email: string, password: string): Promise<boolean> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return false;
  await client.auth.signOut({ scope: "local" });
  return data.session !== null;
}

describe.runIf(hasEnv)("R14: sondy surowe reset-confirm na żywym GoTrue", () => {
  const suffix = Date.now().toString(36);
  const email = `r14-gate-${suffix}@test.local`;
  let service: SupabaseClient;
  let userId: string;
  let tenantId: string;

  beforeAll(async () => {
    service = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password: PASSWORD_START,
      email_confirm: true,
    });
    if (createError || !created.user) {
      throw new Error(`Nie udało się utworzyć syntetycznego usera: ${createError?.message}`);
    }
    userId = created.user.id;

    // Członkostwo w syntetycznym tenancie — żeby hook custom_access_token
    // wstrzykiwał NIEpuste claimy tenanckie i dało się dowieść ich zachowania.
    const { data: tenant, error: tenantError } = await service
      .from("tenants")
      .insert({ slug: `r14-gate-${suffix}`, name: `Sonda R14 ${suffix}` })
      .select("id")
      .single();
    if (tenantError || !tenant) {
      throw new Error(`Nie udało się utworzyć syntetycznego tenanta: ${tenantError?.message}`);
    }
    tenantId = (tenant as { id: string }).id;

    const { error: memberError } = await service
      .from("members")
      .insert({ tenant_id: tenantId, user_id: userId, role: "owner" });
    if (memberError) throw new Error(`Nie udało się dodać członkostwa: ${memberError.message}`);
  }, 30_000);

  afterAll(async () => {
    // Sprzątanie po sobie na WSPÓLNEJ bazie: user + tenant (members kasują się
    // kaskadą). Kolejność: najpierw user (FK members → users), potem tenant.
    if (service) {
      if (userId) await service.auth.admin.deleteUser(userId);
      if (tenantId) await service.from("tenants").delete().eq("id", tenantId);
    }
  }, 30_000);

  it("SONDA 1 — bez sesji: odmowa, hasło niezmienione", async () => {
    currentClient = anonClient(); // zero sesji

    const result = await runConfirm(PASSWORD_HIJACK);

    expect(result).toEqual({ error: UNIFORM_REFUSAL });
    expect(await passwordWorks(email, PASSWORD_START), "stare hasło przestało działać").toBe(true);
    expect(await passwordWorks(email, PASSWORD_HIJACK), "sonda bez sesji ZMIENIŁA hasło").toBe(false);
  }, 20_000);

  it("SONDA 2 — sesja zwykła (hasłowa): odmowa, hasło niezmienione", async () => {
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD_START });
    expect(error).toBeNull();
    currentClient = client;

    const result = await runConfirm(PASSWORD_HIJACK);

    expect(result, "napastnik z ważną sesją dostał inną odpowiedź niż brak sesji").toEqual({
      error: UNIFORM_REFUSAL,
    });
    expect(await passwordWorks(email, PASSWORD_START), "stare hasło przestało działać").toBe(true);
    expect(await passwordWorks(email, PASSWORD_HIJACK), "przejęta sesja ZMIENIŁA hasło").toBe(false);
  }, 20_000);

  it("SONDA 3 — sesja recovery: zmiana + unieważnienie pozostałych sesji + te same claimy tenanta", async () => {
    // „Pozostała sesja" ofiary — jej refresh token ma umrzeć po zmianie hasła.
    const victimSession = anonClient();
    const { data: victimData, error: victimError } = await victimSession.auth.signInWithPassword({
      email,
      password: PASSWORD_START,
    });
    expect(victimError).toBeNull();
    const victimRefreshToken = victimData.session?.refresh_token;
    expect(victimRefreshToken).toBeTruthy();

    const { data: victimClaims } = await victimSession.auth.getClaims();
    const tenantClaimsBefore = victimClaims?.claims.app_metadata as Record<string, unknown>;
    expect(tenantClaimsBefore.tenant_id, "seed nie dał claimu tenant_id").toBe(tenantId);

    // Sesja recovery DOKŁADNIE ścieżką produkcyjnego callbacku /auth/confirm:
    // jednorazowy token z e-maila (generateLink zamiast skrzynki) → verifyOtp.
    const { data: link, error: linkError } = await service.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    expect(linkError).toBeNull();
    const tokenHash = link?.properties?.hashed_token;
    expect(tokenHash).toBeTruthy();

    const recovery = anonClient();
    const { error: verifyError } = await recovery.auth.verifyOtp({
      type: "recovery",
      token_hash: tokenHash as string,
    });
    expect(verifyError).toBeNull();

    // Dowód źródła prawdy: ZWERYFIKOWANE claimy sesji recovery niosą amr=otp.
    const { data: recoveryClaims } = await recovery.auth.getClaims();
    const amr = recoveryClaims?.claims.amr as Array<{ method: string }>;
    expect(amr.some((entry) => entry.method === "otp" || entry.method === "recovery")).toBe(true);

    currentClient = recovery;
    const result = await runConfirm(PASSWORD_FINAL);

    expect(result, "sesja recovery nie przeszła bramki").toHaveProperty("url");
    expect((result as { url: string }).url).toContain("/login");
    expect((result as { url: string }).url).toContain("reset=ok");

    // Hasło NAPRAWDĘ zmienione: stare martwe, nowe działa.
    expect(await passwordWorks(email, PASSWORD_START), "stare hasło wciąż działa").toBe(false);
    expect(await passwordWorks(email, PASSWORD_FINAL), "nowe hasło nie działa").toBe(true);

    // Pozostała sesja unieważniona: refresh token ofiary jest martwy.
    const { error: refreshError } = await victimSession.auth.refreshSession({
      refresh_token: victimRefreshToken as string,
    });
    expect(refreshError, "refresh token pozostałej sesji przeżył zmianę hasła").not.toBeNull();

    // Zero przecieku między tenantami: sesja po zmianie hasła niesie DOKŁADNIE
    // te same claimy tenanta (tenant_id/role/superadmin), co przed zmianą.
    const after = anonClient();
    const { error: afterError } = await after.auth.signInWithPassword({
      email,
      password: PASSWORD_FINAL,
    });
    expect(afterError).toBeNull();
    const { data: afterClaims } = await after.auth.getClaims();
    const tenantClaimsAfter = afterClaims?.claims.app_metadata as Record<string, unknown>;
    expect({
      tenant_id: tenantClaimsAfter.tenant_id,
      role: tenantClaimsAfter.role,
      superadmin: tenantClaimsAfter.superadmin,
    }).toEqual({
      tenant_id: tenantClaimsBefore.tenant_id,
      role: tenantClaimsBefore.role,
      superadmin: tenantClaimsBefore.superadmin,
    });
    await after.auth.signOut({ scope: "local" });
  }, 30_000);
});
