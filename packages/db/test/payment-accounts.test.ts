/**
 * Konto najemcy u dostawcy płatności (migracja 0028, ADR-065) na ŻYWYM,
 * lokalnym Supabase — realni użytkownicy, realne sesje, realne RLS.
 *
 * Przedmiotem testu JEST polityka bazy, więc atrapa klienta nie ma tu czego
 * dowieść: odpowiadałaby „ok" niezależnie od tego, czy bramka istnieje.
 *
 * Cztery mechanizmy, każdy z osobnym powodem istnienia:
 *   1. ZAŁOŻENIE konta tylko dla właściciela — to decyzja o tym, dokąd płyną
 *      pieniądze ze sklepu, a PostgREST przyjmuje INSERT od każdego członka,
 *   2. `provider_account_id` NIEZMIENNY (23514) — przepisanie go byłoby
 *      przekierowaniem cudzych wpłat jednym UPDATE,
 *   3. odświeżenie kopii prezentacyjnej DZIAŁA dla zwykłego członka —
 *      kontrola pozytywna, bez której bramka „wszystkim odmawiaj" też
 *      świeciłaby na zielono,
 *   4. konto u dostawcy należy do JEDNEGO najemcy (unikat) — inaczej najemca
 *      A wpisałby sobie konto najemcy B.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

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

/** 42501 = insufficient_privilege — odmowa z polityki RLS albo z GRANT-u. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";
/** 23514 = check_violation — odmowa z CHECK-a albo z bramki triggera. */
const PG_CHECK_VIOLATION = "23514";
/** 23505 = unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";

const TEST_PASSWORD = "PaymentAccountsTest!12345678";

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const createAdminClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

async function createUser(admin: SupabaseClient, label: string): Promise<{ email: string; id: string }> {
  const email = `pay-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { email, id: data.user.id };
}

const accountId = () => `acct_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

describe.skipIf(!hasEnv)("konto płatności najemcy (0028, ADR-065)", () => {
  let admin: SupabaseClient;
  let tenantId: string;
  let otherTenantId: string;
  let ownerClient: SupabaseClient;
  let staffClient: SupabaseClient;
  let seededAccount: string;

  beforeAll(async () => {
    admin = createAdminClient();

    const owner = await createUser(admin, "owner");
    const bootstrap = await signIn(owner.email);
    const { data: newTenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
        p_slug: `pay-${randomUUID()}`.slice(0, 39),
        p_name: "Organizacja płatności",
      });
    if (tenantError) throw new Error(`create_tenant: ${tenantError.message}`);
    tenantId = newTenantId as string;
    createdTenantIds.push(tenantId);
    ownerClient = await signIn(owner.email);

    // Drugi najemca — potrzebny wyłącznie do dowodu unikatu konta u dostawcy.
    const otherOwner = await createUser(admin, "owner2");
    const otherBootstrap = await signIn(otherOwner.email);
    const { data: otherId, error: otherError } = await rpcCreateTenant(otherBootstrap, {
        p_slug: `pay2-${randomUUID()}`.slice(0, 39),
        p_name: "Druga organizacja płatności",
      });
    if (otherError) throw new Error(`create_tenant(2): ${otherError.message}`);
    otherTenantId = otherId as string;
    createdTenantIds.push(otherTenantId);

    // ZWYKŁY CZŁONEK tego samego najemcy — bohater dowodów (1) i (3). Musi być
    // pełnoprawnym członkiem: gdyby był spoza tenanta, odmowa pochodziłaby
    // z izolacji najemców, a nie z bramki roli.
    const staff = await createUser(admin, "staff");
    const { error: memberError } = await admin
      .from("members")
      .insert({ tenant_id: tenantId, user_id: staff.id, role: "staff" });
    if (memberError) throw new Error(`insert members(staff): ${memberError.message}`);
    // Claim tenant_id wchodzi do JWT przy logowaniu — sesja musi powstać PO
    // dopisaniu do members.
    await admin.auth.admin.updateUserById(staff.id, {
      app_metadata: { tenant_id: tenantId, role: "staff" },
    });
    staffClient = await signIn(staff.email);

    seededAccount = accountId();
  }, 90_000);

  afterAll(async () => {
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Założenie konta — wyłącznie właściciel
  // -------------------------------------------------------------------

  describe("kto może podpiąć konto odbiorcy środków", () => {
    it("zwykły członek NIE założy konta płatności (odmowa z RLS)", async () => {
      const { error } = await staffClient.from("payment_accounts").insert({
        tenant_id: tenantId,
        provider: "stripe",
        provider_account_id: accountId(),
      });

      expect(error, "członek podpiął konto odbiorcy środków — bramka 0028 nie działa").not.toBeNull();
      expect(
        error?.code,
        `odmowa powinna pochodzić z RLS (42501), nie z innego błędu: ${error?.message}`,
      ).toBe(PG_INSUFFICIENT_PRIVILEGE);
    });

    it("właściciel zakłada konto bez przeszkód (kontrola pozytywna)", async () => {
      const { error } = await ownerClient.from("payment_accounts").insert({
        tenant_id: tenantId,
        provider: "stripe",
        provider_account_id: seededAccount,
      });
      expect(error?.message ?? null).toBeNull();
    });

    it("świeży wiersz startuje jako NIEGOTOWY na obu osiach", async () => {
      // Domyślne `true` byłoby cichym sukcesem: konto bez KYC pokazałoby się
      // jako gotowe do przyjmowania pieniędzy.
      const { data } = await ownerClient
        .from("payment_accounts")
        .select("charges_enabled, payouts_enabled, details_submitted, requirements_due, last_synced_at")
        .eq("tenant_id", tenantId)
        .single();

      expect(data).toMatchObject({
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        requirements_due: [],
        last_synced_at: null,
      });
    });

    it("zwykły członek NIE usunie konta (odmowa z RLS)", async () => {
      const { error } = await staffClient
        .from("payment_accounts")
        .delete()
        .eq("tenant_id", tenantId);
      // PostgREST na DELETE bez dopasowanych wierszy nie zwraca błędu, więc
      // dowodem jest TRWANIE wiersza, a nie kod odpowiedzi.
      expect(error?.code ?? null).not.toBe(PG_CHECK_VIOLATION);

      const { data } = await admin
        .from("payment_accounts")
        .select("provider_account_id")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      expect(data?.provider_account_id, "członek usunął konto płatności").toBe(seededAccount);
    });
  });

  // -------------------------------------------------------------------
  // 2. Identyfikator konta jest NIEZMIENNY
  // -------------------------------------------------------------------

  describe("przekierowanie pieniędzy jednym UPDATE jest niemożliwe", () => {
    it("właściciel NIE przepisze provider_account_id (23514)", async () => {
      const { error } = await ownerClient
        .from("payment_accounts")
        .update({ provider_account_id: accountId() })
        .eq("tenant_id", tenantId);

      expect(error, "identyfikator konta dał się przepisać").not.toBeNull();
      expect(error?.code, `odmowa z innego powodu niż bramka: ${error?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );
    });

    it("zwykły członek tym bardziej nie (ta sama bramka, nie inna rola)", async () => {
      const { error } = await staffClient
        .from("payment_accounts")
        .update({ provider_account_id: accountId() })
        .eq("tenant_id", tenantId);

      expect(error?.code).toBe(PG_CHECK_VIOLATION);
    });

    it("stan po odmowie jest nietknięty", async () => {
      const { data } = await admin
        .from("payment_accounts")
        .select("provider_account_id")
        .eq("tenant_id", tenantId)
        .single();
      expect(data?.provider_account_id).toBe(seededAccount);
    });

    it("dostawcy też nie da się podmienić", async () => {
      const { error } = await ownerClient
        .from("payment_accounts")
        .update({ provider: "stripe", provider_account_id: seededAccount })
        .eq("tenant_id", tenantId);
      // Ta sama wartość = brak zmiany, więc bramka milczy (kontrola negatywna
      // dla testów wyżej: trigger nie blokuje KAŻDEGO zapisu).
      expect(error?.message ?? null).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // 3. Kopię prezentacyjną odświeża każdy członek
  // -------------------------------------------------------------------

  describe("odświeżenie stanu konta", () => {
    it("zwykły członek aktualizuje kopię prezentacyjną", async () => {
      const syncedAt = new Date().toISOString();
      const { error } = await staffClient
        .from("payment_accounts")
        .update({
          charges_enabled: true,
          payouts_enabled: false,
          details_submitted: true,
          requirements_due: ["external_account"],
          last_error: null,
          last_synced_at: syncedAt,
        })
        .eq("tenant_id", tenantId);

      expect(error?.message ?? null).toBeNull();

      const { data } = await admin
        .from("payment_accounts")
        .select("charges_enabled, payouts_enabled, requirements_due")
        .eq("tenant_id", tenantId)
        .single();
      expect(data).toMatchObject({
        charges_enabled: true,
        payouts_enabled: false,
        requirements_due: ["external_account"],
      });
    });

    it("updated_at pisze BAZA, nie wołający", async () => {
      const { data: before } = await admin
        .from("payment_accounts")
        .select("updated_at")
        .eq("tenant_id", tenantId)
        .single();

      // Wołający podaje kłamliwą datę; bramka i tak stawia własną.
      await staffClient
        .from("payment_accounts")
        .update({ updated_at: "2000-01-01T00:00:00.000Z", last_error: "próba" })
        .eq("tenant_id", tenantId);

      const { data: after } = await admin
        .from("payment_accounts")
        .select("updated_at")
        .eq("tenant_id", tenantId)
        .single();

      expect(new Date(after!.updated_at as string).getTime()).toBeGreaterThanOrEqual(
        new Date(before!.updated_at as string).getTime(),
      );
      expect(after!.updated_at).not.toBe("2000-01-01T00:00:00+00:00");
    });

    it("requirements_due musi być tablicą (23514)", async () => {
      const { error } = await ownerClient
        .from("payment_accounts")
        .update({ requirements_due: { currently_due: [] } })
        .eq("tenant_id", tenantId);

      expect(error?.code).toBe(PG_CHECK_VIOLATION);
    });
  });

  // -------------------------------------------------------------------
  // 4. Konto u dostawcy należy do JEDNEGO najemcy
  // -------------------------------------------------------------------

  describe("cudzego konta nie da się sobie przypisać", () => {
    it("drugi najemca nie wpisze konta pierwszego (23505)", async () => {
      const { error } = await admin.from("payment_accounts").insert({
        tenant_id: otherTenantId,
        provider: "stripe",
        provider_account_id: seededAccount,
      });

      // Zapis klientem service-role: gdyby bronił nas wyłącznie RLS, ten
      // INSERT by przeszedł. Unikat jest własnością SCHEMATU, więc broni
      // także ścieżek omijających polityki (webhook Z4 chodzi service-role).
      expect(error, "dwa wiersze wskazały to samo konto u dostawcy").not.toBeNull();
      expect(error?.code).toBe(PG_UNIQUE_VIOLATION);
    });
  });
});
