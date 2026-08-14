/**
 * Testy integracyjne przedłużenia najmu (Zadanie 6) na żywym, lokalnym
 * Supabase — wzorzec orders.test.ts/deposits.test.ts: realni użytkownicy,
 * realne sesje, zero mocków i zero service-role w ścieżce mutacji.
 *
 * Weryfikują ścieżkę PANELU (dokładnie ta mutacja, którą wykonuje
 * extendOrderAction — jeden UPDATE end_date+total z filtrami optymistycznej
 * współbieżności i `.select("id")` po mutacji):
 *
 *   1. przedłużenie przechodzi, a total po mutacji == zapisany total +
 *      quoteExtension z silnika (co do grosza),
 *   2. przedłużenie w kolizję z następnym najmem: 23P01 z sesji członka,
 *      którego treść NIE niesie numeru kolidującego zamówienia
 *      (ADR-181/0082), obie kolumny nietknięte,
 *   3. chybione expectedEndDate → zero wierszy (błąd, nie cichy sukces),
 *   4. status terminalny (returned) → zero wierszy: filtr .in() w akcji
 *      jest jedyną zaporą — baza świadomie nie bramkuje dat zamówień
 *      terminalnych (ADR-028; pin w packages/db/test/order-extension.test.ts).
 *      Ten test płonie po usunięciu filtru statusów z mutacji — nic go nie
 *      maskuje, bo trigger 0010 przepuszcza, a RLS to własny tenant,
 *   5. izolacja: członek tenanta B nie przedłuży zamówienia A (zero wierszy,
 *      dane nietknięte),
 *   6. dopłata NA POZYCJE (D1): po przedłużeniu zamówienia wieloproduktowego
 *      sum(order_items.rental_grosze) == orders.total_rental_grosze CO DO
 *      GROSZA (a więc ostrzeżenie ItemsSection „sumy się nie zgadzają" NIE
 *      pojawia się), a każda pozycja dostaje SWOJĄ dokładną dopłatę silnika.
 *      Sekwencja jest ta sama, którą wykonuje extendOrderAction: bramkowany
 *      UPDATE zamówienia, potem writeExtensionItemRentals na pozycje.
 *
 * Mechanikę bramki 0010 dowodzi packages/db/test/order-extension.test.ts —
 * tu jej nie powtarzamy.
 */
import { randomUUID } from "node:crypto";

import {
  AVAILABILITY_BLOCKING_ORDER_STATUSES,
  calculatePrice,
  quoteExtension,
} from "@avably/core";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { writeExtensionItemRentals } from "@/app/[locale]/(panel)/zamowienia/[id]/extension-mutation";
import {
  extensionItemRentals,
  priceParamsFromRow,
  quoteOrderExtension,
} from "@/app/[locale]/(panel)/zamowienia/[id]/extension-pricing";

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

const TEST_PASSWORD = "ExtensionsTest!12345678";
const PG_UNIT_CONFLICT = "23P01";

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

function createAnonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

/** User + własna organizacja + ŚWIEŻA sesja (JWT z claimem tenant_id). */
async function createTenantMember(
  admin: SupabaseClient,
  label: string,
): Promise<{ client: SupabaseClient; tenantId: string }> {
  const email = `ext-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
    p_slug: `ext-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja przedłużeń ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

describe.skipIf(!hasEnv)("przedłużenia najmu (ścieżka panelu, bramki 0010)", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };
  let customerId: string;
  let productId: string;
  let unitId: string;
  let orderId: string;

  /** Cennik jak w orders.test.ts: baza 100 zł, próg 7 dni za 6.5×, kaucja 50 zł. */
  const PRICING = {
    basePriceDayGrosze: 10_000,
    depositGrosze: 5_000,
    autoIncrementMultiplier: 1.0,
    tiers: [{ tierDays: 7, multiplier: 6.5 }],
  };

  /** Dokładnie ten UPDATE, który wykonuje extendOrderAction. */
  async function extendAsPanel(
    client: SupabaseClient,
    tenantId: string,
    targetOrderId: string,
    expectedEndDate: string,
    newEndDate: string,
    newTotalRentalGrosze: number,
  ) {
    return client
      .from("orders")
      .update({ end_date: newEndDate, total_rental_grosze: newTotalRentalGrosze })
      .eq("tenant_id", tenantId)
      .eq("id", targetOrderId)
      .eq("end_date", expectedEndDate)
      .in("order_status", [...AVAILABILITY_BLOCKING_ORDER_STATUSES])
      .select("id");
  }

  async function createOrderAsPanel(start: string, end: string, itemUnitId: string): Promise<{
    orderId: string;
    orderNumber: string;
    totalRentalGrosze: number;
  }> {
    const price = calculatePrice(start, end, PRICING);
    const { data: newOrderId, error } = await tenantA.client.schema("app").rpc("create_order", {
      p_customer_id: customerId,
      p_start_date: start,
      p_end_date: end,
      p_delivery_method: "courier",
      p_pickup_location_id: null,
      p_notes: null,
      p_total_rental_grosze: price.rentalGrosze,
      p_total_deposit_grosze: price.depositGrosze,
      p_items: [
        {
          product_id: productId,
          unit_id: itemUnitId,
          rental_grosze: price.rentalGrosze,
          deposit_grosze: price.depositGrosze,
        },
      ],
    });
    if (error) throw new Error(`create_order: ${error.message}`);
    const { data: row, error: readError } = await tenantA.client
      .from("orders")
      .select("order_number, total_rental_grosze")
      .eq("id", newOrderId as string)
      .single();
    if (readError || !row) throw new Error(`read order: ${readError?.message}`);
    return {
      orderId: newOrderId as string,
      orderNumber: row.order_number as string,
      totalRentalGrosze: row.total_rental_grosze as number,
    };
  }

  beforeAll(async () => {
    admin = createAdminClient();
    tenantA = await createTenantMember(admin, "a");
    tenantB = await createTenantMember(admin, "b");

    const { data: customer, error: customerError } = await tenantA.client
      .from("customers")
      .insert({ tenant_id: tenantA.tenantId, email: `klient-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (customerError) throw new Error(`insert customers: ${customerError.message}`);
    customerId = customer!.id as string;

    const { data: product, error: productError } = await tenantA.client
      .from("products")
      .insert({
        tenant_id: tenantA.tenantId,
        name: "Zagęszczarka do przedłużeń",
        base_price_day_grosze: PRICING.basePriceDayGrosze,
        deposit_grosze: PRICING.depositGrosze,
        buffer_before_days: 1,
        buffer_after_days: 1,
      })
      .select("id")
      .single();
    if (productError) throw new Error(`insert products: ${productError.message}`);
    productId = product!.id as string;

    const { error: tierError } = await tenantA.client.from("pricing_tiers").insert({
      tenant_id: tenantA.tenantId,
      product_id: productId,
      tier_days: 7,
      multiplier: 6.5,
    });
    if (tierError) throw new Error(`insert pricing_tiers: ${tierError.message}`);

    const { data: unit, error: unitError } = await tenantA.client
      .from("product_units")
      .insert({ tenant_id: tenantA.tenantId, product_id: productId, serial_number: "EXT-001" })
      .select("id")
      .single();
    if (unitError) throw new Error(`insert product_units: ${unitError.message}`);
    unitId = unit!.id as string;

    const order = await createOrderAsPanel("2027-03-01", "2027-03-05", unitId);
    orderId = order.orderId;
  }, 60_000);

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

  it("członek A przedłuża zamówienie: total po mutacji == zapisany + silnik, co do grosza", async () => {
    const quote = quoteExtension(
      { startDate: "2027-03-01", endDate: "2027-03-05" },
      "2027-03-08",
      PRICING,
    );
    expect(quote.additionalRentalGrosze).toBe(25_000); // pin: 5→8 dni przy progu 7

    const { data, error } = await extendAsPanel(
      tenantA.client,
      tenantA.tenantId,
      orderId,
      "2027-03-05",
      quote.newEndDate,
      50_000 + quote.additionalRentalGrosze,
    );
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { data: after } = await tenantA.client
      .from("orders")
      .select("end_date, total_rental_grosze")
      .eq("id", orderId)
      .single();
    expect(after).toEqual({ end_date: "2027-03-08", total_rental_grosze: 75_000 });
  });

  it("przedłużenie w kolizję z następnym najmem: 23P01 BEZ numeru zamówienia, dane nietknięte", async () => {
    const neighbour = await createOrderAsPanel("2027-03-10", "2027-03-12", unitId);

    // 03-08 → 03-09: rozszerzony koniec (bufor after 1) = 03-10 dotyka
    // startu sąsiada — bramka 0010 odmawia z sesji członka.
    const { error } = await extendAsPanel(
      tenantA.client,
      tenantA.tenantId,
      orderId,
      "2027-03-08",
      "2027-03-09",
      85_000,
    );
    expect(error?.code).toBe(PG_UNIT_CONFLICT);
    // ADR-181 (0082): odmowa niesie KOD, nie dane. Numer sąsiada wyszedł
    // z treści, bo ta sama bramka odmawia klientowi sklepu.
    expect(
      error?.message,
      "treść odmowy znów niesie numer kolidującego zamówienia (regres ADR-181)",
    ).not.toContain(neighbour.orderNumber);

    const { data: after } = await tenantA.client
      .from("orders")
      .select("end_date, total_rental_grosze")
      .eq("id", orderId)
      .single();
    expect(after).toEqual({ end_date: "2027-03-08", total_rental_grosze: 75_000 });
  });

  it("chybione expectedEndDate dosięga zero wierszy — błąd, nie cichy sukces", async () => {
    const { data, error } = await extendAsPanel(
      tenantA.client,
      tenantA.tenantId,
      orderId,
      "2027-03-05", // operator patrzył na stary termin — zamówienie ma już 03-08
      "2027-03-20",
      999_999,
    );
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("status terminalny: filtr statusów w mutacji odmawia (baza świadomie nie bramkuje — ADR-028)", async () => {
    // Osobny egzemplarz i odległy termin — zero interakcji z resztą testów.
    const { data: unit2 } = await tenantA.client
      .from("product_units")
      .insert({ tenant_id: tenantA.tenantId, product_id: productId, serial_number: "EXT-002" })
      .select("id")
      .single();
    const returnedOrder = await createOrderAsPanel("2027-06-01", "2027-06-05", unit2!.id as string);
    for (const step of ["reserved", "ready_for_pickup", "picked_up", "returned"]) {
      const { data: walked, error: walkError } = await tenantA.client
        .from("orders")
        .update({ order_status: step })
        .eq("tenant_id", tenantA.tenantId)
        .eq("id", returnedOrder.orderId)
        .select("id");
      if (walkError || !walked || walked.length === 0) {
        throw new Error(`walk ${step}: ${walkError?.message ?? "zero wierszy"}`);
      }
    }

    const { data, error } = await extendAsPanel(
      tenantA.client,
      tenantA.tenantId,
      returnedOrder.orderId,
      "2027-06-05",
      "2027-06-08",
      returnedOrder.totalRentalGrosze + 30_000,
    );
    expect(error).toBeNull();
    expect(data).toEqual([]); // .in(statusy aktywne) nie dosięga returned

    const { data: after } = await tenantA.client
      .from("orders")
      .select("end_date")
      .eq("id", returnedOrder.orderId)
      .single();
    expect(after).toEqual({ end_date: "2027-06-05" });
  });

  it("izolacja: członek tenanta B nie przedłuży zamówienia A", async () => {
    const { data, error } = await extendAsPanel(
      tenantB.client,
      tenantB.tenantId,
      orderId,
      "2027-03-08",
      "2027-03-20",
      1,
    );
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // Kontrola bez zaufania sesji B: admin widzi dane nietknięte.
    const { data: after } = await admin
      .from("orders")
      .select("end_date, total_rental_grosze")
      .eq("id", orderId)
      .single();
    expect(after).toEqual({ end_date: "2027-03-08", total_rental_grosze: 75_000 });
  });

  it("D1: po przedłużeniu suma najmu pozycji == total zamówienia (2 różne cenniki, co do grosza)", async () => {
    // Drugi produkt o INNYM cenniku (bez progów, auto-mnożnik 1.2). Dopłaty obu
    // pozycji będą różne i „nierówne" — naiwny podział proporcjonalny musiałby
    // zaokrąglić; my dopisujemy dokładne liczby silnika, więc sumy trzymają się
    // co do grosza także wtedy, gdy dopłata całości nie dzieli się równo.
    const PRICING2 = {
      basePriceDayGrosze: 20_000,
      depositGrosze: 0,
      autoIncrementMultiplier: 1.2,
      tiers: [] as { tierDays: number; multiplier: number }[],
    };
    const { data: product2, error: p2Error } = await tenantA.client
      .from("products")
      .insert({
        tenant_id: tenantA.tenantId,
        name: "Agregat do przedłużeń per pozycja",
        base_price_day_grosze: PRICING2.basePriceDayGrosze,
        deposit_grosze: PRICING2.depositGrosze,
        auto_increment_multiplier: PRICING2.autoIncrementMultiplier,
        buffer_before_days: 0,
        buffer_after_days: 0,
      })
      .select("id")
      .single();
    if (p2Error) throw new Error(`insert product2: ${p2Error.message}`);
    const product2Id = product2!.id as string;

    // Świeże egzemplarze i odległe daty (2028-01) — zero kolizji z resztą testów.
    const { data: unitP1 } = await tenantA.client
      .from("product_units")
      .insert({ tenant_id: tenantA.tenantId, product_id: productId, serial_number: "EXT-REC-1" })
      .select("id")
      .single();
    const { data: unitP2 } = await tenantA.client
      .from("product_units")
      .insert({ tenant_id: tenantA.tenantId, product_id: product2Id, serial_number: "EXT-REC-2" })
      .select("id")
      .single();

    const start = "2028-01-01";
    const end = "2028-01-05";
    const price1 = calculatePrice(start, end, PRICING);
    const price2 = calculatePrice(start, end, PRICING2);
    // Total = suma pozycji → PRZED przedłużeniem sumy się zgadzają (brak dryfu).
    const { data: reconOrderId, error: createError } = await tenantA.client
      .schema("app")
      .rpc("create_order", {
        p_customer_id: customerId,
        p_start_date: start,
        p_end_date: end,
        p_delivery_method: "courier",
        p_pickup_location_id: null,
        p_notes: null,
        p_total_rental_grosze: price1.rentalGrosze + price2.rentalGrosze,
        p_total_deposit_grosze: price1.depositGrosze + price2.depositGrosze,
        p_items: [
          {
            product_id: productId,
            unit_id: unitP1!.id as string,
            rental_grosze: price1.rentalGrosze,
            deposit_grosze: price1.depositGrosze,
          },
          {
            product_id: product2Id,
            unit_id: unitP2!.id as string,
            rental_grosze: price2.rentalGrosze,
            deposit_grosze: price2.depositGrosze,
          },
        ],
      });
    if (createError) throw new Error(`create_order (recon): ${createError.message}`);
    const reconId = reconOrderId as string;

    // Autorytatywny re-odczyt pozycji z cennikiem — DOKŁADNIE jak akcja.
    const { data: orderRow, error: readError } = await tenantA.client
      .from("orders")
      .select(
        "total_rental_grosze, order_items(id, rental_grosze, products(base_price_day_grosze, deposit_grosze, auto_increment_multiplier, pricing_tiers(tier_days, multiplier)))",
      )
      .eq("id", reconId)
      .single();
    if (readError || !orderRow) throw new Error(`read recon order: ${readError?.message}`);
    const itemRows = orderRow.order_items as unknown as {
      id: string;
      rental_grosze: number;
      products: Parameters<typeof priceParamsFromRow>[0];
    }[];

    const newEndDate = "2028-01-09";
    const quote = quoteOrderExtension(
      { startDate: start, endDate: end },
      newEndDate,
      itemRows.map((item) => ({ itemId: item.id, params: priceParamsFromRow(item.products) })),
    );
    // Dopłaty per pozycja RÓŻNE i suma NIEPARZYSTA względem podziału na 2 — pin,
    // że nie ma tu równego dzielenia. (Same liczby zależą od silnika; ważny jest
    // fakt, że obie są > 0 i różne.)
    expect(quote.items).toHaveLength(2);
    expect(quote.items[0]!.additionalRentalGrosze).not.toBe(quote.items[1]!.additionalRentalGrosze);
    expect(quote.items.reduce((sum, i) => sum + i.additionalRentalGrosze, 0)).toBe(
      quote.additionalRentalGrosze,
    );

    const currentById = new Map(itemRows.map((item) => [item.id, item.rental_grosze]));
    const { updates, hasNegative } = extensionItemRentals(currentById, quote.items);
    expect(hasNegative).toBe(false);
    const newTotal = (orderRow.total_rental_grosze as number) + quote.additionalRentalGrosze;

    // Ta sama sekwencja co extendOrderAction: bramkowany UPDATE zamówienia…
    const { data: extData, error: extError } = await extendAsPanel(
      tenantA.client,
      tenantA.tenantId,
      reconId,
      end,
      newEndDate,
      newTotal,
    );
    expect(extError).toBeNull();
    expect(extData).toHaveLength(1);
    // …a POTEM dopłaty na pozycje (współdzielony zapis, ten sam, którego używa akcja).
    const itemsError = await writeExtensionItemRentals(tenantA.client, tenantA.tenantId, updates);
    expect(itemsError).toBeNull();

    // DOWÓD RECONCILIACJI: suma najmu pozycji == total zamówienia, co do grosza.
    // To jest dokładnie warunek, którego pilnuje ItemsSection (`drifted`), więc
    // równość == brak ostrzeżenia „sumy się nie zgadzają" po przedłużeniu.
    const { data: afterRow } = await tenantA.client
      .from("orders")
      .select("total_rental_grosze, order_items(id, rental_grosze)")
      .eq("id", reconId)
      .single();
    const afterItems = afterRow!.order_items as unknown as { id: string; rental_grosze: number }[];
    const itemsSum = afterItems.reduce((sum, item) => sum + item.rental_grosze, 0);
    expect(itemsSum).toBe(afterRow!.total_rental_grosze);
    expect(afterRow!.total_rental_grosze).toBe(newTotal);
    // I każda pozycja dostała SWOJĄ dokładną kwotę (bieżąca + dopłata silnika).
    for (const item of afterItems) {
      expect(item.rental_grosze).toBe(currentById.get(item.id)! + quoteItemSurcharge(quote, item.id));
    }
  });
});

/** Dopłata konkretnej pozycji z wyceny (0 gdy pozycji nie było w wycenie). */
function quoteItemSurcharge(
  quote: ReturnType<typeof quoteOrderExtension>,
  itemId: string,
): number {
  return quote.items.find((item) => item.itemId === itemId)?.additionalRentalGrosze ?? 0;
}
