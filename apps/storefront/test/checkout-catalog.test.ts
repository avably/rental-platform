/**
 * Testy `getPublicCustomFields`/`readCheckoutCustomFieldDefinitions`
 * (apps/storefront/lib/checkout/catalog.ts) — WRAPPER, nie rdzeń.
 *
 * ==================== CO ZŁAPAŁA RECENZJA PM (round-3, #3) ====================
 *
 * Produkcyjny fix-closed w `catalog.ts:44` jest poprawny: błąd odczytu RPC
 * ma RZUCAĆ, nie wracać jako pusta lista (chwilowy blip transportu ≠ "najemca
 * bez pól"). Ale jedyny dotychczasowy "dowód #3" (`checkout-core.test.ts`)
 * wstrzykiwał ATRAPĘ `readCustomFields`, która sama rzucała z góry — to
 * testowało try/catch w `core.ts`, NIE ten wrapper. Rewert `catalog.ts:44-46`
 * z powrotem do `if (error || !Array.isArray(data)) return []` zostawiałby
 * CAŁE CI zielone i przywracał fail-open (przejściowy błąd RPC → [] →
 * pominięcie pól WYMAGANYCH → 201).
 *
 * Te testy wołają `getPublicCustomFields` PRZEZ PUBLICZNY EKSPORT, z klientem
 * Supabase wstrzykniętym jako atrapa (`.schema().rpc()`) — dokładnie tak, jak
 * woła go produkcja (`client?: SupabaseClient` w sygnaturze).
 */
import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublicCustomFields, readCheckoutCustomFieldDefinitions } from "@/lib/checkout/catalog";
import type { PublicCustomField } from "@/lib/checkout/contract";

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Klient-atrapa: `.schema("app").rpc(...)` zwraca dokładnie to, co się poda. */
function fakeClient(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  return {
    schema: () => ({
      rpc: async () => result,
    }),
  } as unknown as SupabaseClient;
}

const ONE_FIELD: PublicCustomField[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    entity: "order",
    field_type: "text",
    label: "Numer PESEL",
    help_text: null,
    required: true,
    options: null,
  },
];

describe("getPublicCustomFields — fail-closed na błąd RPC (#3, round-3)", () => {
  it("klient zwraca { error } → RZUCA (nie [])", async () => {
    const client = fakeClient({ data: null, error: { code: "57014", message: "timeout" } });

    await expect(getPublicCustomFields(TENANT, client)).rejects.toThrow();
  });

  it("readCheckoutCustomFieldDefinitions (kształt domenowy) też RZUCA na błąd", async () => {
    const client = fakeClient({ data: null, error: { code: "57014", message: "timeout" } });

    await expect(readCheckoutCustomFieldDefinitions(TENANT, client)).rejects.toThrow();
  });

  it("kontrola pozytywna: brak błędu + tablica → zwraca dane bez zmian", async () => {
    const client = fakeClient({ data: ONE_FIELD, error: null });

    await expect(getPublicCustomFields(TENANT, client)).resolves.toEqual(ONE_FIELD);
  });

  it("kontrola pozytywna: brak błędu, ale dane NIE są tablicą (najemca nieaktywny) → [] (prawdziwy brak, nie awaria)", async () => {
    const client = fakeClient({ data: null, error: null });

    await expect(getPublicCustomFields(TENANT, client)).resolves.toEqual([]);
  });
});
