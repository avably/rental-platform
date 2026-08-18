/**
 * Waluta zamówienia (K3, migracja 0049; ADR-103) na ŻYWYM, lokalnym Supabase.
 *
 * SEDNO SZWU: zamówienie utrwala walutę W CHWILI ZŁOŻENIA. Zmiana ustawienia
 * najemcy (tenant_settings key='currency') NIE przepisuje wstecznie znaczenia
 * kwot istniejących zamówień — mówi je tylko zamówieniom NOWYM. Przed 0049
 * waluta była wiązana przy ODCZYCIE, więc ten plik jest czerwony z właściwego
 * powodu: get_public_order_payment odpowiadała walutą BIEŻĄCEGO ustawienia.
 *
 * PRZEDMIOTEM TESTU JEST BAZA (kolumna, trigger, bramka zapisu, RPC) —
 * atrapa niczego by tu nie dowiodła.
 *
 * Osie:
 *   1. SZEW — zamówienie złożone przy walucie A mówi A także po zmianie
 *      ustawienia na B (kolumna orders.currency ORAZ odpowiedź
 *      get_public_order_payment — źródło kwoty i waluty PaymentIntentu);
 *      zamówienie złożone PO zmianie mówi B.
 *   2. PAYLOAD CHECKOUTU — public_checkout zwraca walutę UTRWALONĄ na
 *      wstawionym wierszu (RETURNING), nie osobny odczyt ustawień.
 *   3. DOMYŚLNOŚĆ — najemca bez ustawienia currency dostaje 'PLN'
 *      (seed e2e nie ustawia waluty jawnie i musi działać dalej).
 *   4. KAŻDY WRITER — INSERT bez podanej waluty (fabryki testów, przyszłe
 *      ścieżki) dostaje walutę z ustawień przez trigger, jak numeracja.
 *   5. NIEZMIENNOŚĆ — waluty nie da się zmienić po utworzeniu (bramka
 *      app.orders_write_gate, 23514), a CHECK odrzuca wartości spoza
 *      SUPPORTED_CURRENCIES (lustro plans.currency z 0005).
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

/** Sklep jak w public-checkout-payment.test.ts — najprostszy komplet checkoutu. */
async function seedShop(admin: SupabaseClient): Promise<Shop> {
  const slug = `k3-${randomUUID().slice(0, 12)}`;
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({ slug, name: "Sklep K3", status: "active", locale: "pl" })
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
    Array.from({ length: 6 }, () => ({
      tenant_id: tenantId,
      product_id: product.id as string,
      serial_number: `SN-${randomUUID().slice(0, 8)}`,
    })),
  );
  if (unitsError) throw new Error(`Egzemplarze: ${unitsError.message}`);

  return { tenantId, productId: product.id as string, pickupId: pickup.id as string };
}

/** Ustawia walutę operacyjną najemcy — skalar JSON, jak czyta ją cała baza. */
async function setTenantCurrency(
  admin: SupabaseClient,
  tenantId: string,
  currency: string,
): Promise<void> {
  const { error } = await admin
    .from("tenant_settings")
    .upsert({ tenant_id: tenantId, key: "currency", value: currency });
  if (error) throw new Error(`Ustawienie waluty: ${error.message}`);
}

function checkoutArgs(shop: Shop, overrides: Record<string, unknown> = {}) {
  return {
    p_tenant_id: shop.tenantId,
    p_email: `k3-${randomUUID().slice(0, 8)}@test.local`,
    p_full_name: "Kupujący",
    p_phone: null,
    p_start_date: "2026-11-01",
    p_end_date: "2026-11-03",
    p_delivery_method: "pickup",
    p_pickup_location_id: shop.pickupId,
    p_items: [{ product_id: shop.productId, quantity: 1 }],
    p_terms_version: "v1",
    p_locale: "pl",
    p_payment_method: "transfer",
    ...overrides,
  };
}

interface CheckoutResponse {
  order_id: string;
  order_number: string;
  currency: string;
  log_token: string;
}

async function checkout(
  anon: SupabaseClient,
  shop: Shop,
  overrides: Record<string, unknown> = {},
): Promise<CheckoutResponse> {
  const { data, error } = await anon
    .schema("app")
    .rpc("public_checkout", checkoutArgs(shop, overrides));
  if (error) throw new Error(`Checkout: ${error.message}`);
  return data as CheckoutResponse;
}

/** Waluta utrwalona na wierszu zamówienia — odczyt kolumny wprost. */
async function orderCurrency(admin: SupabaseClient, orderId: string): Promise<string> {
  const { data, error } = await admin
    .from("orders")
    .select("currency")
    .eq("id", orderId)
    .single();
  if (error) throw new Error(`Odczyt orders.currency: ${error.message}`);
  return (data as { currency: string }).currency;
}

/** Odpowiedź strony płatności — źródło kwoty i waluty PaymentIntentu. */
async function paymentViewCurrency(
  anon: SupabaseClient,
  shop: Shop,
  order: CheckoutResponse,
): Promise<string> {
  const { data, error } = await anon.schema("app").rpc("get_public_order_payment", {
    p_tenant_id: shop.tenantId,
    p_order_id: order.order_id,
    p_checkout_token: order.log_token,
  });
  if (error) throw new Error(`get_public_order_payment: ${error.message}`);
  if (!data) throw new Error("get_public_order_payment: brak wiersza (token?)");
  return (data as { currency: string }).currency;
}

describe.skipIf(!hasEnv)("orders.currency — utrwalenie waluty na zamówieniu (0049)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
  });

  // -------------------------------------------------------------------
  // 1. SZEW: zmiana ustawienia nie przepisuje historii
  // -------------------------------------------------------------------

  it("zamówienie złożone przy walucie EUR mówi EUR także po zmianie ustawienia na USD; nowe mówi USD", async () => {
    const shop = await seedShop(admin);
    await setTenantCurrency(admin, shop.tenantId, "EUR");

    const before = await checkout(anon, shop);
    expect(before.currency).toBe("EUR");
    expect(await orderCurrency(admin, before.order_id)).toBe("EUR");
    expect(await paymentViewCurrency(anon, shop, before)).toBe("EUR");

    // Najemca przechodzi na USD — historia ma zostać nietknięta.
    await setTenantCurrency(admin, shop.tenantId, "USD");

    expect(await orderCurrency(admin, before.order_id)).toBe("EUR");
    // To jest odpowiedź, z której serwer storefrontu bierze walutę
    // PaymentIntentu — przed 0049 mówiła walutą BIEŻĄCEGO ustawienia.
    expect(await paymentViewCurrency(anon, shop, before)).toBe("EUR");

    const after = await checkout(anon, shop);
    expect(after.currency).toBe("USD");
    expect(await orderCurrency(admin, after.order_id)).toBe("USD");
    expect(await paymentViewCurrency(anon, shop, after)).toBe("USD");
  });

  // -------------------------------------------------------------------
  // 2. Domyślność: brak ustawienia = PLN (kontrakt seedu e2e)
  // -------------------------------------------------------------------

  it("najemca bez ustawienia currency dostaje zamówienia w PLN", async () => {
    const shop = await seedShop(admin);

    const result = await checkout(anon, shop);
    expect(result.currency).toBe("PLN");
    expect(await orderCurrency(admin, result.order_id)).toBe("PLN");
  });

  it("śmieciowe ustawienie waluty spada na PLN, nie wywraca checkoutu", async () => {
    const shop = await seedShop(admin);
    // Wartość spoza SUPPORTED_CURRENCIES — odczyt waliduje i odrzuca,
    // jak dotychczasowe odczyty w RPC (0020/0029/0041).
    await setTenantCurrency(admin, shop.tenantId, "XXX");

    const result = await checkout(anon, shop);
    expect(result.currency).toBe("PLN");
    expect(await orderCurrency(admin, result.order_id)).toBe("PLN");
  });

  // -------------------------------------------------------------------
  // 3. Każdy writer: INSERT bez waluty dostaje ją z ustawień (trigger)
  // -------------------------------------------------------------------

  it("bezpośredni INSERT bez waluty utrwala walutę z ustawień najemcy", async () => {
    const shop = await seedShop(admin);
    await setTenantCurrency(admin, shop.tenantId, "EUR");

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({
        tenant_id: shop.tenantId,
        email: `k3-${randomUUID().slice(0, 8)}@test.local`,
        full_name: "Klient wprost",
      })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`Klient: ${customerError?.message}`);

    const { data: order, error } = await admin
      .from("orders")
      .insert({
        tenant_id: shop.tenantId,
        customer_id: customer.id as string,
        start_date: "2026-12-01",
        end_date: "2026-12-03",
        delivery_method: "courier",
      })
      .select("currency")
      .single();
    expect(error).toBeNull();
    expect((order as { currency: string } | null)?.currency).toBe("EUR");
  });

  it("waluta podana wprost w INSERT zostaje nietknięta (import z innego systemu)", async () => {
    const shop = await seedShop(admin);
    await setTenantCurrency(admin, shop.tenantId, "EUR");

    const { data: customer } = await admin
      .from("customers")
      .insert({
        tenant_id: shop.tenantId,
        email: `k3-${randomUUID().slice(0, 8)}@test.local`,
        full_name: "Klient importowany",
      })
      .select("id")
      .single();

    const { data: order, error } = await admin
      .from("orders")
      .insert({
        tenant_id: shop.tenantId,
        customer_id: customer!.id as string,
        start_date: "2026-12-05",
        end_date: "2026-12-06",
        delivery_method: "courier",
        currency: "USD",
      })
      .select("currency")
      .single();
    expect(error).toBeNull();
    expect((order as { currency: string } | null)?.currency).toBe("USD");
  });

  // -------------------------------------------------------------------
  // 4. Niezmienność i CHECK
  // -------------------------------------------------------------------

  it("waluty zamówienia nie można zmienić po utworzeniu (23514 z bramki zapisu)", async () => {
    const shop = await seedShop(admin);
    await setTenantCurrency(admin, shop.tenantId, "EUR");
    const result = await checkout(anon, shop);

    const { error } = await admin
      .from("orders")
      .update({ currency: "USD" })
      .eq("id", result.order_id);
    expect(error).not.toBeNull();
    expect(error!.code).toBe(PG_CHECK_VIOLATION);

    expect(await orderCurrency(admin, result.order_id)).toBe("EUR");
  });

  it("CHECK odrzuca walutę spoza SUPPORTED_CURRENCIES przy INSERT", async () => {
    const shop = await seedShop(admin);

    const { data: customer } = await admin
      .from("customers")
      .insert({
        tenant_id: shop.tenantId,
        email: `k3-${randomUUID().slice(0, 8)}@test.local`,
        full_name: "Klient zły kod",
      })
      .select("id")
      .single();

    const { error } = await admin.from("orders").insert({
      tenant_id: shop.tenantId,
      customer_id: customer!.id as string,
      start_date: "2026-12-10",
      end_date: "2026-12-11",
      delivery_method: "courier",
      currency: "GBP",
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(PG_CHECK_VIOLATION);
  });
});
