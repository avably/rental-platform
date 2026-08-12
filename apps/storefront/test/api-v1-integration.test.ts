/**
 * Publiczne API v1 na ŻYWYM Supabase (M1, ADR-108) — rdzenie tras + prawdziwe
 * RPC: app.verify_api_key (0053), app.get_public_catalog /
 * app.get_public_availability (0020) i app.public_checkout (0049), wszystko
 * kluczem ANON, jak w produkcyjnych portach (lib/api/deps.ts).
 *
 * Testy jednostkowe (api-v1.test.ts) dowodzą kontraktu na atrapach — ten plik
 * dowodzi, że NAPRAWDĘ: klucz rozwiązuje się na tenanta w bazie, katalog nie
 * niesie cudzych produktów, a rezerwacja kluczem A na produkcie B kończy się
 * odmową Z BAZY i ZEREM zapisu (sonda §6.1 — stan tenanta B sprawdzany po
 * próbie odczytem service-role).
 *
 * Poza zasięgiem: transport poczty (port podstawiony licznikiem — historia
 * wysyłek ma własne testy) i licznik rate-limitu (własne dowody w 0052).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPublicAvailability, getPublicCatalog } from "@/lib/checkout/catalog";
import type { CheckoutRpcError, CheckoutRpcResult } from "@/lib/checkout/core";
import {
  handleAvailabilityRequest,
  handleCatalogRequest,
  handleReservationRequest,
  type ReservationDeps,
} from "@/lib/api/handlers";
import { readCheckoutCustomFieldDefinitions } from "@/lib/checkout/catalog";
import { issueCheckoutTicket } from "@/lib/checkout/ticket";
import type { VerifiedApiKey } from "@/lib/api/auth";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

function client(key: string): SupabaseClient {
  return createClient(process.env.SUPABASE_LOCAL_API_URL as string, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const anonClient = () => client(process.env.SUPABASE_LOCAL_ANON_KEY as string);
const adminClient = () => client(process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY as string);

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** PRAWDZIWA weryfikacja: RPC app.verify_api_key kluczem anon (jak deps.ts). */
async function liveVerify(keyHash: string): Promise<VerifiedApiKey | null> {
  const { data, error } = await anonClient()
    .schema("app")
    .rpc("verify_api_key", { p_key_hash: keyHash });
  if (error || !Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as { tenant_id: string; key_id: string; tenant_status: string };
  return { tenantId: row.tenant_id, keyId: row.key_id, tenantStatus: row.tenant_status };
}

function liveReservationDeps(
  emailCalls: { tenantId: string }[],
  overrides: Partial<ReservationDeps> = {},
): ReservationDeps {
  return {
    verifyKeyHash: liveVerify,
    checkRateLimit: async () => ({ success: true }),
    // PRAWDZIWY wystawca biletu (0059) — nie atrapa. Ta suita jedzie po żywej
    // bazie, więc ma jechać tą samą drogą co produkcja: bez sekretu w env
    // wystawia bilet pusty, a baza bez zasianego klucza go nie bada (dev-skip
    // po obu stronach). Gdyby na tej bazie zasiano klucz bez ustawienia
    // sekretu w env, ta suita zapali się jako pierwsza — i o to chodzi.
    issueTicket: (tenantId) => issueCheckoutTicket(tenantId),
    ip: `test-${randomUUID()}`,
    // PRAWDZIWY odczyt definicji kluczem anon — dokładnie ta ścieżka, którą
    // buduje deps.ts. Zaślepka pustą listą kłamałaby o powierzchni, na której
    // ta suita ma dowodzić izolacji.
    readCustomFields: async (tenantId) =>
      readCheckoutCustomFieldDefinitions(tenantId, anonClient()),
    callRpc: async (args) => {
      const { data, error } = await anonClient().schema("app").rpc("public_checkout", args);
      if (error) {
        const wrapped = new Error(error.message) as CheckoutRpcError;
        wrapped.code = error.code;
        throw wrapped;
      }
      return data as CheckoutRpcResult;
    },
    sendEmails: async (tenantId) => {
      emailCalls.push({ tenantId });
      return [];
    },
    readOnlineAvailability: async () => ({ stripeConfigured: false, chargesEnabled: false }),
    ...overrides,
  };
}

const createdTenantIds: string[] = [];

async function seedTenant(
  admin: SupabaseClient,
  label: string,
  status = "active",
): Promise<string> {
  const { data, error } = await admin
    .from("tenants")
    .insert({
      slug: `apiv1-${label}-${randomUUID().slice(0, 8)}`.slice(0, 39),
      name: `API v1 test ${label}`,
      status,
      locale: "pl",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedTenant(${label}): ${error?.message}`);
  createdTenantIds.push(data.id as string);
  return data.id as string;
}

async function seedProductWithUnit(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data, error } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: `Produkt ${randomUUID().slice(0, 8)}`,
      base_price_day_grosze: 10_000,
      deposit_grosze: 5_000,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedProduct: ${error?.message}`);
  const productId = data.id as string;
  const { error: unitError } = await admin
    .from("product_units")
    .insert({ tenant_id: tenantId, product_id: productId, serial_number: `SN-${randomUUID().slice(0, 8)}` });
  if (unitError) throw new Error(`seedUnit: ${unitError.message}`);
  return productId;
}

async function seedApiKey(admin: SupabaseClient, tenantId: string): Promise<string> {
  const raw = `avbl_${randomBytes(32).toString("hex")}`;
  const { error } = await admin.from("api_keys").insert({
    tenant_id: tenantId,
    name: "Klucz integracyjny",
    key_hash: sha256(raw),
    key_prefix: raw.slice(0, 13),
  });
  if (error) throw new Error(`seedApiKey: ${error.message}`);
  return raw;
}

/** Kategoria katalogu najemcy (0072, ADR-155) — slug świeży per przebieg. */
async function seedCategory(
  admin: SupabaseClient,
  tenantId: string,
  name: string,
  position: number,
): Promise<string> {
  const { data, error } = await admin
    .from("catalog_categories")
    .insert({
      tenant_id: tenantId,
      name: `${name} ${randomUUID().slice(0, 8)}`,
      slug: `apiv1-${randomUUID().slice(0, 8)}`,
      position,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedCategory: ${error?.message}`);
  return data.id as string;
}

const reservationBody = (productId: string) => ({
  email: `apiv1-${randomUUID().slice(0, 8)}@test.local`,
  fullName: "Klient Integracyjny",
  startDate: "2026-09-10",
  endDate: "2026-09-12",
  deliveryMethod: "courier",
  paymentMethod: "transfer",
  items: [{ productId, quantity: 1 }],
  termsAccepted: true,
  termsVersion: "test-v1",
});

describe.skipIf(!hasEnv)("publiczne API v1 na żywym Supabase (M1, ADR-108)", () => {
  let admin: SupabaseClient;
  let tenantA: string;
  let tenantB: string;
  let productA: string;
  let productB: string;
  let categoryA: string;
  let categoryB: string;
  let rawKeyA: string;

  const catalogDeps = () => ({
    verifyKeyHash: liveVerify,
    checkRateLimit: async () => ({ success: true }),
    ip: `test-${randomUUID()}`,
    getCatalog: (tenantId: string) => getPublicCatalog(tenantId, anonClient()),
  });

  const availabilityDeps = () => ({
    verifyKeyHash: liveVerify,
    checkRateLimit: async () => ({ success: true }),
    ip: `test-${randomUUID()}`,
    getAvailability: (tenantId: string, productId: string, start: string, end: string) =>
      getPublicAvailability(tenantId, productId, start, end, anonClient()),
  });

  beforeAll(async () => {
    admin = adminClient();
    tenantA = await seedTenant(admin, "a");
    tenantB = await seedTenant(admin, "b");
    productA = await seedProductWithUnit(admin, tenantA);
    productB = await seedProductWithUnit(admin, tenantB);
    rawKeyA = await seedApiKey(admin, tenantA);

    // Metoda 'courier' wymaga cennika dostaw najemcy (bramka 22023 w
    // public_checkout) — konfiguracja jak z ekranu ustawień dostaw.
    const { error: pricingError } = await admin.from("tenant_settings").insert({
      tenant_id: tenantA,
      key: "delivery_pricing",
      value: { courier: { price_grosze: 2_000 } },
    });
    if (pricingError) throw new Error(`seed delivery_pricing: ${pricingError.message}`);

    // Taksonomia katalogu (ADR-155): kategoria u OBU najemców, przypisanie
    // wyłącznie u A — bez kategorii u B test izolacji nie miałby czego bronić.
    categoryA = await seedCategory(admin, tenantA, "KATEGORIA_A", 5);
    categoryB = await seedCategory(admin, tenantB, "KATEGORIA_B", 0);
    const { error: linkError } = await admin
      .from("product_categories")
      .insert({ tenant_id: tenantA, product_id: productA, category_id: categoryA });
    if (linkError) throw new Error(`seed product_categories: ${linkError.message}`);
  }, 60_000);

  afterAll(async () => {
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
  });

  const auth = () => ({ authorization: `Bearer ${rawKeyA}` });

  it("katalog kluczem A niesie produkt A, NIE niesie produktu B i ma zamknięty kształt (§6.1, §6.6)", async () => {
    const response = await handleCatalogRequest(
      new Request("https://x.avably.io/api/v1/catalog", { headers: auth() }),
      catalogDeps(),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    // Kształt zamknięty: dokładnie kontrakt PublicCatalog z 0020 — bez
    // sekretów nadawcy, bez kont płatności, bez danych innych najemców.
    expect(Object.keys(body).sort()).toEqual([
      // [ADR-155] Kategorie katalogu — pełne obiekty RAZ, na górze koperty;
      // produkt niesie `category_ids`. Klucz dołożony ŚWIADOMIE: bez niego
      // integrator ma identyfikatory, których nie umie nazwać. Kształt
      // pojedynczej kategorii pilnuje osobny przypadek niżej.
      "categories",
      // [C6-A3] Definicje pól własnych zamawiania są w kontrakcie ŚWIADOMIE:
      // bez nich integrator nie ma jak wyrenderować pól, których najemca
      // wymaga. Kształt pojedynczej definicji pilnuje osobny przypadek niżej.
      "custom_fields",
      "delivery_methods",
      "pickup_locations",
      "products",
      "tenant",
    ]);
    expect(Object.keys(body.tenant as object).sort()).toEqual(["currency", "locale", "name"]);

    const ids = (body.products as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(productA);
    expect(ids).not.toContain(productB);
    expect(JSON.stringify(body)).not.toContain(tenantB);
  });

  it("katalog niesie kategorie WŁASNE i przypisania produktu, nie niesie cudzych (ADR-155)", async () => {
    const response = await handleCatalogRequest(
      new Request("https://x.avably.io/api/v1/catalog", { headers: auth() }),
      catalogDeps(),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      categories: Record<string, unknown>[];
      products: { id: string; category_ids: string[] }[];
    };

    // KONTROLA POZYTYWNA NAJPIERW: „nie zawiera cudzej" przeszłoby też przy
    // pustej liście, czyli przy kategoriach, które w ogóle nie wyszły.
    const own = body.categories.find((c) => c.id === categoryA);
    expect(own, "kategoria najemcy A nie doszła do koperty").toBeDefined();
    expect(Object.keys(own!).sort()).toEqual(["description", "id", "name", "position", "slug"]);
    expect(own!.position).toBe(5);

    expect(body.categories.map((c) => c.id)).not.toContain(categoryB);

    const product = body.products.find((p) => p.id === productA)!;
    expect(product.category_ids, "przypisanie produktu A nie doszło").toEqual([categoryA]);
    expect(
      body.products.every((p) => p.category_ids.every((id) => id !== categoryB)),
      "identyfikator cudzej kategorii przy produkcie",
    ).toBe(true);
  });

  it("dostępność kluczem A: produkt A → liczby; produkt B → 404 jak nieistniejący (§6.1)", async () => {
    const url = (productId: string) =>
      `https://x.avably.io/api/v1/availability?product_id=${productId}&start_date=2026-09-10&end_date=2026-09-12`;

    const own = await handleAvailabilityRequest(
      new Request(url(productA), { headers: auth() }),
      availabilityDeps(),
    );
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ available_units: 1, total_units: 1 });

    const cross = await handleAvailabilityRequest(
      new Request(url(productB), { headers: auth() }),
      availabilityDeps(),
    );
    const missing = await handleAvailabilityRequest(
      new Request(url(randomUUID()), { headers: auth() }),
      availabilityDeps(),
    );
    expect(cross.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await cross.json()).toEqual(await missing.json());
  });

  it("rezerwacja kluczem A na produkcie B → odmowa Z BAZY i ZERO zapisu u B (§6.1)", async () => {
    const ordersBefore = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantB);
    const customersBefore = await admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantB);

    const emailCalls: { tenantId: string }[] = [];
    const response = await handleReservationRequest(
      new Request("https://x.avably.io/api/v1/reservations", {
        method: "POST",
        headers: { ...auth(), "content-type": "application/json", "x-tenant-id": tenantB },
        body: JSON.stringify(reservationBody(productB)),
      }),
      liveReservationDeps(emailCalls),
    );

    // app.public_checkout widzi produkt B jako NIEISTNIEJĄCY w tenancie A
    // (22023) → kontrakt v1: 422 rejected, bez szczegółów.
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: "rejected" } });
    expect(emailCalls).toEqual([]);

    // STAN B PO PRÓBIE: zero nowych zamówień i klientów (odczyt service-role).
    const ordersAfter = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantB);
    const customersAfter = await admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantB);
    expect(ordersAfter.count).toBe(ordersBefore.count);
    expect(customersAfter.count).toBe(customersBefore.count);

    // ...i zero zapisu także u A — walidacyjna odmowa wycofuje całość.
    const ordersA = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantA);
    expect(ordersA.count).toBe(0);
  });

  it("rezerwacja kluczem A na produkcie A → 201, zamówienie powstaje W TENANCIE KLUCZA", async () => {
    const emailCalls: { tenantId: string }[] = [];
    const response = await handleReservationRequest(
      new Request("https://x.avably.io/api/v1/reservations", {
        method: "POST",
        headers: { ...auth(), "content-type": "application/json" },
        body: JSON.stringify(reservationBody(productA)),
      }),
      liveReservationDeps(emailCalls),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      status: string;
      order: { orderNumber: string; paymentStatus: string };
    };
    expect(body.status).toBe("success");
    expect(body.order.paymentStatus).toBe("unpaid");

    // Numer zamówienia jest unikalny PER TENANT (numeruje trigger 0015),
    // więc odczyt kontrolny musi być tenant-scoped.
    const { data: order } = await admin
      .from("orders")
      .select("tenant_id, order_number")
      .eq("tenant_id", tenantA)
      .eq("order_number", body.order.orderNumber)
      .single();
    expect(order?.tenant_id).toBe(tenantA);
    // ...i NIE powstało nic w tenancie B.
    const { count: ordersB } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantB);
    expect(ordersB).toBe(0);
    expect(emailCalls).toEqual([{ tenantId: tenantA }]);
  });

  // -------------------------------------------------------------------
  // POLA WŁASNE W API v1 (C6-A3, ADR-121) — sondy izolacji tej powierzchni
  // -------------------------------------------------------------------

  async function seedDefinition(
    tenantId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const { data, error } = await admin
      .from("custom_field_definitions")
      .insert({
        tenant_id: tenantId,
        entity: "order",
        field_type: "text",
        label: `Pole ${randomUUID().slice(0, 8)}`,
        options: [],
        show_in_panel: true,
        show_in_checkout: true,
        ...overrides,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seedDefinition: ${error?.message}`);
    return data.id as string;
  }

  async function reserveWithCustomFields(
    customFields: Record<string, unknown> | null,
  ): Promise<Response> {
    return handleReservationRequest(
      new Request("https://x.avably.io/api/v1/reservations", {
        method: "POST",
        headers: { ...auth(), "content-type": "application/json" },
        // Inny termin niż pozostałe przypadki tej suity: produkt ma JEDEN
        // egzemplarz, a wcześniejsza rezerwacja zajęła go na wrzesień.
        body: JSON.stringify({
          ...reservationBody(productA),
          startDate: "2026-12-01",
          endDate: "2026-12-02",
          ...(customFields === null ? {} : { customFields }),
        }),
      }),
      liveReservationDeps([]),
    );
  }

  it("katalog v1 niesie definicje pól zamawiania i tylko wąski kształt", async () => {
    const definitionId = await seedDefinition(tenantA, { required: true });
    await seedDefinition(tenantA, { show_in_checkout: false });

    const response = await handleCatalogRequest(
      new Request("https://x.avably.io/api/v1/catalog", { headers: auth() }),
      catalogDeps(),
    );
    const body = (await response.json()) as { custom_fields: Record<string, unknown>[] };

    const row = body.custom_fields.find((entry) => entry.id === definitionId);
    expect(row).toBeDefined();
    expect(Object.keys(row!).sort()).toEqual([
      "entity",
      "field_type",
      "help_text",
      "id",
      "label",
      "options",
      "required",
    ]);
    // Pole bez flagi zamawiania nie wychodzi do integratora w ogóle.
    expect(body.custom_fields).toHaveLength(1);

    await admin.from("custom_field_definitions").delete().eq("tenant_id", tenantA);
  });

  it("wartość pod definicją CUDZEGO najemcy → 422, zero zapisu", async () => {
    const foreign = await seedDefinition(tenantB);
    const ordersBefore = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantA);

    const response = await reserveWithCustomFields({ [foreign]: "wartość" });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; fields: Record<string, string> } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.fields[`cf_${foreign}`]).toBe("not_allowed");

    const ordersAfter = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantA);
    expect(ordersAfter.count).toBe(ordersBefore.count);

    await admin.from("custom_field_definitions").delete().eq("tenant_id", tenantB);
  });

  it("pole BEZ flagi „zamawianie” podane WPROST przez API → 422 not_allowed", async () => {
    // Najciekawszy wektor tej powierzchni: integrator zna identyfikator
    // (widzi go w panelu albo w eksporcie CSV) i próbuje go użyć maszynowo.
    const panelOnly = await seedDefinition(tenantA, { show_in_checkout: false });

    const response = await reserveWithCustomFields({ [panelOnly]: "z curl-a" });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { fields: Record<string, string> } };
    expect(body.error.fields[`cf_${panelOnly}`]).toBe("not_allowed");

    await admin.from("custom_field_definitions").delete().eq("tenant_id", tenantA);
  });

  it("pole WYMAGANE pominięte przez konsumenta maszynowego → 422 required", async () => {
    const required = await seedDefinition(tenantA, { required: true });

    const response = await handleReservationRequest(
      new Request("https://x.avably.io/api/v1/reservations", {
        method: "POST",
        headers: { ...auth(), "content-type": "application/json" },
        // BEZ klucza customFields w ogóle — wymagalność liczy się po
        // definicjach najemcy, a nie po tym, co przyszło w żądaniu.
        body: JSON.stringify(reservationBody(productA)),
      }),
      liveReservationDeps([]),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { fields: Record<string, string> } };
    expect(body.error.fields[`cf_${required}`]).toBe("required");

    await admin.from("custom_field_definitions").delete().eq("tenant_id", tenantA);
  });

  it("wartość poprawna → 201 i mapa ląduje na zamówieniu tenanta klucza", async () => {
    const definitionId = await seedDefinition(tenantA);

    const response = await reserveWithCustomFields({ [definitionId]: "ABC-123" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { order: { orderNumber: string } };

    const { data: order } = await admin
      .from("orders")
      .select("custom_fields")
      .eq("tenant_id", tenantA)
      .eq("order_number", body.order.orderNumber)
      .single();
    expect(order?.custom_fields).toEqual({ [definitionId]: "ABC-123" });

    await admin.from("custom_field_definitions").delete().eq("tenant_id", tenantA);
  });

  it("status tenanta bramkuje API na ŻYWEJ ścieżce: suspended → 403, po odwieszeniu ten sam klucz → 200", async () => {
    // Luka z recenzji PM: 403 store_unavailable było przypięte wyłącznie na
    // stubie weryfikacji (unit) — mutant `t.status → 'active'::text` w żywej
    // funkcji app.verify_api_key przechodził całą suitę. Ten test dowodzi
    // SPRZĘŻENIA handlera z PRAWDZIWĄ kolumną tenants.status przez RPC.
    const tenantC = await seedTenant(admin, "c", "suspended");
    const rawKeyC = await seedApiKey(admin, tenantC);

    const denied = await handleCatalogRequest(
      new Request("https://x.avably.io/api/v1/catalog", {
        headers: { authorization: `Bearer ${rawKeyC}` },
      }),
      catalogDeps(),
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: { code: "store_unavailable" } });

    // Kontrola pozytywna na TYM SAMYM tenancie i kluczu — bez niej bramka
    // „wszystkim odmawiaj" też byłaby zielona.
    const { error } = await admin.from("tenants").update({ status: "active" }).eq("id", tenantC);
    expect(error).toBeNull();
    const allowed = await handleCatalogRequest(
      new Request("https://x.avably.io/api/v1/catalog", {
        headers: { authorization: `Bearer ${rawKeyC}` },
      }),
      catalogDeps(),
    );
    expect(allowed.status).toBe(200);
  });

  it("klucz odwołany przestaje działać END-TO-END (401 na żywej ścieżce)", async () => {
    const rawRevocable = await seedApiKey(admin, tenantA);
    const okBefore = await handleCatalogRequest(
      new Request("https://x.avably.io/api/v1/catalog", {
        headers: { authorization: `Bearer ${rawRevocable}` },
      }),
      catalogDeps(),
    );
    expect(okBefore.status).toBe(200);

    const { error } = await admin
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("key_hash", sha256(rawRevocable));
    expect(error).toBeNull();

    const after = await handleCatalogRequest(
      new Request("https://x.avably.io/api/v1/catalog", {
        headers: { authorization: `Bearer ${rawRevocable}` },
      }),
      catalogDeps(),
    );
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: { code: "unauthorized" } });
  });
});
