/**
 * Anulowanie przesyłki u dostawcy (L4, ADR-105) — `cancelShipmentAction`.
 *
 * Test jednostkowy z fałszywym query-builderem (wzorzec `customer-actions.test.ts`)
 * i fałszywym portem kuriera, bo mierzona jest tu KOLEJNOŚĆ I WARUNKI wywołań,
 * a nie zawartość bazy: żywy Supabase nie odpowie na pytanie „czy przy błędzie
 * dostawcy poszedł UPDATE", jeśli UPDATE ma nie pójść wcale.
 *
 * Cztery rzeczy, które ten plik trzyma:
 *   1. lokalny `cancelled` zapada TYLKO po potwierdzeniu dostawcy — błąd
 *      dostawcy nie zostawia rozjazdu „u nas anulowana, u kuriera jedzie";
 *   2. przesyłki w stanie nieanulowalnym nie dotykają dostawcy w ogóle;
 *   3. cudza przesyłka nie generuje ŻADNEGO żądania u dostawcy (odczyt jest
 *      ograniczony tenantem z JWT, więc nie ma czego anulować);
 *   4. credentiale kuriera pochodzą z tenanta KONTEKSTU, nigdy z formularza.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { GlobKurierAPIError } from "@avably/core";

const requireMember = vi.fn();
const loadCourierApi = vi.fn();
const cancelOrder = vi.fn();

vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/app/[locale]/(panel)/zamowienia/[id]/delivery", () => ({
  loadCourierApi: (...args: unknown[]) => loadCourierApi(...args),
}));

const { cancelShipmentAction } = await import(
  "@/app/[locale]/(panel)/zamowienia/[id]/delivery-actions"
);

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const SHIPMENT = "33333333-3333-4333-8333-333333333333";

/**
 * Fałszywy klient Supabase dla JEDNEJ tabeli: zwraca zadany wiersz na odczyt
 * i rejestruje wszystko, co poszło na zapis. `calls.updates` jest tu dowodem
 * negatywnym — pusta lista znaczy „nie tknęliśmy stanu lokalnego".
 */
function makeSupabase(shipment: Record<string, unknown> | null) {
  const calls = {
    selectFilters: [] as [string, unknown][],
    updates: [] as Record<string, unknown>[],
    updateFilters: [] as [string, unknown][],
    order: [] as string[],
  };

  const client = {
    from() {
      return {
        select() {
          const chain = {
            eq(column: string, value: unknown) {
              calls.selectFilters.push([column, value]);
              return chain;
            },
            maybeSingle: async () => {
              calls.order.push("select");
              return { data: shipment, error: null };
            },
          };
          return chain;
        },
        update(patch: Record<string, unknown>) {
          calls.updates.push(patch);
          calls.order.push("update");
          const chain = {
            eq(column: string, value: unknown) {
              calls.updateFilters.push([column, value]);
              return chain;
            },
            select: async () => ({ data: [{ id: SHIPMENT }], error: null }),
          };
          return chain;
        },
      };
    },
  };

  return { client, calls };
}

function form(shipmentId: string): FormData {
  const data = new FormData();
  data.set("shipmentId", shipmentId);
  return data;
}

describe("cancelShipmentAction (ADR-105)", () => {
  beforeEach(() => {
    requireMember.mockReset();
    loadCourierApi.mockReset();
    cancelOrder.mockReset();
    loadCourierApi.mockResolvedValue({ api: { cancelOrder }, config: {} });
    cancelOrder.mockImplementation(async () => {
      calls.order.push("provider");
    });
  });

  // Wspólny rejestr kolejności, podmieniany w każdym teście.
  let calls: { order: string[] } = { order: [] };

  function actOn(shipment: Record<string, unknown> | null) {
    const supabase = makeSupabase(shipment);
    calls = supabase.calls;
    requireMember.mockResolvedValue({
      supabase: supabase.client,
      tenantId: TENANT,
      user: { id: "user-1", email: "owner@test.local" },
      role: "owner",
    });
    return supabase.calls;
  }

  it("anuluje u dostawcy PRZED zapisem lokalnym i dopiero wtedy zapisuje cancelled", async () => {
    const calls = actOn({
      id: SHIPMENT,
      status: "created",
      provider_order_number: "GK260717000001",
    });

    const state = await cancelShipmentAction({}, form(SHIPMENT));

    expect(state.formError, `anulowanie: ${state.formError}`).toBeUndefined();
    expect(state.success).toBe("shipmentCancelled");
    expect(cancelOrder).toHaveBeenCalledWith("GK260717000001");
    expect(calls.updates).toEqual([expect.objectContaining({ status: "cancelled" })]);
    // Sedno: potwierdzenie dostawcy stoi MIĘDZY odczytem a zapisem.
    expect(calls.order).toEqual(["select", "provider", "update"]);
  });

  it("błąd dostawcy NIE zapisuje cancelled — stan lokalny zostaje nietknięty", async () => {
    const calls = actOn({
      id: SHIPMENT,
      status: "created",
      provider_order_number: "GK260717000002",
    });
    cancelOrder.mockRejectedValue(new GlobKurierAPIError("Zlecenie już przekazane kurierowi"));

    const state = await cancelShipmentAction({}, form(SHIPMENT));

    expect(state.formError, "błąd dostawcy musi wrócić do operatora").toBeTruthy();
    expect(state.success).toBeUndefined();
    expect(
      calls.updates,
      "zapisano lokalne anulowanie mimo odmowy dostawcy — rozjazd stanu",
    ).toEqual([]);
  });

  it("przesyłki w drodze i doręczonej nie da się anulować — dostawca nie jest wołany", async () => {
    for (const status of ["in_transit", "delivered", "cancelled", "returned_to_sender"]) {
      const calls = actOn({ id: SHIPMENT, status, provider_order_number: "GK260717000003" });

      const state = await cancelShipmentAction({}, form(SHIPMENT));

      expect(state.formError, `status ${status} powinien zostać odrzucony`).toBeTruthy();
      expect(cancelOrder, `status ${status}: dostawca nie ma być wołany`).not.toHaveBeenCalled();
      expect(calls.updates).toEqual([]);
      cancelOrder.mockClear();
    }
  });

  it("cudza przesyłka: odczyt nie zwraca wiersza, dostawca nie jest wołany", async () => {
    const calls = actOn(null);

    const state = await cancelShipmentAction({}, form(SHIPMENT));

    expect(state.formError).toBeTruthy();
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(calls.updates).toEqual([]);
    // Dowód izolacji: odczyt jest zawężony tenantem z KONTEKSTU, nie z formularza.
    expect(calls.selectFilters).toContainEqual(["tenant_id", TENANT]);
    expect(calls.selectFilters.map(([, value]) => value)).not.toContain(OTHER_TENANT);
  });

  it("credentiale kuriera bierze z tenanta kontekstu, nie z formularza", async () => {
    actOn({ id: SHIPMENT, status: "in_progress", provider_order_number: "GK260717000004" });

    const data = form(SHIPMENT);
    // Podstawienie cudzego tenanta w formularzu nie ma prawa niczego zmienić —
    // akcja tego pola nawet nie czyta.
    data.set("tenantId", OTHER_TENANT);
    await cancelShipmentAction({}, data);

    expect(loadCourierApi).toHaveBeenCalledWith(expect.anything(), TENANT);
  });

  it("zapis lokalny też jest zawężony tenantem i identyfikatorem przesyłki", async () => {
    const calls = actOn({
      id: SHIPMENT,
      status: "created",
      provider_order_number: "GK260717000005",
    });

    await cancelShipmentAction({}, form(SHIPMENT));

    expect(calls.updateFilters).toContainEqual(["tenant_id", TENANT]);
    expect(calls.updateFilters).toContainEqual(["id", SHIPMENT]);
  });
});
