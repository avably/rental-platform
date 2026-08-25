/**
 * Znacznik FAKTYCZNEJ daty zwrotu — orders.returned_at
 * (packages/db/supabase/migrations/0112_order_returned_at.sql, ADR-270)
 * — dowód dla Finding 2 audytu cyklu zamówienia (LOW, missing-logic).
 *
 * DLACZEGO NA ŻYWEJ BAZIE. Reguła jest WŁASNOŚCIĄ BAZY: znacznik ustawia
 * trigger BEFORE UPDATE `app.orders_write_gate` w TYM SAMYM zapisie, który
 * przenosi status w `returned`. Test w JS obok komponentu przeszedłby także
 * wtedy, gdyby trigger nic nie robił — dowodem musi być odczyt returned_at
 * PROSTO z wiersza po tranzycji, tą samą ścieżką (UPDATE + select), którą
 * idzie panel. Zapisy idą kluczem service_role: bramka obowiązuje KAŻDĄ rolę
 * (import danych też nie ma prawa tworzyć stanów niespójnych — ADR-025), więc
 * jeśli znacznik pada dla roli omijającej RLS, pada dla każdej.
 *
 * ATOMOWOŚĆ. Asercja czyta returned_at z odpowiedzi TEGO SAMEGO UPDATE,
 * który ustawia order_status = 'returned' (`.select("returned_at, updated_at")`).
 * Niepusty returned_at w zwróconym wierszu znaczy, że powstał WEWNĄTRZ tego
 * zapisu, a nie osobnym krokiem, który mógłby nie dojść.
 *
 * IDEMPOTENCJA. `returned` jest terminalny (mapa przejść 0010), więc znacznik
 * utrwala się raz. Ponowny UPDATE tej samej wartości statusu nie wchodzi w
 * gałąź `is distinct` i NIE nadpisuje returned_at — osobny przypadek to
 * przypina.
 *
 * DOWÓD MUTACYJNY (staged, wykonany ręcznie — DROP/replace na WSPÓLNEJ bazie
 * uderzyłby w równoległe sesje, więc nie ma go w suicie): przy kolumnie
 * obecnej, ale funkcji SPRZED 0112 (bez wiersza `new.returned_at := now()`),
 * przejście → returned zostawia returned_at NULL i test „ustawia returned_at"
 * świeci na czerwono; po zastosowaniu bloku funkcji z 0112 wraca na zielono.
 * Przebieg udokumentowany we wpisie ADR-270.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*
 * (patrz docs/konwencje-migracji.md). Bez nich cały plik jest pomijany.
 */
import { randomUUID } from "node:crypto";

import type { OrderStatus } from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import { createAdminClient } from "./helpers/seed-tenants";

const hasEnv = integrationEnv([
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
]);

describe.skipIf(!hasEnv)("znacznik returned_at — 0112_order_returned_at.sql", () => {
  let admin: SupabaseClient;
  const createdTenantIds: string[] = [];

  beforeAll(() => {
    admin = createAdminClient();
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
  });

  async function createTenant(label: string): Promise<string> {
    const { data, error } = await admin
      .from("tenants")
      .insert({
        slug: `returned-at-${label}-${randomUUID()}`.slice(0, 39),
        name: `Returned-at test tenant ${label}`,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createTenant(${label}): ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  /** Świeże zamówienie (rodzi się jako pending) — bez pozycji: sam cykl statusu. */
  async function createOrder(tenantId: string): Promise<string> {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, email: `returned-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`createCustomer: ${customerError?.message}`);

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        start_date: "2026-09-01",
        end_date: "2026-09-03",
        delivery_method: "courier",
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(`createOrder: ${orderError?.message}`);
    return order.id as string;
  }

  /**
   * UPDATE statusu tą samą drogą co panel — zwraca wiersz PO triggerze, więc
   * returned_at i updated_at są odczytane z TEGO zapisu (dowód atomowości).
   */
  async function setStatus(
    orderId: string,
    to: OrderStatus,
  ): Promise<{ returned_at: string | null; updated_at: string }> {
    const { data, error } = await admin
      .from("orders")
      .update({ order_status: to })
      .eq("id", orderId)
      .select("returned_at, updated_at")
      .single();
    if (error || !data) throw new Error(`setStatus(${to}): ${error?.message ?? "brak wiersza"}`);
    return data as { returned_at: string | null; updated_at: string };
  }

  async function readReturnedAt(orderId: string): Promise<string | null> {
    const { data, error } = await admin
      .from("orders")
      .select("returned_at")
      .eq("id", orderId)
      .single();
    if (error || !data) throw new Error(`readReturnedAt: ${error?.message ?? "brak wiersza"}`);
    return (data as { returned_at: string | null }).returned_at;
  }

  it("przejście → returned ustawia returned_at w TYM SAMYM UPDATE; stany pośrednie mają NULL", async () => {
    const tenantId = await createTenant("sets");
    const orderId = await createOrder(tenantId);

    // Spacer po dozwolonych przejściach — dokładnie tak wchodzi się w returned.
    // Żaden krok PRZED zwrotem nie tyka znacznika.
    expect((await setStatus(orderId, "reserved")).returned_at).toBeNull();
    expect((await setStatus(orderId, "ready_for_pickup")).returned_at).toBeNull();
    expect((await setStatus(orderId, "picked_up")).returned_at).toBeNull();

    const before = Date.now();
    const returned = await setStatus(orderId, "returned");
    const after = Date.now();

    // Sedno: znacznik JEST w wierszu zwróconym przez ten UPDATE — powstał
    // wewnątrz zapisu przejścia, nie osobnym krokiem.
    expect(returned.returned_at).not.toBeNull();
    const stampedAt = new Date(returned.returned_at as string).getTime();
    // Znacznik to czas TEJ tranzycji (now() transakcji) — mieści się w oknie
    // wywołania, z małym marginesem na zaokrąglenia zegara/RTT.
    expect(stampedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(stampedAt).toBeLessThanOrEqual(after + 1000);
    // now() jest wspólne dla returned_at i updated_at w tej transakcji.
    expect(returned.returned_at).toBe(returned.updated_at);
  });

  it("ponowny zapis statusu returned NIE nadpisuje znacznika (idempotencja)", async () => {
    const tenantId = await createTenant("idempotent");
    const orderId = await createOrder(tenantId);

    await setStatus(orderId, "reserved");
    await setStatus(orderId, "ready_for_pickup");
    await setStatus(orderId, "picked_up");
    const first = (await setStatus(orderId, "returned")).returned_at;
    expect(first).not.toBeNull();

    // UPDATE tej samej wartości statusu: order_status nie jest `is distinct`,
    // więc gałąź przejścia w ogóle nie biegnie — znacznik z pierwszego zwrotu
    // musi przetrwać (updated_at może się przesunąć, returned_at NIE).
    const again = await setStatus(orderId, "returned");
    expect(again.returned_at).toBe(first);
    expect(await readReturnedAt(orderId)).toBe(first);
  });

  it("cancelled NIE ustawia returned_at — znacznik dotyczy WYŁĄCZNIE zwrotu", async () => {
    const tenantId = await createTenant("cancelled");
    const orderId = await createOrder(tenantId);

    const cancelled = await setStatus(orderId, "cancelled");
    expect(cancelled.returned_at).toBeNull();
    expect(await readReturnedAt(orderId)).toBeNull();
  });
});
