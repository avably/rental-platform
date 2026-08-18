/**
 * KONTROLA NEGATYWNA STOREFRONTU dla okna domykania (Zasada 8, ADR-138) —
 * spec (e)7.
 *
 * Okno domykania otwiera CZĘŚĆ PANELU zawieszonego najemcy — i NIC więcej.
 * Ten test jest bezpiecznikiem przed „życzliwym" otwarciem publicznych bramek
 * w przyszłym PR: wszystkie publiczne RPC storefrontu (w tym para płatnicza
 * `get_public_order_payment` / `get_public_payment_account`, z której
 * storefront TWORZY PaymentIntent) odrzucają tenanta `suspended` TAKŻE
 * wtedy, gdy `suspended_at` jest świeże i okno domykania panelu stoi
 * otworem. Embed i API v1 stoją na tych samych RPC (`app.get_public_*` —
 * apps/storefront/lib/embed/contract.ts), a ich warstwę HTTP dla `suspended`
 * przypina apps/storefront/test/api-v1-integration.test.ts.
 *
 * Metoda: PEŁNY sklep na tenancie `active` + kontrola POZYTYWNA każdego RPC
 * (dane są), potem `suspended` + `suspended_at = now()` i kontrola negatywna
 * (danych nie ma / zamówienie nie powstaje). Bez kontroli pozytywnej pusty
 * wynik dowodziłby pustego seeda, nie bramki.
 *
 * Wymaga lokalnego Supabase (SUPABASE_LOCAL_*).
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";
import { cleanupSeeded, createAdminClient, seedTwoTenants, type TenantCtx } from "./helpers/seed-tenants";
import { publishLegalDocuments } from "./helpers/publish-legal-documents";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function createAnonClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_LOCAL_API_URL as string,
    process.env.SUPABASE_LOCAL_ANON_KEY as string,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...realtimeTransport,
    },
  );
}

interface CheckoutResponse {
  order_id: string;
  log_token: string;
}

let admin: SupabaseClient;
let anon: SupabaseClient;
let shop: TenantCtx;
let productId: string;
let pickupId: string;
let orderId: string;
let logToken: string;

async function checkout(tenantId: string) {
  return anon.schema("app").rpc("public_checkout", {
    p_tenant_id: tenantId,
    p_email: `cw-${randomUUID().slice(0, 8)}@test.local`,
    p_full_name: "Kupujący",
    p_phone: null,
    p_start_date: "2027-03-01",
    p_end_date: "2027-03-03",
    p_delivery_method: "pickup",
    p_pickup_location_id: pickupId,
    p_items: [{ product_id: productId, quantity: 1 }],
    p_terms_version: "v1",
    p_locale: "pl",
  });
}

async function orderCount(tenantId: string): Promise<number> {
  const { count, error } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`orderCount: ${error.message}`);
  return count ?? 0;
}

/** Wynik „nie ma danych": NULL albo pusta lista — obie formy są odmową. */
function isEmpty(data: unknown): boolean {
  if (data === null || data === undefined) return true;
  return Array.isArray(data) && data.length === 0;
}

describe.skipIf(!hasEnv)("okno domykania NIE otwiera publicznych RPC (ADR-138, (e)7)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    anon = createAnonClient();
    const pair = await seedTwoTenants();
    shop = pair.a;
    // Komplet dokumentów prawnych (0086/ADR-191) — bez nich checkout odmawia.
    await publishLegalDocuments(admin, shop.tenantId);

    // Pełny sklep: produkt + egzemplarze + punkt odbioru + konto płatności
    // + pole własne + opublikowana strona.
    const { data: product, error: productError } = await admin
      .from("products")
      .insert({
        tenant_id: shop.tenantId,
        name: `Produkt ${randomUUID().slice(0, 8)}`,
        base_price_day_grosze: 10_000,
        deposit_grosze: 5_000,
      })
      .select("id")
      .single();
    if (productError || !product) throw new Error(`seed products: ${productError?.message}`);
    productId = product.id as string;

    const { error: unitsError } = await admin.from("product_units").insert(
      Array.from({ length: 2 }, () => ({
        tenant_id: shop.tenantId,
        product_id: productId,
        serial_number: `SN-${randomUUID().slice(0, 8)}`,
      })),
    );
    if (unitsError) throw new Error(`seed units: ${unitsError.message}`);

    const { data: pickup, error: pickupError } = await admin
      .from("pickup_locations")
      .insert({ tenant_id: shop.tenantId, name: "Magazyn", address_city: "Warszawa" })
      .select("id")
      .single();
    if (pickupError || !pickup) throw new Error(`seed pickup: ${pickupError?.message}`);
    pickupId = pickup.id as string;

    const { error: accountError } = await admin.from("payment_accounts").insert({
      tenant_id: shop.tenantId,
      provider_account_id: `acct_${randomUUID().slice(0, 12)}`,
    });
    if (accountError) throw new Error(`seed payment_accounts: ${accountError.message}`);

    const { error: fieldError } = await admin.from("custom_field_definitions").insert({
      tenant_id: shop.tenantId,
      entity: "order",
      field_type: "text",
      label: `Pole ${randomUUID().slice(0, 8)}`,
      options: [],
      required: false,
      position: 0,
      show_in_panel: true,
      show_in_checkout: true,
    });
    if (fieldError) throw new Error(`seed custom_field_definitions: ${fieldError.message}`);

    const { data: site, error: siteError } = await shop.ownerClient
      .from("sites")
      .insert({ tenant_id: shop.tenantId })
      .select("id")
      .single();
    if (siteError || !site) throw new Error(`seed sites: ${siteError?.message}`);
    const { error: sectionError } = await shop.ownerClient.from("site_sections").insert({
      tenant_id: shop.tenantId,
      site_id: site.id as string,
      type: "hero",
      position: 0,
      content_draft: { heading: "Hero" },
    });
    if (sectionError) throw new Error(`seed site_sections: ${sectionError.message}`);
    const { error: publishError } = await shop.ownerClient
      .schema("app")
      .rpc("publish_site", { p_site_id: site.id as string });
    if (publishError) throw new Error(`publish_site: ${publishError.message}`);
  });

  afterAll(async () => {
    if (hasEnv) await cleanupSeeded(admin);
  });

  it("KONTROLA POZYTYWNA (active): każdy z 7 RPC oddaje dane / przyjmuje zamówienie", async () => {
    const catalog = await anon.schema("app").rpc("get_public_catalog", { p_tenant_id: shop.tenantId });
    expect(catalog.error).toBeNull();
    expect(isEmpty(catalog.data), "katalog musi mieć dane przed zawieszeniem").toBe(false);

    const availability = await anon.schema("app").rpc("get_public_availability", {
      p_tenant_id: shop.tenantId,
      p_product_id: productId,
      p_start_date: "2027-04-01",
      p_end_date: "2027-04-03",
    });
    expect(availability.data).toMatchObject({ available_units: 2, total_units: 2 });

    const fields = await anon
      .schema("app")
      .rpc("get_public_custom_fields", { p_tenant_id: shop.tenantId });
    expect(isEmpty(fields.data)).toBe(false);

    const site = await anon
      .schema("app")
      .rpc("get_published_site", { p_tenant_id: shop.tenantId });
    expect(site.data).not.toBeNull();

    const account = await anon
      .schema("app")
      .rpc("get_public_payment_account", { p_tenant_id: shop.tenantId });
    expect(account.data).not.toBeNull();

    const created = await checkout(shop.tenantId);
    expect(created.error).toBeNull();
    const response = created.data as CheckoutResponse;
    orderId = response.order_id;
    logToken = response.log_token;
    expect(orderId).toBeTruthy();

    await anon.schema("app").rpc("attach_payment_intent", {
      p_tenant_id: shop.tenantId,
      p_order_id: orderId,
      p_checkout_token: logToken,
      p_intent_id: `pi_${randomUUID().slice(0, 12)}`,
      p_application_fee_grosze: 0,
    });
    const payment = await anon.schema("app").rpc("get_public_order_payment", {
      p_tenant_id: shop.tenantId,
      p_order_id: orderId,
      p_checkout_token: logToken,
    });
    expect(payment.data).not.toBeNull();
  });

  it("KONTROLA NEGATYWNA (suspended, suspended_at = now(), okno OTWARTE): wszystkie 7 RPC odmawia", async () => {
    // Świeży zegar — okno domykania panelu jest w tej chwili otwarte.
    const suspendedAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from("tenants")
      .update({ status: "suspended", suspended_at: suspendedAt })
      .eq("id", shop.tenantId);
    if (updateError) throw new Error(`suspend tenant: ${updateError.message}`);

    const catalog = await anon.schema("app").rpc("get_public_catalog", { p_tenant_id: shop.tenantId });
    expect(isEmpty(catalog.data), "katalog zawieszonego ma być pusty").toBe(true);

    const availability = await anon.schema("app").rpc("get_public_availability", {
      p_tenant_id: shop.tenantId,
      p_product_id: productId,
      p_start_date: "2027-04-01",
      p_end_date: "2027-04-03",
    });
    expect(availability.data, "dostępność zawieszonego = brak danych").toBeNull();

    const fields = await anon
      .schema("app")
      .rpc("get_public_custom_fields", { p_tenant_id: shop.tenantId });
    expect(isEmpty(fields.data)).toBe(true);

    const site = await anon
      .schema("app")
      .rpc("get_published_site", { p_tenant_id: shop.tenantId });
    expect(site.data).toBeNull();

    // PARA PŁATNICZA — sedno bezpiecznika: z tych dwóch RPC storefront
    // tworzy PaymentIntent. Otwarcie ich „bo okno" przywróciłoby
    // niepłacącemu najemcy kanał przyjmowania pieniędzy.
    const account = await anon
      .schema("app")
      .rpc("get_public_payment_account", { p_tenant_id: shop.tenantId });
    expect(account.data).toBeNull();

    const payment = await anon.schema("app").rpc("get_public_order_payment", {
      p_tenant_id: shop.tenantId,
      p_order_id: orderId,
      p_checkout_token: logToken,
    });
    expect(payment.data).toBeNull();

    // Checkout: zamówienie NIE powstaje (licznik przed/po), niezależnie od
    // formy odmowy (błąd czy NULL).
    const before = await orderCount(shop.tenantId);
    const attempt = await checkout(shop.tenantId);
    const after = await orderCount(shop.tenantId);
    expect(after, "public_checkout nie ma prawa utworzyć zamówienia").toBe(before);
    expect(attempt.error !== null || attempt.data === null).toBe(true);
  });
});
