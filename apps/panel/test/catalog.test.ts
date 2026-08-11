/**
 * Testy integracyjne katalogu (Zadanie 3) na żywym, lokalnym Supabase —
 * wzorzec superadmin.test.ts: realni użytkownicy, realne sesje, zero mocków.
 *
 * Weryfikują to, co musi być prawdą NIEZALEŻNIE od kodu panelu, bo egzekwuje
 * to RLS i constrainty z 0007 — akcje panelu idą klientem z sesją (zero
 * service-role), więc to jest ich faktyczna bramka:
 *   1. członek tenanta A tworzy produkt/egzemplarz/próg/punkt — działa,
 *   2. tenant B nie widzi, nie zmieni i nie usunie NICZEGO z katalogu A,
 *   3. B nie wstawi wiersza z tenant_id A (WITH CHECK) ani progu wskazującego
 *      produkt A z własnym tenant_id (klucz złożony — wiersz niereprezentowalny),
 *   4. CHECK-i egzemplarza (okno serwisowe) i unikalność numeru seryjnego
 *      działają na poziomie bazy,
 *   5. sekwencja zapisu progów z panelu (upsert po tier_days + delete
 *      nieobecnych) daje dokładnie nowy cennik.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "CatalogTest!12345678";
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

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

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

/** User + własna organizacja + ŚWIEŻA sesja (JWT z claimem tenant_id z hooka). */
async function createTenantMember(
  admin: SupabaseClient,
  label: string,
): Promise<{ client: SupabaseClient; tenantId: string }> {
  const email = `cat-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
    p_slug: `cat-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja katalogowa ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

describe.skipIf(!hasEnv)("katalog (RLS + constrainty 0007)", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };
  let productId: string;
  let locationId: string;

  beforeAll(async () => {
    admin = createAdminClient();
    tenantA = await createTenantMember(admin, "a");
    tenantB = await createTenantMember(admin, "b");
  }, 60_000);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  }, 60_000);

  it("członek tenanta A tworzy produkt, egzemplarz, próg i punkt odbioru", async () => {
    const { data: product, error: productError } = await tenantA.client
      .from("products")
      .insert({
        tenant_id: tenantA.tenantId,
        name: "Agregat testowy",
        base_price_day_grosze: 10_000,
        deposit_grosze: 50_000,
        auto_increment_multiplier: 1.0,
        buffer_before_days: 1,
        buffer_after_days: 1,
        active: true,
      })
      .select("id")
      .single();
    expect(productError, `insert products: ${productError?.message}`).toBeNull();
    productId = product!.id as string;

    const { error: unitError } = await tenantA.client.from("product_units").insert({
      tenant_id: tenantA.tenantId,
      product_id: productId,
      serial_number: "SN-001",
    });
    expect(unitError, `insert product_units: ${unitError?.message}`).toBeNull();

    const { error: tierError } = await tenantA.client.from("pricing_tiers").insert({
      tenant_id: tenantA.tenantId,
      product_id: productId,
      tier_days: 7,
      multiplier: 6.5,
    });
    expect(tierError, `insert pricing_tiers: ${tierError?.message}`).toBeNull();

    const { data: location, error: locationError } = await tenantA.client
      .from("pickup_locations")
      .insert({ tenant_id: tenantA.tenantId, name: "Magazyn A", address_city: "Poznań" })
      .select("id")
      .single();
    expect(locationError, `insert pickup_locations: ${locationError?.message}`).toBeNull();
    locationId = location!.id as string;
  });

  it("tenant B nie widzi katalogu A (SELECT pusty na każdej tabeli katalogu)", async () => {
    for (const table of ["products", "product_units", "pricing_tiers", "pickup_locations"]) {
      const { data, error } = await tenantB.client.from(table).select("id");
      expect(error, `${table}: ${error?.message}`).toBeNull();
      expect(data, `tenant B widzi wiersze ${table} tenanta A`).toEqual([]);
    }
  });

  it("tenant B nie zmieni produktu A: UPDATE dosięga zero wierszy, dane nietknięte", async () => {
    const { data, error } = await tenantB.client
      .from("products")
      .update({ name: "Przejęty", base_price_day_grosze: 1 })
      .eq("id", productId)
      .select("id");
    expect(error).toBeNull();
    expect(data, "UPDATE cudzego produktu dosięgnął wierszy").toEqual([]);

    const { data: after } = await admin
      .from("products")
      .select("name, base_price_day_grosze")
      .eq("id", productId)
      .single();
    expect(after).toMatchObject({ name: "Agregat testowy", base_price_day_grosze: 10_000 });
  });

  it("tenant B nie wstawi wiersza z tenant_id A (WITH CHECK) — produkt i punkt", async () => {
    const { error: productError } = await tenantB.client.from("products").insert({
      tenant_id: tenantA.tenantId,
      name: "Podrzucony",
      base_price_day_grosze: 100,
    });
    expect(productError?.code, "INSERT produktu z cudzym tenant_id przeszedł").toBe("42501");

    const { error: locationError } = await tenantB.client.from("pickup_locations").insert({
      tenant_id: tenantA.tenantId,
      name: "Podrzucony punkt",
    });
    expect(locationError?.code, "INSERT punktu z cudzym tenant_id przeszedł").toBe("42501");
  });

  it("tenant B nie wstawi progu wskazującego produkt A (klucz złożony = wiersz niereprezentowalny)", async () => {
    const { error } = await tenantB.client.from("pricing_tiers").insert({
      tenant_id: tenantB.tenantId,
      product_id: productId,
      tier_days: 3,
      multiplier: 1,
    });
    // 23503: para (tenant_id B, product_id A) nie istnieje w products —
    // bramka spójności, której RLS sam nie daje (patrz komentarz w 0007).
    expect(error?.code, "próg wskazujący cudzy produkt przeszedł").toBe("23503");
  });

  it("tenant B nie usunie punktu odbioru A", async () => {
    const { data, error } = await tenantB.client
      .from("pickup_locations")
      .delete()
      .eq("id", locationId)
      .select("id");
    expect(error).toBeNull();
    expect(data, "DELETE cudzego punktu dosięgnął wierszy").toEqual([]);

    const { data: still } = await admin
      .from("pickup_locations")
      .select("id")
      .eq("id", locationId);
    expect(still).toHaveLength(1);
  });

  it("CHECK okna serwisowego: samo „od” bez „do” odrzucone przez bazę (23514)", async () => {
    const { error } = await tenantA.client.from("product_units").insert({
      tenant_id: tenantA.tenantId,
      product_id: productId,
      unavailable_from: "2026-08-01",
    });
    expect(error?.code, "niepełne okno serwisowe przeszło CHECK").toBe("23514");
  });

  it("duplikat numeru seryjnego w obrębie produktu odrzucony (23505)", async () => {
    const { error } = await tenantA.client.from("product_units").insert({
      tenant_id: tenantA.tenantId,
      product_id: productId,
      serial_number: "SN-001",
    });
    expect(error?.code).toBe("23505");
  });

  it("zapis progów jak w panelu: upsert po tier_days + delete nieobecnych daje dokładnie nowy cennik", async () => {
    // Stan startowy: próg 7×6.5 (z pierwszego testu) + dorzucony 3×2.8.
    const { error: seedError } = await tenantA.client.from("pricing_tiers").insert({
      tenant_id: tenantA.tenantId,
      product_id: productId,
      tier_days: 3,
      multiplier: 2.8,
    });
    expect(seedError).toBeNull();

    // Nowy cennik: 7 dni po nowej cenie + nowy próg 14; próg 3 znika.
    const next = [
      { tier_days: 7, multiplier: 6.0, label: "tydzień", sort_order: 0 },
      { tier_days: 14, multiplier: 11.0, label: "dwa tygodnie", sort_order: 1 },
    ];
    const { error: upsertError } = await tenantA.client.from("pricing_tiers").upsert(
      next.map((tier) => ({ tenant_id: tenantA.tenantId, product_id: productId, ...tier })),
      { onConflict: "tenant_id,product_id,tier_days" },
    );
    expect(upsertError, `upsert: ${upsertError?.message}`).toBeNull();

    const { error: deleteError } = await tenantA.client
      .from("pricing_tiers")
      .delete()
      .eq("tenant_id", tenantA.tenantId)
      .eq("product_id", productId)
      .not("tier_days", "in", "(7,14)");
    expect(deleteError, `delete nieobecnych: ${deleteError?.message}`).toBeNull();

    const { data: tiers } = await tenantA.client
      .from("pricing_tiers")
      .select("tier_days, multiplier, label")
      .eq("product_id", productId)
      .order("tier_days");
    expect(tiers).toEqual([
      { tier_days: 7, multiplier: 6.0, label: "tydzień" },
      { tier_days: 14, multiplier: 11.0, label: "dwa tygodnie" },
    ]);
  });

  it("waluta tenanta: A zapisze 'currency' w tenant_settings, B jej nie widzi", async () => {
    const { error } = await tenantA.client.from("tenant_settings").insert({
      tenant_id: tenantA.tenantId,
      key: "currency",
      // Skalar JSON (string) — PostgREST rzutuje wartość JSON body na jsonb.
      value: "EUR",
    });
    expect(error, `insert tenant_settings: ${error?.message}`).toBeNull();

    const { data: mine } = await tenantA.client
      .from("tenant_settings")
      .select("value")
      .eq("key", "currency");
    expect(mine).toEqual([{ value: "EUR" }]);

    const { data: theirs } = await tenantB.client
      .from("tenant_settings")
      .select("value")
      .eq("key", "currency");
    expect(theirs).toEqual([]);
  });
});
