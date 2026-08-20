/**
 * Idempotencja nadania kuriera + refresh nie kasuje trackingu (L5, ADR-223) —
 * `createShipmentAction`, `refreshShipmentStatusAction`, `refreshOrderShipmentsAction`.
 *
 * Test jednostkowy z fałszywym query-builderem (wzorzec `shipment-cancel.test.ts`)
 * i fałszywym portem kuriera: mierzymy KOLEJNOŚĆ I LICZBĘ wywołań płatnego
 * `createOrderBestPrice`, a nie zawartość bazy. Fałszywy Supabase modeluje
 * unikat CZĘŚCIOWY z 0091 (rejestr aktywnych claimów), więc drugie zaklepanie
 * tego samego (tenant, order, typ) dostaje 23505 — dokładnie tak, jak baza.
 *
 * Trzy dowody:
 *   1. dwa nadania (sekwencyjnie I w wyścigu) → płatne wywołanie DOKŁADNIE RAZ;
 *   2. claim tenanta A nie blokuje zamówienia B (izolacja), a zaklepanie bierze
 *      tenant z KONTEKSTU, nie z formularza;
 *   3. refresh bez numeru trackingu ZOSTAWIA już zapisany (nie zeruje na null).
 *
 * DOWÓD MUTACYJNY (opis dla recenzenta):
 *   - usuń bramkę claim-first (wstaw od razu wiersz 'created' zamiast 'pending'
 *     + brak sprawdzenia 23505) → testy 1 łapią DRUGIE płatne wywołanie (RED);
 *   - przywróć `tracking_number: remote.trackingNumber ?? null` → test 3 RED.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireMember = vi.fn();
const loadCourierApi = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  requireMember: (...args: unknown[]) => requireMember(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/app/[locale]/(panel)/zamowienia/[id]/delivery", () => ({
  loadCourierApi: (...args: unknown[]) => loadCourierApi(...args),
}));

const { createShipmentAction, refreshShipmentStatusAction, refreshOrderShipmentsAction } =
  await import("@/app/[locale]/(panel)/zamowienia/[id]/delivery-actions");

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const BOGUS_TENANT = "99999999-9999-4999-8999-999999999999";
const ORDER_X = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER_Y = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHIPMENT = "33333333-3333-4333-8333-333333333333";

/** Poprawny komplet pól modalu nadania — stały prefill, zmienny orderId. */
function createForm(orderId: string, formTenant?: string): FormData {
  const data = new FormData();
  data.set("orderId", orderId);
  data.set("shipmentType", "outbound");
  data.set("lengthCm", "60");
  data.set("widthCm", "40");
  data.set("heightCm", "30");
  data.set("weightKg", "10");
  data.set("content", "Sprzęt");
  for (const side of ["sender", "recipient"] as const) {
    data.set(`${side}Name`, "Jan Testowy");
    data.set(`${side}Street`, "Testowa");
    data.set(`${side}HouseNumber`, "1");
    data.set(`${side}PostCode`, "00-001");
    data.set(`${side}City`, "Miastko");
    data.set(`${side}Phone`, "+48600000000");
    data.set(`${side}Email`, `${side}@example.com`);
  }
  // Formularz NIE steruje tenantem — akcja bierze go z kontekstu. Dokładamy
  // pole, żeby dowieść, że jest ignorowane.
  if (formTenant) data.set("tenantId", formTenant);
  return data;
}

/**
 * Fałszywy Supabase dla courier_shipments z REJESTREM aktywnych claimów —
 * modeluje unikat częściowy 0091: 'pending'/promowany zajmuje slot
 * (tenant|order|typ), 'cancelled' go zwalnia. Współdzielony między równoległymi
 * akcjami (jeden „serwer bazy") w teście wyścigu.
 */
function makeCourierDb() {
  const active = new Set<string>();
  const claims = new Map<string, string>();
  const calls = { inserts: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[] };
  let seq = 0;
  const keyOf = (o: Record<string, unknown>) => `${o.tenant_id}|${o.order_id}|${o.shipment_type}`;

  function clientFor(order: Record<string, unknown> | null) {
    return {
      from(table: string) {
        if (table === "orders") {
          const chain = {
            eq() {
              return chain;
            },
            maybeSingle: async () => ({ data: order, error: null }),
          };
          return { select: () => chain };
        }
        // courier_shipments
        return {
          insert(patch: Record<string, unknown>) {
            const key = keyOf(patch);
            if (patch.status === "pending") {
              if (active.has(key)) {
                return {
                  select: async () => ({
                    data: null,
                    error: { code: "23505", message: "duplicate key value" },
                  }),
                };
              }
              const id = `claim-${++seq}`;
              active.add(key);
              claims.set(id, key);
              calls.inserts.push(patch);
              return { select: async () => ({ data: [{ id }], error: null }) };
            }
            calls.inserts.push(patch);
            return { select: async () => ({ data: [{ id: `row-${++seq}` }], error: null }) };
          },
          update(patch: Record<string, unknown>) {
            const filters: Record<string, unknown> = {};
            const apply = () => {
              const key = claims.get(filters.id as string);
              if (patch.status === "cancelled" && key) active.delete(key);
              calls.updates.push(patch);
            };
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              select: async () => {
                apply();
                return { data: [{ id: filters.id }], error: null };
              },
              // Ścieżka zwolnienia (releaseClaim) awaituje łańcuch bez .select.
              then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
                return Promise.resolve()
                  .then(() => {
                    apply();
                    return { error: null };
                  })
                  .then(onF, onR);
              },
            };
            return chain;
          },
        };
      },
    };
  }

  return { clientFor, calls, active };
}

function courierApiOk() {
  const createOrderBestPrice = vi.fn(async () => ({
    number: `GK-${Math.random().toString(36).slice(2, 8)}`,
    hash: "h",
    status: "NEW_SHIPMENT",
    creationDate: new Date().toISOString(),
    pricing: { priceGross: 25, priceNet: 20, vatPercent: 23, currency: "PLN" },
    trackingNumber: "T1",
    trackingUrl: "u1",
  }));
  loadCourierApi.mockResolvedValue({ api: { createOrderBestPrice }, config: {} });
  return createOrderBestPrice;
}

const orderRow = (id: string) => ({ id, order_number: "ZM-1", delivery_method: "courier" });

describe("createShipmentAction — idempotencja nadania (L5, ADR-223)", () => {
  beforeEach(() => {
    requireMember.mockReset();
    loadCourierApi.mockReset();
  });

  it("dwa nadania SEKWENCYJNIE tego samego zamówienia → createOrderBestPrice DOKŁADNIE RAZ", async () => {
    const db = makeCourierDb();
    const createOrderBestPrice = courierApiOk();
    requireMember.mockResolvedValue({
      supabase: db.clientFor(orderRow(ORDER_X)),
      tenantId: TENANT_A,
      user: { id: "user-1", email: "owner@test.local" },
      role: "owner",
    });

    const first = await createShipmentAction({}, createForm(ORDER_X));
    const second = await createShipmentAction({}, createForm(ORDER_X));

    expect(first.success, `pierwsze nadanie: ${first.formError}`).toBe("outbound");
    expect(second.success).toBeUndefined();
    expect(second.formError, "drugie nadanie musi zostać odrzucone przed zapłatą").toBeTruthy();
    expect(createOrderBestPrice).toHaveBeenCalledTimes(1);
  });

  it("WYŚCIG: dwa równoległe nadania tego samego zamówienia → createOrderBestPrice DOKŁADNIE RAZ", async () => {
    const db = makeCourierDb();
    const createOrderBestPrice = courierApiOk();
    requireMember.mockResolvedValue({
      supabase: db.clientFor(orderRow(ORDER_X)),
      tenantId: TENANT_A,
      user: { id: "user-1", email: "owner@test.local" },
      role: "owner",
    });

    const [r1, r2] = await Promise.all([
      createShipmentAction({}, createForm(ORDER_X)),
      createShipmentAction({}, createForm(ORDER_X)),
    ]);

    expect(createOrderBestPrice, "płatne wywołanie w wyścigu poszło więcej niż raz").toHaveBeenCalledTimes(1);
    const successes = [r1, r2].filter((r) => r.success);
    const errors = [r1, r2].filter((r) => r.formError);
    expect(successes).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("po ODRZUCENIU przez dostawcę claim jest ZWOLNIONY (ponowienie znów płaci)", async () => {
    const db = makeCourierDb();
    const { GlobKurierAPIError } = await import("@avably/core");
    const createOrderBestPrice = vi
      .fn()
      .mockRejectedValueOnce(new GlobKurierAPIError("zły adres", 400))
      .mockResolvedValueOnce({
        number: "GK-OK",
        hash: "h",
        status: "NEW_SHIPMENT",
        creationDate: new Date().toISOString(),
        pricing: { priceGross: 25, priceNet: 20, vatPercent: 23, currency: "PLN" },
        trackingNumber: "T1",
        trackingUrl: "u1",
      });
    loadCourierApi.mockResolvedValue({ api: { createOrderBestPrice }, config: {} });
    requireMember.mockResolvedValue({
      supabase: db.clientFor(orderRow(ORDER_X)),
      tenantId: TENANT_A,
      user: { id: "user-1", email: "owner@test.local" },
      role: "owner",
    });

    const first = await createShipmentAction({}, createForm(ORDER_X));
    expect(first.formError, "odrzucenie dostawcy wraca do operatora").toBeTruthy();
    // Slot zwolniony → drugie nadanie WOLNO (dostawca nic nie policzył za pierwsze).
    const second = await createShipmentAction({}, createForm(ORDER_X));
    expect(second.success, `ponowienie po odrzuceniu: ${second.formError}`).toBe("outbound");
    expect(createOrderBestPrice).toHaveBeenCalledTimes(2);
    expect(db.active.size, "aktywny slot dokładnie jeden (promowana przesyłka)").toBe(1);
  });

  it("IZOLACJA: claim tenanta A nie blokuje zamówienia B; tenant bierze z kontekstu, nie z formularza", async () => {
    const db = makeCourierDb();
    const createOrderBestPrice = courierApiOk();

    requireMember.mockResolvedValueOnce({
      supabase: db.clientFor(orderRow(ORDER_X)),
      tenantId: TENANT_A,
      user: { id: "user-a", email: "a@test.local" },
      role: "owner",
    });
    const a = await createShipmentAction({}, createForm(ORDER_X, BOGUS_TENANT));

    requireMember.mockResolvedValueOnce({
      supabase: db.clientFor(orderRow(ORDER_Y)),
      tenantId: TENANT_B,
      user: { id: "user-b", email: "b@test.local" },
      role: "owner",
    });
    const b = await createShipmentAction({}, createForm(ORDER_Y, BOGUS_TENANT));

    expect(a.success).toBe("outbound");
    expect(b.success, `nadanie B nie może być zablokowane przez A: ${b.formError}`).toBe("outbound");
    expect(createOrderBestPrice).toHaveBeenCalledTimes(2);
    // Zaklepanie bierze tenant z KONTEKSTU (nie z podrzuconego formTenant).
    expect(db.calls.inserts[0].tenant_id).toBe(TENANT_A);
    expect(db.calls.inserts[1].tenant_id).toBe(TENANT_B);
    expect(db.calls.inserts.map((i) => i.tenant_id)).not.toContain(BOGUS_TENANT);
    // Zaklepanie idzie w stanie 'pending', BEZ numeru (claim-first).
    expect(db.calls.inserts[0].status).toBe("pending");
    expect(db.calls.inserts[0].provider_order_number).toBeUndefined();
  });
});

/** Fałszywy Supabase dla POJEDYNCZEGO refreshu (maybeSingle + update). */
function makeSingleRefreshDb(shipment: Record<string, unknown>) {
  const calls = { updates: [] as Record<string, unknown>[] };
  const client = {
    from() {
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            maybeSingle: async () => ({ data: shipment, error: null }),
          };
          return chain;
        },
        update(patch: Record<string, unknown>) {
          calls.updates.push(patch);
          const chain = {
            eq() {
              return chain;
            },
            select: async () => ({ data: [{ id: shipment.id }], error: null }),
          };
          return chain;
        },
      };
    },
  };
  return { client, calls };
}

/** Fałszywy Supabase dla refreshu ZBIORCZEGO (lista thenable + update). */
function makeBulkRefreshDb(shipments: Record<string, unknown>[]) {
  const calls = { updates: [] as Record<string, unknown>[] };
  const client = {
    from() {
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            not() {
              return chain;
            },
            then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
              return Promise.resolve({ data: shipments, error: null }).then(onF, onR);
            },
          };
          return chain;
        },
        update(patch: Record<string, unknown>) {
          calls.updates.push(patch);
          const chain = {
            eq() {
              return chain;
            },
            select: async () => ({ data: [{ id: "x" }], error: null }),
          };
          return chain;
        },
      };
    },
  };
  return { client, calls };
}

function refreshForm(shipmentId: string): FormData {
  const d = new FormData();
  d.set("shipmentId", shipmentId);
  return d;
}
function refreshAllForm(orderId: string): FormData {
  const d = new FormData();
  d.set("orderId", orderId);
  return d;
}

describe("refresh nie kasuje tracking_number (L5, ADR-223)", () => {
  beforeEach(() => {
    requireMember.mockReset();
    loadCourierApi.mockReset();
  });

  it("pojedynczy refresh bez numeru u dostawcy ZOSTAWIA zapisany tracking_number/url", async () => {
    const db = makeSingleRefreshDb({
      id: SHIPMENT,
      order_id: ORDER_X,
      provider_order_number: "GK1",
      tracking_number: "TRACK-KEEP",
      tracking_url: "https://track/keep",
    });
    loadCourierApi.mockResolvedValue({
      api: { getOrder: async () => ({ status: "IN_TRANSIT", trackingNumber: undefined, trackingUrl: undefined }) },
      config: {},
    });
    requireMember.mockResolvedValue({
      supabase: db.client,
      tenantId: TENANT_A,
      user: { id: "u", email: "o@test.local" },
      role: "owner",
    });

    const state = await refreshShipmentStatusAction({}, refreshForm(SHIPMENT));

    expect(state.success, `refresh: ${state.formError}`).toBe("refreshed");
    expect(db.calls.updates[0].tracking_number, "istniejący numer nie może zniknąć").toBe("TRACK-KEEP");
    expect(db.calls.updates[0].tracking_url).toBe("https://track/keep");
  });

  it("pojedynczy refresh Z numerem u dostawcy NADPISUJE tracking (świeża wartość wygrywa)", async () => {
    const db = makeSingleRefreshDb({
      id: SHIPMENT,
      order_id: ORDER_X,
      provider_order_number: "GK1",
      tracking_number: "TRACK-OLD",
      tracking_url: "https://track/old",
    });
    loadCourierApi.mockResolvedValue({
      api: { getOrder: async () => ({ status: "IN_TRANSIT", trackingNumber: "TRACK-NEW", trackingUrl: "https://track/new" }) },
      config: {},
    });
    requireMember.mockResolvedValue({
      supabase: db.client,
      tenantId: TENANT_A,
      user: { id: "u", email: "o@test.local" },
      role: "owner",
    });

    await refreshShipmentStatusAction({}, refreshForm(SHIPMENT));

    expect(db.calls.updates[0].tracking_number).toBe("TRACK-NEW");
    expect(db.calls.updates[0].tracking_url).toBe("https://track/new");
  });

  it("refresh ZBIORCZY bez numeru u dostawcy ZOSTAWIA zapisany tracking_number", async () => {
    const db = makeBulkRefreshDb([
      {
        id: SHIPMENT,
        provider_order_number: "GK1",
        tracking_number: "TRACK-KEEP",
        tracking_url: "https://track/keep",
      },
    ]);
    loadCourierApi.mockResolvedValue({
      api: { getOrder: async () => ({ status: "IN_TRANSIT", trackingNumber: undefined, trackingUrl: undefined }) },
      config: {},
    });
    requireMember.mockResolvedValue({
      supabase: db.client,
      tenantId: TENANT_A,
      user: { id: "u", email: "o@test.local" },
      role: "owner",
    });

    const state = await refreshOrderShipmentsAction({}, refreshAllForm(ORDER_X));

    expect(state.success ?? state.notice, `zbiorczy refresh: ${state.formError}`).toBeTruthy();
    expect(db.calls.updates[0].tracking_number).toBe("TRACK-KEEP");
    expect(db.calls.updates[0].tracking_url).toBe("https://track/keep");
  });
});
