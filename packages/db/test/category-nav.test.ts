/**
 * MENU KATEGORII NA ŻYWEJ BAZIE — app.get_public_category_nav (0109, ADR-266).
 *
 * ==================== CO TEN PLIK DOWODZI ====================
 *
 * Funkcja oddaje kategorie NIEPUSTE najemcy w JEGO kolejności (`position`)
 * z liczbą AKTYWNYCH pozycji per kategoria, a przy tym:
 *   1. GUARD pustych — kategoria bez aktywnej pozycji NIE wchodzi do wyniku
 *      (bez pozycji w ogóle ORAZ z samymi pozycjami wyłączonymi `active=false`);
 *   2. LICZNIK liczy pozycje aktywne, a produkt w wielu kategoriach liczy się
 *      w każdej z nich;
 *   3. IZOLACJA (warunek zamknięcia) — menu najemcy A nie niesie ani jednej
 *      kategorii najemcy B; kontrola pozytywna pilnuje, żeby „nic nie wyszło"
 *      nie udawało izolacji;
 *   4. NAJEMCA POZA OKNEM HANDLOWYM => [] (jak reszta publicznych odczytów).
 *
 * Odczyt idzie kluczem ANON (jak produkcyjny storefront), więc pilnuje przy
 * okazji grantu; kształt ACL osobno trzyma function-acls.test.ts.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

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

interface NavEntry {
  id: string;
  name: string;
  slug: string;
  count: number;
}

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

/** Znacznik przebiegu — lokalna baza bywa współdzielona z równoległymi sesjami. */
const BIEG = randomUUID().slice(0, 8);

describe.skipIf(!hasEnv)("menu kategorii — 0109 (ADR-266)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  async function seedTenant(label: string, status = "active"): Promise<string> {
    const slug = `knav-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Nav ${label}`, status, locale: "pl" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed tenanta: ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  async function seedCategory(
    tenantId: string,
    name: string,
    position: number,
  ): Promise<{ id: string; slug: string }> {
    const unique = randomUUID().slice(0, 8);
    const { data, error } = await admin
      .from("catalog_categories")
      .insert({ tenant_id: tenantId, name, slug: `nav-${unique}`, position })
      .select("id, slug")
      .single();
    if (error || !data) throw new Error(`seed kategorii: ${error?.message}`);
    return { id: data.id as string, slug: data.slug as string };
  }

  async function seedProduct(tenantId: string, name: string, active = true): Promise<string> {
    const { data, error } = await admin
      .from("products")
      .insert({ tenant_id: tenantId, name: `${name} ${BIEG}`, base_price_day_grosze: 10_000, active })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed pozycji: ${error?.message}`);
    return data.id as string;
  }

  async function assign(tenantId: string, categoryId: string, productId: string): Promise<void> {
    const { error } = await admin
      .from("product_categories")
      .insert({ tenant_id: tenantId, product_id: productId, category_id: categoryId });
    if (error) throw new Error(`przypisanie do kategorii: ${error.message}`);
  }

  async function readNav(tenantId: string): Promise<NavEntry[] | null> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_public_category_nav", { p_tenant_id: tenantId });
    if (error) throw new Error(`get_public_category_nav: ${error.message}`);
    return data as NavEntry[] | null;
  }

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Kolejność najemcy + licznik pozycji aktywnych
  // -------------------------------------------------------------------
  it("oddaje kategorie NIEPUSTE w kolejności position z liczbą pozycji", async () => {
    const tenant = await seedTenant("kolejnosc");
    // Kolejność WSTAWIANIA odwrotna do position — wynik musi porządkować sam.
    const kajaki = await seedCategory(tenant, "Kajaki", 5);
    const rowery = await seedCategory(tenant, "Rowery", 1);

    const r1 = await seedProduct(tenant, "Rower");
    const r2 = await seedProduct(tenant, "Rower");
    const k1 = await seedProduct(tenant, "Kajak");
    await assign(tenant, rowery.id, r1);
    await assign(tenant, rowery.id, r2);
    await assign(tenant, kajaki.id, k1);
    // Produkt w DWÓCH kategoriach — liczy się w każdej.
    await assign(tenant, kajaki.id, r1);

    const nav = await readNav(tenant);
    expect(nav, "menu nie wyszło z bazy").toBeTruthy();

    // Kolejność po position: Rowery (1) przed Kajaki (5).
    expect(nav!.map((e) => e.slug)).toEqual([rowery.slug, kajaki.slug]);
    const byId = new Map(nav!.map((e) => [e.id, e.count]));
    expect(byId.get(rowery.id), "licznik Rowery").toBe(2);
    // Kajaki: k1 + r1 (r1 należy do obu) = 2.
    expect(byId.get(kajaki.id), "licznik Kajaki liczy produkt z dwóch kategorii").toBe(2);
  });

  // -------------------------------------------------------------------
  // 2. Guard pustych — kategoria bez AKTYWNYCH pozycji nie wchodzi
  // -------------------------------------------------------------------
  it("GUARD: kategoria bez pozycji i z samymi wyłączonymi NIE wchodzi do menu", async () => {
    const tenant = await seedTenant("guard");
    const pelna = await seedCategory(tenant, "Pełna", 0);
    const bezPozycji = await seedCategory(tenant, "Bez pozycji", 1);
    const tylkoWylaczone = await seedCategory(tenant, "Tylko wyłączone", 2);

    const aktywny = await seedProduct(tenant, "Aktywny", true);
    await assign(tenant, pelna.id, aktywny);

    const wylaczony = await seedProduct(tenant, "Wyłączony", false);
    await assign(tenant, tylkoWylaczone.id, wylaczony);

    const nav = await readNav(tenant);
    const slugs = (nav ?? []).map((e) => e.slug);

    // KONTROLA POZYTYWNA: kategoria z aktywną pozycją MUSI być — inaczej „nie
    // zawiera pustych" przechodzi też, gdy nie wyszło NIC.
    expect(slugs, "kategoria z aktywną pozycją nie doszła").toContain(pelna.slug);
    expect(slugs, "kategoria bez pozycji weszła do menu").not.toContain(bezPozycji.slug);
    expect(slugs, "kategoria z samymi wyłączonymi pozycjami weszła do menu").not.toContain(
      tylkoWylaczone.slug,
    );
  });

  // -------------------------------------------------------------------
  // 3. Izolacja między najemcami (warunek zamknięcia)
  // -------------------------------------------------------------------
  it("menu najemcy A nie niesie ani jednej kategorii najemcy B", async () => {
    const najemcaA = await seedTenant("iza");
    const najemcaB = await seedTenant("izb");
    const catA = await seedCategory(najemcaA, "Kategoria A", 0);
    const catB = await seedCategory(najemcaB, "Kategoria B", 0);
    await assign(najemcaA, catA.id, await seedProduct(najemcaA, "Alfa"));
    await assign(najemcaB, catB.id, await seedProduct(najemcaB, "Beta"));

    const navA = await readNav(najemcaA);
    const slugsA = (navA ?? []).map((e) => e.slug);
    const idsA = (navA ?? []).map((e) => e.id);

    // Kontrola pozytywna + izolacja w JEDNYM przypadku.
    expect(slugsA, "menu A nie dostało własnej kategorii").toContain(catA.slug);
    expect(slugsA, "WYCIEK: menu A niesie kategorię B").not.toContain(catB.slug);
    expect(idsA, "WYCIEK: menu A niesie identyfikator kategorii B").not.toContain(catB.id);
    expect(
      JSON.stringify(navA),
      "identyfikator najemcy B w kopercie menu A",
    ).not.toContain(najemcaB);
  });

  // -------------------------------------------------------------------
  // 4. Najemca poza oknem handlowym => []
  // -------------------------------------------------------------------
  it("najemca poza oknem handlowym oddaje puste menu", async () => {
    const uspiony = await seedTenant("suspended", "suspended");
    const cat = await seedCategory(uspiony, "Sprzęt", 0);
    await assign(uspiony, cat.id, await seedProduct(uspiony, "Gamma"));

    const nav = await readNav(uspiony);
    expect(nav, "najemca poza oknem handlowym dostał niepuste menu").toEqual([]);
  });
});
