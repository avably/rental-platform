/**
 * Cel dostarczenia zamówienia i forma płatności w bazie (migracja 0044,
 * ADR-089) na ŻYWYM lokalnym Supabase — realne granty, realne CHECK-i,
 * realna funkcja `app.create_order` wołana sesją członka tenanta.
 *
 * PRZEDMIOTEM TESTU JEST BAZA, więc atrapa nie dowiodłaby niczego: bramka,
 * której nie ma, odpowiedziałaby „ok" dokładnie tak samo jak bramka, która
 * jest. Stąd wszystko idzie realnym PostgREST-em.
 *
 * Sześć osi, każda z własnym powodem:
 *   1. PUNKT ODBIORU JEST STRUKTURĄ — dostawca + kod zapisują się razem,
 *      a kod bez dostawcy (czyli luźny string, tak jak robił to pierwowzór)
 *      jest ODMAWIANY. To jest sedno decyzji ADR-089;
 *   2. PUNKT PASUJE DO METODY — numer paczkomatu przy kurierze nie ma
 *      adresata i wchodzi na CHECK, zamiast zostać w wierszu jako śmieć;
 *   3. ADRES TO WSKAŹNIK ALBO MIGAWKA — `customer` z wypełnionymi polami
 *      i `custom` bez kompletu są obie odmawiane; trzeciego stanu nie ma;
 *   4. ŹRÓDŁO CENY DOSTAWY jest zapisywane i domyślnie mówi prawdę
 *      o wierszach sprzed 0044 (`pricing`);
 *   5. FORMA PŁATNOŚCI wywodzi `payment_provider` TĄ SAMĄ regułą co
 *      checkout sklepu, a `online` bez konta rozliczeniowego jest odmawiane;
 *   6. STOREFRONT DZIAŁA DALEJ — `app.public_checkout` tworzy zamówienia
 *      kurierskie BEZ nowych pól, więc bramki 0044 muszą być spójnościowe,
 *      a nie wymagające. Bez tej osi migracja mogłaby po cichu zepsuć sklep.
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (docs/konwencje-
 * migracji.md). Bez nich strażnik integration-env failuje suitę.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

/** 23514 = check_violation — odmowa z CHECK-a tabeli. */
const PG_CHECK_VIOLATION = "23514";
/** 22023 = invalid_parameter_value — odmowa walidacyjna funkcji app.*. */
const PG_INVALID_PARAMETER = "22023";

const TEST_PASSWORD = "TestoweHaslo!12345";

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

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

interface Shop {
  tenantId: string;
  productId: string;
  unitId: string;
  customerId: string;
  pickupId: string;
  member: SupabaseClient;
}

/** Tenant z produktem, egzemplarzem, klientem, punktem odbioru i zalogowanym członkiem. */
async function seedShop(admin: SupabaseClient, withPaymentAccount = false): Promise<Shop> {
  const unique = randomUUID();
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({ slug: `r3-${unique}`.slice(0, 39), name: "Wypożyczalnia R3", locale: "pl" })
    .select("id")
    .single();
  if (tenantError || !tenant) throw new Error(`Tenant: ${tenantError?.message}`);
  const tenantId = tenant.id as string;
  createdTenantIds.push(tenantId);
  // Komplet dokumentów prawnych (0086/ADR-191) — bez nich checkout odmawia.
  await publishLegalDocuments(admin, tenantId);

  const email = `r3-${unique.slice(0, 8)}@test.local`;
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role: "owner" },
  });
  if (userError || !userData.user) throw new Error(`User: ${userError?.message}`);
  createdUserIds.push(userData.user.id);

  const { error: memberError } = await admin
    .from("members")
    .insert({ tenant_id: tenantId, user_id: userData.user.id, role: "owner" });
  if (memberError) throw new Error(`Member: ${memberError.message}`);

  const { data: product, error: productError } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: `Produkt ${unique.slice(0, 8)}`,
      base_price_day_grosze: 10_000,
      deposit_grosze: 0,
    })
    .select("id")
    .single();
  if (productError || !product) throw new Error(`Produkt: ${productError?.message}`);

  const { data: unit, error: unitError } = await admin
    .from("product_units")
    .insert({
      tenant_id: tenantId,
      product_id: product.id as string,
      serial_number: `SN-${unique.slice(0, 8)}`,
    })
    .select("id")
    .single();
  if (unitError || !unit) throw new Error(`Egzemplarz: ${unitError?.message}`);

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .insert({
      tenant_id: tenantId,
      email: `klient-${unique.slice(0, 8)}@test.local`,
      full_name: "Klient Testowy",
      address_street: "ul. Kartotekowa 1",
      address_zip: "61-001",
      address_city: "Poznań",
    })
    .select("id")
    .single();
  if (customerError || !customer) throw new Error(`Klient: ${customerError?.message}`);

  const { data: pickup, error: pickupError } = await admin
    .from("pickup_locations")
    .insert({ tenant_id: tenantId, name: "Magazyn", address_city: "Poznań" })
    .select("id")
    .single();
  if (pickupError || !pickup) throw new Error(`Punkt odbioru: ${pickupError?.message}`);

  // Cennik dostaw: checkout sklepu odmawia metody bez wpisu (ADR-030), więc
  // bez tego oś 6. mierzyłaby brak konfiguracji, a nie bramki 0044.
  const { error: pricingError } = await admin.from("tenant_settings").insert({
    tenant_id: tenantId,
    key: "delivery_pricing",
    value: { courier: { price_grosze: 2500 }, parcel_locker: { price_grosze: 1200 } },
  });
  if (pricingError) throw new Error(`Cennik dostaw: ${pricingError.message}`);

  if (withPaymentAccount) {
    const { error } = await admin.from("payment_accounts").insert({
      tenant_id: tenantId,
      provider_account_id: `acct_${unique.slice(0, 12)}`,
    });
    if (error) throw new Error(`Konto rozliczeniowe: ${error.message}`);
  }

  const member = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    ...realtimeTransport,
  });
  const { error: signInError } = await member.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError) throw new Error(`Logowanie członka: ${signInError.message}`);

  return {
    tenantId,
    productId: product.id as string,
    unitId: unit.id as string,
    customerId: customer.id as string,
    pickupId: pickup.id as string,
    member,
  };
}

/** Argumenty app.create_order w wariancie „kurier, adres z kartoteki". */
function createArgs(shop: Shop, overrides: Record<string, unknown> = {}) {
  return {
    p_customer_id: shop.customerId,
    p_start_date: "2026-11-01",
    p_end_date: "2026-11-03",
    p_delivery_method: "courier",
    p_pickup_location_id: null,
    p_notes: null,
    p_total_rental_grosze: 30_000,
    p_total_deposit_grosze: 0,
    p_items: [{ product_id: shop.productId, unit_id: shop.unitId, rental_grosze: 30_000 }],
    p_delivery_grosze: 2500,
    p_delivery_address_source: "customer",
    ...overrides,
  };
}

const createOrder = (shop: Shop, overrides: Record<string, unknown> = {}) =>
  shop.member.schema("app").rpc("create_order", createArgs(shop, overrides));

/** Wiersz zamówienia odczytany service-rolem (inspekcja, nie ścieżka produktu). */
async function readOrder(admin: SupabaseClient, orderId: string) {
  const { data, error } = await admin
    .from("orders")
    .select(
      "delivery_method, delivery_grosze, delivery_price_source, payment_method, payment_provider, delivery_point_provider, delivery_point_code, delivery_point_address, delivery_address_source, delivery_address_name, delivery_address_street, delivery_address_zip, delivery_address_city, delivery_address_phone",
    )
    .eq("id", orderId)
    .single();
  if (error) throw new Error(`Odczyt zamówienia: ${error.message}`);
  return data as Record<string, unknown>;
}

describe.skipIf(!hasEnv)("cel dostarczenia zamówienia — migracja 0044", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);

  /*
    DWA sklepy na całą suitę, nie jeden per przypadek: każdy sklep zakłada
    użytkownika w GoTrue, a dwadzieścia logowań pod rząd potrafi wejść na
    limit dostawcy auth i wywrócić SĄSIEDNIE suity dzielące tę samą bazę.
    Różnica między sklepami jest jedna i istotna dla osi 5: `paid` ma konto
    rozliczeniowe, `plain` nie ma.
    Zamówienia, które MAJĄ powstać, dostają rozłączne terminy — ten sam
    egzemplarz w tym samym terminie odmówiłby wykluczeniem 23P01 i test
    mierzyłby wtedy tamtą bramkę, a nie swoją.
  */
  let plain: Shop;
  let paid: Shop;
  let dayCursor = 1;
  /** Kolejny rozłączny termin dla zamówienia, które ma się udać. */
  const nextTerm = () => {
    const start = `2026-11-${String(dayCursor).padStart(2, "0")}`;
    dayCursor += 2;
    return { p_start_date: start, p_end_date: start };
  };

  beforeAll(async () => {
    if (!hasEnv) return;
    plain = await seedShop(admin, false);
    paid = await seedShop(admin, true);
  }, 60_000);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  // -------------------------------------------------------------------
  // 1. Punkt odbioru jest STRUKTURĄ
  // -------------------------------------------------------------------

  it("paczkomat zapisuje dostawcę, kod i opis punktu jako trzy osobne dane", async () => {
    const shop = plain;
    const { data: orderId, error } = await createOrder(shop, {
      ...nextTerm(),
      p_delivery_method: "parcel_locker",
      p_delivery_address_source: null,
      p_delivery_point_provider: "inpost",
      p_delivery_point_code: "POZ08M",
      p_delivery_point_address: "ul. Cumownicza 1, Poznań",
    });
    expect(error).toBeNull();

    const row = await readOrder(admin, orderId as string);
    expect(row.delivery_point_provider).toBe("inpost");
    expect(row.delivery_point_code).toBe("POZ08M");
    expect(row.delivery_point_address).toBe("ul. Cumownicza 1, Poznań");
  });

  it("kod punktu BEZ dostawcy jest odmawiany — luźny string nie jest punktem", async () => {
    const shop = plain;
    const { error } = await createOrder(shop, {
      p_delivery_method: "parcel_locker",
      p_delivery_address_source: null,
      p_delivery_point_code: "POZ08M",
    });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("sam adres opisowy bez kodu nie przechodzi — nie ma jak zaadresować przesyłki", async () => {
    const shop = plain;
    const { error } = await createOrder(shop, {
      p_delivery_method: "parcel_locker",
      p_delivery_address_source: null,
      p_delivery_point_address: "gdzieś w Poznaniu",
    });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("nieznany dostawca punktu jest odmawiany", async () => {
    const shop = plain;
    const { error } = await createOrder(shop, {
      p_delivery_method: "parcel_locker",
      p_delivery_address_source: null,
      p_delivery_point_provider: "kurier-z-ulicy",
      p_delivery_point_code: "POZ08M",
    });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  // -------------------------------------------------------------------
  // 2. Punkt pasuje do metody
  // -------------------------------------------------------------------

  it("numer paczkomatu przy kurierze jest odmawiany, a nie zapisany „na zapas”", async () => {
    const shop = plain;
    const { error } = await createOrder(shop, {
      p_delivery_point_provider: "inpost",
      p_delivery_point_code: "POZ08M",
    });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  // -------------------------------------------------------------------
  // 3. Adres: WSKAŹNIK albo MIGAWKA
  // -------------------------------------------------------------------

  it("adres z kartoteki zapisuje samo źródło — zero kopii pól adresowych", async () => {
    const shop = plain;
    const { data: orderId, error } = await createOrder(shop, nextTerm());
    expect(error).toBeNull();

    const row = await readOrder(admin, orderId as string);
    expect(row.delivery_address_source).toBe("customer");
    expect(row.delivery_address_street).toBeNull();
    expect(row.delivery_address_city).toBeNull();
  });

  it("adres z kartoteki z DOPISANYM adresem jest odmawiany — druga prawda o adresie", async () => {
    const shop = plain;
    const { error } = await createOrder(shop, {
      p_delivery_address_street: "ul. Inna 1",
      p_delivery_address_zip: "00-001",
      p_delivery_address_city: "Warszawa",
    });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("inny adres z kompletem ulica+kod+miasto zapisuje migawkę", async () => {
    const shop = plain;
    const { data: orderId, error } = await createOrder(shop, {
      ...nextTerm(),
      p_delivery_address_source: "custom",
      p_delivery_address_name: "Magazyn budowy",
      p_delivery_address_street: "ul. Polna 7",
      p_delivery_address_zip: "61-002",
      p_delivery_address_city: "Poznań",
      p_delivery_address_phone: "500600700",
    });
    expect(error).toBeNull();

    const row = await readOrder(admin, orderId as string);
    expect(row.delivery_address_source).toBe("custom");
    expect(row.delivery_address_street).toBe("ul. Polna 7");
    expect(row.delivery_address_zip).toBe("61-002");
    expect(row.delivery_address_city).toBe("Poznań");
    expect(row.delivery_address_name).toBe("Magazyn budowy");
    expect(row.delivery_address_phone).toBe("500600700");
  });

  it("inny adres bez miejscowości jest odmawiany", async () => {
    const shop = plain;
    const { error } = await createOrder(shop, {
      p_delivery_address_source: "custom",
      p_delivery_address_street: "ul. Polna 7",
      p_delivery_address_zip: "61-002",
    });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("adres dostarczenia przy odbiorze osobistym jest odmawiany", async () => {
    const shop = plain;
    const { error } = await createOrder(shop, {
      p_delivery_method: "pickup",
      p_pickup_location_id: shop.pickupId,
      p_delivery_address_source: "customer",
    });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("nieznane źródło adresu jest odmawiane", async () => {
    const shop = plain;
    const { error } = await createOrder(shop, { p_delivery_address_source: "skads" });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  // -------------------------------------------------------------------
  // 4. Źródło ceny dostawy
  // -------------------------------------------------------------------

  it("domyślnie cena pochodzi z cennika — tak jak wszystkie wiersze sprzed 0044", async () => {
    const shop = plain;
    const { data: orderId, error } = await createOrder(shop, nextTerm());
    expect(error).toBeNull();

    const row = await readOrder(admin, orderId as string);
    expect(row.delivery_price_source).toBe("pricing");
    expect(row.delivery_grosze).toBe(2500);
  });

  it("cena ustalona ręcznie jest zapisana RAZEM z informacją, że jest ręczna", async () => {
    const shop = plain;
    const { data: orderId, error } = await createOrder(shop, {
      ...nextTerm(),
      p_delivery_grosze: 999,
      p_delivery_price_source: "manual",
    });
    expect(error).toBeNull();

    const row = await readOrder(admin, orderId as string);
    expect(row.delivery_price_source).toBe("manual");
    expect(row.delivery_grosze).toBe(999);
  });

  it("nieznane źródło ceny jest odmawiane przez funkcję", async () => {
    const shop = plain;
    const { error } = await createOrder(shop, { p_delivery_price_source: "z_sufitu" });
    expect(error?.code).toBe(PG_INVALID_PARAMETER);
  });

  // -------------------------------------------------------------------
  // 5. Forma płatności
  // -------------------------------------------------------------------

  it("formy offline zapisują reżim manual — ta sama reguła co w checkoucie sklepu", async () => {
    for (const method of ["cod", "transfer"] as const) {
      const shop = plain;
      const { data: orderId, error } = await createOrder(shop, {
        ...nextTerm(),
        p_payment_method: method,
      });
      expect(error, method).toBeNull();

      const row = await readOrder(admin, orderId as string);
      expect(row.payment_method).toBe(method);
      expect(row.payment_provider).toBe("manual");
    }
  });

  it("brak formy płatności jest poprawny i zostaje NULL-em, nie pustym napisem", async () => {
    const shop = plain;
    const { data: orderId, error } = await createOrder(shop, {
      ...nextTerm(),
      p_payment_method: "",
    });
    expect(error).toBeNull();

    const row = await readOrder(admin, orderId as string);
    expect(row.payment_method).toBeNull();
    expect(row.payment_provider).toBe("manual");
  });

  it("płatność online wywodzi reżim stripe, gdy tenant ma konto rozliczeniowe", async () => {
    const shop = paid;
    const { data: orderId, error } = await createOrder(shop, {
      ...nextTerm(),
      p_payment_method: "online",
    });
    expect(error).toBeNull();

    const row = await readOrder(admin, orderId as string);
    expect(row.payment_method).toBe("online");
    expect(row.payment_provider).toBe("stripe");
  });

  it("płatność online BEZ konta rozliczeniowego jest odmawiana", async () => {
    const shop = plain;
    const { error } = await createOrder(shop, { p_payment_method: "online" });
    expect(error?.code).toBe(PG_INVALID_PARAMETER);
  });

  it("forma spoza słownika jest odmawiana", async () => {
    const shop = plain;
    const { error } = await createOrder(shop, { p_payment_method: "blik" });
    expect(error?.code).toBe(PG_INVALID_PARAMETER);
  });

  // -------------------------------------------------------------------
  // 6. Storefront działa dalej (bramki spójnościowe, nie wymagające)
  // -------------------------------------------------------------------

  it("checkout sklepu tworzy zamówienie kurierskie BEZ nowych pól i nie wchodzi na bramki", async () => {
    const shop = plain;
    const anon = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...realtimeTransport,
    });

    const { data, error } = await anon.schema("app").rpc("public_checkout", {
      p_tenant_id: shop.tenantId,
      p_email: `sklep-${randomUUID().slice(0, 8)}@test.local`,
      p_full_name: "Kupujący ze sklepu",
      p_phone: null,
      p_start_date: "2026-12-01",
      p_end_date: "2026-12-02",
      p_delivery_method: "courier",
      p_pickup_location_id: null,
      p_items: [{ product_id: shop.productId, quantity: 1 }],
      p_terms_version: "v1",
      p_locale: "pl",
      p_payment_method: "transfer",
    });
    expect(error).toBeNull();

    const row = await readOrder(admin, (data as { order_id: string }).order_id);
    // Zamówienie ze sklepu nie ma celu dostarczenia — i to jest POPRAWNY stan.
    expect(row.delivery_address_source).toBeNull();
    expect(row.delivery_point_code).toBeNull();
    // …a źródło ceny domyślnie mówi prawdę: policzył je cennik.
    expect(row.delivery_price_source).toBe("pricing");
  });
});
