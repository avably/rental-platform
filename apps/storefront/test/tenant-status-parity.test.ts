/**
 * Parytet SQL↔TS zbioru komercyjnie aktywnego (0065, ADR-134).
 *
 * Decyzja „czy publiczna powierzchnia najemcy przyjmuje ruch" ma dokładnie
 * DWA nośniki: predykat SQL app.tenant_commercially_active (bramki RPC
 * storefrontu/checkoutu/embed) i stałą API_ACTIVE_TENANT_STATUSES
 * (bramka API v1 w lib/api/handlers.ts). Rozjazd tych zbiorów daje klucz
 * API działający tam, gdzie sklep odmawia (albo odwrotnie) — dlatego parytet
 * jest przypięty testem na ŻYWEJ bazie, wywołaniem tej samej funkcji, którą
 * wołają bramki, a nie skanem pliku migracji.
 *
 * DOWODY MUTACYJNE: usunięcie 'past_due' z predykatu SQL pali ten test tak
 * samo jak usunięcie "past_due" z lustra TS — każdy nośnik z osobna.
 *
 * Wymaga lokalnego Supabase (SUPABASE_LOCAL_*) — patrz helpers/integration-env.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { API_ACTIVE_TENANT_STATUSES } from "@/lib/api/auth";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = ["SUPABASE_LOCAL_API_URL", "SUPABASE_LOCAL_SERVICE_ROLE_KEY"] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/**
 * Pełna domena statusu tenanta (CHECK 0001; kompletność domeny względem
 * żywej bazy przypina packages/db/test/commercial-active-predicate.test.ts —
 * tripwire CHECK-a). Parytet MUSI być mierzony na całej domenie: porównanie
 * samych elementów lustra nie wykryłoby statusu, który SQL wpuszcza, a TS nie.
 */
const STATUS_DOMAIN = [
  "trialing",
  "active",
  "past_due",
  "suspended",
  "cancelled",
  "superadmin_locked",
] as const;

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_LOCAL_API_URL as string,
    process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

describe.skipIf(!hasEnv)("parytet zbioru komercyjnie aktywnego SQL↔TS (ADR-134)", () => {
  it.each(STATUS_DOMAIN)(
    "status '%s': app.tenant_commercially_active == członkostwo w API_ACTIVE_TENANT_STATUSES",
    async (status) => {
      const { data, error } = await serviceClient()
        .schema("app")
        .rpc("tenant_commercially_active", { p_status: status });

      expect(error, `RPC predykatu zawiodło: ${error?.message}`).toBeNull();
      expect(
        data,
        `rozjazd SQL↔TS dla '${status}': predykat SQL mówi ${data}, ` +
          `lustro TS mówi ${API_ACTIVE_TENANT_STATUSES.includes(status)} — ` +
          "jedno miejsce decyzji rozpadło się na dwa (ADR-134)",
      ).toBe(API_ACTIVE_TENANT_STATUSES.includes(status));
    },
  );

  it("lustro TS nie zawiera statusów spoza domeny (literówka = martwy wpis)", () => {
    const domain = new Set<string>(STATUS_DOMAIN);
    const unknown = API_ACTIVE_TENANT_STATUSES.filter((s) => !domain.has(s));
    expect(unknown, `wpisy lustra spoza domeny statusu: ${unknown.join(", ")}`).toEqual([]);
  });
});
