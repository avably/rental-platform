/**
 * app.import_catalog (C3, migracja 0055; ADR-112) na ŻYWYM lokalnym Supabase.
 *
 * PRZEDMIOTEM TESTU JEST BAZA: atomowy zapis katalogu z pliku idzie JEDNĄ
 * funkcją SQL (wzorzec app.create_order — SECURITY INVOKER, tenant z claimu,
 * RLS obowiązuje wewnątrz, jedna transakcja). Połowicznie wgrany cennik jest
 * gorszy niż odrzucony plik, więc każda odmowa wycofuje CAŁOŚĆ.
 *
 * Osie:
 *   1. KONTRAKT — nowy produkt (product_id null), aktualizacja istniejącego,
 *      progi ZASTĄPIONE kompletem z pliku (pusta lista = progi usunięte),
 *      produkty nieobecne w pliku NIETKNIĘTE; zwrotka {created,updated,tiers}.
 *   2. IZOLACJA — product_id należący do tenanta B w wywołaniu ownera A:
 *      odmowa i ZERO zapisu u OBU (stan katalogu A i B porównany przed/po).
 *      Dowód mutacyjny: zdjęcie filtra `tenant_id = v_tenant` przy SELECT
 *      istnienia produktu pali dokładnie ten test.
 *   3. ATOMOWOŚĆ — partia z jednym złym wierszem (cudzy id / CHECK bazy)
 *      nie zapisuje NIC, także poprawnych produktów sprzed błędu.
 *   4. ANON — odmowa 42501 (REVOKE na funkcji), zero pracy.
 *   5. SERVICE-ROLE — brak grantu + brak claimu tenant_id = fail-closed:
 *      funkcja nie daje się użyć do zapisu poza własnym najemcą.
 *   6. WALIDACJA — nie-tablica / pusta tablica / ponad limit → 22023;
 *      naruszenie CHECK schematu (cena 0) wycofuje całość.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const anonClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

/** Wiersz produktu w kształcie p_rows (grupa po stronie parsera panelu). */
function productRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product_id: null,
    name: `Produkt ${randomUUID().slice(0, 8)}`,
    description: null,
    base_price_day_grosze: 10_000,
    deposit_grosze: 0,
    auto_increment_multiplier: "1.0",
    buffer_before_days: 1,
    buffer_after_days: 1,
    active: true,
    tiers: [],
    ...overrides,
  };
}

async function importCatalog(
  client: SupabaseClient,
  rows: unknown,
): Promise<{ data: unknown; error: { code?: string; message: string } | null }> {
  const { data, error } = await client.schema("app").rpc("import_catalog", { p_rows: rows });
  return { data, error: error ?? null };
}

interface CatalogSnapshot {
  products: Record<string, unknown>[];
  tiers: Record<string, unknown>[];
}

/** Pełny stan katalogu tenanta (admin, poza RLS) — do porównań przed/po. */
async function snapshotCatalog(admin: SupabaseClient, tenantId: string): Promise<CatalogSnapshot> {
  const { data: products, error: pErr } = await admin
    .from("products")
    .select("id, name, description, base_price_day_grosze, deposit_grosze, active")
    .eq("tenant_id", tenantId)
    .order("id");
  if (pErr) throw new Error(`snapshot products: ${pErr.message}`);
  const { data: tiers, error: tErr } = await admin
    .from("pricing_tiers")
    .select("product_id, tier_days, multiplier, label, sort_order")
    .eq("tenant_id", tenantId)
    .order("product_id")
    .order("tier_days");
  if (tErr) throw new Error(`snapshot tiers: ${tErr.message}`);
  return { products: products ?? [], tiers: tiers ?? [] };
}

async function seedProduct(
  admin: SupabaseClient,
  tenantId: string,
  name: string,
  tiers: { tier_days: number; multiplier: number; label?: string; sort_order?: number }[] = [],
): Promise<string> {
  const { data, error } = await admin
    .from("products")
    .insert({ tenant_id: tenantId, name, base_price_day_grosze: 5_000, deposit_grosze: 1_000 })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedProduct(${name}): ${error?.message}`);
  if (tiers.length > 0) {
    const { error: tierError } = await admin
      .from("pricing_tiers")
      .insert(tiers.map((tier) => ({ tenant_id: tenantId, product_id: data.id, ...tier })));
    if (tierError) throw new Error(`seedTiers(${name}): ${tierError.message}`);
  }
  return data.id as string;
}

describe.skipIf(!hasEnv)("app.import_catalog (C3, migracja 0055)", () => {
  let admin: SupabaseClient;
  let a: TenantCtx;
  let b: TenantCtx;

  beforeAll(async () => {
    admin = createAdminClient();
    ({ a, b } = await seedTwoTenants());
  }, 120_000);

  afterAll(async () => {
    await cleanupSeeded(admin);
  }, 60_000);

  it("kontrakt: tworzy nowy produkt, aktualizuje istniejący, ZASTĘPUJE progi kompletem z pliku, nie tyka produktów spoza pliku", async () => {
    const updatedId = await seedProduct(admin, a.tenantId, "Do aktualizacji", [
      { tier_days: 3, multiplier: 2.5, sort_order: 0 },
      { tier_days: 14, multiplier: 11, label: "Dwa tygodnie", sort_order: 1 },
    ]);
    const untouchedId = await seedProduct(admin, a.tenantId, "Poza plikiem", [
      { tier_days: 5, multiplier: 4, sort_order: 0 },
    ]);

    const { data, error } = await importCatalog(a.ownerClient, [
      productRow({
        product_id: updatedId,
        name: "Po aktualizacji",
        description: "Nowy opis",
        base_price_day_grosze: 12_000,
        deposit_grosze: 3_000,
        auto_increment_multiplier: "1.2",
        active: false,
        tiers: [
          { tier_days: 7, multiplier: "6.5", label: "Tydzień", sort_order: 1 },
          { tier_days: 3, multiplier: "2.8", label: null, sort_order: 0 },
        ],
      }),
      productRow({
        name: "Nowy z importu",
        tiers: [{ tier_days: 2, multiplier: "1.9", label: null, sort_order: 0 }],
      }),
    ]);

    expect(error).toBeNull();
    expect(data).toEqual({ created: 1, updated: 1, tiers: 3 });

    // Produkt zaktualizowany co do WSZYSTKICH pól.
    const { data: updated } = await admin
      .from("products")
      .select(
        "name, description, base_price_day_grosze, deposit_grosze, auto_increment_multiplier, active",
      )
      .eq("id", updatedId)
      .single();
    expect(updated).toEqual({
      name: "Po aktualizacji",
      description: "Nowy opis",
      base_price_day_grosze: 12_000,
      deposit_grosze: 3_000,
      auto_increment_multiplier: 1.2,
      active: false,
    });

    // Progi ZASTĄPIONE kompletem z pliku (stare 3/14 zniknęły, są 3/7 z pliku).
    const { data: tiers } = await admin
      .from("pricing_tiers")
      .select("tier_days, multiplier, label, sort_order")
      .eq("product_id", updatedId)
      .order("tier_days");
    expect(tiers).toEqual([
      { tier_days: 3, multiplier: 2.8, label: null, sort_order: 0 },
      { tier_days: 7, multiplier: 6.5, label: "Tydzień", sort_order: 1 },
    ]);

    // Produkt spoza pliku NIETKNIĘTY (import to aktualizacja, nie lustro).
    const { data: untouched } = await admin
      .from("products")
      .select("name, base_price_day_grosze")
      .eq("id", untouchedId)
      .single();
    expect(untouched).toEqual({ name: "Poza plikiem", base_price_day_grosze: 5_000 });
    const { data: untouchedTiers } = await admin
      .from("pricing_tiers")
      .select("tier_days")
      .eq("product_id", untouchedId);
    expect(untouchedTiers).toEqual([{ tier_days: 5 }]);

    // Nowy produkt istnieje u najemcy A z progiem z pliku.
    const { data: created } = await admin
      .from("products")
      .select("id, tenant_id")
      .eq("tenant_id", a.tenantId)
      .eq("name", "Nowy z importu");
    expect(created).toHaveLength(1);
  });

  it("produkt z pustą listą progów = progi USUNIĘTE", async () => {
    const productId = await seedProduct(admin, a.tenantId, "Z progami do zdjęcia", [
      { tier_days: 3, multiplier: 2.5, sort_order: 0 },
    ]);
    const { error } = await importCatalog(a.ownerClient, [
      productRow({ product_id: productId, name: "Z progami do zdjęcia", tiers: [] }),
    ]);
    expect(error).toBeNull();
    const { data: tiers } = await admin
      .from("pricing_tiers")
      .select("tier_days")
      .eq("product_id", productId);
    expect(tiers).toEqual([]);
  });

  it("IZOLACJA: product_id tenanta B w wywołaniu ownera A → odmowa i ZERO zapisu u OBU (nigdy produkt „na cudzym id')", async () => {
    const productB = await seedProduct(admin, b.tenantId, "Katalog B — nie dotykać", [
      { tier_days: 7, multiplier: 6, sort_order: 0 },
    ]);
    const beforeA = await snapshotCatalog(admin, a.tenantId);
    const beforeB = await snapshotCatalog(admin, b.tenantId);

    const { error } = await importCatalog(a.ownerClient, [
      productRow({ product_id: productB, name: "Przejęty?" }),
    ]);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("22023");

    // Stan OBU katalogów bajt w bajt jak przed próbą.
    expect(await snapshotCatalog(admin, a.tenantId)).toEqual(beforeA);
    expect(await snapshotCatalog(admin, b.tenantId)).toEqual(beforeB);
  });

  it("nieistniejący product_id → odmowa 22023, zero zapisu", async () => {
    const before = await snapshotCatalog(admin, a.tenantId);
    const { error } = await importCatalog(a.ownerClient, [
      productRow({ product_id: randomUUID(), name: "Duch" }),
    ]);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("22023");
    expect(await snapshotCatalog(admin, a.tenantId)).toEqual(before);
  });

  it("ATOMOWOŚĆ: partia z jednym złym wierszem nie zapisuje NIC — także poprawnych produktów sprzed błędu", async () => {
    const before = await snapshotCatalog(admin, a.tenantId);
    const { error } = await importCatalog(a.ownerClient, [
      productRow({ name: "Poprawny pierwszy" }),
      productRow({ product_id: randomUUID(), name: "Zły drugi" }),
    ]);
    expect(error).not.toBeNull();
    expect(await snapshotCatalog(admin, a.tenantId)).toEqual(before);
    const { data: leaked } = await admin
      .from("products")
      .select("id")
      .eq("tenant_id", a.tenantId)
      .eq("name", "Poprawny pierwszy");
    expect(leaked).toEqual([]);
  });

  it("ATOMOWOŚĆ: naruszenie CHECK schematu (cena 0) w drugim wierszu wycofuje pierwszy", async () => {
    const before = await snapshotCatalog(admin, a.tenantId);
    const { error } = await importCatalog(a.ownerClient, [
      productRow({ name: "Poprawny przed CHECK" }),
      productRow({ name: "Cena zero", base_price_day_grosze: 0 }),
    ]);
    expect(error).not.toBeNull();
    expect(await snapshotCatalog(admin, a.tenantId)).toEqual(before);
  });

  it("ANON: odmowa 42501 z REVOKE — funkcja nie rusza przed jakąkolwiek pracą", async () => {
    const { error } = await importCatalog(anonClient(), [productRow()]);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  it("SERVICE-ROLE: brak grantu + brak claimu = fail-closed, zero zapisu poza własnym najemcą", async () => {
    const beforeA = await snapshotCatalog(admin, a.tenantId);
    const { error } = await importCatalog(admin, [
      productRow({ name: "Zrzut service-role" }),
    ]);
    expect(error).not.toBeNull();
    expect(await snapshotCatalog(admin, a.tenantId)).toEqual(beforeA);
    // Produkt nie powstał u NIKOGO (żaden tenant nie dostał tego wiersza).
    const { data: anywhere } = await admin
      .from("products")
      .select("id")
      .eq("name", "Zrzut service-role");
    expect(anywhere).toEqual([]);
  });

  it("WALIDACJA: nie-tablica i pusta tablica → 22023", async () => {
    for (const bad of [{ nie: "tablica" }, []]) {
      const { error } = await importCatalog(a.ownerClient, bad);
      expect(error).not.toBeNull();
      expect(error!.code).toBe("22023");
    }
  });

  it("WALIDACJA: ponad limit produktów → 22023 z komunikatem o limicie, zero zapisu", async () => {
    const rows = Array.from({ length: 10_001 }, (_, i) =>
      productRow({ name: `Hurt ${i}` }),
    );
    const before = await snapshotCatalog(admin, a.tenantId);
    const { error } = await importCatalog(a.ownerClient, rows);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("22023");
    expect(error!.message).toMatch(/limit/i);
    expect(await snapshotCatalog(admin, a.tenantId)).toEqual(before);
  }, 60_000);
});
