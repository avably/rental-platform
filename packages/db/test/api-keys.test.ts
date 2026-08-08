/**
 * Klucze publicznego API (migracja 0053, ADR-108) na ŻYWYM lokalnym Supabase
 * — realne sesje, realne RLS, realna funkcja app.verify_api_key.
 *
 * Suita pokrywa pięć niezależnych mechanizmów:
 *   1. WERYFIKACJA klucza przychodzącego: poprawny hash → tenant; hash
 *      nieznany / odwołany / źle sformowany → 0 wierszy NIEROZRÓŻNIALNIE
 *      (dowód mutacyjny M2: zdjęcie filtra `revoked_at is null` pali test
 *      klucza odwołanego),
 *   2. KSZTAŁT odpowiedzi weryfikacji: wyłącznie (tenant_id, key_id,
 *      tenant_status) — żadnych hashy, nazw ani cudzych kluczy (§6.6/§6.7),
 *   3. RLS: anon nie czyta nic, członek nie czyta kluczy innego tenanta,
 *      mutacje wyłącznie owner (staff dostaje odmowę Z BAZY),
 *   4. PLAINTEXT niereprezentowalny: CHECK 64-hex odrzuca surowy klucz
 *      w kolumnie key_hash,
 *   5. last_used_at aktualizowane przez weryfikację (obserwowalność).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

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
/** 23514 = check_violation — odmowa z CHECK-a kształtu. */
const PG_CHECK_VIOLATION = "23514";

const TEST_PASSWORD = "ApiKeysTest!12345678";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const sha256Hex = (raw: string): string => createHash("sha256").update(raw).digest("hex");

/** Surowy klucz w formacie produkcyjnym: avbl_ + 64 hex (32 bajty entropii). */
function rawApiKey(): string {
  return `avbl_${randomBytes(32).toString("hex")}`;
}

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

const createAdminClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

const createAnonClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

async function createUser(admin: SupabaseClient, label: string): Promise<string> {
  const email = `apikeys-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);
  return email;
}

/** Owner zakłada organizację przez app.create_tenant (claim tenant_id w JWT). */
async function createTenantWithOwner(
  admin: SupabaseClient,
  label: string,
): Promise<{ tenantId: string; ownerClient: SupabaseClient }> {
  const ownerEmail = await createUser(admin, `owner-${label}`);
  const bootstrap = await signIn(ownerEmail);
  const { data: tenantId, error } = await bootstrap.schema("app").rpc("create_tenant", {
    p_slug: `apikeys-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja kluczy ${label}`,
  });
  if (error) throw new Error(`create_tenant(${label}): ${error.message}`);
  createdTenantIds.push(tenantId as string);
  return { tenantId: tenantId as string, ownerClient: await signIn(ownerEmail) };
}

describe.skipIf(!hasEnv)("klucze publicznego API (0053, ADR-108)", () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let tenantA: string;
  let tenantB: string;
  let ownerA: SupabaseClient;
  let ownerB: SupabaseClient;
  let staffA: SupabaseClient;

  /** Żywy klucz tenanta A — zasiany raz, używany przez większość dowodów. */
  const keyA = rawApiKey();
  /** Klucz tenanta A, który zostanie ODWOŁANY. */
  const keyARevoked = rawApiKey();

  beforeAll(async () => {
    admin = createAdminClient();
    anon = createAnonClient();

    ({ tenantId: tenantA, ownerClient: ownerA } = await createTenantWithOwner(admin, "a"));
    ({ tenantId: tenantB, ownerClient: ownerB } = await createTenantWithOwner(admin, "b"));

    // Zwykły członek tenanta A — bohater dowodu bramki roli (patrz
    // tenant-secrets.test.ts: musi być CZŁONKIEM, żeby odmowa pochodziła
    // z bramki roli, a nie z izolacji najemców).
    const staffEmail = await createUser(admin, "staff-a");
    const staffUser = createdUserIds[createdUserIds.length - 1];
    const { error: memberError } = await admin
      .from("members")
      .insert({ tenant_id: tenantA, user_id: staffUser, role: "staff" });
    if (memberError) throw new Error(`insert members(staff): ${memberError.message}`);
    await admin.auth.admin.updateUserById(staffUser!, {
      app_metadata: { tenant_id: tenantA, role: "staff" },
    });
    staffA = await signIn(staffEmail);

    // Klucze zasiane przez OWNERA (kontrola pozytywna polityki INSERT jest
    // częścią setupu — gdyby owner nie mógł, cała suita spadnie tutaj).
    for (const [client, tenantId, raw, name] of [
      [ownerA, tenantA, keyA, "Klucz testowy A"],
      [ownerA, tenantA, keyARevoked, "Klucz odwołany A"],
    ] as const) {
      const { error } = await client.from("api_keys").insert({
        tenant_id: tenantId,
        name,
        key_hash: sha256Hex(raw),
        key_prefix: raw.slice(0, 13),
      });
      if (error) throw new Error(`insert api_keys(${name}): ${error.message}`);
    }

    // Odwołanie drugiego klucza — przez ownera, jak w produkcie.
    const { error: revokeError } = await ownerA
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("tenant_id", tenantA)
      .eq("key_hash", sha256Hex(keyARevoked));
    if (revokeError) throw new Error(`revoke api_keys: ${revokeError.message}`);
  }, 60_000);

  afterAll(async () => {
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  // -------------------------------------------------------------------
  // 1. app.verify_api_key — weryfikacja klucza przychodzącego
  // -------------------------------------------------------------------

  describe("app.verify_api_key", () => {
    it("poprawny hash żywego klucza → tenant_id + key_id + status tenanta", async () => {
      const { data, error } = await anon
        .schema("app")
        .rpc("verify_api_key", { p_key_hash: sha256Hex(keyA) });
      expect(error, `verify_api_key: ${error?.message}`).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);

      const row = (data as Record<string, unknown>[])[0]!;
      expect(row.tenant_id).toBe(tenantA);
      expect(typeof row.key_id).toBe("string");
      expect(row.tenant_status).toBe("trialing");

      // KSZTAŁT zamknięty (§6.6): odpowiedź nie niesie hashy, nazw,
      // prefiksów ani niczego o INNYCH kluczach.
      expect(Object.keys(row).sort()).toEqual(["key_id", "tenant_id", "tenant_status"]);
    });

    it("hash nieznany, odwołany i źle sformowany → 0 wierszy NIEROZRÓŻNIALNIE", async () => {
      const probes = [
        sha256Hex(rawApiKey()), // klucz, którego nikt nie wygenerował
        sha256Hex(keyARevoked), // klucz odwołany (dowód mutacyjny M2)
        "nie-hex", // śmieć
        sha256Hex(keyA).slice(0, 32), // za krótki
      ];
      const responses = [] as unknown[];
      for (const p_key_hash of probes) {
        const { data, error } = await anon.schema("app").rpc("verify_api_key", { p_key_hash });
        expect(error, `verify_api_key(${p_key_hash}): ${error?.message}`).toBeNull();
        responses.push(data);
      }
      // Wszystkie odmowy są IDENTYCZNE — ani kodem, ani kształtem nie da się
      // odróżnić „nie istnieje" od „odwołany" (zakaz enumeracji, §6.2/§6.4).
      for (const response of responses) expect(response).toEqual([]);
    });

    it("prefiks hasha ani prefiks klucza nie wystarczą (dowód mutacyjny M1 od strony bazy)", async () => {
      // Hash „klucza-prefiksu": ktoś zna prefiks z ekranu panelu i próbuje
      // go użyć jako klucza. To INNY string niż pełny klucz → inny sha256.
      const { data } = await anon
        .schema("app")
        .rpc("verify_api_key", { p_key_hash: sha256Hex(keyA.slice(0, 13)) });
      expect(data).toEqual([]);
    });

    it("weryfikacja aktualizuje last_used_at (obserwowalność użycia)", async () => {
      const { data: before } = await admin
        .from("api_keys")
        .select("last_used_at")
        .eq("key_hash", sha256Hex(keyA))
        .single();
      // Wcześniejsze testy mogły już użyć klucza — asercja jest na tym, że
      // po świeżej weryfikacji znacznik ISTNIEJE (dławienie 1 min nie cofa go).
      await anon.schema("app").rpc("verify_api_key", { p_key_hash: sha256Hex(keyA) });
      const { data: after } = await admin
        .from("api_keys")
        .select("last_used_at")
        .eq("key_hash", sha256Hex(keyA))
        .single();
      expect(after?.last_used_at, "verify_api_key nie zapisał last_used_at").not.toBeNull();
      // Znacznik nie cofa się w czasie.
      if (before?.last_used_at) {
        expect(new Date(after!.last_used_at as string).getTime()).toBeGreaterThanOrEqual(
          new Date(before.last_used_at as string).getTime(),
        );
      }
    });
  });

  // -------------------------------------------------------------------
  // 2. RLS — kto co widzi i kto co zmienia
  // -------------------------------------------------------------------

  describe("RLS api_keys", () => {
    it("anon nie czyta tabeli w ogóle (zero grantów)", async () => {
      const { data, error } = await anon.from("api_keys").select("id, key_hash");
      // Brak grantu SELECT dla anon → odmowa; gdyby grant wrócił regresją,
      // brak polityki dla anon i tak odetnie wiersze (pusta lista).
      if (error) {
        expect(error.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
      } else {
        expect(data).toEqual([]);
      }
    });

    it("członek A nie czyta kluczy tenanta B (test celowany, obok macierzy)", async () => {
      const { data, error } = await staffA.from("api_keys").select("id").eq("tenant_id", tenantB);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("staff NIE wygeneruje klucza (odmowa z RLS, nie z UI)", async () => {
      const raw = rawApiKey();
      const { error } = await staffA.from("api_keys").insert({
        tenant_id: tenantA,
        name: "Klucz podstawiony przez pracownika",
        key_hash: sha256Hex(raw),
        key_prefix: raw.slice(0, 13),
      });
      expect(error, "staff wygenerował klucz — bramka ownera 0053 nie działa").not.toBeNull();
      expect(error?.code, `odmowa z innego powodu niż RLS: ${error?.message}`).toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
    });

    it("staff NIE odwoła klucza (UPDATE tylko dla ownera)", async () => {
      const { data, error } = await staffA
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("tenant_id", tenantA)
        .eq("key_hash", sha256Hex(keyA))
        .select("id");
      // RLS na UPDATE przycina wiersze do zera (bez wyjątku) — liczy się to,
      // że ŻADEN wiersz nie został dotknięty.
      expect(error).toBeNull();
      expect(data).toEqual([]);
      const { data: still } = await admin
        .from("api_keys")
        .select("revoked_at")
        .eq("key_hash", sha256Hex(keyA))
        .single();
      expect(still?.revoked_at, "klucz odwołany przez staffa mimo braku roli").toBeNull();
    });

    it("owner B nie odwoła klucza tenanta A (izolacja przy mutacji)", async () => {
      const { data, error } = await ownerB
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("key_hash", sha256Hex(keyA))
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // 3. Plaintext niereprezentowalny w kolumnie hasha
  // -------------------------------------------------------------------

  it("surowy klucz NIE przejdzie CHECK-a kolumny key_hash (plaintext niereprezentowalny)", async () => {
    const raw = rawApiKey();
    const { error } = await ownerA.from("api_keys").insert({
      tenant_id: tenantA,
      name: "Próba zapisu plaintextu",
      key_hash: raw, // surowy klucz zamiast sha256 — ma się wywrócić na CHECK
      key_prefix: raw.slice(0, 13),
    });
    expect(error, "kolumna key_hash przyjęła surowy klucz").not.toBeNull();
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("w tabeli nie ma plaintextu zasianych kluczy (asercja na kolumnach wprost)", async () => {
    const { data } = await admin
      .from("api_keys")
      .select("key_hash, key_prefix, name")
      .eq("tenant_id", tenantA);
    for (const row of data ?? []) {
      const dump = JSON.stringify(row);
      expect(dump).not.toContain(keyA.slice(13)); // entropia surowego klucza
      expect(dump).not.toContain(keyARevoked.slice(13));
      expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
