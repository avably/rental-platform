/**
 * Pola własne w ZAMAWIANIU (migracja 0058, ADR-121) na ŻYWYM Supabase —
 * realny anon, realne SECURITY DEFINER, realne triggery.
 *
 * KAŻDA sonda idzie SUROWYM WYWOŁANIEM RPC, z pominięciem formularza sklepu
 * i wtyczki. To jest cała pointa: warstwa aplikacji może być pominięta przez
 * kogokolwiek z internetu jednym `curl`-em, więc dowód „pole nie da się
 * wypełnić” musi pochodzić z bazy, a nie z tego, czego formularz nie
 * wyrenderował.
 *
 * Cztery przyczyny odmowy (cudza definicja / zmyślona / bez flagi
 * „zamawianie” / zarchiwizowana / zła encja) mają dawać JEDNĄ odpowiedź —
 * rozróżnienie byłoby wyrocznią o konfiguracji cudzego sklepu, czytaną
 * z kanału błędu.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
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

/** 22023 = invalid_parameter_value — odmowa bramki widoczności / encji / najemcy. */
const PG_INVALID_PARAMETER = "22023";
/** 23514 = check_violation — wartość niezgodna z definicją (trigger 0057). */
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

async function seedTenant(admin: SupabaseClient, status = "active"): Promise<string> {
  const { data, error } = await admin
    .from("tenants")
    .insert({
      slug: `cf-checkout-${randomUUID().slice(0, 12)}`.slice(0, 39),
      name: "Pola własne w zamawianiu",
      status,
      locale: "pl",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedTenant: ${error?.message}`);
  createdTenantIds.push(data.id as string);
  return data.id as string;
}

interface DefinitionInput {
  entity?: "customer" | "order" | "product";
  field_type?: string;
  show_in_checkout?: boolean;
  show_in_panel?: boolean;
  required?: boolean;
  options?: unknown;
  archived?: boolean;
  position?: number;
}

async function seedDefinition(
  admin: SupabaseClient,
  tenantId: string,
  input: DefinitionInput = {},
): Promise<string> {
  const { data, error } = await admin
    .from("custom_field_definitions")
    .insert({
      tenant_id: tenantId,
      entity: input.entity ?? "order",
      field_type: input.field_type ?? "text",
      label: `Pole ${randomUUID().slice(0, 8)}`,
      options: input.options ?? [],
      required: input.required ?? false,
      position: input.position ?? 0,
      show_in_panel: input.show_in_panel ?? true,
      show_in_checkout: input.show_in_checkout ?? true,
      ...(input.archived ? { archived_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedDefinition: ${error?.message}`);
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
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedProduct: ${error?.message}`);
  return data.id as string;
}

async function seedUnits(admin: SupabaseClient, tenantId: string, productId: string, count = 2) {
  const rows = Array.from({ length: count }, () => ({
    tenant_id: tenantId,
    product_id: productId,
    serial_number: `SN-${randomUUID().slice(0, 8)}`,
  }));
  const { error } = await admin.from("product_units").insert(rows);
  if (error) throw new Error(`seedUnits: ${error.message}`);
}

async function seedPickup(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data, error } = await admin
    .from("pickup_locations")
    .insert({ tenant_id: tenantId, name: "Magazyn", address_city: "Warszawa" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedPickup: ${error?.message}`);
  return data.id as string;
}

interface Shop {
  tenantId: string;
  productId: string;
  pickupId: string;
}

async function seedShop(admin: SupabaseClient, status = "active"): Promise<Shop> {
  const tenantId = await seedTenant(admin, status);
  const productId = await seedProduct(admin, tenantId);
  await seedUnits(admin, tenantId, productId);
  const pickupId = await seedPickup(admin, tenantId);
  return { tenantId, productId, pickupId };
}

/** Wywołanie SUROWE, jako anon — dokładnie ta droga, którą ma napastnik. */
function checkout(
  anon: SupabaseClient,
  shop: Shop,
  overrides: Record<string, unknown> = {},
): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> {
  return anon.schema("app").rpc("public_checkout", {
    p_tenant_id: shop.tenantId,
    p_email: `cf-${randomUUID().slice(0, 8)}@test.local`,
    p_full_name: "Kupujący",
    p_phone: null,
    p_start_date: "2026-11-02",
    p_end_date: "2026-11-04",
    p_delivery_method: "pickup",
    p_pickup_location_id: shop.pickupId,
    p_items: [{ product_id: shop.productId, quantity: 1 }],
    p_terms_version: "v1",
    p_locale: "pl",
    ...overrides,
  });
}

async function orderCount(admin: SupabaseClient, tenantId: string): Promise<number> {
  const { count, error } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`orderCount: ${error.message}`);
  return count ?? 0;
}

describe.skipIf(!hasEnv)("pola własne w zamawianiu (0058, ADR-121)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
      createdTenantIds.length = 0;
    }
  });

  // ------------------------------------------------------------------
  // 1. ŚCIEŻKA POZYTYWNA — bez niej reszta dowodziłaby tylko, że nic nie działa
  // ------------------------------------------------------------------

  it("wartość pod ŻYWĄ definicją zamawiania ląduje na zamówieniu", async () => {
    const shop = await seedShop(admin);
    const definitionId = await seedDefinition(admin, shop.tenantId, { entity: "order" });

    const { data, error } = await checkout(anon, shop, {
      p_order_custom_fields: { [definitionId]: "ABC-123" },
    });
    expect(error).toBeNull();

    const orderId = (data as { order_id: string }).order_id;
    const { data: row } = await admin
      .from("orders")
      .select("custom_fields")
      .eq("id", orderId)
      .single();
    expect(row?.custom_fields).toEqual({ [definitionId]: "ABC-123" });
  });

  it("checkout BEZ pól własnych zachowuje się jak przed migracją (domyślki parametrów)", async () => {
    const shop = await seedShop(admin);
    const { data, error } = await checkout(anon, shop);
    expect(error).toBeNull();

    const orderId = (data as { order_id: string }).order_id;
    const { data: row } = await admin
      .from("orders")
      .select("custom_fields")
      .eq("id", orderId)
      .single();
    expect(row?.custom_fields).toEqual({});
  });

  // ------------------------------------------------------------------
  // 2. SONDA IZOLACJI: CUDZA DEFINICJA
  // ------------------------------------------------------------------

  it("wartość pod identyfikatorem definicji CUDZEGO najemcy odbija się o bazę", async () => {
    const shop = await seedShop(admin);
    const other = await seedTenant(admin);
    const foreignDefinition = await seedDefinition(admin, other, { entity: "order" });

    const before = await orderCount(admin, shop.tenantId);
    const { error } = await checkout(anon, shop, {
      p_order_custom_fields: { [foreignDefinition]: "wartość" },
    });

    expect(error?.code).toBe(PG_INVALID_PARAMETER);
    // Odmowa ma być TWARDA: zamówienie nie powstaje ani w połowie.
    expect(await orderCount(admin, shop.tenantId)).toBe(before);
  });

  it("odmowa za cudzą definicję jest NIEODRÓŻNIALNA od odmowy za zmyśloną", async () => {
    const shop = await seedShop(admin);
    const other = await seedTenant(admin);
    const foreignDefinition = await seedDefinition(admin, other, { entity: "order" });

    const foreign = await checkout(anon, shop, {
      p_order_custom_fields: { [foreignDefinition]: "wartość" },
    });
    const invented = await checkout(anon, shop, {
      p_order_custom_fields: { [randomUUID()]: "wartość" },
    });

    expect(foreign.error?.code).toBe(invented.error?.code);
    expect(foreign.error?.message).toBe(invented.error?.message);
  });

  // ------------------------------------------------------------------
  // 3. SONDA WIDOCZNOŚCI — najciekawszy wektor zadania
  // ------------------------------------------------------------------

  it("pole BEZ flagi „zamawianie” nie da się wypełnić, także po podaniu id wprost", async () => {
    const shop = await seedShop(admin);
    const panelOnly = await seedDefinition(admin, shop.tenantId, {
      entity: "order",
      show_in_panel: true,
      show_in_checkout: false,
    });

    const before = await orderCount(admin, shop.tenantId);
    const { error } = await checkout(anon, shop, {
      p_order_custom_fields: { [panelOnly]: "wpisane z curl-a" },
    });

    expect(error?.code).toBe(PG_INVALID_PARAMETER);
    expect(await orderCount(admin, shop.tenantId)).toBe(before);
  });

  it("pole ZARCHIWIZOWANE z flagą zamawiania też nie ma drogi z checkoutu", async () => {
    const shop = await seedShop(admin);
    const archived = await seedDefinition(admin, shop.tenantId, {
      entity: "order",
      archived: true,
    });

    const { error } = await checkout(anon, shop, {
      p_order_custom_fields: { [archived]: "wartość" },
    });
    expect(error?.code).toBe(PG_INVALID_PARAMETER);
  });

  it("definicja PRODUKTU z flagą zamawiania jest do CZYTANIA, nie do pisania", async () => {
    const shop = await seedShop(admin);
    const productField = await seedDefinition(admin, shop.tenantId, { entity: "product" });

    // Obie mapy — napastnik nie zgadnie encji, więc próbuje w każdej.
    const asOrder = await checkout(anon, shop, {
      p_order_custom_fields: { [productField]: "wartość" },
    });
    const asCustomer = await checkout(anon, shop, {
      p_customer_custom_fields: { [productField]: "wartość" },
    });

    expect(asOrder.error?.code).toBe(PG_INVALID_PARAMETER);
    expect(asCustomer.error?.code).toBe(PG_INVALID_PARAMETER);
  });

  it("definicja KLIENTA podana w mapie ZAMÓWIENIA jest odrzucona (filtr encji)", async () => {
    const shop = await seedShop(admin);
    const customerField = await seedDefinition(admin, shop.tenantId, { entity: "customer" });

    const { error } = await checkout(anon, shop, {
      p_order_custom_fields: { [customerField]: "wartość" },
    });
    expect(error?.code).toBe(PG_INVALID_PARAMETER);
  });

  // ------------------------------------------------------------------
  // 4. ZGODNOŚĆ WARTOŚCI — bramką jest BAZA, nie formularz
  // ------------------------------------------------------------------

  it("wartość niezgodna z definicją odbija się o TRIGGER, choć formularza nie było", async () => {
    const shop = await seedShop(admin);
    const numberField = await seedDefinition(admin, shop.tenantId, {
      entity: "order",
      field_type: "number",
    });

    // Surowe wywołanie: liczba przysłana jako string. Formularz zamieniłby ją
    // na liczbę, ale formularza tu nie ma — i właśnie o to chodzi.
    const { error } = await checkout(anon, shop, {
      p_order_custom_fields: { [numberField]: "nie-liczba" },
    });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("wartość spoza listy opcji selecta nie przechodzi", async () => {
    const shop = await seedShop(admin);
    const selectField = await seedDefinition(admin, shop.tenantId, {
      entity: "order",
      field_type: "select",
      options: ["Alfa", "Beta"],
    });

    const ok = await checkout(anon, shop, {
      p_order_custom_fields: { [selectField]: "Alfa" },
    });
    expect(ok.error).toBeNull();

    const bad = await checkout(anon, shop, {
      p_order_custom_fields: { [selectField]: "Gamma" },
    });
    expect(bad.error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("JSON-owy null i mapa nie-obiekt są odrzucone", async () => {
    const shop = await seedShop(admin);

    const notObject = await checkout(anon, shop, { p_order_custom_fields: ["a"] });
    expect(notObject.error?.code).toBe(PG_INVALID_PARAMETER);

    // `null` jest normalizowany do pustej mapy — checkout ma przejść.
    const asNull = await checkout(anon, shop, { p_order_custom_fields: null });
    expect(asNull.error).toBeNull();
  });

  // ------------------------------------------------------------------
  // 5. SCALENIE MAPY KLIENTA — dług `existing` po stronie bazy
  // ------------------------------------------------------------------

  it("zamówienie ze sklepu NIE KASUJE wartości pod polami, których sklep nie pokazuje", async () => {
    const shop = await seedShop(admin);
    const panelOnly = await seedDefinition(admin, shop.tenantId, {
      entity: "customer",
      show_in_checkout: false,
    });
    const checkoutField = await seedDefinition(admin, shop.tenantId, {
      entity: "customer",
      show_in_checkout: true,
    });

    // Stały klient panelu: wiersz istnieje i niesie wartość spoza sklepu.
    const email = `staly-${randomUUID().slice(0, 8)}@test.local`;
    const { error: insertError } = await admin.from("customers").insert({
      tenant_id: shop.tenantId,
      email,
      full_name: "Stały klient",
      custom_fields: { [panelOnly]: "notatka lady" },
    });
    expect(insertError).toBeNull();

    const { error } = await checkout(anon, shop, {
      p_email: email,
      p_customer_custom_fields: { [checkoutField]: "wpisane w sklepie" },
    });
    expect(error).toBeNull();

    const { data: row } = await admin
      .from("customers")
      .select("custom_fields")
      .eq("tenant_id", shop.tenantId)
      .eq("email", email)
      .single();

    // OBIE wartości — scalenie, nie nadpisanie.
    expect(row?.custom_fields).toEqual({
      [panelOnly]: "notatka lady",
      [checkoutField]: "wpisane w sklepie",
    });
  });

  // ------------------------------------------------------------------
  // 6. ODCZYT PUBLICZNY — co wychodzi na zewnątrz, a co nie
  // ------------------------------------------------------------------

  it("get_public_custom_fields oddaje WYŁĄCZNIE pola zamawiania i tylko wąski kształt", async () => {
    const tenantId = await seedTenant(admin);
    const visible = await seedDefinition(admin, tenantId, { entity: "order", position: 0 });
    const panelOnly = await seedDefinition(admin, tenantId, {
      entity: "order",
      show_in_checkout: false,
      position: 1,
    });
    const archived = await seedDefinition(admin, tenantId, {
      entity: "order",
      archived: true,
      position: 2,
    });

    const { data, error } = await anon
      .schema("app")
      .rpc("get_public_custom_fields", { p_tenant_id: tenantId });
    expect(error).toBeNull();

    const rows = data as Record<string, unknown>[];
    expect(rows.map((row) => row.id)).toEqual([visible]);
    expect(rows.map((row) => row.id)).not.toContain(panelOnly);
    expect(rows.map((row) => row.id)).not.toContain(archived);

    // Kształt ZAMKNIĘTY: bez flag widoczności, bez archived_at, bez created_at.
    expect(Object.keys(rows[0]!).sort()).toEqual([
      "entity",
      "field_type",
      "help_text",
      "id",
      "label",
      "options",
      "required",
    ]);
  });

  it("get_public_custom_fields nie pokazuje definicji CUDZEGO najemcy", async () => {
    const mine = await seedTenant(admin);
    const other = await seedTenant(admin);
    const foreign = await seedDefinition(admin, other, { entity: "order" });

    const { data } = await anon
      .schema("app")
      .rpc("get_public_custom_fields", { p_tenant_id: mine });
    expect((data as { id: string }[]).map((row) => row.id)).not.toContain(foreign);
  });

  it("sklep poza trialing|active nie oddaje definicji (pusta lista, nie odmowa)", async () => {
    const suspended = await seedTenant(admin, "suspended");
    await seedDefinition(admin, suspended, { entity: "order" });

    const { data, error } = await anon
      .schema("app")
      .rpc("get_public_custom_fields", { p_tenant_id: suspended });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("katalog publiczny niesie wartości pól PRODUKTU tylko pod flagą zamawiania", async () => {
    const tenantId = await seedTenant(admin);
    const shown = await seedDefinition(admin, tenantId, { entity: "product" });
    const hidden = await seedDefinition(admin, tenantId, {
      entity: "product",
      show_in_checkout: false,
    });
    const productId = await seedProduct(admin, tenantId, {
      custom_fields: { [shown]: "rocznik 2024", [hidden]: "koszt zakupu 4200" },
    });

    const { data, error } = await anon
      .schema("app")
      .rpc("get_public_catalog", { p_tenant_id: tenantId });
    expect(error).toBeNull();

    const catalog = data as { products: { id: string; custom_fields: unknown }[] };
    const product = catalog.products.find((row) => row.id === productId);
    expect(product?.custom_fields).toEqual({ [shown]: "rocznik 2024" });
  });
});
