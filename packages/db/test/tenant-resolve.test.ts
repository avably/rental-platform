/**
 * Testy app.resolve_tenant_by_slug (Zadanie 2.1, migracja 0017_tenant_resolution.sql).
 *
 * To jest bramka izolacji routingu storefrontu: middleware zamienia slug z
 * subdomeny na tenant_id TĄ funkcją, anonimowo (odwiedzający sklep nie ma
 * sesji). Test dowodzi trzech rzeczy:
 *   1. anon dostaje id dla tenanta OSIĄGALNEGO (status trialing|active),
 *   2. tenant NIEAKTYWNY (suspended/cancelled/past_due/superadmin_locked) jest
 *      dla anona nieodróżnialny od nieistniejącego — funkcja zwraca NULL,
 *   3. funkcja zwraca WYŁĄCZNIE uuid, a bezpośredni SELECT z tenants dla anona
 *      nadal nic nie zwraca (RPC to jedyna ścieżka, nie wyłom w RLS).
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_* — patrz
 * helpers/seed-tenants.ts. Bez nich plik jest pomijany (strażnik jawności).
 */
import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";

// supabase-js zawsze konstruuje klienta Realtime; Node 20 nie ma globalnego
// WebSocket (patrz helpers/seed-tenants.ts). Ten sam obejście.
const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function createAdminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

function createAnonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

const createdTenantIds: string[] = [];

/** Zakłada tenanta o danym slugu i statusie (service-role omija RLS przy seedzie). */
async function seedTenant(admin: SupabaseClient, status: string): Promise<{ id: string; slug: string }> {
  // Slug NIE koduje statusu: nazwy statusów (superadmin_locked, past_due) mają
  // podkreślenia, a CHECK slugu ich nie dopuszcza (^[a-z0-9][a-z0-9-]{2,38}$).
  const slug = `resolve-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: `Resolve test ${status}`, status })
    .select("id, slug")
    .single();
  if (error || !data) {
    throw new Error(`Nie udało się zasiać tenanta (${status}): ${error?.message}`);
  }
  createdTenantIds.push(data.id as string);
  return { id: data.id as string, slug: data.slug as string };
}

describe.skipIf(!hasEnv)("app.resolve_tenant_by_slug — 0017", () => {
  const admin = hasEnv ? createAdminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? createAnonClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
      createdTenantIds.length = 0;
    }
  });

  it("anon dostaje id dla tenanta ze statusem 'active'", async () => {
    const tenant = await seedTenant(admin, "active");
    const { data, error } = await anon
      .schema("app")
      .rpc("resolve_tenant_by_slug", { p_slug: tenant.slug });

    expect(error, `RPC jako anon zawiodło: ${error?.message}`).toBeNull();
    expect(data, "anon nie rozwiązał slugu aktywnego tenanta — routing zepsuty").toBe(tenant.id);
  });

  it("anon dostaje id dla tenanta ze statusem 'trialing'", async () => {
    const tenant = await seedTenant(admin, "trialing");
    const { data, error } = await anon
      .schema("app")
      .rpc("resolve_tenant_by_slug", { p_slug: tenant.slug });

    expect(error, `RPC jako anon zawiodło: ${error?.message}`).toBeNull();
    expect(data).toBe(tenant.id);
  });

  // DOWÓD MUTACYJNY (izolacja): rozluźnienie filtra statusu w funkcji (np.
  // dopuszczenie 'suspended') sprawi, że ten test przestanie widzieć NULL i
  // spali się — nieaktywny sklep stałby się osiągalny.
  it.each(["suspended", "cancelled", "past_due", "superadmin_locked"])(
    "tenant '%s' jest dla anona nieodróżnialny od nieistniejącego (NULL)",
    async (status) => {
      const tenant = await seedTenant(admin, status);
      const { data, error } = await anon
        .schema("app")
        .rpc("resolve_tenant_by_slug", { p_slug: tenant.slug });

      expect(error, `RPC jako anon zawiodło: ${error?.message}`).toBeNull();
      expect(
        data,
        `tenant ze statusem '${status}' został rozwiązany — nieaktywny sklep jest osiągalny`,
      ).toBeNull();
    },
  );

  it("nieznany slug zwraca NULL (nie błąd)", async () => {
    const { data, error } = await anon
      .schema("app")
      .rpc("resolve_tenant_by_slug", { p_slug: `nieistnieje-${randomUUID().slice(0, 8)}` });

    expect(error, `RPC jako anon zawiodło: ${error?.message}`).toBeNull();
    expect(data).toBeNull();
  });

  it("RPC to JEDYNA ścieżka: bezpośredni SELECT z tenants dla anona nic nie zwraca", async () => {
    const tenant = await seedTenant(admin, "active");
    // Anon widzi id przez RPC…
    const viaRpc = await anon.schema("app").rpc("resolve_tenant_by_slug", { p_slug: tenant.slug });
    expect(viaRpc.data).toBe(tenant.id);

    // …ale nie przez bezpośredni odczyt tabeli (RLS 0001 fail-closed dla anona).
    const direct = await anon.from("tenants").select("id, slug, name, status").eq("slug", tenant.slug);
    expect(direct.data ?? [], "anon odczytał tenants bezpośrednio — RPC nie jest jedyną ścieżką").toHaveLength(0);
  });
});
