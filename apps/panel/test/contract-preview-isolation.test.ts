/**
 * SONDA IZOLACJI PODGLĄDU UMOWY (U10, ADR-151) na żywym, lokalnym Supabase.
 *
 * Pytanie brzmi: co ten ekran UDOSTĘPNIA, czego wcześniej nie udostępniał?
 * Nową trasę, która czyta dane firmy i treść warunków najemcy i odsyła je
 * ZŁOŻONE W DOKUMENT. Dwie rzeczy trzeba więc udowodnić: że dokument niesie
 * dane wyłącznie tego najemcy, i że jego powstanie nie zostawia śladu.
 *
 * ============= DLACZEGO KLIENT SERVICE-ROLE =============
 *
 * Sonda uruchamiana klientem z sesją najemcy B dowodzi wyłącznie tego, że
 * działa RLS — i byłaby ZIELONA również wtedy, gdyby zapytanie podglądu
 * straciło zawężenie po najemcy. Dlatego `loadContractPreviewProps` wołamy tu
 * klientem SERVICE-ROLE, który RLS omija: jedyną rzeczą, która trzyma wynik
 * przy jednym najemcy, jest wtedy samo zapytanie. Zdjęcie `.eq("tenant_id", …)`
 * z `ustawienia-umow/preview.ts` zapala te testy z imienia.
 *
 * Funkcja jest tu wołana DOKŁADNIE tak, jak woła ją trasa — kopia zapytania
 * w teście broniłaby kopii, nie produkcji.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { loadContractPreviewProps } from "@/app/[locale]/(panel)/ustawienia-umow/preview";

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

const TEST_PASSWORD = "ContractPreview!12345678";
const TODAY = "2026-08-12";

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

/** Najemca z KOMPLETEM ustawień umowy — wartości rozłączne między najemcami. */
async function createTenantWithSettings(
  admin: SupabaseClient,
  label: string,
): Promise<{ tenantId: string; client: SupabaseClient }> {
  const email = `contract-preview-${label}-${randomUUID()}@test.local`;
  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`createUser(${label}): ${userError?.message}`);
  createdUserIds.push(user.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
    p_slug: `cpreview-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja umów ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  const { error: settingsError } = await admin.from("tenant_settings").upsert(
    {
      tenant_id: tenantId as string,
      key: "contract_document",
      value: {
        address: `ul. ${label} 1, 00-001 Miasto ${label}`,
        nip: null,
        email: `umowy-${label}@example.test`,
        terms_version: `wersja-${label}`,
        terms_body: `Warunki najemcy ${label}.`,
      },
    },
    { onConflict: "tenant_id,key" },
  );
  if (settingsError) throw new Error(`insert tenant_settings(${label}): ${settingsError.message}`);

  return { tenantId: tenantId as string, client: await signIn(email) };
}

describe.skipIf(!hasEnv)("sonda izolacji: podgląd umowy", () => {
  let admin: SupabaseClient;
  let tenantA: { tenantId: string; client: SupabaseClient };
  let tenantB: { tenantId: string; client: SupabaseClient };

  beforeAll(async () => {
    admin = createAdminClient();
    tenantA = await createTenantWithSettings(admin, "alfa");
    tenantB = await createTenantWithSettings(admin, "beta");
  }, 120_000);

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

  it("kontrola pozytywna: ustawienia OBU najemców naprawdę są w bazie", async () => {
    // Bez tego cała sonda niżej mogłaby przechodzić po pustym zbiorze:
    // „nie widzę danych beta" jest prawdą również wtedy, gdy beta nie istnieje.
    const { data, error } = await admin
      .from("tenant_settings")
      .select("tenant_id")
      .eq("key", "contract_document")
      .in("tenant_id", [tenantA.tenantId, tenantB.tenantId]);
    expect(error).toBeNull();
    expect(new Set((data ?? []).map((row) => row.tenant_id as string))).toEqual(
      new Set([tenantA.tenantId, tenantB.tenantId]),
    );
  });

  it("klientem service-role podgląd alfa niesie WYŁĄCZNIE dane alfa", async () => {
    const props = await loadContractPreviewProps(admin, {
      tenantId: tenantA.tenantId,
      today: TODAY,
    });

    expect(props.terms.version).toBe("wersja-alfa");
    expect(props.terms.body).toBe("Warunki najemcy alfa.");
    expect(props.tenant.email).toBe("umowy-alfa@example.test");
    expect(props.tenant.name).toBe("Organizacja umów alfa");

    // Dowód z drugiej strony: w CAŁYM dokumencie nie ma ani śladu beta.
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain("beta");
    expect(serialized).not.toContain(tenantB.tenantId);
  });

  it("klientem service-role podgląd beta niesie WYŁĄCZNIE dane beta", async () => {
    const props = await loadContractPreviewProps(admin, {
      tenantId: tenantB.tenantId,
      today: TODAY,
    });
    expect(props.terms.version).toBe("wersja-beta");
    expect(props.tenant.name).toBe("Organizacja umów beta");
    expect(JSON.stringify(props)).not.toContain("alfa");
  });

  it("sesja najemcy beta nie zobaczy umowy alfa nawet podając cudzy tenant_id", async () => {
    // Druga warstwa: gdyby zawężenie w zapytaniu kiedyś padło, RLS ma trzymać
    // niezależnie od tego, co panel poda jako najemcę.
    await expect(
      loadContractPreviewProps(tenantB.client, { tenantId: tenantA.tenantId, today: TODAY }),
    ).rejects.toThrow();
  });

  it("podgląd nie zostawia śladu: rejestr umów pozostaje pusty", async () => {
    const before = await admin
      .from("contract_documents")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantA.tenantId);
    expect(before.error).toBeNull();

    await loadContractPreviewProps(admin, { tenantId: tenantA.tenantId, today: TODAY });

    const after = await admin
      .from("contract_documents")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantA.tenantId);
    expect(after.error).toBeNull();
    expect(after.count ?? 0).toBe(before.count ?? 0);
    expect(after.count ?? 0).toBe(0);
  });
});
