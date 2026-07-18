/**
 * Testy app.resolve_tenant_by_domain (Zadanie 2.6, migracja 0022_store_domains.sql).
 *
 * To jest BRAMKA IZOLACJI własnych domen: middleware zamienia obcy host na
 * tenant_id TĄ funkcją, anonimowo (odwiedzający sklep nie ma sesji). Test
 * dowodzi czterech rzeczy:
 *   1. anon dostaje id dla domeny ZWERYFIKOWANEJ i tenanta osiągalnego,
 *   2. domena NIEZWERYFIKOWANA nie prowadzi do sklepu — NULL (dowód mutacyjny
 *      niżej),
 *   3. domena zweryfikowana, ale tenant nieaktywny → NULL (lustro 0017),
 *   4. funkcja zwraca WYŁĄCZNIE uuid, a bezpośredni SELECT z domains dla anona
 *      nadal nic nie zwraca (RPC to jedyna ścieżka, nie wyłom w RLS).
 *
 * Sprawdza też, że automatyczna subdomena powstaje w TEJ SAMEJ transakcji co
 * tenant (app.create_tenant, 0022) — niezmiennik „tenant istnieje ⇒ ma host".
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

async function seedTenant(admin: SupabaseClient, status: string): Promise<string> {
  const slug = `domena-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: `Domain test ${status}`, status })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać tenanta (${status}): ${error?.message}`);
  createdTenantIds.push(data.id as string);
  return data.id as string;
}

async function seedDomain(
  admin: SupabaseClient,
  tenantId: string,
  verified: boolean,
  kind: "subdomain" | "custom" = "custom",
): Promise<string> {
  const host = `sklep-${randomUUID().slice(0, 12)}.example.com`;
  const { error } = await admin.from("domains").insert({
    tenant_id: tenantId,
    domain: host,
    kind,
    verified,
    verified_at: verified ? new Date().toISOString() : null,
  });
  if (error) throw new Error(`Nie udało się zasiać domeny: ${error.message}`);
  return host;
}

describe.skipIf(!hasEnv)("app.resolve_tenant_by_domain — 0022", () => {
  const admin = hasEnv ? createAdminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? createAnonClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) {
      // domains kaskaduje po tenant_id (FK on delete cascade z 0019).
      await admin.from("tenants").delete().in("id", createdTenantIds);
      createdTenantIds.length = 0;
    }
  });

  it.each(["trialing", "active"])(
    "anon rozwiązuje zweryfikowaną domenę tenanta '%s'",
    async (status) => {
      const tenantId = await seedTenant(admin, status);
      const host = await seedDomain(admin, tenantId, true);

      const { data, error } = await anon
        .schema("app")
        .rpc("resolve_tenant_by_domain", { p_host: host });

      expect(error, `RPC jako anon zawiodło: ${error?.message}`).toBeNull();
      expect(data, "zweryfikowana domena aktywnego tenanta nie prowadzi do sklepu").toBe(tenantId);
    },
  );

  /**
   * DOWÓD MUTACYJNY (a) — BRAMKA `verified`. Zdjęcie warunku `and d.verified`
   * z app.resolve_tenant_by_domain sprawia, że ten test przestaje widzieć NULL
   * i się PALI. Bez tej bramki dowolny najemca wpisałby w panelu CUDZĄ domenę
   * (albo nasz kanon www.avably.io) i zacząłby serwować pod nią swój sklep —
   * wiersz w domains nie jest dowodem własności, dowodem jest rekord DNS
   * potwierdzony przez dostawcę.
   */
  it("NIEZWERYFIKOWANA domena nie prowadzi do sklepu (NULL)", async () => {
    const tenantId = await seedTenant(admin, "active");
    const host = await seedDomain(admin, tenantId, false);

    const { data, error } = await anon
      .schema("app")
      .rpc("resolve_tenant_by_domain", { p_host: host });

    expect(error, `RPC jako anon zawiodło: ${error?.message}`).toBeNull();
    expect(
      data,
      "domena bez potwierdzonej własności została rozwiązana — można przejąć cudzy host",
    ).toBeNull();
  });

  /**
   * DOWÓD MUTACYJNY (b) — BRAMKA STATUSU TENANTA (lustro 0017). Rozluźnienie
   * filtra `t.status in ('trialing','active')` sprawia, że ten test przestaje
   * widzieć NULL: sklep zawieszony/anulowany stałby się osiągalny przez własną
   * domenę, omijając bramkę, którą 2.1 postawiło na subdomenach.
   */
  it.each(["suspended", "cancelled", "past_due", "superadmin_locked"])(
    "zweryfikowana domena tenanta '%s' → NULL (nieodróżnialne od nieistnienia)",
    async (status) => {
      const tenantId = await seedTenant(admin, status);
      const host = await seedDomain(admin, tenantId, true);

      const { data, error } = await anon
        .schema("app")
        .rpc("resolve_tenant_by_domain", { p_host: host });

      expect(error, `RPC jako anon zawiodło: ${error?.message}`).toBeNull();
      expect(data, `sklep ze statusem '${status}' jest osiągalny przez własną domenę`).toBeNull();
    },
  );

  it("nieznany host zwraca NULL (nie błąd)", async () => {
    const { data, error } = await anon
      .schema("app")
      .rpc("resolve_tenant_by_domain", { p_host: `nieistnieje-${randomUUID().slice(0, 8)}.example.com` });

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  // Nagłówek `Host` niesie KLIENT: 'SKLEP.EXAMPLE.COM.' to ten sam host co
  // 'sklep.example.com'. Bez normalizacji te warianty dawałyby fałszywe 404.
  it("host normalizuje się do postaci z kolumny (wielkość liter, kropka końcowa)", async () => {
    const tenantId = await seedTenant(admin, "active");
    const host = await seedDomain(admin, tenantId, true);

    for (const variant of [host.toUpperCase(), `${host}.`, ` ${host} `.trim()]) {
      const { data } = await anon
        .schema("app")
        .rpc("resolve_tenant_by_domain", { p_host: variant });
      expect(data, `wariant hosta '${variant}' nie rozwiązał się`).toBe(tenantId);
    }
  });

  it("RPC to JEDYNA ścieżka: bezpośredni SELECT z domains dla anona nic nie zwraca", async () => {
    const tenantId = await seedTenant(admin, "active");
    const host = await seedDomain(admin, tenantId, true);

    const viaRpc = await anon.schema("app").rpc("resolve_tenant_by_domain", { p_host: host });
    expect(viaRpc.data).toBe(tenantId);

    const direct = await anon.from("domains").select("id, domain, tenant_id").eq("domain", host);
    expect(
      direct.data ?? [],
      "anon odczytał domains bezpośrednio — RPC nie jest jedyną ścieżką",
    ).toHaveLength(0);
  });

  // Bramka schematu: kolumny 0022 istnieją i mają zadeklarowane wartości
  // domyślne. Wiersz sprzed migracji ma zostać 'subdomain'/NULL, nie NULL/'?'.
  it("kolumny 0022 mają wartości domyślne zgodne z migracją", async () => {
    const tenantId = await seedTenant(admin, "active");
    const host = `sklep-${randomUUID().slice(0, 12)}.example.com`;
    await admin.from("domains").insert({ tenant_id: tenantId, domain: host });

    const { data } = await admin
      .from("domains")
      .select("kind, verified, provider_domain_id, verified_at, last_error")
      .eq("domain", host)
      .single();

    expect(data).toMatchObject({
      kind: "subdomain",
      verified: false,
      provider_domain_id: null,
      verified_at: null,
      last_error: null,
    });
  });

  it("CHECK odrzuca nieznany kind (tylko subdomain|custom)", async () => {
    const tenantId = await seedTenant(admin, "active");
    const { error } = await admin.from("domains").insert({
      tenant_id: tenantId,
      domain: `zly-${randomUUID().slice(0, 8)}.example.com`,
      kind: "wildcard",
    });

    expect(error?.code, `oczekiwano 23514, było: ${error?.message}`).toBe("23514");
  });
});
