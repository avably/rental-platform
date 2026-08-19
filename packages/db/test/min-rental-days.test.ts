/**
 * Testy minimalnego okresu najmu (migracja 0089, ADR-202):
 * `products.min_rental_days` + bramka NIEOBEJŚCIOWA w `app.public_checkout`.
 *
 * Cztery osie dowodu:
 *   1. EGZEKWOWANIE: najem krótszy niż minimum pozycji → odmowa PT422
 *      z hint='min_rental_days' i detail=liczbą minimum; ZERO śladu zapisu
 *      (ani zamówienia, ani klienta — transakcja wycofana w całości).
 *   2. GRANICA INCLUSIVE: liczenie dni w SQL ≡ rentalDaysInclusive
 *      (@avably/core): 25→27.08 przy min=3 to DOKŁADNIE 3 doby i MA przejść;
 *      25→26 (2 doby) odpada. Rozjazd o jeden dzień = czerwień na granicy.
 *   3. ZERO REGRESU: produkt z domyślnym minimum (1) przyjmuje najem
 *      jednodniowy (start = end) jak przed 0089.
 *   4. IZOLACJA + ADR-181: minimum jednego najemcy nie dotyka checkoutu
 *      drugiego (pole per produkt), a odpowiedź odmowy dla anon nie niesie
 *      identyfikatorów (skan igłami + kontrola pozytywna skanu).
 *
 * Wywołania idą jako ANON przez PostgREST — to zarazem dowód, że klasa PT422
 * NIE jest maskowana do 500 (jak P0xxx, pomiar przy 0088/ADR-199) i że kod,
 * detail oraz hint docierają do warstwy TS, która składa zdanie „minimum X dni".
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_* — patrz
 * helpers/seed-tenants.ts. Bez nich plik jest pomijany (strażnik jawności).
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { rentalDaysInclusive } from "@avably/core";

import { integrationEnv } from "./helpers/integration-env";
import { publishLegalDocuments } from "./helpers/publish-legal-documents";

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

async function seedTenant(admin: SupabaseClient): Promise<string> {
  const slug = `minokres-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: "Min okres test", status: "active", locale: "pl" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać tenanta: ${error?.message}`);
  createdTenantIds.push(data.id as string);
  // Komplet dokumentów prawnych — bez nich odmawia bramka 0086, a nie 0089,
  // i cała suita dowodziłaby cudzej bramki.
  await publishLegalDocuments(admin, data.id as string);
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
      // Bufory 0: dowodzimy bramki MINIMUM, nie kolizji buforowych.
      buffer_before_days: 0,
      buffer_after_days: 0,
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać produktu: ${error?.message}`);
  return data.id as string;
}

async function seedUnits(
  admin: SupabaseClient,
  tenantId: string,
  productId: string,
  count: number,
): Promise<void> {
  const rows = Array.from({ length: count }, () => ({
    tenant_id: tenantId,
    product_id: productId,
    serial_number: `SN-${randomUUID().slice(0, 8)}`,
  }));
  const { error } = await admin.from("product_units").insert(rows);
  if (error) throw new Error(`Nie udało się zasiać egzemplarzy: ${error.message}`);
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

/** Wywołanie RPC jako ANON — realna ścieżka publiczna przez PostgREST. */
async function checkoutAsAnon(
  anon: SupabaseClient,
  tenantId: string,
  productId: string,
  pickupId: string,
  startDate: string,
  endDate: string,
  overrides: Record<string, unknown> = {},
) {
  return anon.schema("app").rpc("public_checkout", {
    p_tenant_id: tenantId,
    p_email: `mo-${randomUUID().slice(0, 8)}@test.local`,
    p_full_name: "Kupujący",
    p_phone: null,
    p_start_date: startDate,
    p_end_date: endDate,
    p_delivery_method: "pickup",
    p_pickup_location_id: pickupId,
    p_items: [{ product_id: productId, quantity: 1 }],
    p_terms_version: "v1",
    p_locale: "pl",
    ...overrides,
  });
}

/** Liczba zamówień tenanta — dowód „zero śladu zapisu". */
async function orderCount(admin: SupabaseClient, tenantId: string): Promise<number> {
  const { count, error } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function customerCount(admin: SupabaseClient, tenantId: string): Promise<number> {
  const { count, error } = await admin
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * SKAN ODPOWIEDZI DLA ANON (ADR-181) — igły dwóch klas jak w suicie 0082:
 * konkretne wartości fikstury ORAZ kształty (dowolny uuid, format numeru
 * zamówienia). detail='3' jest liczbą minimum i ŚWIADOMIE nie jest igłą —
 * to reguła oferty ustawiona dla klientów, nie identyfikator.
 */
interface LeakNeedle {
  name: string;
  hit: (haystack: string) => boolean;
}

function leakNeedles(productId: string, unitLikeUuid: string): LeakNeedle[] {
  return [
    { name: "uuid produktu", hit: (h) => h.includes(productId) },
    { name: "uuid egzemplarza", hit: (h) => h.includes(unitLikeUuid) },
    { name: "format numeru zamówienia", hit: (h) => /\b[A-Z0-9]{2,10}-\d{4}-\d{3,}\b/u.test(h) },
    {
      name: "dowolny uuid",
      hit: (h) => /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu.test(h),
    },
  ];
}

function leaksIn(haystack: string, needles: LeakNeedle[]): string[] {
  return needles.filter((needle) => needle.hit(haystack)).map((needle) => needle.name);
}

describe.skipIf(!hasEnv)("products.min_rental_days + bramka w app.public_checkout — 0089 (ADR-202)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
      createdTenantIds.length = 0;
    }
  });

  // -------------------------------------------------------------------
  // 1. EGZEKWOWANIE + ADR-181 (skan odpowiedzi)
  // -------------------------------------------------------------------
  it("najem 2-dniowy przy minimum 3 → PT422 (hint=min_rental_days, detail=3), zero śladu zapisu", async () => {
    // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie bramki [0089] z app.public_checkout
    // (dowód mutacyjny a) — zamówienie krótsze niż minimum przechodzi, error
    // jest null i pierwsza asercja pali. Nic tej ścieżki nie maskuje: produkt
    // ma wolny egzemplarz, dokumenty są opublikowane, tenant aktywny.
    const tenantId = await seedTenant(admin);
    const productId = await seedProduct(admin, tenantId, { min_rental_days: 3 });
    await seedUnits(admin, tenantId, productId, 1);
    const pickupId = await seedPickupLocation(admin, tenantId);

    const { data, error } = await checkoutAsAnon(
      anon, tenantId, productId, pickupId,
      "2026-08-25", "2026-08-26", // 2 doby INCLUSIVE < minimum 3
    );

    expect(error, "checkout 2-dniowy przy minimum 3 PRZESZEDŁ — bramki 0089 nie ma").not.toBeNull();
    // Klasa PT dociera do anon przez PostgREST z kodem, detail i hint —
    // gdyby bramka rzucała P0xxx, tu byłoby zamaskowane 500 bez kodu
    // (pomiar 0088/ADR-199) i warstwa TS nie miałaby z czego złożyć zdania.
    expect(error?.code, `oczekiwano PT422, było ${error?.code}: ${error?.message}`).toBe("PT422");
    expect(error?.hint, "odmowa nie niesie znacznika kategorii").toBe("min_rental_days");
    expect(error?.details, "detail ma nieść SAMĄ liczbę minimum").toBe("3");
    expect(data).toBeNull();

    // ZERO ŚLADU: transakcja wycofana w całości — ani zamówienia, ani
    // klienta-sieroty (klient powstaje PRZED pętlą pozycji, więc bez
    // wycofania zostałby w bazie).
    expect(await orderCount(admin, tenantId), "odmowa zostawiła zamówienie").toBe(0);
    expect(await customerCount(admin, tenantId), "odmowa zostawiła klienta-sierotę").toBe(0);

    // SKAN ADR-181: cała surowa odpowiedź (message+details+hint+code naraz).
    const surowa = JSON.stringify({ data, error });
    const igly = leakNeedles(productId, tenantId);
    expect(
      leaksIn(surowa, igly),
      `odpowiedź dla anon niesie dane, których klient znać nie może: ${surowa}`,
    ).toEqual([]);

    // Treść docelowa — przypięta PO skanie (osobna czerwień na korektę
    // brzmienia, żeby nie przebierała się za wyciek).
    expect(error?.message).toBe(
      "Wybrany okres najmu jest krótszy niż minimalny okres najmu tej pozycji.",
    );

    // KONTROLA POZYTYWNA SKANU: odpowiedź SPREPAROWANA z identyfikatorem
    // i numerem zamówienia — skan musi trafić wszystkie igły, inaczej „zero
    // trafień" wyżej dowodzi tylko ślepoty skanu.
    const spreparowana = JSON.stringify({
      data: null,
      error: {
        code: "PT422",
        message: `Produkt ${productId} wynajmuje się na minimum 3 dni (zamówienie ${tenantId} odrzucone, por. ORD-2026-001).`,
        details: null,
        hint: null,
      },
    });
    expect(
      leaksIn(spreparowana, igly),
      "skan nie wykrył wycieku w odpowiedzi spreparowanej — jest dekoracją, nie bramką",
    ).toEqual(igly.map((needle) => needle.name));
  });

  // -------------------------------------------------------------------
  // 2. GRANICA INCLUSIVE — SQL ≡ rentalDaysInclusive
  // -------------------------------------------------------------------
  it("granica INCLUSIVE: 25→27.08 przy minimum 3 to DOKŁADNIE 3 doby i przechodzi", async () => {
    // Kotwica konwencji PO STRONIE TS — ta sama para dat, którą za chwilę
    // dostanie SQL. Gdyby ktoś przepisał rentalDaysInclusive na EXCLUSIVE,
    // ta asercja pali PIERWSZA i mówi wprost, że rozjechały się konwencje.
    expect(rentalDaysInclusive("2026-08-25", "2026-08-27")).toBe(3);

    // CO MUSIAŁOBY SIĘ ZEPSUĆ: liczenie dni w SQL na EXCLUSIVE
    // (`end - start` zamiast `+ 1`, dowód mutacyjny b) — SQL policzyłby
    // 2 < 3 i odmówił terminu, który wg konwencji INCLUSIVE jest legalny;
    // asercja `error → null` pali. Rozjazd o jeden dzień nie ma się gdzie
    // schować: test stoi DOKŁADNIE na granicy.
    const tenantId = await seedTenant(admin);
    const productId = await seedProduct(admin, tenantId, { min_rental_days: 3 });
    await seedUnits(admin, tenantId, productId, 1);
    const pickupId = await seedPickupLocation(admin, tenantId);

    const { data, error } = await checkoutAsAnon(
      anon, tenantId, productId, pickupId,
      "2026-08-25", "2026-08-27", // 3 doby INCLUSIVE = minimum 3
    );

    expect(error, `najem RÓWNY minimum odrzucony (rozjazd SQL↔TS o 1 dzień?): ${error?.message}`).toBeNull();
    expect((data as { order_number?: string })?.order_number).toBeTruthy();
    expect(await orderCount(admin, tenantId)).toBe(1);
  });

  // -------------------------------------------------------------------
  // 3. ZERO REGRESU dla default 1
  // -------------------------------------------------------------------
  it("produkt z domyślnym minimum (1): najem jednodniowy start=end przechodzi", async () => {
    const tenantId = await seedTenant(admin);
    // BEZ min_rental_days w insercie — działa default kolumny z 0089,
    // dokładnie ten, który dostały wszystkie pozycje istniejące przed migracją.
    const productId = await seedProduct(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 1);
    const pickupId = await seedPickupLocation(admin, tenantId);

    const { error } = await checkoutAsAnon(
      anon, tenantId, productId, pickupId,
      "2026-08-25", "2026-08-25", // 1 doba (start = end) — najkrótszy legalny najem
    );

    expect(error, `najem 1-dniowy przy default 1 odrzucony (regres): ${error?.message}`).toBeNull();
    expect(await orderCount(admin, tenantId)).toBe(1);
  });

  // -------------------------------------------------------------------
  // 4. IZOLACJA: minimum per produkt, nie per platforma
  // -------------------------------------------------------------------
  it("minimum najemcy A nie dotyka checkoutu najemcy B; w zamówieniu decyduje KAŻDA pozycja", async () => {
    // Najemca A ustawia surowe minimum 5 — i to jest JEGO reguła.
    const tenantA = await seedTenant(admin);
    const productA = await seedProduct(admin, tenantA, { min_rental_days: 5 });
    await seedUnits(admin, tenantA, productA, 1);
    const pickupA = await seedPickupLocation(admin, tenantA);

    // Najemca B z produktem bez ograniczenia: najem 2-dniowy przechodzi,
    // choćby A miał minimum 5 — pole żyje na wierszu produktu (RLS + odczyt
    // po (tenant_id, id) w definerze), nie w żadnym stanie globalnym.
    const tenantB = await seedTenant(admin);
    const productB = await seedProduct(admin, tenantB);
    await seedUnits(admin, tenantB, productB, 1);
    const pickupB = await seedPickupLocation(admin, tenantB);

    const wynikB = await checkoutAsAnon(
      anon, tenantB, productB, pickupB, "2026-08-25", "2026-08-26",
    );
    expect(wynikB.error, `minimum najemcy A zablokowało najemcę B: ${wynikB.error?.message}`).toBeNull();

    // A dostaje odmowę na 2 dobach — kontrola pozytywna izolacji (gdyby
    // bramka w ogóle nie czytała pola, oba checkouty by przeszły i „izolacja"
    // wyżej byłaby dowodem próżniowym).
    const wynikA = await checkoutAsAnon(
      anon, tenantA, productA, pickupA, "2026-08-25", "2026-08-26",
    );
    expect(wynikA.error?.code).toBe("PT422");
    expect(wynikA.error?.details).toBe("5");

    // W JEDNYM zamówieniu decyduje każda pozycja z osobna: produkt bez
    // ograniczenia nie przemyca pozycji z minimum — odmowa wycofuje CAŁE
    // zamówienie (u najemcy B: produkt swobodny + produkt z minimum 3).
    const productB3 = await seedProduct(admin, tenantB, { min_rental_days: 3 });
    await seedUnits(admin, tenantB, productB3, 1);
    const przedMieszanym = await orderCount(admin, tenantB);
    const mieszane = await checkoutAsAnon(anon, tenantB, productB, pickupB, "2026-09-01", "2026-09-02", {
      p_items: [
        { product_id: productB, quantity: 1 },
        { product_id: productB3, quantity: 1 },
      ],
    });
    expect(mieszane.error?.code, "pozycja z minimum przemycona w zamówieniu mieszanym").toBe("PT422");
    expect(mieszane.error?.details).toBe("3");
    expect(await orderCount(admin, tenantB), "odmowa mieszana zostawiła zamówienie").toBe(przedMieszanym);
  });

  // -------------------------------------------------------------------
  // 5. CHECK kolumny: minimum < 1 jest niereprezentowalne
  // -------------------------------------------------------------------
  it("min_rental_days = 0 nie wchodzi do bazy (CHECK >= 1) — nawet service_rolem", async () => {
    const tenantId = await seedTenant(admin);
    const { error } = await admin.from("products").insert({
      tenant_id: tenantId,
      name: "Zero minimum",
      base_price_day_grosze: 10_000,
      min_rental_days: 0,
    });
    expect(error, "CHECK products_min_rental_days_check nie zadziałał").not.toBeNull();
    expect(error?.code).toBe("23514");
  });
});
