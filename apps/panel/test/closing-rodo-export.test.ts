/**
 * RODO w oknie domykania (Zasada 8, ADR-138) — spec (e)6:
 *
 *   1. TRZY handlery eksportu zwracają DANE (200 + CSV), nie puste 403,
 *      gdy tenant jest `suspended` w otwartym oknie — guard dostaje opt-in
 *      `{ closing: true }` i przechodzi przez REALNY rdzeń.
 *   2. Zbiór klientów pozostaje `owner`-only (staff → 403) — okno nie
 *      poszerza ról.
 *   3. `eraseCustomerAction` działa w oknie `owner`-only: staff dostaje
 *      odmowę roli, owner dochodzi do funkcji usuwającej.
 *   4. PO zamknięciu okna eksporty wracają do 403 — RODO obsługuje wtedy
 *      wsparcie, nie panel (decyzja spec: zero zrzutów z retencją).
 *
 * Wzorzec: export-routes.test.ts (rdzenie eksportu na atrapach), ale guard
 * NIE jest atrapą — requireMember deleguje do requireMemberWithClient.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireMemberWithClient } from "@/lib/auth";

const requireMemberMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-server", () => ({
  requireMember: (role?: string, options?: { closing?: boolean }) =>
    requireMemberMock(role, options),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const exportOrdersMock = vi.hoisted(() => vi.fn());
const exportCustomersMock = vi.hoisted(() => vi.fn());
const exportCatalogMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/export/orders", () => ({ exportOrdersCsv: exportOrdersMock }));
vi.mock("@/lib/export/customers", () => ({ exportCustomersCsv: exportCustomersMock }));
vi.mock("@/lib/export/catalog", () => ({ exportCatalogCsv: exportCatalogMock }));

const removeContractDocuments = vi.hoisted(() => vi.fn());
vi.mock("@/src/jobs/erase-customer-documents", () => ({
  removeContractDocuments: (paths: readonly string[]) => removeContractDocuments(paths),
}));
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect,
  permanentRedirect: redirect,
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/navigation", () => ({ localePath: async (path: string) => `/pl${path}` }));

const { POST: postOrders } = await import(
  "@/app/[locale]/(panel)/eksport-danych/zamowienia/route"
);
const { POST: postCustomers } = await import(
  "@/app/[locale]/(panel)/eksport-danych/klienci/route"
);
const { POST: postCatalog } = await import("@/app/[locale]/(panel)/eksport-danych/katalog/route");
const { eraseCustomerAction } = await import("@/app/[locale]/(panel)/klienci/[id]/actions");

const DAY_MS = 24 * 60 * 60 * 1000;
const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const EMAIL = "anna@example.com";

/**
 * Atrapa klienta: members dla guardu + odczyt klienta i RPC dla erase.
 * Eksportowe rdzenie są atrapami, więc poza guardem nikt bazy nie pyta.
 */
function fakeClient(config: { status: string; suspendedAt: string | null; role: string }) {
  const recorded = { rpcName: null as string | null, rpcArgs: null as unknown };
  const client = {
    auth: {
      getClaims: async () => ({
        data: {
          claims: {
            sub: USER,
            email: "op@test.local",
            app_metadata: { tenant_id: TENANT, role: config.role },
          },
        },
        error: null,
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () =>
              table === "members"
                ? {
                    data: {
                      role: config.role,
                      tenants: { status: config.status, suspended_at: config.suspendedAt },
                    },
                    error: null,
                  }
                : { data: { email: EMAIL }, error: null },
          }),
        }),
      }),
    }),
    schema: () => ({
      rpc: async (fn: string, args: unknown) => {
        recorded.rpcName = fn;
        recorded.rpcArgs = args;
        return { data: { mode: "anonymized", contract_paths: [] }, error: null };
      },
    }),
  };
  return { client: client as never, recorded };
}

function wireGuard(config: { status: string; suspendedAt: string | null; role: string }) {
  const db = fakeClient(config);
  requireMemberMock.mockImplementation((role?: string, options?: { closing?: boolean }) =>
    requireMemberWithClient(db.client, role as never, options),
  );
  return db;
}

const params = { params: Promise.resolve({ locale: "pl" }) };

function request(): Request {
  return new Request("https://panel.test/pl/eksport-danych/zamowienia", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "",
  });
}

const IN_WINDOW = () => new Date(Date.now() - 5 * DAY_MS).toISOString();
const AFTER_WINDOW = () => new Date(Date.now() - 31 * DAY_MS).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  const file = { filename: "avably-export-2026-08-11.csv", csv: "﻿a;b\r\n" };
  exportOrdersMock.mockResolvedValue(file);
  exportCustomersMock.mockResolvedValue(file);
  exportCatalogMock.mockResolvedValue(file);
  removeContractDocuments.mockResolvedValue({ requested: 0, removed: 0 });
});

describe("(e)6 eksporty w oknie domykania — dane, nie puste 403", () => {
  it.each([
    ["zamówienia", postOrders, "staff"],
    ["katalog", postCatalog, "staff"],
    ["klienci (owner)", postCustomers, "owner"],
  ] as const)("POST %s → 200 + CSV w otwartym oknie", async (_label, handler, role) => {
    wireGuard({ status: "suspended", suspendedAt: IN_WINDOW(), role });

    const response = await handler(request(), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(await response.text()).toContain("a;b");
  });

  it("zbiór klientów pozostaje owner-only TAKŻE w oknie (staff → 403)", async () => {
    wireGuard({ status: "suspended", suspendedAt: IN_WINDOW(), role: "staff" });

    const response = await postCustomers(request(), params);

    expect(response.status).toBe(403);
    expect(exportCustomersMock).not.toHaveBeenCalled();
  });

  it("po zamknięciu okna eksport wraca do 403 (zegar, nie rola)", async () => {
    wireGuard({ status: "suspended", suspendedAt: AFTER_WINDOW(), role: "owner" });

    const response = await postOrders(request(), params);

    expect(response.status).toBe(403);
    expect(exportOrdersMock).not.toHaveBeenCalled();
  });
});

describe("(e)6 eraseCustomerAction w oknie — owner-only, funkcja usuwająca rusza", () => {
  function confirmationForm(): FormData {
    const fd = new FormData();
    fd.set("confirmation", EMAIL);
    return fd;
  }

  it("owner w otwartym oknie → dochodzi do app.erase_customer", async () => {
    const db = wireGuard({ status: "suspended", suspendedAt: IN_WINDOW(), role: "owner" });

    const state = await eraseCustomerAction(CUSTOMER, {}, confirmationForm());

    expect(state.formError).toBeUndefined();
    expect(db.recorded.rpcName).toBe("erase_customer");
    expect(db.recorded.rpcArgs).toEqual({ p_customer_id: CUSTOMER });
  });

  it("staff w otwartym oknie → odmowa ROLI, funkcja usuwająca nie rusza", async () => {
    const db = wireGuard({ status: "suspended", suspendedAt: IN_WINDOW(), role: "staff" });

    const state = await eraseCustomerAction(CUSTOMER, {}, confirmationForm());

    expect(state.formError).toMatch(/rola/i);
    expect(db.recorded.rpcName).toBeNull();
  });

  it("po zamknięciu okna erase odmawia — RODO przejmuje wsparcie, nie panel", async () => {
    const db = wireGuard({ status: "suspended", suspendedAt: AFTER_WINDOW(), role: "owner" });

    const state = await eraseCustomerAction(CUSTOMER, {}, confirmationForm());

    expect(state.formError).toMatch(/zawieszona/);
    expect(db.recorded.rpcName).toBeNull();
  });
});
