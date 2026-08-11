/**
 * U3 (audyt W4): pobranie kaucji na zamówieniu ANULOWANYM jest odmową AKCJI,
 * nie tylko schowanym formularzem.
 *
 * Audyt zastał formularz „Zarejestruj pobranie" aktywny na anulowanym najmie.
 * Zdjęcie formularza z ekranu (DepositForms, prop collectAllowed) to lustro —
 * bramka musi stać w akcji, bo formularz da się wysłać bez ekranu (zasada
 * projektu: zakaz egzekwowany w akcjach, nie chowany w UI; wzorzec
 * items-validation.ts).
 *
 * Test woła REALNĄ akcję produkcyjną drogą (realny rdzeń guardu
 * requireMemberWithClient), podstawiona jest wyłącznie granica sieci/bazy —
 * atrapa klienta Supabase z rejestratorem mutacji. Asercja odmowy jest parą:
 * treść zdania + ZERO zapisów w rejestrze kaucji — sam komunikat przeszedłby
 * także nad kodem, który wpisuje wiersz i potem przeprasza.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireMemberWithClient } from "@/lib/auth";

const requireMemberMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-server", () => ({
  requireMember: (role?: string, options?: { closing?: boolean }) =>
    requireMemberMock(role, options),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { collectDepositAction } = await import(
  "@/app/[locale]/(panel)/zamowienia/[id]/deposit-actions"
);

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ORDER_CANCELLED = "33333333-3333-4333-8333-333333333341";
const ORDER_LIVE = "33333333-3333-4333-8333-333333333342";

interface Mutation {
  table: string;
  kind: "insert" | "update";
  values: unknown;
}

/** Atrapa klienta pod zapytania collectDepositAction (tenant AKTYWNY). */
function fakeDb(orders: Record<string, { order_status: string }>) {
  const mutations: Mutation[] = [];

  function builder(table: string) {
    const q = {
      table,
      mode: "select" as "select" | "insert" | "update",
      values: undefined as unknown,
      filters: [] as [string, unknown][],
    };
    const resolve = () => {
      if (q.table === "members") {
        return {
          data: { role: "owner", tenants: { status: "active", suspended_at: null } },
          error: null,
        };
      }
      if (q.table === "orders" && q.mode === "select") {
        const idEq = q.filters.find(([column]) => column === "id");
        return { data: idEq ? (orders[idEq[1] as string] ?? null) : null, error: null };
      }
      if (q.table === "deposit_events" && q.mode === "insert") {
        mutations.push({ table: q.table, kind: "insert", values: q.values });
        const rows = Array.isArray(q.values) ? q.values : [q.values];
        return { data: rows.map((_, index) => ({ id: `de-${index}` })), error: null };
      }
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (values: unknown) => {
        q.mode = "insert";
        q.values = values;
        return b;
      },
      eq: (column: string, value: unknown) => {
        q.filters.push([column, value]);
        return b;
      },
      maybeSingle: async () => resolve(),
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
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
            app_metadata: { tenant_id: TENANT, role: "owner" },
          },
        },
        error: null,
      }),
    },
    from: (table: string) => builder(table),
  };
  return { client: client as never, mutations };
}

function wire(db: ReturnType<typeof fakeDb>) {
  requireMemberMock.mockImplementation((role?: string, options?: { closing?: boolean }) =>
    requireMemberWithClient(db.client, role as never, options),
  );
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  requireMemberMock.mockReset();
});

describe("U3 — pobranie kaucji a zamówienie anulowane (bramka akcji)", () => {
  it("zamówienie anulowane → odmowa z powodem i ZERO wierszy w rejestrze", async () => {
    const db = fakeDb({ [ORDER_CANCELLED]: { order_status: "cancelled" } });
    wire(db);

    const state = await collectDepositAction({}, form({ orderId: ORDER_CANCELLED, amount: "400" }));

    expect(state.formError).toMatch(/anulowane/);
    expect(state.success).toBeUndefined();
    expect(db.mutations).toEqual([]);
  });

  it("zamówienie żywe → pobranie przechodzi (kontrola negatywna bramki)", async () => {
    // Bez tej próbki bramka „odmawiaj zawsze" też byłaby zielona.
    const db = fakeDb({ [ORDER_LIVE]: { order_status: "ready_for_pickup" } });
    wire(db);

    const state = await collectDepositAction({}, form({ orderId: ORDER_LIVE, amount: "400" }));

    expect(state.formError).toBeUndefined();
    expect(state.success).toBe("collected");
    expect(db.mutations).toHaveLength(1);
    expect(db.mutations[0]).toMatchObject({ table: "deposit_events", kind: "insert" });
  });

  it("zamówienie spoza tenanta (odczyt pusty) → odmowa bez zapisu", async () => {
    // RLS nie zgłasza odmowy — dosięga zero wierszy; akcja musi to nazwać
    // błędem, a nie pobrać kaucji „w ciemno".
    const db = fakeDb({});
    wire(db);

    const state = await collectDepositAction({}, form({ orderId: ORDER_LIVE, amount: "400" }));

    expect(state.formError).toMatch(/nie istnieje/);
    expect(db.mutations).toEqual([]);
  });
});
