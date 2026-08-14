/**
 * Edycja POZYCJI zamówienia (uwagi przeglądu D6/N4) na żywym, lokalnym
 * Supabase — wzorzec extensions.test.ts/deposits.test.ts: realni użytkownicy,
 * realne sesje, zero service-role w ścieżce mutacji.
 *
 * ================== CO TU JEST NAPRAWDĘ URUCHOMIONE ==================
 *
 * Testy wołają PRAWDZIWE akcje serwerowe z `items-actions.ts`. Zamockowana
 * jest wyłącznie hydraulika żądania (`requireMember` czytające ciasteczka
 * i `revalidatePath`), a w jej miejsce wchodzi klient z REALNĄ sesją członka
 * tenanta. Cała reszta jest prawdziwa: RLS 0007, bramka
 * `order_items_assignment_gate` → `app.assert_unit_available` (0010, ADR-024)
 * i przeliczanie sum przez akcję.
 *
 * To NIE jest kosmetyka. Test, który powtarza mutację „ręcznie" obok akcji,
 * przechodzi także wtedy, gdy akcja przestanie robić połowę swojej roboty —
 * czyli świeci na zielono nad kodem, którego nie dotyka. Stąd wektor dowodu
 * mutacyjnego dla tej paczki: usunięcie kroku przeliczania sum z
 * `removeOrderItemAction` MUSI zapalić test „usunięcie pozycji" na czerwono.
 *
 * Co jest dowodzone:
 *   1. dodanie pozycji z wolnym egzemplarzem — pozycja ma przypisanie,
 *      a sumy zamówienia zgadzają się z pozycjami CO DO GROSZA,
 *   2. ręczna zmiana ceny i kaucji — obie kolumny i obie sumy,
 *   3. usunięcie pozycji — sumy przeliczone po usunięciu,
 *   4. przypisanie egzemplarza ZAJĘTEGO w tym terminie — odmowa bramki
 *      (23P01) wraca do operatora jako powód RODZAJOWY, bez numeru
 *      kolidującego zamówienia (ADR-181/0082), a w bazie NIC się nie
 *      zmienia (ani pozycja, ani sumy),
 *   5. dodanie produktu BEZ wolnego egzemplarza — pozycja wchodzi z
 *      `unit_id = NULL` i akcja mówi o tym wprost,
 *   6. zmiana kaucji przy POBRANEJ kaucji — `deposit_events` nietknięte,
 *   7. statusy: `picked_up` i `returned` odmawiają edycji (dla `returned`
 *      bramka bazy w ogóle nie sprawdza dostępności, więc ta zapora jest
 *      JEDYNA — patrz nagłówek items-validation.ts).
 */
import { randomUUID } from "node:crypto";

import { calculatePrice } from "@avably/core";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

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

const TEST_PASSWORD = "OrderItemsEditTest!12345678";

/** Kontekst wstrzykiwany akcjom zamiast odczytu ciasteczek. */
const memberContext = vi.hoisted(() => ({
  current: null as { tenantId: string; supabase: SupabaseClient } | null,
}));

vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => {
    if (!memberContext.current) throw new Error("Test nie ustawił kontekstu członka.");
    return {
      user: { id: "test", email: "test@test.local" },
      tenantId: memberContext.current.tenantId,
      role: "owner",
      superadmin: false,
      aal: "aal1",
      supabase: memberContext.current.supabase,
    };
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { addOrderItemAction, updateOrderItemAction, removeOrderItemAction } = await import(
  "@/app/[locale]/(panel)/zamowienia/[id]/items-actions"
);

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
  const email = `items-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
    p_slug: `items-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja pozycji ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

describe.skipIf(!hasEnv)("edycja pozycji zamówienia (akcje panelu, bramka 0010)", () => {
  let admin: SupabaseClient;
  let tenant: { client: SupabaseClient; tenantId: string };
  let customerId: string;
  /** Produkt z DWOMA egzemplarzami — jest czym obracać przy kolizji. */
  let heaterId: string;
  let heaterUnits: string[];
  /** Produkt BEZ ani jednego egzemplarza — ścieżka „niedostępne" z N4. */
  let cableId: string;
  let orderId: string;

  const START = "2027-05-10";
  const END = "2027-05-14";
  const HEATER = {
    basePriceDayGrosze: 10_000,
    depositGrosze: 5_000,
    autoIncrementMultiplier: 1.0,
    tiers: [],
  };
  const CABLE = {
    basePriceDayGrosze: 2_000,
    depositGrosze: 0,
    autoIncrementMultiplier: 1.0,
    tiers: [],
  };

  /** Sumy zamówienia vs suma pozycji — dowód „co do grosza" jednym zapytaniem. */
  async function totalsVsItems(): Promise<{
    order: { rental: number; deposit: number };
    items: { rental: number; deposit: number; count: number };
  }> {
    const { data: order, error: orderError } = await tenant.client
      .from("orders")
      .select("total_rental_grosze, total_deposit_grosze")
      .eq("tenant_id", tenant.tenantId)
      .eq("id", orderId)
      .single();
    if (orderError) throw new Error(`read order: ${orderError.message}`);

    const { data: items, error: itemsError } = await tenant.client
      .from("order_items")
      .select("rental_grosze, deposit_grosze")
      .eq("tenant_id", tenant.tenantId)
      .eq("order_id", orderId);
    if (itemsError) throw new Error(`read items: ${itemsError.message}`);

    return {
      order: {
        rental: order!.total_rental_grosze as number,
        deposit: order!.total_deposit_grosze as number,
      },
      items: {
        rental: (items ?? []).reduce((sum, row) => sum + (row.rental_grosze as number), 0),
        deposit: (items ?? []).reduce((sum, row) => sum + (row.deposit_grosze as number), 0),
        count: (items ?? []).length,
      },
    };
  }

  async function itemRow(itemId: string) {
    const { data } = await tenant.client
      .from("order_items")
      .select("id, unit_id, rental_grosze, deposit_grosze")
      .eq("tenant_id", tenant.tenantId)
      .eq("id", itemId)
      .maybeSingle();
    return data as { id: string; unit_id: string | null; rental_grosze: number; deposit_grosze: number } | null;
  }

  async function itemsOfOrder() {
    const { data } = await tenant.client
      .from("order_items")
      .select("id, product_id, unit_id, rental_grosze, deposit_grosze")
      .eq("tenant_id", tenant.tenantId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    return (data ?? []) as {
      id: string;
      product_id: string;
      unit_id: string | null;
      rental_grosze: number;
      deposit_grosze: number;
    }[];
  }

  async function setOrderStatus(status: string) {
    const { error } = await tenant.client
      .from("orders")
      .update({ order_status: status })
      .eq("tenant_id", tenant.tenantId)
      .eq("id", orderId);
    if (error) throw new Error(`set status ${status}: ${error.message}`);
  }

  beforeAll(async () => {
    admin = createAdminClient();
    tenant = await createTenantMember(admin, "a");
    memberContext.current = { tenantId: tenant.tenantId, supabase: tenant.client };

    const { data: customer, error: customerError } = await tenant.client
      .from("customers")
      .insert({ tenant_id: tenant.tenantId, email: `klient-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (customerError) throw new Error(`insert customers: ${customerError.message}`);
    customerId = customer!.id as string;

    const { data: heater, error: heaterError } = await tenant.client
      .from("products")
      .insert({
        tenant_id: tenant.tenantId,
        name: "Nagrzewnica do pozycji",
        base_price_day_grosze: HEATER.basePriceDayGrosze,
        deposit_grosze: HEATER.depositGrosze,
        buffer_before_days: 0,
        buffer_after_days: 0,
      })
      .select("id")
      .single();
    if (heaterError) throw new Error(`insert products: ${heaterError.message}`);
    heaterId = heater!.id as string;

    const { data: units, error: unitsError } = await tenant.client
      .from("product_units")
      .insert([
        { tenant_id: tenant.tenantId, product_id: heaterId, serial_number: "ITEMS-001" },
        { tenant_id: tenant.tenantId, product_id: heaterId, serial_number: "ITEMS-002" },
      ])
      .select("id");
    if (unitsError) throw new Error(`insert product_units: ${unitsError.message}`);
    heaterUnits = (units ?? []).map((unit) => unit.id as string);

    const { data: cable, error: cableError } = await tenant.client
      .from("products")
      .insert({
        tenant_id: tenant.tenantId,
        name: "Przedłużacz bez egzemplarzy",
        base_price_day_grosze: CABLE.basePriceDayGrosze,
        deposit_grosze: CABLE.depositGrosze,
        buffer_before_days: 0,
        buffer_after_days: 0,
      })
      .select("id")
      .single();
    if (cableError) throw new Error(`insert products (cable): ${cableError.message}`);
    cableId = cable!.id as string;

    // Zamówienie startuje PUSTE (RPC create_order wymaga pozycji, więc
    // wstawiamy zamówienie wprost) — dodawanie pozycji jest tu przedmiotem
    // testu, a nie warunkiem wstępnym.
    const { data: order, error: orderError } = await tenant.client
      .from("orders")
      .insert({
        tenant_id: tenant.tenantId,
        customer_id: customerId,
        start_date: START,
        end_date: END,
        delivery_method: "courier",
        total_rental_grosze: 0,
        total_deposit_grosze: 0,
      })
      .select("id")
      .single();
    if (orderError) throw new Error(`insert orders: ${orderError.message}`);
    orderId = order!.id as string;
  }, 60_000);

  afterAll(async () => {
    memberContext.current = null;
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

  it("dodaje pozycję z WOLNYM egzemplarzem, a sumy zgadzają się co do grosza", async () => {
    const state = await addOrderItemAction({}, form({ orderId, productId: heaterId }));
    expect(state.formError).toBeUndefined();
    expect(state.success).toBe("item-added");

    const items = await itemsOfOrder();
    expect(items).toHaveLength(1);
    expect(items[0]!.unit_id).not.toBeNull();
    expect(heaterUnits).toContain(items[0]!.unit_id);

    // Wycena z silnika, nie z palca: 5 dni × 100 zł, kaucja 50 zł.
    const price = calculatePrice(START, END, HEATER);
    expect(price.rentalGrosze).toBe(50_000);
    expect(items[0]!.rental_grosze).toBe(price.rentalGrosze);
    expect(items[0]!.deposit_grosze).toBe(price.depositGrosze);

    const totals = await totalsVsItems();
    expect(totals.order).toEqual({ rental: 50_000, deposit: 5_000 });
    expect(totals.order.rental).toBe(totals.items.rental);
    expect(totals.order.deposit).toBe(totals.items.deposit);
  });

  it("dodaje pozycję JEDNYM krokiem: wybrany egzemplarz + RĘCZNE kwoty (R1)", async () => {
    // Własne zamówienie w odległym terminie — bez kolizji z egzemplarzami,
    // którymi obracają pozostałe testy na wspólnym `orderId`.
    const OWN_START = "2028-01-10";
    const OWN_END = "2028-01-14";
    const { data: own, error: ownError } = await tenant.client
      .from("orders")
      .insert({
        tenant_id: tenant.tenantId,
        customer_id: customerId,
        start_date: OWN_START,
        end_date: OWN_END,
        delivery_method: "courier",
        total_rental_grosze: 0,
        total_deposit_grosze: 0,
      })
      .select("id")
      .single();
    if (ownError) throw new Error(`insert own order: ${ownError.message}`);
    const ownOrderId = own!.id as string;

    // Komplet z formularza: konkretny egzemplarz + kwoty operatora (inne niż
    // wycena silnika — dowód, że to ręczne kwoty jadą do bazy, nie propozycja).
    const engine = calculatePrice(OWN_START, OWN_END, HEATER);
    const state = await addOrderItemAction(
      {},
      form({
        orderId: ownOrderId,
        productId: heaterId,
        // DRUGA sztuka, nie pierwsza — auto-dobór wybrałby units[0], więc
        // dopiero units[1] odróżnia uszanowany wybór operatora od zbiegu
        // okoliczności (mutacja PM: akcja ignorująca unitId przechodziła
        // na units[0] całą suitę).
        unitId: heaterUnits[1]!,
        rental: "123,45",
        deposit: "67,89",
      }),
    );
    expect(state.formError).toBeUndefined();
    expect(state.success).toBe("item-added");

    const { data: rows } = await tenant.client
      .from("order_items")
      .select("unit_id, rental_grosze, deposit_grosze")
      .eq("tenant_id", tenant.tenantId)
      .eq("order_id", ownOrderId);
    expect(rows).toHaveLength(1);
    const row = rows![0]!;
    // Egzemplarz z formularza, nie auto-dobór.
    expect(row.unit_id).toBe(heaterUnits[1]);
    expect(row.unit_id).not.toBe(heaterUnits[0]);
    // Kwoty RĘCZNE, a nie z silnika — komplet w jednym zapisie.
    expect(row.rental_grosze).toBe(12_345);
    expect(row.deposit_grosze).toBe(6_789);
    expect(row.rental_grosze).not.toBe(engine.rentalGrosze);

    // Sumy zamówienia przeliczone z tej jednej pozycji.
    const { data: ownOrder } = await tenant.client
      .from("orders")
      .select("total_rental_grosze, total_deposit_grosze")
      .eq("tenant_id", tenant.tenantId)
      .eq("id", ownOrderId)
      .single();
    expect(ownOrder!.total_rental_grosze).toBe(12_345);
    expect(ownOrder!.total_deposit_grosze).toBe(6_789);
  });

  it("ręczna zmiana ceny i kaucji zapisuje grosze i przelicza sumy", async () => {
    const [item] = await itemsOfOrder();
    const state = await updateOrderItemAction(
      {},
      form({
        orderId,
        itemId: item!.id,
        unitId: item!.unit_id ?? "",
        // Rabat handlowy: 420,50 zł najmu, 99 zł kaucji — obie z groszami.
        rental: "420,50",
        deposit: "99",
      }),
    );
    expect(state.formError).toBeUndefined();
    expect(state.success).toBe("item-updated");

    const after = await itemRow(item!.id);
    expect(after!.rental_grosze).toBe(42_050);
    expect(after!.deposit_grosze).toBe(9_900);

    const totals = await totalsVsItems();
    expect(totals.order).toEqual({ rental: 42_050, deposit: 9_900 });
    expect(totals.order.rental).toBe(totals.items.rental);
    expect(totals.order.deposit).toBe(totals.items.deposit);
  });

  it("dodaje produkt BEZ wolnego egzemplarza jako pozycję bez przypisania", async () => {
    const state = await addOrderItemAction({}, form({ orderId, productId: cableId }));
    expect(state.formError).toBeUndefined();
    // Nie „sukces po cichu": operator dostaje zdanie o braku przypisania.
    expect(state.notice).toContain("BEZ przypisanego egzemplarza");

    const items = await itemsOfOrder();
    const cableItem = items.find((row) => row.product_id === cableId);
    expect(cableItem).toBeDefined();
    expect(cableItem!.unit_id).toBeNull();
    expect(cableItem!.rental_grosze).toBe(calculatePrice(START, END, CABLE).rentalGrosze);

    const totals = await totalsVsItems();
    expect(totals.order.rental).toBe(totals.items.rental);
    expect(totals.order.deposit).toBe(totals.items.deposit);
  });

  it("odmawia przypisania egzemplarza ZAJĘTEGO w tym terminie i nic nie zmienia", async () => {
    // Sąsiednie zamówienie w tym samym terminie zajmuje DRUGI egzemplarz.
    const price = calculatePrice(START, END, HEATER);
    const { data: rivalId, error: rivalError } = await tenant.client
      .schema("app")
      .rpc("create_order", {
        p_customer_id: customerId,
        p_start_date: START,
        p_end_date: END,
        p_delivery_method: "courier",
        p_pickup_location_id: null,
        p_notes: null,
        p_total_rental_grosze: price.rentalGrosze,
        p_total_deposit_grosze: price.depositGrosze,
        p_items: [
          {
            product_id: heaterId,
            unit_id: heaterUnits[1],
            rental_grosze: price.rentalGrosze,
            deposit_grosze: price.depositGrosze,
          },
        ],
      });
    if (rivalError) throw new Error(`create_order (rywal): ${rivalError.message}`);
    const { data: rival } = await tenant.client
      .from("orders")
      .select("order_number")
      .eq("id", rivalId as string)
      .single();

    const items = await itemsOfOrder();
    const heaterItem = items.find((row) => row.product_id === heaterId)!;
    const before = await itemRow(heaterItem.id);
    const totalsBefore = await totalsVsItems();

    const state = await updateOrderItemAction(
      {},
      form({
        orderId,
        itemId: heaterItem.id,
        // Egzemplarz sąsiada — bramka 0010 musi to odbić (23P01).
        unitId: heaterUnits[1]!,
        rental: "1",
        deposit: "1",
      }),
    );

    expect(state.success).toBeUndefined();
    expect(state.formError).toContain("niedostępny w terminie zamówienia");
    // ADR-181 (0082): powód rodzajowy, BEZ numeru sąsiada. Ta sama funkcja
    // bramki odmawia niezalogowanemu klientowi sklepu, więc numer nie może
    // jechać jej komunikatem — asercja pilnuje, żeby nie wrócił tą drogą.
    expect(
      state.formError,
      "komunikat operatora znów niesie numer kolidującego zamówienia (regres ADR-181)",
    ).not.toContain(rival!.order_number as string);

    // W bazie NIC — ani przypisanie, ani kwoty, ani sumy zamówienia.
    const after = await itemRow(heaterItem.id);
    expect(after).toEqual(before);
    expect(await totalsVsItems()).toEqual(totalsBefore);
  });

  it("zmiana kaucji NIE rusza rejestru kaucji", async () => {
    const items = await itemsOfOrder();
    const heaterItem = items.find((row) => row.product_id === heaterId)!;

    // Kaucja POBRANA — rejestr zna 99 zł, tyle realnie leży u wynajmującego.
    const { error: eventError } = await tenant.client.from("deposit_events").insert({
      tenant_id: tenant.tenantId,
      order_id: orderId,
      kind: "collected",
      amount_grosze: 9_900,
    });
    if (eventError) throw new Error(`insert deposit_events: ${eventError.message}`);

    const ledgerBefore = await tenant.client
      .from("deposit_events")
      .select("id, kind, amount_grosze")
      .eq("tenant_id", tenant.tenantId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    const state = await updateOrderItemAction(
      {},
      form({
        orderId,
        itemId: heaterItem.id,
        unitId: heaterItem.unit_id ?? "",
        rental: "420,50",
        // Obniżka ZAMIARU z 99 zł na 20 zł — to NIE jest zwrot 79 zł.
        deposit: "20",
      }),
    );
    expect(state.formError).toBeUndefined();
    expect(state.success).toBe("item-updated");

    const ledgerAfter = await tenant.client
      .from("deposit_events")
      .select("id, kind, amount_grosze")
      .eq("tenant_id", tenant.tenantId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    // Rejestr CO DO WIERSZA taki sam: żadnego „refunded", żadnej korekty kwoty.
    expect(ledgerAfter.data).toEqual(ledgerBefore.data);
    expect((ledgerAfter.data ?? []).reduce((sum, row) => sum + (row.amount_grosze as number), 0)).toBe(9_900);

    // …a kwota ZAMIERZONA poszła w dół i zgadza się z pozycjami.
    const totals = await totalsVsItems();
    expect(totals.order.deposit).toBe(2_000);
    expect(totals.order.deposit).toBe(totals.items.deposit);
  });

  it("usuwa pozycję i przelicza sumy zamówienia", async () => {
    const before = await itemsOfOrder();
    const cableItem = before.find((row) => row.product_id === cableId)!;

    const state = await removeOrderItemAction({}, form({ orderId, itemId: cableItem.id }));
    expect(state.formError).toBeUndefined();
    expect(state.success).toBe("item-removed");

    const after = await itemsOfOrder();
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((row) => row.id === cableItem.id)).toBe(false);

    // WEKTOR DOWODU MUTACYJNEGO: bez kroku przeliczenia w akcji sumy zostają
    // z usuniętą pozycją w środku i ta asercja pada.
    const totals = await totalsVsItems();
    expect(totals.order.rental).toBe(totals.items.rental);
    expect(totals.order.deposit).toBe(totals.items.deposit);
    expect(totals.order.rental).toBe(42_050);
  });

  it("odmawia edycji na zamówieniu WYDANYM (picked_up)", async () => {
    await setOrderStatus("reserved");
    await setOrderStatus("ready_for_pickup");
    await setOrderStatus("picked_up");

    const items = await itemsOfOrder();
    const totalsBefore = await totalsVsItems();

    const state = await updateOrderItemAction(
      {},
      form({ orderId, itemId: items[0]!.id, unitId: "", rental: "1", deposit: "1" }),
    );
    expect(state.success).toBeUndefined();
    expect(state.formError).toContain("wydany");

    const added = await addOrderItemAction({}, form({ orderId, productId: heaterId }));
    expect(added.success).toBeUndefined();
    expect(added.formError).toContain("wydany");

    expect(await itemsOfOrder()).toEqual(items);
    expect(await totalsVsItems()).toEqual(totalsBefore);
  });

  it("odmawia edycji na zamówieniu ZWRÓCONYM — tam bramka bazy w ogóle nie pyta o dostępność", async () => {
    await setOrderStatus("returned");

    const items = await itemsOfOrder();
    const totalsBefore = await totalsVsItems();

    // Gdyby ta zapora zniknęła, egzemplarz zajęty przez ŻYWE zamówienie
    // sąsiada dałby się tu przypisać bez jednego sprawdzenia: trigger 0010
    // dla statusu `returned` wychodzi przed `assert_unit_available`.
    const state = await updateOrderItemAction(
      {},
      form({ orderId, itemId: items[0]!.id, unitId: heaterUnits[1]!, rental: "1", deposit: "1" }),
    );
    expect(state.success).toBeUndefined();
    expect(state.formError).toContain("zamknięte");

    const removed = await removeOrderItemAction({}, form({ orderId, itemId: items[0]!.id }));
    expect(removed.success).toBeUndefined();
    expect(removed.formError).toContain("zamknięte");

    expect(await itemsOfOrder()).toEqual(items);
    expect(await totalsVsItems()).toEqual(totalsBefore);
  });
});
