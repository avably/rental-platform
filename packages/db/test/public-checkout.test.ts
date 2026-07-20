/**
 * Testy publicznej ścieżki checkoutu storefrontu (Zadanie 2.4a, migracja
 * 0020_public_checkout.sql; ADR-042).
 *
 * To jest ścieżka PIENIĘDZY i IZOLACJI — dowody mutacyjne są obowiązkowe.
 * Test dowodzi czterech osi:
 *   1. WYŚCIG: dwa równoległe public_checkout o ostatni egzemplarz → dokładnie
 *      jeden sukces, drugi 23P01 (bramka 0010: advisory lock + re-check).
 *   2. KWOTY Z SERWERA: wejście NIE niesie kwot; utrwalone sumy = wynik silnika
 *      @avably/core (calculatePrice). Klient nie ma parametru ceny.
 *   3. IZOLACJA: checkout na tenancie nieaktywnym → 22023; get_public_catalog
 *      nie zwraca produktów cudzych/nieaktywnych ani credentiali; NULL dla
 *      tenanta nieaktywnego.
 *   4. DOSTĘPNOŚĆ: get_public_availability zwraca liczby (available/total) i
 *      NULL dla zakresu odwróconego / tenanta nieaktywnego.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_* — patrz
 * helpers/seed-tenants.ts. Bez nich plik jest pomijany (strażnik jawności).
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { calculatePrice } from "@avably/core";

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

const createdTenantIds: string[] = [];

async function seedTenant(admin: SupabaseClient, status: string): Promise<string> {
  const slug = `checkout-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: `Checkout test ${status}`, status, locale: "pl" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać tenanta (${status}): ${error?.message}`);
  createdTenantIds.push(data.id as string);
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
      buffer_before_days: 1,
      buffer_after_days: 1,
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać produktu: ${error?.message}`);
  return data.id as string;
}

async function seedPickupLocation(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data, error } = await admin
    .from("pickup_locations")
    .insert({ tenant_id: tenantId, name: "Magazyn", address_city: "Warszawa" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać punktu odbioru: ${error?.message}`);
  return data.id as string;
}

async function seedUnits(admin: SupabaseClient, tenantId: string, productId: string, count: number) {
  const rows = Array.from({ length: count }, () => ({
    tenant_id: tenantId,
    product_id: productId,
    serial_number: `SN-${randomUUID().slice(0, 8)}`,
  }));
  const { error } = await admin.from("product_units").insert(rows);
  if (error) throw new Error(`Nie udało się zasiać egzemplarzy: ${error.message}`);
}

/** Wywołanie RPC jako ANON (bramka grantu + realna ścieżka publiczna). */
async function checkoutAsAnon(anon: SupabaseClient, args: Record<string, unknown>) {
  return anon.schema("app").rpc("public_checkout", args);
}

const createdUserIds: string[] = [];

/** Owner tenanta (auth user + wiersz members) — do testu PII notify_email. */
async function seedOwner(admin: SupabaseClient, tenantId: string): Promise<string> {
  const email = `owner-checkout-${randomUUID().slice(0, 8)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "CheckoutTest!12345678",
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role: "owner" },
  });
  if (error || !data.user) throw new Error(`Nie udało się utworzyć ownera: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const { error: memberError } = await admin
    .from("members")
    .insert({ tenant_id: tenantId, user_id: data.user.id, role: "owner" });
  if (memberError) throw new Error(`Nie udało się dodać membera-ownera: ${memberError.message}`);
  return email;
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

describe.skipIf(!hasEnv)("app.public_checkout / get_public_catalog / get_public_availability — 0020", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
    createdUserIds.length = 0;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
      createdTenantIds.length = 0;
    }
  });

  // -------------------------------------------------------------------
  // 1. WYŚCIG o ostatni egzemplarz
  // -------------------------------------------------------------------
  it("dwa równoległe checkouty o JEDEN egzemplarz → dokładnie jeden sukces, drugi 23P01", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId);
    const pickupId = await seedPickupLocation(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 1); // dokładnie jeden

    const call = (sql: postgres.Sql) => sql`
      select app.public_checkout(
        ${tenantId}, ${`race-${randomUUID().slice(0, 8)}@test.local`}, 'Kupujący', null,
        '2026-10-01', '2026-10-03', 'pickup', ${pickupId},
        ${sql.json([{ product_id: productId, quantity: 1 }])}, 'v1', 'pl'
      ) as j`;

    // Dwa NIEZALEŻNE połączenia = realna współbieżność na żywej bazie.
    const sqlA = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    const sqlB = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    try {
      const results = await Promise.allSettled([call(sqlA), call(sqlB)]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

      // DOWÓD MUTACYJNY: bramką wyścigu jest advisory lock + re-check w
      // app.assert_unit_available (0010). Gdy się ją WYŁĄCZY (np. `return` na
      // wejściu funkcji albo usunięcie re-checku), OBA checkouty przypisują ten
      // sam egzemplarz i OBA kończą się sukcesem — ten assert (ok === 1) staje
      // się czerwony (2 !== 1). Ścieżki mutacji NIC nie maskuje: advisory lock
      // numeracji (generate_order_number) serializuje INSERT zamówień, ale NIE
      // dotyka egzemplarzy — nawet w pełni zserializowany drugi checkout musi
      // odrzucić zajętą sztukę re-checkiem, więc to bramka egzemplarza, a nie
      // numeracja, decyduje (lekcja ADR-024 o maskowaniu przez cudzy lock).
      expect(ok, `oczekiwano dokładnie 1 sukcesu, było ${ok.length}`).toHaveLength(1);
      expect(failed, `oczekiwano dokładnie 1 odmowy, było ${failed.length}`).toHaveLength(1);
      expect(
        (failed[0]?.reason as { code?: string })?.code,
        "odmowa wyścigu musi nieść 23P01 (egzemplarz zajęty)",
      ).toBe("23P01");

      // Po wyścigu istnieje DOKŁADNIE jedno zamówienie na tym tenancie.
      const [{ count }] = await sqlA`select count(*)::int from public.orders where tenant_id = ${tenantId}`;
      expect(count, "wyścig zostawił inną liczbę zamówień niż 1").toBe(1);
    } finally {
      await sqlA.end({ timeout: 5 });
      await sqlB.end({ timeout: 5 });
    }
  });

  // -------------------------------------------------------------------
  // 2. KWOTY LICZY SERWER (klient nie zaniży ceny)
  // -------------------------------------------------------------------
  it("sumy zamówienia = wynik silnika @avably/core (wejście nie niesie kwot)", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId, {
      base_price_day_grosze: 12_000,
      deposit_grosze: 8_000,
      auto_increment_multiplier: 1.0,
    });
    await seedUnits(admin, tenantId, productId, 2);
    const pickupId = await seedPickupLocation(admin, tenantId);
    // Próg: 7 dni = 6.5× ceny dziennej (rabat) — musi zadziałać serwerowo.
    const { error: tierError } = await admin.from("pricing_tiers").insert({
      tenant_id: tenantId,
      product_id: productId,
      tier_days: 7,
      multiplier: 6.5,
      label: "tydzień",
    });
    if (tierError) throw new Error(tierError.message);

    // Najem 7-dniowy (INCLUSIVE): 2026-10-01..2026-10-07.
    const expected = calculatePrice("2026-10-01", "2026-10-07", {
      basePriceDayGrosze: 12_000,
      depositGrosze: 8_000,
      autoIncrementMultiplier: 1.0,
      tiers: [{ tierDays: 7, multiplier: 6.5 }],
    });

    const { data, error } = await checkoutAsAnon(anon, {
      p_tenant_id: tenantId,
      p_email: `price-${randomUUID().slice(0, 8)}@test.local`,
      p_full_name: "Kupujący",
      p_phone: null,
      p_start_date: "2026-10-01",
      p_end_date: "2026-10-07",
      p_delivery_method: "pickup",
      p_pickup_location_id: pickupId,
      p_items: [{ product_id: productId, quantity: 2 }],
      p_terms_version: "v1",
      p_locale: "pl",
    });
    expect(error, `checkout jako anon zawiódł: ${error?.message}`).toBeNull();

    const summary = data as {
      total_rental_grosze: number;
      total_deposit_grosze: number;
      order_number: string;
    };
    // Dwie sztuki po cenie progu; kaucja per sztuka.
    expect(summary.total_rental_grosze).toBe(expected.rentalGrosze * 2);
    expect(summary.total_deposit_grosze).toBe(expected.depositGrosze * 2);

    // DOWÓD MUTACYJNY (kwoty z serwera): funkcja NIE MA parametru kwoty — klient
    // nie ma jak jej podać. Gdyby wprowadzić parametr `p_total_rental` i wstawiać
    // go zamiast obliczenia, ten assert (== wynik silnika) rozjechałby się z
    // dowolną kwotą podaną przez klienta. Utrwalona suma czytana z bazy
    // potwierdza, że zapisano policzone serwerowo, nie przysłane.
    const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    try {
      const [row] = await sql`
        select total_rental_grosze, total_deposit_grosze
        from public.orders where tenant_id = ${tenantId} and order_number = ${summary.order_number}`;
      expect(row.total_rental_grosze).toBe(expected.rentalGrosze * 2);
      expect(row.total_deposit_grosze).toBe(expected.depositGrosze * 2);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  // -------------------------------------------------------------------
  // 3. IZOLACJA
  // -------------------------------------------------------------------
  it("checkout na tenancie NIEAKTYWNYM → 22023 (nieodróżnialny od nieistniejącego)", async () => {
    const suspended = await seedTenant(admin, "suspended");
    const productId = await seedProduct(admin, suspended);
    const pickupId = await seedPickupLocation(admin, suspended);
    await seedUnits(admin, suspended, productId, 1);

    // Wejście POZA TYM jest w pełni poprawne (punkt odbioru, egzemplarz,
    // regulamin) — jedyną przyczyną odmowy MA BYĆ status tenanta. Bez tego
    // (np. gdyby punkt był null) odmowę dałaby walidacja punktu i zamaskowała,
    // czy bramka statusu w ogóle działa.
    const { data, error } = await checkoutAsAnon(anon, {
      p_tenant_id: suspended,
      p_email: `susp-${randomUUID().slice(0, 8)}@test.local`,
      p_full_name: "Kupujący",
      p_phone: null,
      p_start_date: "2026-10-01",
      p_end_date: "2026-10-03",
      p_delivery_method: "pickup",
      p_pickup_location_id: pickupId,
      p_items: [{ product_id: productId, quantity: 1 }],
      p_terms_version: "v1",
      p_locale: "pl",
    });

    // DOWÓD MUTACYJNY: rozluźnienie bramki statusu w public_checkout
    // (dopuszczenie 'suspended') sprawi, że checkout przejdzie i `error` będzie
    // null — ten assert (kod 22023) się spali. Nieaktywny sklep nie może
    // przyjmować zamówień.
    expect(data).toBeNull();
    expect(error?.code).toBe("22023");
  });

  it("get_public_catalog: NULL dla nieaktywnego, tylko własne aktywne produkty, ZERO credentiali", async () => {
    const active = await seedTenant(admin, "active");
    const otherTenant = await seedTenant(admin, "active");
    await seedProduct(admin, active, { name: "WIDOCZNY" });
    await seedProduct(admin, active, { name: "UKRYTY_NIEAKTYWNY", active: false });
    await seedProduct(admin, otherTenant, { name: "CUDZY" });
    // Konfiguracja kurierska — NIE MOŻE wyciec do katalogu. Od 0024 (ADR-052)
    // dzieli się na dwie tabele, więc katalog musi milczeć o OBU: część jawna
    // w tenant_settings i koperta sekretu w tenant_secrets.
    const { error: credError } = await admin.from("tenant_settings").insert({
      tenant_id: active,
      key: "globkurier_credentials",
      value: { email: "TOPSECRET_EMAIL@x", environment: "test" },
    });
    if (credError) throw new Error(credError.message);

    const { error: secretError } = await admin.from("tenant_secrets").insert({
      tenant_id: active,
      key: "globkurier_password",
      ciphertext: "v1:1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB:TOPSECRETCIPHER",
      key_version: 1,
    });
    if (secretError) throw new Error(secretError.message);

    const { data, error } = await anon.schema("app").rpc("get_public_catalog", { p_tenant_id: active });
    expect(error, `get_public_catalog jako anon zawiódł: ${error?.message}`).toBeNull();

    const catalog = data as { products: { id: string; name: string }[] };
    const names = catalog.products.map((p) => p.name);

    // DOWÓD MUTACYJNY (izolacja produktów): zdjęcie warunku `p.active` w funkcji
    // wpuści UKRYTY_NIEAKTYWNY; zmiana `p.tenant_id = t.id` wpuści CUDZY — oba
    // asserty poniżej się spalą.
    expect(names).toContain("WIDOCZNY");
    expect(names).not.toContain("UKRYTY_NIEAKTYWNY");
    expect(names).not.toContain("CUDZY");

    // DOWÓD MUTACYJNY (brak credentiali): gdyby funkcja zwracała surowe wiersze
    // tenant_settings zamiast tylko delivery_pricing, TOPSECRET_EMAIL
    // pojawiłby się w JSON-ie i ten assert by się spalił. Druga asercja
    // pilnuje, żeby przy rozszerzaniu katalogu nikt nie dociągnął do niego
    // tabeli sekretów — nawet zaszyfrowanej.
    expect(JSON.stringify(catalog)).not.toContain("TOPSECRET_EMAIL");
    expect(JSON.stringify(catalog)).not.toContain("TOPSECRETCIPHER");

    // Tenant nieaktywny → NULL (bramka statusu).
    const suspended = await seedTenant(admin, "suspended");
    const { data: nullData } = await anon
      .schema("app")
      .rpc("get_public_catalog", { p_tenant_id: suspended });
    expect(nullData, "nieaktywny tenant zwrócił katalog zamiast NULL").toBeNull();
  });

  // -------------------------------------------------------------------
  // 4. DOSTĘPNOŚĆ (kształt: liczby, bez danych zamówień)
  // -------------------------------------------------------------------
  it("get_public_availability: {available,total}, spada po zamówieniu, NULL dla zakresu odwróconego", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId);
    const pickupId = await seedPickupLocation(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 3);

    const before = (
      await anon.schema("app").rpc("get_public_availability", {
        p_tenant_id: tenantId,
        p_product_id: productId,
        p_start_date: "2026-11-01",
        p_end_date: "2026-11-05",
      })
    ).data as { available_units: number; total_units: number };
    expect(before).toEqual({ available_units: 3, total_units: 3 });

    // Złóż zamówienie na 1 sztukę → dostępność spada do 2.
    await checkoutAsAnon(anon, {
      p_tenant_id: tenantId,
      p_email: `av-${randomUUID().slice(0, 8)}@test.local`,
      p_full_name: "Kupujący",
      p_phone: null,
      p_start_date: "2026-11-01",
      p_end_date: "2026-11-05",
      p_delivery_method: "pickup",
      p_pickup_location_id: pickupId,
      p_items: [{ product_id: productId, quantity: 1 }],
      p_terms_version: "v1",
      p_locale: "pl",
    });

    const after = (
      await anon.schema("app").rpc("get_public_availability", {
        p_tenant_id: tenantId,
        p_product_id: productId,
        p_start_date: "2026-11-01",
        p_end_date: "2026-11-05",
      })
    ).data as { available_units: number; total_units: number };
    // DOWÓD MUTACYJNY: usunięcie klauzuli `not exists (... blokujące statusy ...)`
    // sprawi, że available_units nie spadnie (zostanie 3) — assert się spali.
    expect(after).toEqual({ available_units: 2, total_units: 3 });

    // Zakres odwrócony → NULL (nie błąd, nie 0).
    const reversed = (
      await anon.schema("app").rpc("get_public_availability", {
        p_tenant_id: tenantId,
        p_product_id: productId,
        p_start_date: "2026-11-05",
        p_end_date: "2026-11-01",
      })
    ).data;
    expect(reversed).toBeNull();
  });

  // -------------------------------------------------------------------
  // 5. PII: notify_email NIGDY z auth.users (znalezisko recenzji 2.4a)
  // -------------------------------------------------------------------
  it("bez email_sender.reply_to notify_email = null — e-mail ownera z auth.users NIE wycieka", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId);
    const pickupId = await seedPickupLocation(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 1);
    // Tenant MA ownera z prywatnym e-mailem konta, ale NIE ma email_sender —
    // dokładnie scenariusz wycieku: stara wersja funkcji zwracała tu adres
    // ownera każdemu bezpośredniemu wołającemu z anon keyem.
    const ownerEmail = await seedOwner(admin, tenantId);

    const { data, error } = await checkoutAsAnon(anon, checkoutArgs(tenantId, productId, pickupId));
    expect(error, `checkout zawiódł: ${error?.message}`).toBeNull();

    // DOWÓD (fix znaleziska 1): odpowiedź RPC — czytana przez KAŻDEGO
    // bezpośredniego wołającego — nie niesie prywatnego adresu konta ownera.
    // Gdyby fallback coalesce(v_reply_to, v_owner_email) wrócił, oba asserty
    // się palą: notify_email przestaje być null i JSON zawiera ownerEmail.
    expect((data as { notify_email: string | null }).notify_email).toBeNull();
    expect(JSON.stringify(data)).not.toContain(ownerEmail);
  });

  /**
   * log_token (0021/ADR-045, znalezisko recenzji 2.8): checkout WYDAJE token
   * jednorazowy i zwraca go w odpowiedzi. Bez niego zapis do dziennika wysyłek
   * dałoby się wykonać samymi danymi publicznymi (tenant_id jest jawny,
   * order_number sekwencyjny), więc historia byłaby fałszowalna.
   *
   * To także REGRESJA redefinicji funkcji w 0021: gdyby odtworzone ciało
   * zgubiło zapis tokenu, kolumna zostałaby NULL-em i bramka dziennika
   * odcięłaby całą ścieżkę checkoutu.
   */
  it("checkout wydaje log_token i utrwala go w orders (ADR-045)", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId);
    const pickupId = await seedPickupLocation(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 1);

    const { data, error } = await checkoutAsAnon(anon, checkoutArgs(tenantId, productId, pickupId));
    expect(error, `checkout zawiódł: ${error?.message}`).toBeNull();

    const result = data as { order_number: string; log_token: string };
    expect(result.log_token, "odpowiedź RPC musi nieść log_token").toEqual(expect.any(String));

    // Zwrócona wartość MUSI zgadzać się z utrwaloną kolumną — inaczej token
    // byłby ozdobnym uuid, którym nie da się otworzyć bramki dziennika.
    const { data: order } = await admin
      .from("orders")
      .select("checkout_log_token")
      .eq("tenant_id", tenantId)
      .eq("order_number", result.order_number)
      .single();
    expect(order!.checkout_log_token).toBe(result.log_token);
  });

  it("każdy checkout dostaje INNY log_token", async () => {
    // Token stały albo wyprowadzony z danych zamówienia byłby odgadywalny —
    // a wtedy bramka dziennika chroniłaby dokładnie tyle, co jej brak.
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId);
    const pickupId = await seedPickupLocation(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 2);

    const first = await checkoutAsAnon(
      anon,
      checkoutArgs(tenantId, productId, pickupId, {
        p_start_date: "2026-10-01",
        p_end_date: "2026-10-01",
      }),
    );
    const second = await checkoutAsAnon(
      anon,
      checkoutArgs(tenantId, productId, pickupId, {
        p_start_date: "2026-11-05",
        p_end_date: "2026-11-05",
      }),
    );

    expect(first.error, `pierwszy checkout zawiódł: ${first.error?.message}`).toBeNull();
    expect(second.error, `drugi checkout zawiódł: ${second.error?.message}`).toBeNull();
    expect((first.data as { log_token: string }).log_token).not.toBe(
      (second.data as { log_token: string }).log_token,
    );
  });

  // -------------------------------------------------------------------
  // 6. THROTTLE w bazie (znalezisko recenzji 2.4a — DoS przez pending)
  // -------------------------------------------------------------------
  //
  // Bezpośrednie wywołanie RPC anon keyem omija honeypot/rate-limit/Turnstile
  // warstwy storefrontu, a pending blokuje egzemplarze — limit MUSI stać w
  // funkcji. Produkt z buforami 0 i najmy jednodniowe w różnych dniach: ta sama
  // sztuka obsługuje kolejne zamówienia bez kolizji dostępności, więc jedyną
  // bramką, która może odmówić, jest throttle (23P01 nie maskuje 22023).
  it("per klient: 3 publiczne pending/24h przechodzą (kontrola pozytywna), 4. → 22023", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId, {
      buffer_before_days: 0,
      buffer_after_days: 0,
    });
    const pickupId = await seedPickupLocation(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 1);
    const email = `throttle-${randomUUID().slice(0, 8)}@test.local`;

    // Kontrola pozytywna: legalny klient poniżej limitu przechodzi.
    for (const day of ["2026-12-01", "2026-12-03", "2026-12-05"]) {
      const { error } = await checkoutAsAnon(
        anon,
        checkoutArgs(tenantId, productId, pickupId, {
          p_email: email,
          p_start_date: day,
          p_end_date: day,
        }),
      );
      expect(error, `checkout ${day} poniżej limitu zawiódł: ${error?.message}`).toBeNull();
    }

    // DOWÓD MUTACYJNY (throttle per klient): zdjęcie limitu (`if false`) sprawia,
    // że 4. zamówienie przechodzi i `error` jest null — assert 22023 się pali.
    const { data, error } = await checkoutAsAnon(
      anon,
      checkoutArgs(tenantId, productId, pickupId, {
        p_email: email,
        p_start_date: "2026-12-07",
        p_end_date: "2026-12-07",
      }),
    );
    expect(data).toBeNull();
    expect(error?.code, "4. publiczne zamówienie klienta w 24h nie zostało zatrzymane").toBe("22023");

    // Odmowa nie zostawia śladu: dokładnie 3 zamówienia.
    const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    try {
      const [{ count }] = await sql`select count(*)::int from public.orders where tenant_id = ${tenantId}`;
      expect(count).toBe(3);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("per tenant: 30 publicznych pending/1h przechodzi, 31. → 22023 (różni klienci)", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId, {
      buffer_before_days: 0,
      buffer_after_days: 0,
    });
    const pickupId = await seedPickupLocation(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 1);

    // 30 zamówień RÓŻNYCH klientów (limit per klient 3 nie wchodzi w drogę),
    // każde na inny dzień (jedna sztuka, bufory 0 — zero kolizji dostępności).
    const day = (i: number) => `2027-01-${String(i + 1).padStart(2, "0")}`;
    for (let i = 0; i < 30; i += 1) {
      const { error } = await checkoutAsAnon(
        anon,
        checkoutArgs(tenantId, productId, pickupId, {
          p_start_date: day(i),
          p_end_date: day(i),
        }),
      );
      expect(error, `checkout #${i + 1} poniżej limitu tenanta zawiódł: ${error?.message}`).toBeNull();
    }

    // DOWÓD MUTACYJNY (throttle per tenant): zdjęcie limitu → 31. przechodzi,
    // assert 22023 się pali.
    const { data, error } = await checkoutAsAnon(
      anon,
      checkoutArgs(tenantId, productId, pickupId, {
        p_start_date: "2027-02-10",
        p_end_date: "2027-02-10",
      }),
    );
    expect(data).toBeNull();
    expect(error?.code, "31. publiczne zamówienie tenanta w 1h nie zostało zatrzymane").toBe("22023");
  });

  it("tenant z checkout_limits podniesionym (per_tenant_1h=50) przechodzi 31. zamówienie", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId, {
      buffer_before_days: 0,
      buffer_after_days: 0,
    });
    const pickupId = await seedPickupLocation(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 1);
    // Operator podniósł WŁASNY limit (duża wypożyczalnia w sezonie) — klucz
    // tenant_settings, zapis ograniczony RLS do członków tenanta (tu seed
    // service-rolem). Default 30/1h zatrzymałby 31. zamówienie (dowiedzione
    // testem wyżej); z limitem 50 musi przejść.
    const { error: limitError } = await admin.from("tenant_settings").insert({
      tenant_id: tenantId,
      key: "checkout_limits",
      value: { per_tenant_1h: 50, per_customer_24h: 3 },
    });
    if (limitError) throw new Error(limitError.message);

    const day = (i: number) => new Date(Date.UTC(2027, 5, 1 + i)).toISOString().slice(0, 10);
    for (let i = 0; i < 31; i += 1) {
      const { error } = await checkoutAsAnon(
        anon,
        checkoutArgs(tenantId, productId, pickupId, {
          p_start_date: day(i),
          p_end_date: day(i),
        }),
      );
      expect(
        error,
        `checkout #${i + 1} przy podniesionym limicie (50/1h) zawiódł: ${error?.message}`,
      ).toBeNull();
    }
  });

  it("checkout_limits ze śmieciem (-1 / string) → działają defaulty, checkout nie pada", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId, {
      buffer_before_days: 0,
      buffer_after_days: 0,
    });
    const pickupId = await seedPickupLocation(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 1);
    // Śmieciowa konfiguracja: ujemna liczba i string. Coalesce-guard w funkcji
    // MUSI zignorować obie wartości i spaść na defaulty (3/24h, 30/1h) —
    // zepsuty wpis nie ma prawa ani zablokować sklepu, ani zdjąć throttle'u.
    const { error: limitError } = await admin.from("tenant_settings").insert({
      tenant_id: tenantId,
      key: "checkout_limits",
      value: { per_tenant_1h: -1, per_customer_24h: "abc" },
    });
    if (limitError) throw new Error(limitError.message);

    const email = `garbage-${randomUUID().slice(0, 8)}@test.local`;

    // DOWÓD MUTACYJNY (coalesce-guard): naiwny odczyt bez guardu
    // (`coalesce((value->>'per_tenant_1h')::int, 30)`) daje limit -1 —
    // count 0 >= -1 odrzuca JUŻ PIERWSZE zamówienie i te asserty się palą.
    for (const d of ["2027-07-01", "2027-07-03", "2027-07-05"]) {
      const { error } = await checkoutAsAnon(
        anon,
        checkoutArgs(tenantId, productId, pickupId, {
          p_email: email,
          p_start_date: d,
          p_end_date: d,
        }),
      );
      expect(error, `checkout ${d} przy śmieciowym checkout_limits zawiódł: ${error?.message}`).toBeNull();
    }

    // Defaulty realnie obowiązują: 4. zamówienie tego samego klienta w 24h
    // odbija się na domyślnym limicie 3 — śmieć nie zdjął throttle'u.
    const { error } = await checkoutAsAnon(
      anon,
      checkoutArgs(tenantId, productId, pickupId, {
        p_email: email,
        p_start_date: "2027-07-07",
        p_end_date: "2027-07-07",
      }),
    );
    expect(error?.code, "śmieciowy checkout_limits zdjął domyślny throttle").toBe("22023");
  });

  it("zamówienia z panelu (source='panel') NIE zjadają budżetu throttle'u klienta", async () => {
    const tenantId = await seedTenant(admin, "active");
    const productId = await seedProduct(admin, tenantId, {
      buffer_before_days: 0,
      buffer_after_days: 0,
    });
    const pickupId = await seedPickupLocation(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 1);
    const email = `panelmix-${randomUUID().slice(0, 8)}@test.local`;

    // Klient istnieje i ma JUŻ 3 zamówienia pending/unpaid założone przez ladę
    // (source='panel' — default kolumny; INSERT service-rolem symuluje pracę
    // panelu). Filtr source='storefront' w throttle'u musi je pominąć.
    const { data: customer, error: custError } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, email, full_name: "Stały klient" })
      .select("id")
      .single();
    if (custError || !customer) throw new Error(custError?.message);
    for (const day of ["2026-12-10", "2026-12-12", "2026-12-14"]) {
      const { error } = await admin.from("orders").insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        start_date: day,
        end_date: day,
        delivery_method: "courier",
      });
      if (error) throw new Error(error.message);
    }

    // Publiczny checkout tego samego klienta przechodzi — gdyby throttle liczył
    // wszystkie zamówienia (bez filtra source), poległby tu na 22023.
    const { error } = await checkoutAsAnon(
      anon,
      checkoutArgs(tenantId, productId, pickupId, {
        p_email: email,
        p_start_date: "2026-12-20",
        p_end_date: "2026-12-20",
      }),
    );
    expect(error, `praca lady zablokowała publiczny checkout klienta: ${error?.message}`).toBeNull();
  });
});
