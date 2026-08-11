/**
 * Okno domykania (Zasada 8, ADR-138) — testy BEHAWIORALNE produkcyjną drogą
 * wywołania: realne server actions + REALNY rdzeń guardu
 * (requireMemberWithClient) + realny assertClosableOrder; podstawiony jest
 * wyłącznie klient Supabase (atrapa z rejestratorem mutacji).
 *
 * Checklist spec (e):
 *   (e)1 — DOMYŚLNA ODMOWA: próbka realnych akcji BEZ opt-in `{ closing: true }`
 *          (przedłużenie, pozycje, katalog, zaproszenia) odmawia dla
 *          `suspended` w oknie i NIE dotyka żadnej tabeli poza `members`.
 *   (e)2 — ZEGAR przez akcję: po zamknięciu okna odmawia TAKŻE akcja
 *          z allowlisty (obie strony progu w tenant-status-guard.test.ts).
 *   (e)3 — FORWARD-ONLY: cofnięcie odrzucone, krok w przód przyjęty —
 *          pojedynczo i zbiorczo; anulowanie OFF.
 *   (e)4 — ZAMROŻONY ZBIÓR na akcjach: `unpaid` i `created_at > suspended_at`
 *          odmawiają; opłacone przed zawieszeniem przechodzi (przypadek
 *          webhookowy co do predykatu — closing-window.test.ts w core).
 *
 * Asercje mierzą ZDANIE BRAMKI (treść odmowy + zero mutacji), nie „error
 * truthy" — wzorzec tenant-status-guard.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireMemberWithClient } from "@/lib/auth";

const requireMemberMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-server", () => ({
  requireMember: (role?: string, options?: { closing?: boolean }) =>
    requireMemberMock(role, options),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  permanentRedirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "pl",
}));

const { changeOrderStatusAction, changeOrderStatusBulkAction } = await import(
  "@/app/[locale]/(panel)/zamowienia/actions"
);
const { collectDepositAction } = await import(
  "@/app/[locale]/(panel)/zamowienia/[id]/deposit-actions"
);
const { extendOrderAction } = await import(
  "@/app/[locale]/(panel)/zamowienia/[id]/extension-actions"
);
const { addOrderItemAction } = await import(
  "@/app/[locale]/(panel)/zamowienia/[id]/items-actions"
);
const { createProductAction } = await import("@/app/[locale]/(panel)/katalog/actions");
const { inviteMemberAction } = await import("@/app/[locale]/(panel)/zaproszenia/actions");

const DAY_MS = 24 * 60 * 60 * 1000;
const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
/** Zawieszenie 5 dni temu — okno szeroko otwarte. */
const SUSPENDED_AT = () => new Date(Date.now() - 5 * DAY_MS).toISOString();
const BEFORE_SUSPENSION = () => new Date(Date.now() - 10 * DAY_MS).toISOString();
const AFTER_SUSPENSION = () => new Date(Date.now() - 1 * DAY_MS).toISOString();

const ORDER_A = "33333333-3333-4333-8333-333333333331";
const ORDER_B = "33333333-3333-4333-8333-333333333332";
const ORDER_C = "33333333-3333-4333-8333-333333333333";
const ORDER_D = "33333333-3333-4333-8333-333333333334";

interface FakeOrder {
  id: string;
  order_number?: string;
  created_at: string;
  payment_status: string;
  order_status: string;
}

interface Mutation {
  table: string;
  kind: "update" | "insert";
  values: unknown;
  filters: [string, unknown][];
}

/**
 * Atrapa klienta Supabase pod produkcyjne zapytania tego zestawu akcji:
 * odczyt members (guard), odczyt orders (assertClosableOrder / bulk),
 * odczyt deposit_events, UPDATE orders i INSERT deposit_events.
 * Każda mutacja ląduje w `mutations` — dowód „odmowa = zero zapisów".
 */
function fakeDb(config: {
  status?: string;
  suspendedAt?: string | null;
  role?: string;
  orders?: FakeOrder[];
  depositEvents?: Record<string, { kind: string; amount_grosze: number }[]>;
}) {
  const mutations: Mutation[] = [];
  const foreignReads: string[] = [];
  const ordersById = new Map((config.orders ?? []).map((order) => [order.id, order]));

  function resolve(q: {
    table: string;
    mode: "select" | "update" | "insert";
    values?: unknown;
    filters: [string, unknown][];
    ins: [string, unknown[]][];
    single: boolean;
  }) {
    if (q.table === "members") {
      return {
        data: {
          role: config.role ?? "owner",
          tenants: {
            status: config.status ?? "active",
            suspended_at: config.suspendedAt ?? null,
          },
        },
        error: null,
      };
    }
    foreignReads.push(`${q.mode}:${q.table}`);
    if (q.table === "orders" && q.mode === "select") {
      const idEq = q.filters.find(([column]) => column === "id");
      if (idEq) {
        return { data: ordersById.get(idEq[1] as string) ?? null, error: null };
      }
      const idIn = q.ins.find(([column]) => column === "id");
      if (idIn) {
        const rows = idIn[1]
          .map((id) => ordersById.get(id as string))
          .filter((row): row is FakeOrder => Boolean(row))
          .map((row) => ({ id: row.id, order_number: row.order_number ?? row.id, order_status: row.order_status }));
        return { data: rows, error: null };
      }
      return { data: [], error: null };
    }
    if (q.table === "orders" && q.mode === "update") {
      mutations.push({ table: "orders", kind: "update", values: q.values, filters: q.filters });
      const idEq = q.filters.find(([column]) => column === "id");
      const fromEq = q.filters.find(([column]) => column === "order_status");
      const row = idEq ? ordersById.get(idEq[1] as string) : undefined;
      if (row && (!fromEq || row.order_status === fromEq[1])) {
        row.order_status = (q.values as { order_status: string }).order_status;
        return { data: [{ id: row.id }], error: null };
      }
      return { data: [], error: null };
    }
    if (q.table === "deposit_events" && q.mode === "select") {
      const orderEq = q.filters.find(([column]) => column === "order_id");
      const events = orderEq ? (config.depositEvents?.[orderEq[1] as string] ?? []) : [];
      return { data: events, error: null };
    }
    if (q.table === "deposit_events" && q.mode === "insert") {
      mutations.push({ table: "deposit_events", kind: "insert", values: q.values, filters: [] });
      const rows = Array.isArray(q.values) ? q.values : [q.values];
      return { data: rows.map((_, index) => ({ id: `de-${index}` })), error: null };
    }
    // Nieznany odczyt — pusto, żeby test padł na asercji, nie na wyjątku.
    return { data: q.single ? null : [], error: null };
  }

  function builder(table: string) {
    const q = {
      table,
      mode: "select" as "select" | "update" | "insert",
      values: undefined as unknown,
      filters: [] as [string, unknown][],
      ins: [] as [string, unknown[]][],
      single: false,
    };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (values: unknown) => {
        q.mode = "update";
        q.values = values;
        return b;
      },
      insert: (values: unknown) => {
        q.mode = "insert";
        q.values = values;
        return b;
      },
      eq: (column: string, value: unknown) => {
        q.filters.push([column, value]);
        return b;
      },
      in: (column: string, values: unknown[]) => {
        q.ins.push([column, values]);
        return b;
      },
      lt: (column: string, value: unknown) => {
        q.filters.push([`lt:${column}`, value]);
        return b;
      },
      order: () => b,
      limit: () => b,
      maybeSingle: async () => {
        q.single = true;
        return resolve(q);
      },
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve(q)).then(onFulfilled, onRejected),
    };
    return b;
  }

  const client = {
    auth: {
      getClaims: async () => ({
        data: {
          claims: {
            sub: USER,
            email: "op@test.local",
            app_metadata: { tenant_id: TENANT, role: config.role ?? "owner" },
          },
        },
        error: null,
      }),
    },
    from: (table: string) => builder(table),
    schema: () => ({
      rpc: async () => ({ data: null, error: null }),
    }),
  };
  return { client: client as never, mutations, foreignReads };
}

/** Guard produkcyjny na atrapie klienta — dokładnie to robi requireMember. */
function wireGuard(db: ReturnType<typeof fakeDb>) {
  requireMemberMock.mockImplementation((role?: string, options?: { closing?: boolean }) =>
    requireMemberWithClient(db.client, role as never, options),
  );
}

beforeEach(() => {
  requireMemberMock.mockReset();
});

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

describe("(e)1 DOMYŚLNA ODMOWA — akcje bez opt-in odmawiają w oknie i nie tykają bazy", () => {
  const suspendedDb = () => fakeDb({ status: "suspended", suspendedAt: SUSPENDED_AT() });

  it("extendOrderAction (przedłużenie) → odmowa okna, zero mutacji", async () => {
    const db = suspendedDb();
    wireGuard(db);
    const state = await extendOrderAction(
      {},
      form({ orderId: ORDER_A, newEndDate: "2026-09-10", expectedEndDate: "2026-09-01" }),
    );
    expect(state.formError).toMatch(/oknie domykania/);
    expect(db.mutations).toEqual([]);
    expect(db.foreignReads).toEqual([]);
  });

  it("addOrderItemAction (pozycje) → odmowa okna, zero mutacji", async () => {
    const db = suspendedDb();
    wireGuard(db);
    const state = await addOrderItemAction(
      {},
      form({ orderId: ORDER_A, productId: ORDER_B }),
    );
    expect(state.formError).toMatch(/oknie domykania/);
    expect(db.mutations).toEqual([]);
    expect(db.foreignReads).toEqual([]);
  });

  it("createProductAction (katalog) → odmowa okna, zero mutacji", async () => {
    const db = suspendedDb();
    wireGuard(db);
    const state = await createProductAction(
      {},
      form({
        name: "Produkt testowy",
        description: "",
        basePriceDayGrosze: "100",
        depositGrosze: "",
        autoIncrementMultiplier: "1",
        bufferBeforeDays: "0",
        bufferAfterDays: "0",
      }),
    );
    expect(state.formError).toMatch(/oknie domykania/);
    expect(db.mutations).toEqual([]);
    expect(db.foreignReads).toEqual([]);
  });

  it("inviteMemberAction (zaproszenia, owner) → odmowa okna, zero mutacji", async () => {
    const db = suspendedDb();
    wireGuard(db);
    const state = await inviteMemberAction(
      {},
      form({ email: "nowy@test.local", role: "staff" }),
    );
    expect(state.error).toMatch(/oknie domykania/);
    expect(db.mutations).toEqual([]);
    expect(db.foreignReads).toEqual([]);
  });
});

describe("(e)2 ZEGAR przez akcję z allowlisty", () => {
  it("po zamknięciu okna changeOrderStatusAction odmawia mimo opt-in — i bez mutacji", async () => {
    const db = fakeDb({
      status: "suspended",
      suspendedAt: new Date(Date.now() - 31 * DAY_MS).toISOString(),
      orders: [
        { id: ORDER_A, created_at: BEFORE_SUSPENSION(), payment_status: "paid", order_status: "picked_up" },
      ],
    });
    wireGuard(db);
    const state = await changeOrderStatusAction(
      {},
      form({ orderId: ORDER_A, to: "returned", expectedFrom: "picked_up" }),
    );
    expect(state.formError).toMatch(/zawieszona/);
    expect(db.mutations).toEqual([]);
  });
});

describe("(e)3 FORWARD-ONLY — pojedyncza akcja statusu", () => {
  const dbWith = (order: Partial<FakeOrder>) =>
    fakeDb({
      status: "suspended",
      suspendedAt: SUSPENDED_AT(),
      orders: [
        {
          id: ORDER_A,
          created_at: BEFORE_SUSPENSION(),
          payment_status: "paid",
          order_status: "picked_up",
          ...order,
        },
      ],
    });

  it("picked_up → returned PRZYJĘTE (mutacja wychodzi)", async () => {
    const db = dbWith({});
    wireGuard(db);
    const state = await changeOrderStatusAction(
      {},
      form({ orderId: ORDER_A, to: "returned", expectedFrom: "picked_up" }),
    );
    expect(state.success).toBe("changed");
    expect(db.mutations).toHaveLength(1);
    expect(db.mutations[0]).toMatchObject({ table: "orders", kind: "update" });
  });

  it("picked_up → ready_for_pickup (cofnięcie legalne poza oknem) ODRZUCONE predykatem", async () => {
    const db = dbWith({});
    wireGuard(db);
    const state = await changeOrderStatusAction(
      {},
      form({ orderId: ORDER_A, to: "ready_for_pickup", expectedFrom: "picked_up" }),
    );
    expect(state.formError).toMatch(/do przodu/);
    expect(db.mutations).toEqual([]);
  });

  it("pending → reserved (przyjęcie rezerwacji) ODRZUCONE", async () => {
    const db = dbWith({ order_status: "pending" });
    wireGuard(db);
    const state = await changeOrderStatusAction(
      {},
      form({ orderId: ORDER_A, to: "reserved", expectedFrom: "pending" }),
    );
    expect(state.formError).toMatch(/do przodu/);
    expect(db.mutations).toEqual([]);
  });

  it("anulowanie OFF bez wyjątków (reserved → cancelled)", async () => {
    const db = dbWith({ order_status: "reserved" });
    wireGuard(db);
    const state = await changeOrderStatusAction(
      {},
      form({ orderId: ORDER_A, to: "cancelled", expectedFrom: "reserved" }),
    );
    expect(state.formError).toMatch(/do przodu/);
    expect(db.mutations).toEqual([]);
  });
});

describe("(e)3 FORWARD-ONLY — wersja zbiorcza (raport per zamówienie)", () => {
  it("krok w przód wchodzi, cofnięcie/poza-zbiorem odpadają powodem closing-window", async () => {
    const db = fakeDb({
      status: "suspended",
      suspendedAt: SUSPENDED_AT(),
      orders: [
        // A: ready_for_pickup → picked_up = do przodu (przechodzi).
        { id: ORDER_A, order_number: "A-1", created_at: BEFORE_SUSPENSION(), payment_status: "paid", order_status: "ready_for_pickup" },
        // B: reserved → picked_up = NIE-forward (predykat odrzuca przed bazą).
        { id: ORDER_B, order_number: "A-2", created_at: BEFORE_SUSPENSION(), payment_status: "paid", order_status: "reserved" },
        // C: forward, ale UNPAID — poza zamrożonym zbiorem.
        { id: ORDER_C, order_number: "A-3", created_at: BEFORE_SUSPENSION(), payment_status: "unpaid", order_status: "ready_for_pickup" },
      ],
    });
    wireGuard(db);

    const fd = new FormData();
    fd.append("orderId", ORDER_A);
    fd.append("orderId", ORDER_B);
    fd.append("orderId", ORDER_C);
    fd.set("to", "picked_up");

    const state = await changeOrderStatusBulkAction({}, fd);
    expect(state.report).toBeDefined();
    expect(state.report!.changed.map((entry) => entry.orderId)).toEqual([ORDER_A]);
    const rejectedById = new Map(
      state.report!.rejected.map((entry) => [entry.orderId, entry.reason]),
    );
    expect(rejectedById.get(ORDER_B)).toBe("closing-window");
    expect(rejectedById.get(ORDER_C)).toBe("closing-window");
    // Dokładnie JEDNA mutacja — odmowy zapadły PRZED bazą.
    expect(db.mutations.filter((mutation) => mutation.kind === "update")).toHaveLength(1);
  });
});

describe("(e)4 ZAMROŻONY ZBIÓR na akcjach domykających", () => {
  const orders = (): FakeOrder[] => [
    { id: ORDER_A, created_at: BEFORE_SUSPENSION(), payment_status: "paid", order_status: "picked_up" },
    { id: ORDER_B, created_at: BEFORE_SUSPENSION(), payment_status: "unpaid", order_status: "picked_up" },
    { id: ORDER_C, created_at: AFTER_SUSPENSION(), payment_status: "paid", order_status: "picked_up" },
    { id: ORDER_D, created_at: BEFORE_SUSPENSION(), payment_status: "manual", order_status: "returned" },
  ];
  const db = () =>
    fakeDb({
      status: "suspended",
      suspendedAt: SUSPENDED_AT(),
      orders: orders(),
      depositEvents: {
        // D: returned z saldem 0 — wypadło ze zbioru.
        [ORDER_D]: [
          { kind: "collected", amount_grosze: 10_000 },
          { kind: "refunded", amount_grosze: 10_000 },
        ],
      },
    });

  it("unpaid → wszystkie akcje domykające odmawiają (status), zero mutacji", async () => {
    const database = db();
    wireGuard(database);
    const state = await changeOrderStatusAction(
      {},
      form({ orderId: ORDER_B, to: "returned", expectedFrom: "picked_up" }),
    );
    expect(state.formError).toMatch(/opłacone przed zawieszeniem/);
    expect(database.mutations).toEqual([]);
  });

  it("created_at > suspended_at → odmowa (kaucja), zero insertów", async () => {
    const database = db();
    wireGuard(database);
    const state = await collectDepositAction(
      {},
      form({ orderId: ORDER_C, amount: "100" }),
    );
    expect(state.formError).toMatch(/opłacone przed zawieszeniem/);
    expect(database.mutations).toEqual([]);
  });

  it("opłacone przed zawieszeniem → kaucja przechodzi (insert do rejestru)", async () => {
    const database = db();
    wireGuard(database);
    const state = await collectDepositAction(
      {},
      form({ orderId: ORDER_A, amount: "100" }),
    );
    expect(state.formError).toBeUndefined();
    expect(state.success).toBe("collected");
    expect(database.mutations).toHaveLength(1);
    expect(database.mutations[0]).toMatchObject({ table: "deposit_events", kind: "insert" });
  });

  it("returned z saldem 0 wypadło ze zbioru → odmowa", async () => {
    const database = db();
    wireGuard(database);
    const state = await changeOrderStatusAction(
      {},
      // returned jest terminalne, ale odmowa zbioru ma zapaść PRZED
      // canTransition — bierzemy akcję notatki? Nie: sprawdzamy przez
      // collectDeposit (akcja domykająca bez maszyny stanów).
      form({ orderId: ORDER_D, to: "returned", expectedFrom: "picked_up" }),
    );
    expect(state.formError).toMatch(/opłacone przed zawieszeniem/);
    expect(database.mutations).toEqual([]);
  });

  it("poza oknem domykania (tenant active) predykat NIE kosztuje żadnego zapytania", async () => {
    const database = fakeDb({
      status: "active",
      orders: orders(),
    });
    wireGuard(database);
    const state = await changeOrderStatusAction(
      {},
      form({ orderId: ORDER_A, to: "returned", expectedFrom: "picked_up" }),
    );
    expect(state.success).toBe("changed");
    // Jedyny ruch na orders to UPDATE — zero odczytów assertClosableOrder.
    expect(database.foreignReads.filter((read) => read === "select:orders")).toEqual([]);
  });
});
