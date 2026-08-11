/**
 * Testy ban-listy klientów (R6b, migracja 0040_customer_bans.sql; ADR-080).
 *
 * To jest ścieżka IZOLACJI i EGZEKWOWANIA — dowody mutacyjne obowiązkowe.
 * Osie:
 *   1. EGZEKWOWANIE PO MAILU: zbanowany (znormalizowany) mail → checkout odmawia
 *      (22023), zamówienie NIE powstaje.
 *   2. EGZEKWOWANIE PO TELEFONIE: inny mail, ten sam numer (inaczej sformatowany)
 *      → odmowa (dowód, że dopasowanie po telefonie działa i jest znormalizowane).
 *   3. KONTROLA POZYTYWNA: niezbanowany klient przechodzi (checkout żyje).
 *   4. IZOLACJA: ban tenanta A nie blokuje checkoutu tenanta B.
 *   5. UNBAN: zdjęcie banu przywraca możliwość zamówienia.
 *   6. ZAPIS PRZEZ CZŁONKA + TRIGGER: członek tenanta wstawia ban, trigger
 *      wypełnia znormalizowane klucze; anon NIE czyta customer_bans.
 *
 * DOWODY MUTACYJNE (README pliku 0020): dwa RÓŻNE wektory na migracji 0040 —
 *   A) zdjęcie warunku telefonu z checka → oś 2 (telefon) czerwona,
 *   B) zdjęcie zawężenia tenant_id z checka → oś 4 (izolacja) czerwona.
 *
 * Wymaga lokalnego Supabase i SUPABASE_LOCAL_* — inaczej strażnik jawności.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { rpcCreateTenant } from "./helpers/create-tenant";
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

const TEST_PASSWORD = "TestoweHaslo123!";
const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function createUser(admin: SupabaseClient, label: string): Promise<{ id: string; email: string }> {
  const email = `ban-${label}-${randomUUID().slice(0, 8)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

async function seedTenant(admin: SupabaseClient, status: string): Promise<string> {
  const slug = `ban-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: `Ban test ${status}`, status, locale: "pl" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedTenant(${status}): ${error?.message}`);
  createdTenantIds.push(data.id as string);
  return data.id as string;
}

async function seedProduct(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data, error } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: `Produkt ${randomUUID().slice(0, 8)}`,
      base_price_day_grosze: 10_000,
      deposit_grosze: 5_000,
      buffer_before_days: 1,
      buffer_after_days: 1,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedProduct: ${error?.message}`);
  return data.id as string;
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

async function seedUnits(admin: SupabaseClient, tenantId: string, productId: string, count: number) {
  const rows = Array.from({ length: count }, () => ({
    tenant_id: tenantId,
    product_id: productId,
    serial_number: `SN-${randomUUID().slice(0, 8)}`,
  }));
  const { error } = await admin.from("product_units").insert(rows);
  if (error) throw new Error(`seedUnits: ${error.message}`);
}

async function seedCustomer(
  admin: SupabaseClient,
  tenantId: string,
  email: string,
  phone: string | null,
): Promise<string> {
  const { data, error } = await admin
    .from("customers")
    .insert({ tenant_id: tenantId, email, full_name: "Klient", phone })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedCustomer: ${error?.message}`);
  return data.id as string;
}

/** Standardowe wejście checkoutu (nadpisywalne per test). */
function checkoutArgs(
  tenantId: string,
  productId: string,
  pickupId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    p_tenant_id: tenantId,
    p_email: `co-${randomUUID().slice(0, 8)}@test.local`,
    p_full_name: "Kupujący",
    p_phone: null,
    p_start_date: "2026-10-01",
    p_end_date: "2026-10-03",
    p_delivery_method: "pickup",
    p_pickup_location_id: pickupId,
    p_items: [{ product_id: productId, quantity: 1 }],
    p_terms_version: "v1",
    p_locale: "pl",
    ...overrides,
  };
}

function checkout(anon: SupabaseClient, args: Record<string, unknown>) {
  return anon.schema("app").rpc("public_checkout", args);
}

describe.skipIf(!hasEnv)("app.public_checkout — ban-lista klientów (R6b / 0040)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  // Tenant A: właściciel + realny claim (do testu zapisu banu przez członka).
  let tenantA: string;
  let productA: string;
  let pickupA: string;
  let memberA: SupabaseClient;
  let bannedCustomerId: string;

  const BANNED_EMAIL = `zbanowany-${randomUUID().slice(0, 8)}@test.local`;
  const BANNED_PHONE_RAW = "+48 111 222 333"; // u klienta (z prefiksem +48)
  // [0042] app.normalize_phone kanonizuje prefiks kraju: „+48 111 222 333"
  // schodzi do 9-cyfrowej postaci krajowej — ten sam klucz co „111 222 333".
  const BANNED_PHONE_DIGITS = "111222333";

  // Klient zbanowany numerem BEZ prefiksu — do dowodu kierunku ODWROTNEGO
  // (ban krajowy łapie checkout z „+48"). Numer rozłączny z BANNED_PHONE_*.
  const BANNED_BARE_EMAIL = `zbanowany-bare-${randomUUID().slice(0, 8)}@test.local`;
  const BANNED_BARE_PHONE_RAW = "882 333 444"; // u klienta (postać krajowa)
  let bannedBarePhoneCustomerId: string;

  // Tenant B: niezależny (izolacja).
  let tenantB: string;
  let productB: string;
  let pickupB: string;

  afterAll(async () => {
    if (!hasEnv) return;
    for (const userId of createdUserIds) await admin.auth.admin.deleteUser(userId);
    createdUserIds.length = 0;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
      createdTenantIds.length = 0;
    }
  });

  it("przygotowanie: tenant z właścicielem, produkt z zapasem egzemplarzy, klient i jego ban", async () => {
    // Tenant A powstaje realną ścieżką onboardingu (owner → claim tenant_id).
    const owner = await createUser(admin, "owner-a");
    const bootstrap = await signIn(owner.email);
    const { data: newTenant, error: tErr } = await rpcCreateTenant(bootstrap, {
      p_slug: `ban-a-${randomUUID()}`.slice(0, 39),
      p_name: "Wypożyczalnia A",
    });
    if (tErr) throw new Error(`create_tenant A: ${tErr.message}`);
    tenantA = newTenant as string;
    createdTenantIds.push(tenantA);
    memberA = await signIn(owner.email); // świeża sesja z claimem tenant_id

    productA = await seedProduct(admin, tenantA);
    // Zapas egzemplarzy: kontrola pozytywna, unban i checkout tenanta B nie mogą
    // padać na braku sztuki zamiast na (nie)banie.
    await seedUnits(admin, tenantA, productA, 5);
    pickupA = await seedPickup(admin, tenantA);
    bannedCustomerId = await seedCustomer(admin, tenantA, BANNED_EMAIL, BANNED_PHONE_RAW);
    // Drugi klient — numer w postaci KRAJOWEJ (bez prefiksu); jego ban dowodzi
    // kierunku odwrotnego w oś 2c (klucz krajowy łapie checkout z „+48").
    bannedBarePhoneCustomerId = await seedCustomer(
      admin,
      tenantA,
      BANNED_BARE_EMAIL,
      BANNED_BARE_PHONE_RAW,
    );

    // Tenant B — niezależny, z własnym zapasem.
    tenantB = await seedTenant(admin, "active");
    productB = await seedProduct(admin, tenantB);
    await seedUnits(admin, tenantB, productB, 2);
    pickupB = await seedPickup(admin, tenantB);

    expect(tenantA).toBeTruthy();
    expect(tenantB).toBeTruthy();
    expect(bannedCustomerId).toBeTruthy();
  });

  it("oś 6 — członek tenanta wstawia ban; trigger wypełnia znormalizowane klucze; anon NIE czyta tabeli", async () => {
    const { data, error } = await memberA
      .from("customer_bans")
      .insert({ tenant_id: tenantA, customer_id: bannedCustomerId })
      .select("id, email_normalized, phone_normalized, created_by")
      .single();
    expect(error, `zapis banu przez członka odrzucony: ${error?.message}`).toBeNull();
    // Trigger znormalizował klucze z danych klienta (jedno źródło reguły).
    expect(data!.email_normalized).toBe(BANNED_EMAIL.toLowerCase());
    expect(data!.phone_normalized).toBe(BANNED_PHONE_DIGITS);
    // created_by = zalogowany członek (nie NULL).
    expect(data!.created_by, "created_by nie ustawione na autora").toBeTruthy();

    // anon nie ma grantu na tabelę — nie wolno mu poznać, kto jest na liście.
    const anonRead = await anon.from("customer_bans").select("id").eq("tenant_id", tenantA);
    const leaked = !anonRead.error && (anonRead.data ?? []).length > 0;
    expect(leaked, "anon odczytał ban-listę").toBe(false);

    // Drugi ban — klient z numerem w postaci KRAJOWEJ (bez prefiksu). Klucz
    // 9-cyfrowy zostaje nietknięty przez kanonizację (0042) i posłuży za dowód
    // kierunku odwrotnego w oś 2c.
    const bare = await memberA
      .from("customer_bans")
      .insert({ tenant_id: tenantA, customer_id: bannedBarePhoneCustomerId })
      .select("phone_normalized")
      .single();
    expect(bare.error, `zapis banu (numer krajowy) odrzucony: ${bare.error?.message}`).toBeNull();
    expect(bare.data!.phone_normalized).toBe("882333444");
  });

  it("oś 1 — zbanowany MAIL nie przechodzi checkoutu (22023), zamówienie nie powstaje", async () => {
    const { data, error } = await checkout(
      anon,
      checkoutArgs(tenantA, productA, pickupA, { p_email: BANNED_EMAIL, p_phone: "500 000 000" }),
    );
    expect(data, "zbanowany mail złożył zamówienie").toBeNull();
    expect(error?.code, `zły SQLSTATE odmowy: ${error?.message}`).toBe("22023");

    // Twardy dowód: brak zamówienia storefront dla tego klienta.
    const { data: orders } = await admin
      .from("orders")
      .select("id")
      .eq("tenant_id", tenantA)
      .eq("customer_id", bannedCustomerId);
    expect(orders ?? [], "ban po mailu jednak utworzył zamówienie").toHaveLength(0);
  });

  it("oś 2 — zbanowany TELEFON (inny mail, inny format) nie przechodzi (dopasowanie znormalizowane)", async () => {
    const freshEmail = `inny-${randomUUID().slice(0, 8)}@test.local`;
    const { data, error } = await checkout(
      anon,
      // Ten sam numer co u zbanowanego klienta, ale inaczej sformatowany.
      checkoutArgs(tenantA, productA, pickupA, { p_email: freshEmail, p_phone: "48-111-222-333" }),
    );
    expect(data, "zbanowany telefon złożył zamówienie").toBeNull();
    expect(error?.code, `zły SQLSTATE odmowy telefonu: ${error?.message}`).toBe("22023");

    // Świeży mail nie mógł nawet założyć klienta (odmowa jest PRZED find-or-create).
    const { data: cust } = await admin
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantA)
      .eq("email", freshEmail);
    expect(cust ?? [], "odmowa po telefonie mimo to utworzyła klienta").toHaveLength(0);
  });

  it("oś 2b — ban z prefiksem +48 łapie checkout BEZ prefiksu (0042: +48 111... == 111...)", async () => {
    // Klient zbanowany numerem „+48 111 222 333"; zbanowany wraca z NUMEREM
    // KRAJOWYM „111 222 333" (bez prefiksu) i innym mailem. Przed 0042 klucze
    // rozjeżdżały się (48111222333 vs 111222333) i przechodził — teraz nie.
    const freshEmail = `bezpref-${randomUUID().slice(0, 8)}@test.local`;
    const { data, error } = await checkout(
      anon,
      checkoutArgs(tenantA, productA, pickupA, { p_email: freshEmail, p_phone: "111 222 333" }),
    );
    expect(data, "checkout bez prefiksu ominął ban z prefiksem").toBeNull();
    expect(error?.code, `zły SQLSTATE odmowy (2b): ${error?.message}`).toBe("22023");

    const { data: cust } = await admin
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantA)
      .eq("email", freshEmail);
    expect(cust ?? [], "odmowa (2b) mimo to utworzyła klienta").toHaveLength(0);
  });

  it("oś 2c — ban BEZ prefiksu łapie checkout z +48 (kierunek odwrotny)", async () => {
    // Klient zbanowany numerem krajowym „882 333 444"; zbanowany wraca
    // z „+48 882 333 444" i innym mailem — kanonizacja checkoutu schodzi do
    // tego samego 9-cyfrowego klucza, więc ban łapie.
    const freshEmail = `zpref-${randomUUID().slice(0, 8)}@test.local`;
    const { data, error } = await checkout(
      anon,
      checkoutArgs(tenantA, productA, pickupA, { p_email: freshEmail, p_phone: "+48 882 333 444" }),
    );
    expect(data, "checkout z +48 ominął ban krajowy").toBeNull();
    expect(error?.code, `zły SQLSTATE odmowy (2c): ${error?.message}`).toBe("22023");

    const { data: cust } = await admin
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantA)
      .eq("email", freshEmail);
    expect(cust ?? [], "odmowa (2c) mimo to utworzyła klienta").toHaveLength(0);
  });

  it("kontrola pozytywna — niezbanowany klient (świeży mail i telefon) przechodzi", async () => {
    const { data, error } = await checkout(
      anon,
      checkoutArgs(tenantA, productA, pickupA, {
        p_email: `wolny-${randomUUID().slice(0, 8)}@test.local`,
        p_phone: "600 700 800",
      }),
    );
    expect(error, `niezbanowany checkout odrzucony: ${error?.message}`).toBeNull();
    expect((data as { order_number: string }).order_number).toBeTruthy();
  });

  it("oś 4 — IZOLACJA: ban tenanta A nie blokuje checkoutu tenanta B (ten sam mail i telefon)", async () => {
    const { data, error } = await checkout(
      anon,
      checkoutArgs(tenantB, productB, pickupB, {
        p_email: BANNED_EMAIL,
        p_phone: BANNED_PHONE_RAW,
      }),
    );
    expect(error, `ban tenanta A przeciekł na tenanta B: ${error?.message}`).toBeNull();
    expect((data as { order_number: string }).order_number).toBeTruthy();
  });

  it("oś 5 — UNBAN przywraca możliwość zamówienia (ten sam, wcześniej zbanowany mail)", async () => {
    const del = await memberA
      .from("customer_bans")
      .delete()
      .eq("tenant_id", tenantA)
      .eq("customer_id", bannedCustomerId)
      .select("id");
    expect(del.error, `unban odrzucony: ${del.error?.message}`).toBeNull();
    expect(del.data ?? [], "unban nie zdjął wiersza banu").toHaveLength(1);

    const { data, error } = await checkout(
      anon,
      checkoutArgs(tenantA, productA, pickupA, {
        p_email: BANNED_EMAIL,
        p_phone: BANNED_PHONE_RAW,
      }),
    );
    expect(error, `po unbanie checkout nadal odrzucony: ${error?.message}`).toBeNull();
    expect((data as { order_number: string }).order_number).toBeTruthy();
  });
});
