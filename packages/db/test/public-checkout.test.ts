/**
 * Testy publicznej ścieżki checkoutu storefrontu (Zadanie 2.4a, migracja
 * 0020_public_checkout.sql; ADR-042).
 *
 * To jest ścieżka PIENIĘDZY i IZOLACJI — dowody mutacyjne są obowiązkowe.
 * Test dowodzi czterech osi:
 *   1. WYŚCIG: dwa równoległe public_checkout o ostatni egzemplarz → dokładnie
 *      jeden sukces, drugi 23P01 (bramka 0010: advisory lock + re-check).
 *   2. KWOTY Z SERWERA: wejście NIE niesie kwot; utrwalone sumy = wynik silnika
 *      @avably/core (calculatePrice). Klient nie ma parametru ceny.
 *   3. IZOLACJA: checkout na tenancie nieaktywnym → 22023; get_public_catalog
 *      nie zwraca produktów cudzych/nieaktywnych ani credentiali; NULL dla
 *      tenanta nieaktywnego.
 *   4. DOSTĘPNOŚĆ: get_public_availability zwraca liczby (available/total) i
 *      NULL dla zakresu odwróconego / tenanta nieaktywnego.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_* — patrz
 * helpers/seed-tenants.ts. Bez nich plik jest pomijany (strażnik jawności).
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { calculatePrice } from "@avably/core";

import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
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

function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

const createdTenantIds: string[] = [];

async function seedTenant(admin: SupabaseClient, status: string): Promise<string> {
  const slug = `checkout-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: `Checkout test ${status}`, status, locale: "pl" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać tenanta (${status}): ${error?.message}`);
  createdTenantIds.push(data.id as string);
  return data.id as string;
}

async function seedProduct(
  admin: SupabaseClient,
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: `Produkt ${randomUUID().slice(0, 8)}`,
      base_price_day_grosze: 10_000,
      deposit_grosze: 5_000,
      buffer_before_days: 1,
      buffer_after_days: 1,
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać produktu: ${error?.message}`);
  return data.id as string;
}

async function seedPickupLocation(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data, error } = await admin
    .from("pickup_locations")
    .insert({ tenant_id: tenantId, name: "Magazyn", address_city: "Warszawa" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać punktu odbioru: ${error?.message}`);
  return data.id as string;
}

async function seedUnits(admin: SupabaseClient, tenantId: string, productId: string, count: number) {
  const rows = Array.from({ length: count }, () => ({
    tenant_id: tenantId,
    product_id: productId,
    serial_number: `SN-${randomUUID().slice(0, 8)}`,
  }));
  const { error } = await admin.from("product_units").insert(rows);
  if (error) throw new Error(`Nie udało się zasiać egzemplarzy: ${error.message}`);
}

/** Wywołanie RPC jako ANON (bramka grantu + realna ścieżka publiczna). */
async function checkoutAsAnon(anon: SupabaseClient, args: Record<string, unknown>) {
  return anon.schema("app").rpc("public_checkout", args);
}

describe.skipIf(!hasEnv)("app.public_checkout / get_public_catalog / get_public_availability — 0020", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
      createdTenantIds.length = 0;
    }
  });

  // -------------------------------------------------------------------
  // 1. WYŚCIG o ostatni egzemplarz
  // -------------------------------------------------------------------
  it("dwa równoległe checkouty o JEDEN egzemplarz → dokładnie jeden sukces, drugi 23P01", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId);
    const pickupId = await seedPickupLocation(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 1); // dokładnie jeden

    const call = (sql: postgres.Sql) => sql`
      select app.public_checkout(
        ${tenantId}, ${`race-${randomUUID().slice(0, 8)}@test.local`}, 'Kupujący', null,
        '2026-10-01', '2026-10-03', 'pickup', ${pickupId},
        ${sql.json([{ product_id: productId, quantity: 1 }])}, 'v1', 'pl'
      ) as j`;

    // Dwa NIEZALEŻNE połączenia = realna współbieżność na żywej bazie.
    const sqlA = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    const sqlB = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    try {
      const results = await Promise.allSettled([call(sqlA), call(sqlB)]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

      // DOWÓD MUTACYJNY: bramką wyścigu jest advisory lock + re-check w
      // app.assert_unit_available (0010). Gdy się ją WYŁĄCZY (np. `return` na
      // wejściu funkcji albo usunięcie re-checku), OBA checkouty przypisują ten
      // sam egzemplarz i OBA kończą się sukcesem — ten assert (ok === 1) staje
      // się czerwony (2 !== 1). Ścieżki mutacji NIC nie maskuje: advisory lock
      // numeracji (generate_order_number) serializuje INSERT zamówień, ale NIE
      // dotyka egzemplarzy — nawet w pełni zserializowany drugi checkout musi
      // odrzucić zajętą sztukę re-checkiem, więc to bramka egzemplarza, a nie
      // numeracja, decyduje (lekcja ADR-024 o maskowaniu przez cudzy lock).
      expect(ok, `oczekiwano dokładnie 1 sukcesu, było ${ok.length}`).toHaveLength(1);
      expect(failed, `oczekiwano dokładnie 1 odmowy, było ${failed.length}`).toHaveLength(1);
      expect(
        (failed[0]?.reason as { code?: string })?.code,
        "odmowa wyścigu musi nieść 23P01 (egzemplarz zajęty)",
      ).toBe("23P01");

      // Po wyścigu istnieje DOKŁADNIE jedno zamówienie na tym tenancie.
      const [{ count }] = await sqlA`select count(*)::int from public.orders where tenant_id = ${tenantId}`;
      expect(count, "wyścig zostawił inną liczbę zamówień niż 1").toBe(1);
    } finally {
      await sqlA.end({ timeout: 5 });
      await sqlB.end({ timeout: 5 });
    }
  });

  // -------------------------------------------------------------------
  // 2. KWOTY LICZY SERWER (klient nie zaniży ceny)
  // -------------------------------------------------------------------
  it("sumy zamówienia = wynik silnika @avably/core (wejście nie niesie kwot)", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId, {
      base_price_day_grosze: 12_000,
      deposit_grosze: 8_000,
      auto_increment_multiplier: 1.0,
    });
    await seedUnits(admin, tenantId, productId, 2);
    const pickupId = await seedPickupLocation(admin, tenantId);
    // Próg: 7 dni = 6.5× ceny dziennej (rabat) — musi zadziałać serwerowo.
    const { error: tierError } = await admin.from("pricing_tiers").insert({
      tenant_id: tenantId,
      product_id: productId,
      tier_days: 7,
      multiplier: 6.5,
      label: "tydzień",
    });
    if (tierError) throw new Error(tierError.message);

    // Najem 7-dniowy (INCLUSIVE): 2026-10-01..2026-10-07.
    const expected = calculatePrice("2026-10-01", "2026-10-07", {
      basePriceDayGrosze: 12_000,
      depositGrosze: 8_000,
      autoIncrementMultiplier: 1.0,
      tiers: [{ tierDays: 7, multiplier: 6.5 }],
    });

    const { data, error } = await checkoutAsAnon(anon, {
      p_tenant_id: tenantId,
      p_email: `price-${randomUUID().slice(0, 8)}@test.local`,
      p_full_name: "Kupujący",
      p_phone: null,
      p_start_date: "2026-10-01",
      p_end_date: "2026-10-07",
      p_delivery_method: "pickup",
      p_pickup_location_id: pickupId,
      p_items: [{ product_id: productId, quantity: 2 }],
      p_terms_version: "v1",
      p_locale: "pl",
    });
    expect(error, `checkout jako anon zawiódł: ${error?.message}`).toBeNull();

    const summary = data as {
      total_rental_grosze: number;
      total_deposit_grosze: number;
      order_number: string;
    };
    // Dwie sztuki po cenie progu; kaucja per sztuka.
    expect(summary.total_rental_grosze).toBe(expected.rentalGrosze * 2);
    expect(summary.total_deposit_grosze).toBe(expected.depositGrosze * 2);

    // DOWÓD MUTACYJNY (kwoty z serwera): funkcja NIE MA parametru kwoty — klient
    // nie ma jak jej podać. Gdyby wprowadzić parametr `p_total_rental` i wstawiać
    // go zamiast obliczenia, ten assert (== wynik silnika) rozjechałby się z
    // dowolną kwotą podaną przez klienta. Utrwalona suma czytana z bazy
    // potwierdza, że zapisano policzone serwerowo, nie przysłane.
    const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    try {
      const [row] = await sql`
        select total_rental_grosze, total_deposit_grosze
        from public.orders where tenant_id = ${tenantId} and order_number = ${summary.order_number}`;
      expect(row.total_rental_grosze).toBe(expected.rentalGrosze * 2);
      expect(row.total_deposit_grosze).toBe(expected.depositGrosze * 2);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  // -------------------------------------------------------------------
  // 3. IZOLACJA
  // -------------------------------------------------------------------
  it("checkout na tenancie NIEAKTYWNYM → 22023 (nieodróżnialny od nieistniejącego)", async () => {
    const suspended = await seedTenant(admin, "suspended");
    const productId = await seedProduct(admin, suspended);
    const pickupId = await seedPickupLocation(admin, suspended);
    await seedUnits(admin, suspended, productId, 1);

    // Wejście POZA TYM jest w pełni poprawne (punkt odbioru, egzemplarz,
    // regulamin) — jedyną przyczyną odmowy MA BYĆ status tenanta. Bez tego
    // (np. gdyby punkt był null) odmowę dałaby walidacja punktu i zamaskowała,
    // czy bramka statusu w ogóle działa.
    const { data, error } = await checkoutAsAnon(anon, {
      p_tenant_id: suspended,
      p_email: `susp-${randomUUID().slice(0, 8)}@test.local`,
      p_full_name: "Kupujący",
      p_phone: null,
      p_start_date: "2026-10-01",
      p_end_date: "2026-10-03",
      p_delivery_method: "pickup",
      p_pickup_location_id: pickupId,
      p_items: [{ product_id: productId, quantity: 1 }],
      p_terms_version: "v1",
      p_locale: "pl",
    });

    // DOWÓD MUTACYJNY: rozluźnienie bramki statusu w public_checkout
    // (dopuszczenie 'suspended') sprawi, że checkout przejdzie i `error` będzie
    // null — ten assert (kod 22023) się spali. Nieaktywny sklep nie może
    // przyjmować zamówień.
    expect(data).toBeNull();
    expect(error?.code).toBe("22023");
  });

  it("get_public_catalog: NULL dla nieaktywnego, tylko własne aktywne produkty, ZERO credentiali", async () => {
    const active = await seedTenant(admin, "active");
    const otherTenant = await seedTenant(admin, "active");
    await seedProduct(admin, active, { name: "WIDOCZNY" });
    await seedProduct(admin, active, { name: "UKRYTY_NIEAKTYWNY", active: false });
    await seedProduct(admin, otherTenant, { name: "CUDZY" });
    // Credentiale kurierskie — NIE MOGĄ wyciec do katalogu.
    const { error: credError } = await admin.from("tenant_settings").insert({
      tenant_id: active,
      key: "globkurier_credentials",
      value: { email: "sekret@x", password: "TOPSECRET_PASSWORD", environment: "test" },
    });
    if (credError) throw new Error(credError.message);

    const { data, error } = await anon.schema("app").rpc("get_public_catalog", { p_tenant_id: active });
    expect(error, `get_public_catalog jako anon zawiódł: ${error?.message}`).toBeNull();

    const catalog = data as { products: { id: string; name: string }[] };
    const names = catalog.products.map((p) => p.name);

    // DOWÓD MUTACYJNY (izolacja produktów): zdjęcie warunku `p.active` w funkcji
    // wpuści UKRYTY_NIEAKTYWNY; zmiana `p.tenant_id = t.id` wpuści CUDZY — oba
    // asserty poniżej się spalą.
    expect(names).toContain("WIDOCZNY");
    expect(names).not.toContain("UKRYTY_NIEAKTYWNY");
    expect(names).not.toContain("CUDZY");

    // DOWÓD MUTACYJNY (brak credentiali): gdyby funkcja zwracała surowe wiersze
    // tenant_settings zamiast tylko delivery_pricing, TOPSECRET_PASSWORD
    // pojawiłby się w JSON-ie i ten assert by się spalił.
    expect(JSON.stringify(catalog)).not.toContain("TOPSECRET_PASSWORD");

    // Tenant nieaktywny → NULL (bramka statusu).
    const suspended = await seedTenant(admin, "suspended");
    const { data: nullData } = await anon
      .schema("app")
      .rpc("get_public_catalog", { p_tenant_id: suspended });
    expect(nullData, "nieaktywny tenant zwrócił katalog zamiast NULL").toBeNull();
  });

  // -------------------------------------------------------------------
  // 4. DOSTĘPNOŚĆ (kształt: liczby, bez danych zamówień)
  // -------------------------------------------------------------------
  it("get_public_availability: {available,total}, spada po zamówieniu, NULL dla zakresu odwróconego", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId);
    const pickupId = await seedPickupLocation(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 3);

    const before = (
      await anon.schema("app").rpc("get_public_availability", {
        p_tenant_id: tenantId,
        p_product_id: productId,
        p_start_date: "2026-11-01",
        p_end_date: "2026-11-05",
      })
    ).data as { available_units: number; total_units: number };
    expect(before).toEqual({ available_units: 3, total_units: 3 });

    // Złóż zamówienie na 1 sztukę → dostępność spada do 2.
    await checkoutAsAnon(anon, {
      p_tenant_id: tenantId,
      p_email: `av-${randomUUID().slice(0, 8)}@test.local`,
      p_full_name: "Kupujący",
      p_phone: null,
      p_start_date: "2026-11-01",
      p_end_date: "2026-11-05",
      p_delivery_method: "pickup",
      p_pickup_location_id: pickupId,
      p_items: [{ product_id: productId, quantity: 1 }],
      p_terms_version: "v1",
      p_locale: "pl",
    });

    const after = (
      await anon.schema("app").rpc("get_public_availability", {
        p_tenant_id: tenantId,
        p_product_id: productId,
        p_start_date: "2026-11-01",
        p_end_date: "2026-11-05",
      })
    ).data as { available_units: number; total_units: number };
    // DOWÓD MUTACYJNY: usunięcie klauzuli `not exists (... blokujące statusy ...)`
    // sprawi, że available_units nie spadnie (zostanie 3) — assert się spali.
    expect(after).toEqual({ available_units: 2, total_units: 3 });

    // Zakres odwrócony → NULL (nie błąd, nie 0).
    const reversed = (
      await anon.schema("app").rpc("get_public_availability", {
        p_tenant_id: tenantId,
        p_product_id: productId,
        p_start_date: "2026-11-05",
        p_end_date: "2026-11-01",
      })
    ).data;
    expect(reversed).toBeNull();
  });
});
