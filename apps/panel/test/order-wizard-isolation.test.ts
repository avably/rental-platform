/**
 * SONDA IZOLACJI KREATORA ZAMÓWIENIA (U7, ADR-147) na żywym, lokalnym Supabase.
 *
 * Pytanie brzmi: co ten ekran UDOSTĘPNIA po U7, czego wcześniej nie
 * udostępniał? Odpowiedź: nic nowego z bazy — ale OGŁASZA KWOTĘ, więc czyta
 * cenniki, progi cenowe, kalendarz zajętości i punkty odbioru i pokazuje wynik
 * operatorowi. Podgląd kwoty jest kanałem, przez który cudza cena albo cudza
 * nazwa mogłaby wyjść na ekran. Ta sonda dowodzi, że nie może.
 *
 * ================== DLACZEGO KLIENT SERVICE-ROLE ==================
 *
 * Sonda uruchamiana klientem z sesją tenanta B dowodzi tylko tego, że działa
 * RLS — i byłaby ZIELONA również wtedy, gdyby zapytanie ekranu straciło
 * zawężenie po tenancie. Dlatego GŁÓWNA sonda woła `fetchOrderWizardData`
 * klientem SERVICE-ROLE, który RLS omija: wtedy jedyną rzeczą, która trzyma
 * wynik przy jednym najemcy, jest samo zapytanie. Zdjęcie `.eq("tenant_id",
 * …)` z któregokolwiek odczytu w `nowe/wizard-query.ts` zapala te testy
 * z imienia (wzorzec catalog-list-isolation.test.ts, ADR-145).
 *
 * Druga sonda (klientem z sesją B, z PODSTAWIONYM tenant_id tenanta A)
 * pokazuje, że RLS trzyma niezależnie od tego, co panel poda jako tenant.
 *
 * Trzecia sprawdza WYCENĘ: podgląd liczy `priceOrderItems` na mapie cenników
 * WCZYTANEJ dla najemcy, więc cudzy identyfikator produktu nie daje ani
 * kwoty, ani nazwy — dostaje głośny błąd, nie pozycję za zero.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { priceOrderItems, type ProductPricingRow } from "@/app/[locale]/(panel)/zamowienia/pricing";
import { fetchOrderWizardData } from "@/app/[locale]/(panel)/zamowienia/nowe/wizard-query";

import { rpcCreateTenant } from "./helpers/create-tenant";
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

const TEST_PASSWORD = "OrderWizard!12345678";
const TODAY = "2026-08-12";

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

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

async function createTenantMember(
  admin: SupabaseClient,
  label: string,
): Promise<{ client: SupabaseClient; tenantId: string }> {
  const email = `wizard-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
    p_slug: `wizard-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja kreatora ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

interface Seed {
  productId: string;
  productName: string;
  basePriceDayGrosze: number;
  depositGrosze: number;
  tierMultiplier: number;
  locationName: string;
  customerEmail: string;
  courierPriceGrosze: number;
}

/** Komplet, na którym stoi podgląd kwoty: cennik, próg, egzemplarz, punkt, klient. */
async function seedTenant(admin: SupabaseClient, tenantId: string, seed: Seed): Promise<void> {
  const { error: productError } = await admin.from("products").insert({
    id: seed.productId,
    tenant_id: tenantId,
    name: seed.productName,
    base_price_day_grosze: seed.basePriceDayGrosze,
    deposit_grosze: seed.depositGrosze,
    auto_increment_multiplier: 1.0,
    active: true,
  });
  if (productError) throw new Error(`insert products: ${productError.message}`);

  const { error: tierError } = await admin.from("pricing_tiers").insert({
    tenant_id: tenantId,
    product_id: seed.productId,
    tier_days: 3,
    multiplier: seed.tierMultiplier,
    sort_order: 0,
  });
  if (tierError) throw new Error(`insert pricing_tiers: ${tierError.message}`);

  const { error: unitError } = await admin
    .from("product_units")
    .insert({ tenant_id: tenantId, product_id: seed.productId, serial_number: `${seed.productName}-1` });
  if (unitError) throw new Error(`insert product_units: ${unitError.message}`);

  const { error: locationError } = await admin
    .from("pickup_locations")
    .insert({ tenant_id: tenantId, name: seed.locationName, active: true });
  if (locationError) throw new Error(`insert pickup_locations: ${locationError.message}`);

  const { error: customerError } = await admin
    .from("customers")
    .insert({ tenant_id: tenantId, email: seed.customerEmail, full_name: "Klient sondy" });
  if (customerError) throw new Error(`insert customers: ${customerError.message}`);

  const { error: settingError } = await admin.from("tenant_settings").insert({
    tenant_id: tenantId,
    key: "delivery_pricing",
    value: { courier: { price_grosze: seed.courierPriceGrosze } },
  });
  if (settingError) throw new Error(`insert tenant_settings: ${settingError.message}`);
}

const SEED_A: Seed = {
  productId: randomUUID(),
  productName: "Nagrzewnica najemcy A",
  basePriceDayGrosze: 10_000,
  depositGrosze: 5_000,
  tierMultiplier: 2.8,
  locationName: "Magazyn najemcy A",
  customerEmail: `klient-a-${randomUUID()}@test.local`,
  courierPriceGrosze: 2_500,
};

const SEED_B: Seed = {
  productId: randomUUID(),
  productName: "Agregat najemcy B",
  basePriceDayGrosze: 77_700,
  depositGrosze: 88_800,
  tierMultiplier: 9.1,
  locationName: "Magazyn najemcy B",
  customerEmail: `klient-b-${randomUUID()}@test.local`,
  courierPriceGrosze: 9_900,
};

describe.skipIf(!hasEnv)("kreator zamówienia — izolacja najemców (U7)", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };

  beforeAll(async () => {
    admin = createAdminClient();
    tenantA = await createTenantMember(admin, "a");
    tenantB = await createTenantMember(admin, "b");
    await seedTenant(admin, tenantA.tenantId, SEED_A);
    await seedTenant(admin, tenantB.tenantId, SEED_B);
  }, 120_000);

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

  it("kontrola pozytywna: dane obu najemców NAPRAWDĘ istnieją", async () => {
    // Bez tego dowody niżej byłyby dowodami po pustym zbiorze: „nie widzę
    // cudzej ceny" jest prawdą również wtedy, gdy cudzej ceny nie ma.
    const { data: products } = await admin
      .from("products")
      .select("id, name")
      .in("id", [SEED_A.productId, SEED_B.productId]);
    expect(products).toHaveLength(2);

    const { data: tiers } = await admin
      .from("pricing_tiers")
      .select("product_id")
      .in("product_id", [SEED_A.productId, SEED_B.productId]);
    expect(tiers).toHaveLength(2);
  });

  it("odczyt kreatora jest zawężony do najemcy SAMYM ZAPYTANIEM (klient bez RLS)", async () => {
    const data = await fetchOrderWizardData(admin, tenantA.tenantId, TODAY);

    // Kontrola pozytywna: własny komplet JEST — inaczej asercje „nie ma
    // cudzego" byłyby prawdą o pustym wyniku.
    expect(data.products.map((product) => product.pricing.id)).toEqual([SEED_A.productId]);
    expect(data.products[0]!.name).toBe(SEED_A.productName);
    expect(data.locations.map((location) => location.name)).toEqual([SEED_A.locationName]);
    expect(data.customers.map((customer) => customer.email)).toEqual([SEED_A.customerEmail]);
    expect(data.deliveryPricing?.courier?.priceGrosze).toBe(SEED_A.courierPriceGrosze);

    // …a najemcy B nie ma NIGDZIE w wyniku: ani produktu, ani nazwy, ani
    // ceny, ani progu, ani punktu odbioru, ani cennika dostaw. Ta asercja
    // pali po zdjęciu `.eq("tenant_id", …)` z wizard-query.ts.
    const serialized = JSON.stringify(data);
    for (const leak of [
      SEED_B.productId,
      SEED_B.productName,
      SEED_B.locationName,
      SEED_B.customerEmail,
      tenantB.tenantId,
      String(SEED_B.basePriceDayGrosze),
      String(SEED_B.depositGrosze),
      String(SEED_B.tierMultiplier),
      String(SEED_B.courierPriceGrosze),
    ]) {
      expect(serialized, `wynik kreatora najemcy A niesie „${leak}"`).not.toContain(leak);
    }
  });

  it("cennik dostaw jednego najemcy nie wchodzi do podglądu drugiego", async () => {
    const dataB = await fetchOrderWizardData(admin, tenantB.tenantId, TODAY);
    expect(dataB.deliveryPricing?.courier?.priceGrosze).toBe(SEED_B.courierPriceGrosze);
    expect(dataB.deliveryPricing?.courier?.priceGrosze).not.toBe(SEED_A.courierPriceGrosze);
  });

  it("cudzy identyfikator produktu nie daje ceny — wycena rzuca, nie zgaduje", async () => {
    const data = await fetchOrderWizardData(admin, tenantA.tenantId, TODAY);
    const pricingById = new Map<string, ProductPricingRow>(
      data.products.map((product) => [product.pricing.id, product.pricing]),
    );

    // Kontrola pozytywna: własny produkt wycenia się (próg 3 dni × 2.8).
    const own = priceOrderItems([SEED_A.productId], pricingById, "2026-09-01", "2026-09-03");
    expect(own.totalRentalGrosze).toBe(Math.round(SEED_A.basePriceDayGrosze * SEED_A.tierMultiplier));

    // Cudzy — głośny błąd zamiast pozycji za zero. Komunikat niesie wyłącznie
    // identyfikator podany przez wołającego: żadnej nazwy i żadnej kwoty
    // z cennika drugiego najemcy.
    let message = "";
    expect(() => {
      try {
        priceOrderItems([SEED_B.productId], pricingById, "2026-09-01", "2026-09-03");
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
        throw err;
      }
    }).toThrow();
    expect(message).not.toContain(SEED_B.productName);
    expect(message).not.toContain(String(SEED_B.basePriceDayGrosze));
    expect(message).not.toContain(String(SEED_B.depositGrosze));
  });

  it("cudza sesja nie dostaje danych kreatora — nawet z podstawionym tenant_id", async () => {
    // Panel poda tu tenant_id z claimu, ale sonda podstawia CUDZY: RLS jest
    // bramką ostateczną i musi trzymać niezależnie od argumentu.
    const forged = await fetchOrderWizardData(tenantB.client, tenantA.tenantId, TODAY);
    expect(forged.products).toEqual([]);
    expect(forged.locations).toEqual([]);
    expect(forged.customers).toEqual([]);
    expect(forged.deliveryPricing).toBeNull();

    // Ta sama sesja z WŁASNYM tenantem widzi swój komplet — dowód, że pustka
    // wyżej to odmowa, a nie zepsuty klient.
    const own = await fetchOrderWizardData(tenantB.client, tenantB.tenantId, TODAY);
    expect(own.products.map((product) => product.pricing.id)).toEqual([SEED_B.productId]);
  });
});
