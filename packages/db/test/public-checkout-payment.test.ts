/**
 * Checkout z wyborem metody płatności (Z3, migracja 0029; ADR-066) na ŻYWYM,
 * lokalnym Supabase — realny anon, realne granty, realne bramki triggerów.
 *
 * PRZEDMIOTEM TESTU JEST BAZA, więc atrapa niczego by tu nie dowiodła:
 * odpowiadałaby „ok" niezależnie od tego, czy bramka istnieje.
 *
 * Pięć osi, każda z osobnym powodem:
 *   1. OBA TORY DZIAŁAJĄ — przelew zapisuje obieg `manual`, online `stripe`;
 *      żaden z nich nie ustawia `paid` (jedynym writerem `paid` jest webhook
 *      z Z4, którego jeszcze nie ma — i to jest stan docelowy, nie brak);
 *   2. NAJEMCA BEZ KONTA nie może założyć zamówienia online — inaczej
 *      wpadłoby w reżim ścisły bez drogi wyjścia;
 *   3. IDENTYFIKATOR PŁATNOŚCI JEST NIEZMIENNY — przepisanie go przypisałoby
 *      zamówieniu cudzą, opłaconą płatność, a webhook z Z4 posłusznie
 *      oznaczyłby je jako opłacone;
 *   4. TOKEN BRAMKUJE — bez uchwytu checkoutu nie da się ani związać
 *      płatności, ani odczytać stanu zamówienia (dane publiczne nie
 *      wystarczają: tenant_id jest jawny, a numery zamówień sekwencyjne);
 *   5. `unpaid → paid` W REŻIMIE STRIPE JEST ODMAWIANE PRZEZ BAZĘ — bramka
 *      stoi w bazie, nie w handlerze, bo UPDATE na orders ma każdy członek
 *      tenanta (RLS 0007).
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import { publishLegalDocuments } from "./helpers/publish-legal-documents";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/** 22023 = invalid_parameter_value — odmowa walidacyjna funkcji. */
const PG_INVALID_PARAMETER = "22023";
/** 23514 = check_violation — odmowa z CHECK-a albo z bramki triggera. */
const PG_CHECK_VIOLATION = "23514";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const adminClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

const anonClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

const createdTenantIds: string[] = [];

interface Shop {
  tenantId: string;
  productId: string;
  pickupId: string;
}

async function seedShop(admin: SupabaseClient, withAccount: boolean): Promise<Shop> {
  const slug = `z3-${randomUUID().slice(0, 12)}`;
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({ slug, name: "Sklep Z3", status: "active", locale: "pl" })
    .select("id")
    .single();
  if (tenantError || !tenant) throw new Error(`Tenant: ${tenantError?.message}`);
  const tenantId = tenant.id as string;
  createdTenantIds.push(tenantId);
  // Komplet dokumentów prawnych (0086/ADR-191) — bez nich checkout odmawia.
  await publishLegalDocuments(admin, tenantId);

  const { data: product, error: productError } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: `Produkt ${randomUUID().slice(0, 8)}`,
      base_price_day_grosze: 10_000,
      deposit_grosze: 5_000,
    })
    .select("id")
    .single();
  if (productError || !product) throw new Error(`Produkt: ${productError?.message}`);

  const { data: pickup, error: pickupError } = await admin
    .from("pickup_locations")
    .insert({ tenant_id: tenantId, name: "Magazyn", address_city: "Warszawa" })
    .select("id")
    .single();
  if (pickupError || !pickup) throw new Error(`Punkt odbioru: ${pickupError?.message}`);

  const { error: unitsError } = await admin.from("product_units").insert(
    Array.from({ length: 4 }, () => ({
      tenant_id: tenantId,
      product_id: product.id as string,
      serial_number: `SN-${randomUUID().slice(0, 8)}`,
    })),
  );
  if (unitsError) throw new Error(`Egzemplarze: ${unitsError.message}`);

  if (withAccount) {
    const { error } = await admin.from("payment_accounts").insert({
      tenant_id: tenantId,
      // Konto u dostawcy — samo jego ISTNIENIE, nie gotowość. Gotowość
      // (charges_enabled) stwierdza wyłącznie odczyt u dostawcy po stronie
      // serwera storefrontu; baza celowo o nią nie pyta (ADR-049).
      provider_account_id: `acct_${randomUUID().slice(0, 12)}`,
    });
    if (error) throw new Error(`Konto płatności: ${error.message}`);
  }

  return { tenantId, productId: product.id as string, pickupId: pickup.id as string };
}

function checkoutArgs(shop: Shop, paymentMethod: string, overrides: Record<string, unknown> = {}) {
  return {
    p_tenant_id: shop.tenantId,
    p_email: `z3-${randomUUID().slice(0, 8)}@test.local`,
    p_full_name: "Kupujący",
    p_phone: null,
    p_start_date: "2026-11-01",
    p_end_date: "2026-11-03",
    p_delivery_method: "pickup",
    p_pickup_location_id: shop.pickupId,
    p_items: [{ product_id: shop.productId, quantity: 1 }],
    p_terms_version: "v1",
    p_locale: "pl",
    p_payment_method: paymentMethod,
    ...overrides,
  };
}

interface CheckoutResponse {
  order_id: string;
  order_number: string;
  payment_status: string;
  payment_method: string;
  payment_provider: string;
  log_token: string;
}

async function checkout(
  anon: SupabaseClient,
  shop: Shop,
  paymentMethod: string,
  overrides: Record<string, unknown> = {},
) {
  return anon.schema("app").rpc("public_checkout", checkoutArgs(shop, paymentMethod, overrides));
}

describe.skipIf(!hasEnv)("app.public_checkout + płatność online — 0029", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
  });

  // -------------------------------------------------------------------
  // 1. Oba tory
  // -------------------------------------------------------------------

  it("przelew: zamówienie w obiegu manual, nieopłacone, bez płatności u dostawcy", async () => {
    const shop = await seedShop(admin, false);

    const { data, error } = await checkout(anon, shop, "transfer");
    expect(error).toBeNull();

    const result = data as CheckoutResponse;
    expect(result.payment_method).toBe("transfer");
    expect(result.payment_provider).toBe("manual");
    expect(result.payment_status).toBe("unpaid");

    const { data: row } = await admin
      .from("orders")
      .select("payment_method, payment_provider, payment_status, provider_payment_intent_id, application_fee_grosze")
      .eq("id", result.order_id)
      .single();
    expect(row).toMatchObject({
      payment_method: "transfer",
      payment_provider: "manual",
      payment_status: "unpaid",
      provider_payment_intent_id: null,
      // Kolumna istnieje od dziś, choć wartość jest zerem — dopisanie jej
      // w fazie 4 nie odtworzyłoby prowizji sprzed dopisania.
      application_fee_grosze: 0,
    });
  });

  it("płatność przy odbiorze też jest obiegiem offline", async () => {
    const shop = await seedShop(admin, false);
    const { data, error } = await checkout(anon, shop, "cod");
    expect(error).toBeNull();
    expect(data as CheckoutResponse).toMatchObject({
      payment_method: "cod",
      payment_provider: "manual",
    });
  });

  it("SKLEP Z DZIAŁAJĄCĄ PŁATNOŚCIĄ ONLINE nadal przyjmuje przelew", async () => {
    // Kontrola z tabeli mutacji („usuń tor offline, gdy Stripe działa"):
    // konto u dostawcy istnieje, a przelew i tak przechodzi.
    const shop = await seedShop(admin, true);
    const { data, error } = await checkout(anon, shop, "transfer");
    expect(error).toBeNull();
    expect((data as CheckoutResponse).payment_provider).toBe("manual");
  });

  it("online: zamówienie w reżimie stripe, ale WCIĄŻ nieopłacone", async () => {
    const shop = await seedShop(admin, true);

    const { data, error } = await checkout(anon, shop, "online");
    expect(error).toBeNull();

    const result = data as CheckoutResponse;
    expect(result.payment_provider).toBe("stripe");
    // Zamówienie rodzi się nieopłacone także wtedy, gdy klient za sekundę
    // zapłaci kartą. `paid` nie pada w tej migracji ani razu.
    expect(result.payment_status).toBe("unpaid");
  });

  // -------------------------------------------------------------------
  // 2. Najemca bez konta
  // -------------------------------------------------------------------

  it("najemca BEZ konta u dostawcy nie przyjmuje zamówienia online (22023)", async () => {
    const shop = await seedShop(admin, false);

    const { error } = await checkout(anon, shop, "online");

    expect(error?.code).toBe(PG_INVALID_PARAMETER);
  });

  it("…ale ten sam sklep przyjmuje przelew (tor offline działa zawsze)", async () => {
    const shop = await seedShop(admin, false);
    const { error } = await checkout(anon, shop, "transfer");
    expect(error).toBeNull();
  });

  it("nieznana metoda płatności jest odrzucana (22023)", async () => {
    const shop = await seedShop(admin, true);
    const { error } = await checkout(anon, shop, "bitcoin");
    expect(error?.code).toBe(PG_INVALID_PARAMETER);
  });

  // -------------------------------------------------------------------
  // 3–4. Wiązanie płatności: token i niezmienność
  // -------------------------------------------------------------------

  it("attach_payment_intent przenosi unpaid → pending i zapisuje identyfikator", async () => {
    const shop = await seedShop(admin, true);
    const { data } = await checkout(anon, shop, "online");
    const order = data as CheckoutResponse;

    const { data: attached, error } = await anon.schema("app").rpc("attach_payment_intent", {
      p_tenant_id: shop.tenantId,
      p_order_id: order.order_id,
      p_checkout_token: order.log_token,
      p_intent_id: "pi_test_z3_1",
      p_application_fee_grosze: 0,
    });

    expect(error).toBeNull();
    expect(attached).toMatchObject({
      payment_status: "pending",
      provider_payment_intent_id: "pi_test_z3_1",
    });
  });

  it("powtórzone wiązanie TYM SAMYM identyfikatorem jest sukcesem, nie błędem", async () => {
    // Klient odświeżający krok płatności ma zobaczyć swoją płatność, a nie
    // komunikat o awarii.
    const shop = await seedShop(admin, true);
    const { data } = await checkout(anon, shop, "online");
    const order = data as CheckoutResponse;
    const args = {
      p_tenant_id: shop.tenantId,
      p_order_id: order.order_id,
      p_checkout_token: order.log_token,
      p_intent_id: "pi_test_z3_2",
      p_application_fee_grosze: 0,
    };

    await anon.schema("app").rpc("attach_payment_intent", args);
    const { data: second, error } = await anon.schema("app").rpc("attach_payment_intent", args);

    expect(error).toBeNull();
    expect(second).toMatchObject({ provider_payment_intent_id: "pi_test_z3_2" });
  });

  it("PODMIANA identyfikatora płatności jest odrzucana przez bazę (23514)", async () => {
    // Bez tej bramki jedno żądanie przypisałoby zamówieniu cudzą, opłaconą
    // płatność — a webhook z Z4, który pisze `paid` po odczycie TEJ
    // płatności, posłusznie oznaczyłby zamówienie jako opłacone.
    const shop = await seedShop(admin, true);
    const { data } = await checkout(anon, shop, "online");
    const order = data as CheckoutResponse;
    const base = {
      p_tenant_id: shop.tenantId,
      p_order_id: order.order_id,
      p_checkout_token: order.log_token,
      p_application_fee_grosze: 0,
    };

    await anon.schema("app").rpc("attach_payment_intent", { ...base, p_intent_id: "pi_wlasny" });
    const { error } = await anon
      .schema("app")
      .rpc("attach_payment_intent", { ...base, p_intent_id: "pi_cudzy_oplacony" });

    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("bramka niezmienności działa też przy bezpośrednim UPDATE service-rolem", async () => {
    // Kontrola, że reguła siedzi w BAZIE, a nie w funkcji RPC: nawet rola
    // omijająca RLS nie przepisze identyfikatora.
    const shop = await seedShop(admin, true);
    const { data } = await checkout(anon, shop, "online");
    const order = data as CheckoutResponse;
    await anon.schema("app").rpc("attach_payment_intent", {
      p_tenant_id: shop.tenantId,
      p_order_id: order.order_id,
      p_checkout_token: order.log_token,
      p_intent_id: "pi_pierwotny",
      p_application_fee_grosze: 0,
    });

    const { error } = await admin
      .from("orders")
      .update({ provider_payment_intent_id: "pi_podmieniony" })
      .eq("id", order.order_id);

    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("ZŁY TOKEN nie wiąże płatności — dane publiczne nie wystarczają", async () => {
    const shop = await seedShop(admin, true);
    const { data } = await checkout(anon, shop, "online");
    const order = data as CheckoutResponse;

    const { error } = await anon.schema("app").rpc("attach_payment_intent", {
      p_tenant_id: shop.tenantId,
      p_order_id: order.order_id,
      p_checkout_token: randomUUID(),
      p_intent_id: "pi_obcy",
      p_application_fee_grosze: 0,
    });

    expect(error?.code).toBe(PG_INVALID_PARAMETER);
  });

  it("zamówienia PRZELEWOWEGO nie da się wciągnąć w reżim online płatnością", async () => {
    const shop = await seedShop(admin, true);
    const { data } = await checkout(anon, shop, "transfer");
    const order = data as CheckoutResponse;

    const { error } = await anon.schema("app").rpc("attach_payment_intent", {
      p_tenant_id: shop.tenantId,
      p_order_id: order.order_id,
      p_checkout_token: order.log_token,
      p_intent_id: "pi_obcy",
      p_application_fee_grosze: 0,
    });

    expect(error?.code).toBe(PG_INVALID_PARAMETER);
  });

  // -------------------------------------------------------------------
  // Odczyt stanu dla strony powrotu
  // -------------------------------------------------------------------

  it("get_public_order_payment oddaje stan Z BAZY i sumę policzoną przez serwer", async () => {
    const shop = await seedShop(admin, true);
    const { data } = await checkout(anon, shop, "online");
    const order = data as CheckoutResponse;
    await anon.schema("app").rpc("attach_payment_intent", {
      p_tenant_id: shop.tenantId,
      p_order_id: order.order_id,
      p_checkout_token: order.log_token,
      p_intent_id: "pi_stan",
      p_application_fee_grosze: 0,
    });

    const { data: state, error } = await anon.schema("app").rpc("get_public_order_payment", {
      p_tenant_id: shop.tenantId,
      p_order_id: order.order_id,
      p_checkout_token: order.log_token,
    });

    expect(error).toBeNull();
    expect(state).toMatchObject({
      payment_status: "pending",
      payment_provider: "stripe",
      provider_payment_intent_id: "pi_stan",
      // Najem (3 doby × 100 zł) + kaucja 50 zł, odbiór osobisty = 0 dostawy.
      amount_grosze: 35_000,
      currency: "PLN",
    });
  });

  it("bez tokenu odczyt zwraca NULL — funkcja nie jest wyrocznią zamówień", async () => {
    const shop = await seedShop(admin, true);
    const { data } = await checkout(anon, shop, "online");
    const order = data as CheckoutResponse;

    const { data: state } = await anon.schema("app").rpc("get_public_order_payment", {
      p_tenant_id: shop.tenantId,
      p_order_id: order.order_id,
      p_checkout_token: randomUUID(),
    });

    expect(state).toBeNull();
  });

  it("get_public_payment_account oddaje SAM identyfikator, bez kolumn gotowości", async () => {
    const shop = await seedShop(admin, true);

    const { data, error } = await anon
      .schema("app")
      .rpc("get_public_payment_account", { p_tenant_id: shop.tenantId });

    expect(error).toBeNull();
    expect(typeof data).toBe("string");
    // Gdyby funkcja zwracała obiekt ze stanem, pierwszy wołający oparłby na
    // nim decyzję o pobraniu pieniędzy — a to kopia sprzed nieznanego czasu.
    expect(String(data)).toMatch(/^acct_/);
  });

  it("najemca bez konta: NULL, a nie odmowa (tor offline to normalny stan)", async () => {
    const shop = await seedShop(admin, false);
    const { data, error } = await anon
      .schema("app")
      .rpc("get_public_payment_account", { p_tenant_id: shop.tenantId });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  // -------------------------------------------------------------------
  // 5. `paid` jest nieosiągalne z tej ścieżki
  // -------------------------------------------------------------------

  it("unpaid → paid W REŻIMIE STRIPE jest odmawiane przez bazę (23514)", async () => {
    // Ta odmowa jest powodem, dla którego Z3 nie musi „pamiętać", żeby nie
    // ustawiać `paid`: nawet gdyby ktoś dopisał taki UPDATE, baza go odrzuci.
    // Bramka stoi w bazie, bo UPDATE na orders ma każdy członek tenanta.
    const shop = await seedShop(admin, true);
    const { data } = await checkout(anon, shop, "online");
    const order = data as CheckoutResponse;

    const { error } = await admin
      .from("orders")
      .update({ payment_status: "paid" })
      .eq("id", order.order_id);

    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("pending → paid pozostaje otwarte — tą drogą pójdzie webhook z Z4", async () => {
    // Kontrola POZYTYWNA: bez niej bramka „wszystkiego odmawiaj" świeciłaby
    // na zielono, a Z4 nie miałby jak domknąć płatności.
    const shop = await seedShop(admin, true);
    const { data } = await checkout(anon, shop, "online");
    const order = data as CheckoutResponse;
    await anon.schema("app").rpc("attach_payment_intent", {
      p_tenant_id: shop.tenantId,
      p_order_id: order.order_id,
      p_checkout_token: order.log_token,
      p_intent_id: "pi_do_domkniecia",
      p_application_fee_grosze: 0,
    });

    const { error } = await admin
      .from("orders")
      .update({ payment_status: "paid" })
      .eq("id", order.order_id);

    expect(error).toBeNull();
  });
});
