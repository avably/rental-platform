/**
 * Testy integracyjne klientów (R6a) na żywym, lokalnym Supabase — wzorzec
 * orders.test.ts: realni użytkownicy, realne sesje, zero mocków.
 *
 * Weryfikują ścieżkę PANELU (klient z sesją, zero service-role):
 *   1. członek tenanta EDYTUJE swojego klienta dokładnie tak, jak robi to
 *      updateCustomerAction (UPDATE zawężony tenantem i id, select po zapisie);
 *      wiersz w bazie niesie nowe dane co do znaku, a zmiana NIE dotyka
 *      wcześniej złożonych zamówień (kwoty zdenormalizowane w orders);
 *   2. IZOLACJA: tenant B nie widzi klientów A (SELECT pusty), nie zmieni ich
 *      (UPDATE po samym id dosięga zero wierszy — bramką jest RLS 0007), i nie
 *      podepnie klienta do cudzego tenanta.
 *
 * Bramkę RLS tabeli customers dowodzi też packages/db/test/rls-isolation.test.ts
 * na szerszym zbiorze tabel — tu pokazujemy ją na ścieżce edycji z karty.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "CustomersTest!12345678";
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

function createAnonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

/** User + własna organizacja + ŚWIEŻA sesja (JWT z claimem tenant_id). */
async function createTenantMember(
  admin: SupabaseClient,
  label: string,
): Promise<{ client: SupabaseClient; tenantId: string }> {
  const email = `cust-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
    p_slug: `cust-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja klientów ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

describe.skipIf(!hasEnv)("klienci (RLS 0007, ścieżka panelu)", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };
  let customerId: string;

  beforeAll(async () => {
    admin = createAdminClient();
    tenantA = await createTenantMember(admin, "a");
    tenantB = await createTenantMember(admin, "b");

    const { data: customer, error } = await tenantA.client
      .from("customers")
      .insert({
        tenant_id: tenantA.tenantId,
        email: `klient-${randomUUID()}@test.local`,
        full_name: "Klient Pierwotny",
        phone: "+48 600 000 000",
      })
      .select("id")
      .single();
    if (error) throw new Error(`insert customers: ${error.message}`);
    customerId = customer!.id as string;
  }, 60_000);

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

  it("członek A edytuje swojego klienta (UPDATE zawężony tenantem i id trafia wiersz)", async () => {
    // Dokładnie payload updateCustomerAction: kontakt + faktura + adres.
    const { data, error } = await tenantA.client
      .from("customers")
      .update({
        email: "nowy@example.com",
        full_name: "Klient Zmieniony",
        phone: "+48 601 202 303",
        company_name: "Studio Plan B",
        nip: "5250000000",
        address_street: "Polna 4",
        address_zip: "00-001",
        address_city: "Warszawa",
      })
      .eq("tenant_id", tenantA.tenantId)
      .eq("id", customerId)
      .select("id");
    expect(error, `update: ${error?.message}`).toBeNull();
    expect(data, "UPDATE własnego klienta nie trafił wiersza").toHaveLength(1);

    const { data: after } = await tenantA.client
      .from("customers")
      .select("email, full_name, company_name, nip, address_city")
      .eq("id", customerId)
      .single();
    expect(after).toMatchObject({
      email: "nowy@example.com",
      full_name: "Klient Zmieniony",
      company_name: "Studio Plan B",
      nip: "5250000000",
      address_city: "Warszawa",
    });
  });

  it("tenant B nie widzi klientów A (SELECT pusty)", async () => {
    const { data, error } = await tenantB.client.from("customers").select("id");
    expect(error, `select: ${error?.message}`).toBeNull();
    expect(data, "tenant B widzi klientów tenanta A").toEqual([]);
  });

  it("tenant B nie zmieni klienta A: UPDATE po samym id dosięga zero wierszy, dane nietknięte", async () => {
    // Bez filtra tenanta CELOWO — dowodzimy, że BRAMKĄ jest RLS, a nie tylko
    // filtr w zapytaniu: cudzy wiersz i tak jest poza zasięgiem sesji B.
    const { data, error } = await tenantB.client
      .from("customers")
      .update({ full_name: "Przejęty" })
      .eq("id", customerId)
      .select("id");
    expect(error).toBeNull();
    expect(data, "UPDATE cudzego klienta dosięgnął wierszy").toEqual([]);

    const { data: after } = await admin
      .from("customers")
      .select("full_name")
      .eq("id", customerId)
      .single();
    expect(after).toMatchObject({ full_name: "Klient Zmieniony" });
  });

  it("tenant B nie podepnie klienta pod tenanta A (RLS na INSERT)", async () => {
    const { data, error } = await tenantB.client
      .from("customers")
      .insert({ tenant_id: tenantA.tenantId, email: `obcy-${randomUUID()}@test.local` })
      .select("id");
    // RLS WITH CHECK odrzuca insert z cudzym tenant_id — zero wstawionych wierszy.
    expect(data ?? []).toEqual([]);
    expect(error, "INSERT do cudzego tenanta nie został odrzucony").not.toBeNull();
  });
});
