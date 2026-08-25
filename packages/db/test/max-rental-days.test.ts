/**
 * Testy SUFITU ANTYNADUŻYCIOWEGO długości najmu (migracja 0110, ADR-268):
 * bramka NIEOBEJŚCIOWA `v_days > c_max_rental_days` w `app.public_checkout`.
 *
 * Trzy osie dowodu:
 *   1. EGZEKWOWANIE: najem dłuższy niż sufit (w tym atak start=2026-01-01…
 *      end=9999-12-31) → odmowa 22023; ZERO śladu zapisu (ani zamówienia,
 *      ani klienta — transakcja wycofana w całości, choć klient powstaje
 *      PRZED pętlą pozycji). Odpowiedź dla anon nie niesie identyfikatorów
 *      (skan igłami + kontrola pozytywna skanu, ADR-181).
 *   2. GRANICA INCLUSIVE: sufit liczony na TEJ SAMEJ `v_days` co wycena
 *      (`end - start + 1`) ≡ rentalDaysInclusive (@avably/core). Najem RÓWNY
 *      sufitowi (365 dób: 2026-01-01→2026-12-31) MA przejść; o jeden dzień
 *      dłuższy (366: →2027-01-01) odpada. Rozjazd o dobę = czerwień na granicy.
 * DOWÓD MUTACYJNY (poza tym plikiem, jak w min-rental-days): wykonawca
 * podnosi `c_max_rental_days` w zastosowanej funkcji do wartości
 * astronomicznej (`create or replace` przez psql) — to samo, co usunięcie
 * bramki [0110] — i przebieg osi 1 idzie na CZERWONO (najem-atak przechodzi),
 * po czym przywraca oryginał i przebieg znów jest zielony. Bramka [0110] jest
 * bezwarunkowa (`if v_days > c_max_rental_days`), więc niepusty diff funkcji
 * nie wystarcza — dowodem jest dopiero czerwień testu przy mutancie.
 *
 * Wywołania idą jako ANON przez PostgREST — realna ścieżka publiczna.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_* —
 * patrz helpers/seed-tenants.ts. Bez nich plik jest pomijany (strażnik jawności).
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

/**
 * Sufit z migracji 0110 (`c_max_rental_days`) i z checkoutSchema
 * (`MAX_RENTAL_DAYS`). Kotwica testu; gdyby ktoś zmienił wartość w bazie
 * bez zmiany tutaj, granica INCLUSIVE poniżej pali PIERWSZA.
 */
const MAX_RENTAL_DAYS = 365;

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
  const slug = `maxokres-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: "Max okres test", status: "active", locale: "pl" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać tenanta: ${error?.message}`);
  createdTenantIds.push(data.id as string);
  // Komplet dokumentów prawnych — bez nich odmawia bramka 0086, a nie 0110,
  // i cała suita dowodziłaby cudzej bramki.
  await publishLegalDocuments(admin, data.id as string);
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
      // Bufory 0: dowodzimy bramki SUFITU, nie kolizji buforowych.
      buffer_before_days: 0,
      buffer_after_days: 0,
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
) {
  return anon.schema("app").rpc("public_checkout", {
    p_tenant_id: tenantId,
    p_email: `mx-${randomUUID().slice(0, 8)}@test.local`,
    p_full_name: "Kupujący",
    p_phone: null,
    p_start_date: startDate,
    p_end_date: endDate,
    p_delivery_method: "pickup",
    p_pickup_location_id: pickupId,
    p_items: [{ product_id: productId, quantity: 1 }],
    p_terms_version: "v1",
    p_locale: "pl",
  });
}

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

interface LeakNeedle {
  name: string;
  hit: (haystack: string) => boolean;
}

function leakNeedles(productId: string, tenantId: string): LeakNeedle[] {
  return [
    { name: "uuid produktu", hit: (h) => h.includes(productId) },
    { name: "uuid tenanta", hit: (h) => h.includes(tenantId) },
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

describe.skipIf(!hasEnv)("sufit czasu najmu w app.public_checkout — 0110 (ADR-268)", () => {
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
  // 1. EGZEKWOWANIE + ADR-181 (skan odpowiedzi) — atak start…9999
  // -------------------------------------------------------------------
  it("najem znacznie dłuższy niż sufit (start=2026-01-01…end=9999-12-31) → 22023, zero śladu zapisu", async () => {
    // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie bramki [0110] z app.public_checkout —
    // najem-atak przechodzi, error jest null i pierwsza asercja pali. Nic tej
    // ścieżki nie maskuje: produkt ma wolny egzemplarz, dokumenty opublikowane,
    // tenant aktywny, sufit to jedyna bramka, która ma tu odmówić.
    const tenantId = await seedTenant(admin);
    const productId = await seedProduct(admin, tenantId);
    await seedUnits(admin, tenantId, productId, 1);
    const pickupId = await seedPickupLocation(admin, tenantId);

    const { data, error } = await checkoutAsAnon(
      anon, tenantId, productId, pickupId,
      "2026-01-01", "9999-12-31", // ~2.9 mln dób INCLUSIVE » sufit
    );

    expect(error, "najem-atak PRZESZEDŁ — bramki sufitu [0110] nie ma").not.toBeNull();
    expect(error?.code, `oczekiwano 22023, było ${error?.code}: ${error?.message}`).toBe("22023");
    expect(data).toBeNull();

    // ZERO ŚLADU: transakcja wycofana w całości — ani zamówienia, ani
    // klienta-sieroty (klient powstaje PRZED pętlą pozycji; sufit stoi jednak
    // JESZCZE wcześniej, tuż po policzeniu v_days, więc klient nie zdąży
    // nawet powstać).
    expect(await orderCount(admin, tenantId), "odmowa zostawiła zamówienie").toBe(0);
    expect(await customerCount(admin, tenantId), "odmowa zostawiła klienta-sierotę").toBe(0);

    // SKAN ADR-181: cała surowa odpowiedź nie niesie identyfikatorów.
    const surowa = JSON.stringify({ data, error });
    const igly = leakNeedles(productId, tenantId);
    expect(
      leaksIn(surowa, igly),
      `odpowiedź dla anon niesie dane, których klient znać nie może: ${surowa}`,
    ).toEqual([]);

    // Treść docelowa — przypięta PO skanie (osobna czerwień na korektę
    // brzmienia, żeby nie przebierała się za wyciek).
    expect(error?.message).toBe("Wybrany okres najmu jest zbyt długi.");

    // KONTROLA POZYTYWNA SKANU: odpowiedź SPREPAROWANA z identyfikatorem i
    // numerem zamówienia — skan musi trafić wszystkie igły, inaczej „zero
    // trafień" wyżej dowodzi tylko ślepoty skanu.
    const spreparowana = JSON.stringify({
      data: null,
      error: {
        code: "22023",
        message: `Produkt ${productId} u tenanta ${tenantId} (por. ORD-2026-001).`,
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
  it(`granica: najem RÓWNY sufitowi (${MAX_RENTAL_DAYS} dób) przechodzi, o dobę dłuższy odpada`, async () => {
    // Kotwica konwencji PO STRONIE TS — te same pary dat, które dostanie SQL.
    // 2026 nie jest rokiem przestępnym: 01-01→12-31 to DOKŁADNIE 365 dób.
    expect(rentalDaysInclusive("2026-01-01", "2026-12-31")).toBe(MAX_RENTAL_DAYS);
    expect(rentalDaysInclusive("2026-01-01", "2027-01-01")).toBe(MAX_RENTAL_DAYS + 1);

    const tenantId = await seedTenant(admin);
    const productId = await seedProduct(admin, tenantId);
    // Dwa egzemplarze: dwa najmy zachodzące na siebie w czasie potrzebują
    // osobnych sztuk, żeby test granicy nie odbił się o kolizję dostępności
    // zamiast o sufit.
    await seedUnits(admin, tenantId, productId, 2);
    const pickupId = await seedPickupLocation(admin, tenantId);

    // RÓWNY sufitowi — MA przejść.
    const rowny = await checkoutAsAnon(
      anon, tenantId, productId, pickupId, "2026-01-01", "2026-12-31",
    );
    expect(
      rowny.error,
      `najem RÓWNY sufitowi odrzucony (sufit liczy EXCLUSIVE albo <= zamiast <?): ${rowny.error?.message}`,
    ).toBeNull();
    expect((rowny.data as { order_number?: string })?.order_number).toBeTruthy();

    // O DOBĘ DŁUŻSZY — MA odpaść.
    const zaDlugi = await checkoutAsAnon(
      anon, tenantId, productId, pickupId, "2026-01-01", "2027-01-01",
    );
    expect(zaDlugi.error?.code, "najem o dobę dłuższy niż sufit przeszedł").toBe("22023");
    expect(zaDlugi.error?.message).toBe("Wybrany okres najmu jest zbyt długi.");

    // Tylko najem równy sufitowi się utrwalił.
    expect(await orderCount(admin, tenantId)).toBe(1);
  });
});
