/**
 * SONDA IZOLACJI KARTY PRODUKTU (U8b, ADR-146) na żywym, lokalnym Supabase.
 *
 * Pytanie brzmi: co ta zmiana UDOSTĘPNIA, czego wcześniej nie udostępniała?
 * Karta produktu była do U8b samym formularzem edycji — nie czytała ani
 * zamówień, ani kwot. Teraz czyta `order_items` z dołączonym `orders`
 * i pokazuje z tego HISTORIĘ NAJMÓW (numery zamówień) i PRZYCHÓD (kwoty).
 * To są dane, których wyciek między najemcami byłby wyciekiem obrotu
 * i listy klientów, więc sonda dotyczy dokładnie tego złączenia.
 *
 * ================== DLACZEGO KLIENT SERVICE-ROLE ==================
 *
 * Sonda uruchamiana klientem z sesją tenanta B dowodzi tylko tego, że działa
 * RLS — i byłaby ZIELONA również wtedy, gdyby zapytanie karty straciło
 * zawężenie po tenancie. Dlatego GŁÓWNA sonda woła `fetchProductCard`
 * klientem SERVICE-ROLE, który RLS omija: wtedy jedyną rzeczą, która trzyma
 * wynik przy jednym najemcy, jest samo zapytanie. Zdjęcie `.eq("tenant_id",
 * …)` z `lib/catalog/card-query.ts` zapala te testy z imienia.
 *
 * Druga sonda (klientem z sesją B, z PODSTAWIONYM tenant_id tenanta A)
 * pokazuje, że RLS trzyma niezależnie od tego, co panel poda jako tenant.
 *
 * `fetchProductCard` i `fetchProductUnits` są tu wołane DOKŁADNIE tak, jak
 * wołają je ekrany — kopia zapytania w teście broniłaby kopii, nie produkcji.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { fetchProductCard, fetchProductUnits } from "@/lib/catalog/card-query";

import { rpcCreateTenant } from "./helpers/create-tenant";
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

const TEST_PASSWORD = "CatalogCard!12345678";
const SUPABASE_PUBLIC_URL = "http://127.0.0.1:54321";
const TODAY = "2026-08-12";

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function createAdminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

async function createTenantMember(
  admin: SupabaseClient,
  label: string,
): Promise<{ client: SupabaseClient; tenantId: string }> {
  const email = `catcard-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
    p_slug: `catcard-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja karty ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

async function seedProduct(
  admin: SupabaseClient,
  tenantId: string,
  name: string,
  units: number,
): Promise<{ productId: string; unitIds: string[]; storagePath: string }> {
  const { data: product, error } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name,
      base_price_day_grosze: 10_000,
      deposit_grosze: 20_000,
      auto_increment_multiplier: 1.0,
      active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insert products(${name}): ${error.message}`);
  const productId = product!.id as string;

  const unitIds: string[] = [];
  for (let index = 0; index < units; index += 1) {
    const { data: unit, error: unitError } = await admin
      .from("product_units")
      .insert({ tenant_id: tenantId, product_id: productId, serial_number: `${name}-${index}` })
      .select("id")
      .single();
    if (unitError) throw new Error(`insert product_units(${name}): ${unitError.message}`);
    unitIds.push(unit!.id as string);
  }

  const storagePath = `${tenantId}/${productId}/${randomUUID()}.jpg`;
  const { error: imageError } = await admin.from("product_images").insert({
    tenant_id: tenantId,
    product_id: productId,
    storage_path: storagePath,
    sort_order: 0,
    alt_text: `Zdjęcie ${name}`,
  });
  if (imageError) throw new Error(`insert product_images(${name}): ${imageError.message}`);

  return { productId, unitIds, storagePath };
}

/** Zamówienie w zadanym stanie obu osi + jedna pozycja wskazująca produkt. */
async function seedOrder(
  admin: SupabaseClient,
  tenantId: string,
  productId: string,
  options: {
    orderStatus: string;
    paymentStatus?: string;
    startDate: string;
    endDate: string;
    rentalGrosze?: number;
    unitId?: string | null;
  },
): Promise<string> {
  const { data: customer, error: customerError } = await admin
    .from("customers")
    .insert({ tenant_id: tenantId, email: `k-${randomUUID()}@test.local`, full_name: "Klient" })
    .select("id")
    .single();
  if (customerError) throw new Error(`insert customers: ${customerError.message}`);

  // Zamówienie RODZI SIĘ jako `pending` (bramka 0010) — do docelowego statusu
  // idziemy maszyną stanów, krok po kroku, tak jak robi to panel.
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      customer_id: customer!.id,
      start_date: options.startDate,
      end_date: options.endDate,
      delivery_method: "courier",
      total_rental_grosze: options.rentalGrosze ?? 10_000,
    })
    .select("id")
    .single();
  if (orderError) throw new Error(`insert orders: ${orderError.message}`);

  const { error: itemError } = await admin.from("order_items").insert({
    tenant_id: tenantId,
    order_id: order!.id,
    product_id: productId,
    unit_id: options.unitId ?? null,
    rental_grosze: options.rentalGrosze ?? 10_000,
  });
  if (itemError) throw new Error(`insert order_items: ${itemError.message}`);

  const path: Record<string, readonly string[]> = {
    pending: [],
    cancelled: ["cancelled"],
    reserved: ["reserved"],
    ready_for_pickup: ["reserved", "ready_for_pickup"],
    picked_up: ["reserved", "ready_for_pickup", "picked_up"],
    returned: ["reserved", "ready_for_pickup", "picked_up", "returned"],
  };
  for (const next of path[options.orderStatus] ?? []) {
    const { error: stepError } = await admin
      .from("orders")
      .update({ order_status: next })
      .eq("id", order!.id);
    if (stepError) throw new Error(`przejście ${next}: ${stepError.message}`);
  }

  if (options.paymentStatus) {
    const { error: payError } = await admin
      .from("orders")
      .update({ payment_status: options.paymentStatus })
      .eq("id", order!.id);
    if (payError) throw new Error(`płatność ${options.paymentStatus}: ${payError.message}`);
  }

  return order!.id as string;
}

describe.skipIf(!hasEnv)("karta produktu — izolacja najemców (U8b)", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };
  let productA: { productId: string; unitIds: string[]; storagePath: string };
  let productB: { productId: string; unitIds: string[]; storagePath: string };
  let orderIdB: string;

  const options = { today: TODAY, supabaseUrl: SUPABASE_PUBLIC_URL };

  beforeAll(async () => {
    admin = createAdminClient();
    tenantA = await createTenantMember(admin, "a");
    tenantB = await createTenantMember(admin, "b");

    productA = await seedProduct(admin, tenantA.tenantId, "Rusztowanie najemcy A", 3);
    productB = await seedProduct(admin, tenantB.tenantId, "Rusztowanie najemcy B", 2);

    // A: jedna sztuka w terenie DZIŚ (na konkretnym egzemplarzu), jedna
    // pozycja bez egzemplarza też dziś w terenie, jeden najem rozliczony
    // i jeden ANULOWANY Z POBRANĄ WPŁATĄ.
    //
    // Ta ostatnia para jest reprezentowalna WYŁĄCZNIE w dwóch krokach: 0015
    // blokuje anulowanie zamówienia z rozliczoną płatnością (23001), ale nie
    // blokuje ruchu na osi płatności PO anulowaniu (unpaid → paid). Dlatego
    // `seedOrder` przestawia płatność DOPIERO po przejściu statusu — i dlatego
    // kontrakt 0054 potrzebuje `AND order_status <> 'cancelled'`: sama oś
    // płatności tego przypadku nie odsiewa.
    await seedOrder(admin, tenantA.tenantId, productA.productId, {
      orderStatus: "picked_up",
      startDate: "2026-08-10",
      endDate: "2026-08-14",
      unitId: productA.unitIds[0]!,
      rentalGrosze: 40_000,
      paymentStatus: "paid",
    });
    await seedOrder(admin, tenantA.tenantId, productA.productId, {
      orderStatus: "picked_up",
      startDate: TODAY,
      endDate: TODAY,
      rentalGrosze: 10_000,
      paymentStatus: "unpaid",
    });
    await seedOrder(admin, tenantA.tenantId, productA.productId, {
      orderStatus: "returned",
      startDate: "2026-07-01",
      endDate: "2026-07-05",
      rentalGrosze: 50_000,
      paymentStatus: "completed",
    });
    await seedOrder(admin, tenantA.tenantId, productA.productId, {
      orderStatus: "cancelled",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      rentalGrosze: 99_000,
      paymentStatus: "paid",
    });

    // B ma WŁASNE najmy z własnymi kwotami — gdyby zapytanie karty przestało
    // zawężać po tenancie, wpadłyby do historii i przychodu najemcy A.
    orderIdB = await seedOrder(admin, tenantB.tenantId, productB.productId, {
      orderStatus: "picked_up",
      startDate: "2026-08-10",
      endDate: "2026-08-20",
      unitId: productB.unitIds[0]!,
      rentalGrosze: 777_000,
      paymentStatus: "paid",
    });
  }, 180_000);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  }, 60_000);

  it("kontrola pozytywna: dane obu najemców NAPRAWDĘ istnieją", async () => {
    // Bez tego dowody niżej byłyby dowodami po pustym zbiorze: „nie widzę
    // cudzej historii" jest prawdą również wtedy, gdy cudzej historii nie ma.
    const { data } = await admin
      .from("order_items")
      .select("product_id")
      .in("product_id", [productA.productId, productB.productId]);
    expect(data!.length).toBe(5);
    expect(orderIdB).toBeTruthy();

    // UWAGA NA FAŁSZYWY DYSKRYMINATOR: `orders.order_number` jest sekwencją
    // PER NAJEMCA, więc pierwsze zamówienie obu tenantów nazywa się tak samo
    // („AV-2026-001"). Asercja „wynik nie zawiera cudzego numeru" byłaby więc
    // czerwona przy POPRAWNEJ izolacji — dowodem musi być identyfikator
    // wiersza (UUID) i kwota, które są globalnie jednoznaczne.
    const { data: numbers } = await admin
      .from("orders")
      .select("tenant_id, order_number")
      .in("tenant_id", [tenantA.tenantId, tenantB.tenantId]);
    const numbersA = numbers!.filter((row) => row.tenant_id === tenantA.tenantId);
    const numbersB = numbers!.filter((row) => row.tenant_id === tenantB.tenantId);
    expect(
      numbersA.some((a) => numbersB.some((b) => a.order_number === b.order_number)),
      "numeracja zamówień okazała się globalna — dobierz inny dyskryminator",
    ).toBe(true);
  });

  it("historia i przychód są zawężone do najemcy SAMYM ZAPYTANIEM (klient bez RLS)", async () => {
    const card = await fetchProductCard(admin, tenantA.tenantId, productA.productId, options);

    // Cztery najmy produktu A — i ANI JEDEN produktu B. Ta asercja pali po
    // zdjęciu `.eq("tenant_id", …)` z zapytania pozycji w card-query.ts.
    expect(card.historyCount).toBe(4);
    expect(card.history).toHaveLength(4);

    const serialized = JSON.stringify(card);
    expect(serialized, "identyfikator cudzego zamówienia w karcie").not.toContain(orderIdB);
    expect(serialized, "cudza kwota najmu w karcie").not.toContain("777000");
    expect(serialized, "identyfikator cudzego najemcy w karcie").not.toContain(tenantB.tenantId);
    expect(serialized, "ścieżka cudzego zdjęcia w karcie").not.toContain(productB.storagePath);
    expect(serialized, "cudzy egzemplarz w karcie").not.toContain(productB.unitIds[0]!);
  });

  it("PODSTAWIONY identyfikator cudzego produktu nie wynosi historii ani kwot", async () => {
    // TO JEST SONDA ZAWĘŻENIA PO TENANCIE, a nie test wyżej.
    //
    // Odczyt karty jest kluczowany identyfikatorem produktu, a UUID jest
    // globalnie jednoznaczny — więc „czytam swój produkt" wygląda tak samo
    // z zawężeniem po tenancie i bez niego. Mutacja zdejmująca `.eq("tenant_id",
    // …)` przechodziła tamten test na zielono (sprawdzone). Różnicę widać
    // dopiero wtedy, gdy najemca A pyta o CUDZY produkt — a to jest realny
    // wektor: identyfikator przychodzi ze ścieżki URL.
    //
    // Klientem jest service-role, więc RLS NIE zasłania wyniku: jedyną
    // rzeczą, która trzyma tu pustkę, jest zawężenie w zapytaniu.
    const forged = await fetchProductCard(admin, tenantA.tenantId, productB.productId, options);

    expect(forged.history, "historia cudzego produktu wyciekła").toEqual([]);
    expect(forged.revenue, "przychód cudzego produktu wyciekł").toEqual([]);
    expect(forged.historyCount).toBe(0);
    expect(forged.deployedToday).toBe(0);
    expect(forged.unitCount).toBe(0);
    expect(forged.thumbnail).toBeNull();

    // Kontrola POZYTYWNA: ten sam produkt czytany przez SWOJEGO najemcę ma
    // komplet danych — pustka wyżej jest zawężeniem, a nie pustym produktem.
    const own = await fetchProductCard(admin, tenantB.tenantId, productB.productId, options);
    expect(own.history).toHaveLength(1);
    expect(own.revenue).toEqual([{ currency: "PLN", rentalGrosze: 777_000, itemCount: 1 }]);

    // To samo dla zakładki egzemplarzy — ma własną parę zapytań.
    const forgedUnits = await fetchProductUnits(admin, tenantA.tenantId, productB.productId, {
      today: TODAY,
    });
    expect(forgedUnits.units).toEqual([]);
    expect(forgedUnits.deployedToday).toBe(0);
  });

  it("przychód liczy WYŁĄCZNIE najmy rozliczone tego produktu", async () => {
    const card = await fetchProductCard(admin, tenantA.tenantId, productA.productId, options);

    // 40 000 (paid) + 50 000 (completed). NIE wchodzą: 10 000 (unpaid)
    // ani 99 000 z zamówienia ANULOWANEGO, choć jego płatność stoi na `paid`
    // — druga połowa koniunkcji z 0054. Cudze 777 000 tym bardziej.
    expect(card.revenue).toEqual([{ currency: "PLN", rentalGrosze: 90_000, itemCount: 2 }]);

    // Kontrola POZYTYWNA dla samego przypadku: anulowane zamówienie z pobraną
    // wpłatą NAPRAWDĘ stoi w bazie — bez tego asercja wyżej byłaby dowodem po
    // pustym zbiorze (przeszłaby też, gdyby seed takiego wiersza nie zapisał).
    const { data: cancelled } = await admin
      .from("orders")
      .select("order_status, payment_status")
      .eq("tenant_id", tenantA.tenantId)
      .eq("order_status", "cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled![0]!.payment_status).toBe("paid");
  });

  it("„dziś w terenie” nie wchłania cudzych wydań", async () => {
    const card = await fetchProductCard(admin, tenantA.tenantId, productA.productId, options);
    expect(card.deployedToday).toBe(2);
    expect(card.unitCount).toBe(3);

    // Kontrola z drugiej strony: B ma własne wydanie i jego liczba NIE jest
    // liczbą A (gdyby agregat przestał zawężać, obie strony pokazałyby 3).
    const cardB = await fetchProductCard(admin, tenantB.tenantId, productB.productId, options);
    expect(cardB.deployedToday).toBe(1);
  });

  it("kolumna stanu egzemplarza wskazuje WŁASNE zamówienie, nigdy cudze", async () => {
    const result = await fetchProductUnits(admin, tenantA.tenantId, productA.productId, {
      today: TODAY,
    });

    const deployed = result.units.filter((unit) => unit.deployment !== null);
    // Dokładnie jeden egzemplarz ma przypisane zamówienie (drugie wydanie
    // poszło bez wskazania sztuki), a jego numer nie jest numerem B.
    expect(deployed).toHaveLength(1);
    expect(deployed[0]!.id).toBe(productA.unitIds[0]);
    expect(deployed[0]!.deployment!.endDate).toBe("2026-08-14");
    expect(JSON.stringify(result)).not.toContain(orderIdB);
    expect(JSON.stringify(result)).not.toContain(productB.unitIds[0]!);
  });

  it("zdjęcie karty powstaje ze ścieżki najemcy i nigdy z cudzej", async () => {
    const card = await fetchProductCard(admin, tenantA.tenantId, productA.productId, options);
    expect(card.thumbnail).not.toBeNull();
    expect(card.thumbnail!.url).toContain(productA.storagePath);
    expect(card.thumbnail!.url).toContain("/storage/v1/object/public/product-images/");
  });

  it("cudza sesja nie dostaje ani historii, ani kwot — nawet z podstawionym tenant_id", async () => {
    // Panel poda tu tenant_id z claimu, ale sonda podstawia CUDZY: RLS jest
    // bramką ostateczną i musi trzymać niezależnie od argumentu.
    const forged = await fetchProductCard(
      tenantB.client,
      tenantA.tenantId,
      productA.productId,
      options,
    );
    expect(forged.history).toEqual([]);
    expect(forged.revenue).toEqual([]);
    expect(forged.unitCount).toBe(0);
    expect(forged.thumbnail).toBeNull();

    // Ta sama sesja z WŁASNYM produktem widzi swoje dane — dowód, że pustka
    // wyżej to odmowa, a nie zepsuty klient.
    const own = await fetchProductCard(
      tenantB.client,
      tenantB.tenantId,
      productB.productId,
      options,
    );
    expect(own.history).toHaveLength(1);
    expect(own.revenue).toEqual([{ currency: "PLN", rentalGrosze: 777_000, itemCount: 1 }]);
  });
});
