/**
 * Warstwa panelu superadmina (Zadanie 7): guard tras /admin, dostęp do danych
 * i kontekst podglądu tenanta.
 *
 * DWIE zasady, na których stoi ten moduł:
 *
 * 1. Zero service-role. Wszystkie odczyty i mutacje idą klientem z sesją
 *    superadmina — egzekwuje je RLS (app.is_superadmin()). Błąd w kodzie tego
 *    pliku nie jest w stanie odsłonić danych, bo bramka siedzi w bazie.
 * 2. Brak uprawnień = 404, nie 403. Zwykły użytkownik nie ma się dowiedzieć,
 *    że /admin w ogóle istnieje.
 */
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import type { Plan, Subscription, Tenant, TenantStatus } from "@avably/db";

import { AuthError, type AuthContext } from "./auth";
import { localePath, type Query } from "./navigation";
import { requireSuperadmin } from "./supabase-server";

export const SUPERADMIN_HOME = "/admin/tenants";

/**
 * Guard stron i akcji /admin. Kieruje user-a tam, gdzie może coś z tym zrobić:
 * brak sesji → logowanie, sesja aal1 z czynnikiem TOTP → wyzwanie MFA
 * (step-up), superadmin bez 2FA → włączenie 2FA. Każdy inny przypadek — czyli
 * „to nie jest superadmin" — kończy się 404.
 */
export async function requireSuperadminPage(nextPath: string = SUPERADMIN_HOME): Promise<AuthContext> {
  try {
    return await requireSuperadmin();
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;

    // Cel przekierowania musi nieść locale, na którym user stał. Bez tego
    // routing (localePrefix: "always") nada prefiks z wykrywania i wyrzuci
    // np. Polaka z /pl/admin/tenants na /en/login.
    const next: Query = { next: nextPath };
    if (error.code === "unauthenticated") redirect(await localePath("/login", next));
    if (error.code === "mfa_required") redirect(await localePath("/bezpieczenstwo/wyzwanie", next));
    if (error.code === "mfa_enrollment_required") redirect(await localePath("/bezpieczenstwo", next));
    // Cofnięty superadmin (R12b/H-01): wpis app.superadmins zniknął, a claim
    // wciąż mówi superadmin=true. NIE notFound() — to zamaskowałoby /admin jako
    // 404 i zostawiło usera z martwym claimem; kierujemy na /dostep-cofniety,
    // który wylogowuje i odsyła na /login (jak dla cofniętego członka).
    if (error.code === "membership_revoked") redirect(await localePath("/dostep-cofniety"));
    notFound();
  }
}

// -----------------------------------------------------------------------
// Odczyt danych (RLS: superadmin widzi wszystkich tenantów)
// -----------------------------------------------------------------------

export interface TenantListItem extends Tenant {
  plan_id: string | null;
  subscription_status: string | null;
}

interface TenantRow extends Tenant {
  subscriptions: Pick<Subscription, "plan_id" | "status"> | Pick<Subscription, "plan_id" | "status">[] | null;
}

function flattenTenant(row: TenantRow): TenantListItem {
  const subscription = Array.isArray(row.subscriptions) ? row.subscriptions[0] : row.subscriptions;
  const { subscriptions: _subscriptions, ...tenant } = row;
  return {
    ...tenant,
    plan_id: subscription?.plan_id ?? null,
    subscription_status: subscription?.status ?? null,
  };
}

export async function listTenants(ctx: AuthContext): Promise<TenantListItem[]> {
  const { data, error } = await ctx.supabase
    .from("tenants")
    .select("id, slug, name, status, status_before_lock, locale, created_at, subscriptions(plan_id, status)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Nie udało się pobrać listy organizacji: ${error.message}`);
  return (data as TenantRow[]).map(flattenTenant);
}

export async function getTenant(ctx: AuthContext, tenantId: string): Promise<TenantListItem | null> {
  const { data, error } = await ctx.supabase
    .from("tenants")
    .select("id, slug, name, status, status_before_lock, locale, created_at, subscriptions(plan_id, status)")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) throw new Error(`Nie udało się pobrać organizacji: ${error.message}`);
  return data ? flattenTenant(data as TenantRow) : null;
}

export async function listPlans(ctx: AuthContext): Promise<Plan[]> {
  const { data, error } = await ctx.supabase
    .from("plans")
    .select("*")
    .eq("active", true)
    .order("price_grosze", { ascending: true });

  if (error) throw new Error(`Nie udało się pobrać katalogu planów: ${error.message}`);
  return (data ?? []) as Plan[];
}

export const LOCKED_STATUS: TenantStatus = "superadmin_locked";

export function isLocked(tenant: Pick<Tenant, "status">): boolean {
  return tenant.status === LOCKED_STATUS;
}

// -----------------------------------------------------------------------
// Podgląd tenanta (impersonacja read-only — ADR-010)
// -----------------------------------------------------------------------

/**
 * Ciasteczko podglądu NIE jest poświadczeniem: nie nadaje żadnych uprawnień
 * i samo z siebie niczego nie otwiera. Każde żądanie w podglądzie i tak
 * przechodzi przez `requireSuperadminPage()` + RLS. Ciasteczko trzyma tylko
 * odpowiedź na pytanie „przez które drzwi tu wszedłeś" — a te drzwi
 * (server action) obowiązkowo zapisują wpis w audit_log. Dzięki temu nie da
 * się oglądać danych tenanta bez śladu w dzienniku, mimo że polityki RLS
 * pozwalają superadminowi czytać wszystko.
 */
const VIEW_COOKIE = "sa_podglad_tenant";
const VIEW_MAX_AGE_SECONDS = 30 * 60;

export async function setTenantViewCookie(tenantId: string): Promise<void> {
  const store = await cookies();
  store.set(VIEW_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VIEW_MAX_AGE_SECONDS,
  });
}

export async function clearTenantViewCookie(): Promise<void> {
  const store = await cookies();
  store.delete(VIEW_COOKIE);
}

export async function getTenantViewCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(VIEW_COOKIE)?.value ?? null;
}
