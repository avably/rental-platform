/**
 * Sekrety tenanta i bramka właściciela (migracja 0024, ADR-052) na ŻYWYM,
 * lokalnym Supabase — realni użytkownicy, realne sesje, realne RLS.
 *
 * Dlaczego tu, a nie na atrapie klienta: przedmiotem testu JEST polityka
 * bazy. Atrapa, która nie egzekwuje polityk, odpowiadałaby „ok" niezależnie
 * od tego, czy bramka istnieje — czyli zepsucie polityki byłoby niewidoczne,
 * a dowód mutacyjny (a) bezwartościowy.
 *
 * Suita pokrywa trzy niezależne mechanizmy:
 *   1. ZAPIS tylko dla ownera (tenant_settings ORAZ tenant_secrets) — zwykły
 *      członek dostaje odmowę Z BAZY, nie z interfejsu,
 *   2. w kolumnie tenant_secrets.ciphertext NIE MA wartości jawnej —
 *      asercja na KOLUMNIE odczytanej wprost z Postgresa, nie na wyniku
 *      funkcji odczytu (mutant szyfrujący dopiero w drodze powrotnej
 *      przeszedłby test oparty na funkcji),
 *   3. sekret nie wycieka do komunikatów błędów ani do audit_log.
 */
import { randomUUID } from "node:crypto";

import {
  GLOBKURIER_PASSWORD_SECRET_KEY,
  decryptTenantSecret,
  encryptTenantSecret,
  resolveSecretsKeyring,
} from "@avably/core";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/** 42501 = insufficient_privilege — odmowa z polityki RLS albo z GRANT-u. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";
/** 23514 = check_violation — odmowa z CHECK-a kształtu. */
const PG_CHECK_VIOLATION = "23514";

const TEST_PASSWORD = "SecretsTest!12345678";
/** Wartość jawna, której szukamy potem w bazie — rozpoznawalna i unikalna. */
const COURIER_PLAINTEXT = `NIEJAWNE-HASLO-${randomUUID()}`;

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

async function createUser(admin: SupabaseClient, label: string): Promise<string> {
  const email = `sec-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);
  return email;
}

const KEYRING = resolveSecretsKeyring({
  AVABLY_SECRETS_KEY_CURRENT: "1",
  AVABLY_SECRETS_KEY_V1: Buffer.alloc(32, 42).toString("base64"),
});

describe.skipIf(!hasEnv)("sekrety tenanta i bramka właściciela (0024, ADR-052)", () => {
  let admin: SupabaseClient;
  let sql: ReturnType<typeof postgres>;
  let tenantId: string;
  let ownerClient: SupabaseClient;
  let staffClient: SupabaseClient;

  beforeAll(async () => {
    admin = createAdminClient();
    sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });

    // Owner zakłada organizację (app.create_tenant dopisuje go jako owner).
    const ownerEmail = await createUser(admin, "owner");
    const bootstrap = await signIn(ownerEmail);
    const { data: newTenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
        p_slug: `sec-${randomUUID()}`.slice(0, 39),
        p_name: "Organizacja sekretów",
      });
    if (tenantError) throw new Error(`create_tenant: ${tenantError.message}`);
    tenantId = newTenantId as string;
    createdTenantIds.push(tenantId);
    ownerClient = await signIn(ownerEmail);

    // ZWYKŁY CZŁONEK tego samego tenanta — bohater dowodu (a). Musi być
    // pełnoprawnym członkiem: gdyby był spoza tenanta, odmowa pochodziłaby
    // z izolacji najemców, a nie z bramki roli, i mutacja (a) nie zapaliłaby
    // się przy zdjętym `app.is_tenant_owner()`.
    const staffEmail = await createUser(admin, "staff");
    const staffUser = createdUserIds[createdUserIds.length - 1];
    const { error: memberError } = await admin
      .from("members")
      .insert({ tenant_id: tenantId, user_id: staffUser, role: "staff" });
    if (memberError) throw new Error(`insert members(staff): ${memberError.message}`);
    // Claim tenant_id wchodzi do JWT przy logowaniu — sesja musi powstać PO
    // dopisaniu do members, inaczej token nie zna tenanta.
    await admin.auth.admin.updateUserById(staffUser, {
      app_metadata: { tenant_id: tenantId, role: "staff" },
    });
    staffClient = await signIn(staffEmail);
  }, 60_000);

  afterAll(async () => {
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    await sql.end({ timeout: 5 });
  });

  // -------------------------------------------------------------------
  // 1. Bramka właściciela — odmowa pochodzi Z BAZY
  // -------------------------------------------------------------------

  describe("zapis ustawień i sekretów wyłącznie dla właściciela", () => {
    it("zwykły członek NIE zapisze tenant_settings (odmowa z RLS)", async () => {
      const { error } = await staffClient.from("tenant_settings").insert({
        tenant_id: tenantId,
        key: "order_number_prefix",
        value: "HACK",
      });
      expect(error, "członek zapisał ustawienia tenanta — bramka 0024 nie działa").not.toBeNull();
      expect(
        error?.code,
        `odmowa powinna pochodzić z RLS (42501), nie z innego błędu: ${error?.message}`,
      ).toBe(PG_INSUFFICIENT_PRIVILEGE);
    });

    it("zwykły członek NIE zapisze sekretu tenanta (odmowa z RLS)", async () => {
      const envelope = encryptTenantSecret(
        "hasło-podstawione-przez-pracownika",
        { tenantId, key: GLOBKURIER_PASSWORD_SECRET_KEY },
        KEYRING,
      );
      const { error } = await staffClient.from("tenant_secrets").insert({
        tenant_id: tenantId,
        key: GLOBKURIER_PASSWORD_SECRET_KEY,
        ciphertext: envelope.ciphertext,
        key_version: envelope.keyVersion,
      });
      expect(error, "członek zapisał sekret tenanta — bramka 0024 nie działa").not.toBeNull();
      expect(error?.code, `odmowa z innego powodu niż RLS: ${error?.message}`).toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
    });

    it("właściciel zapisuje ustawienia i sekret bez przeszkód (kontrola pozytywna)", async () => {
      // Bez tej asercji bramka „wszystkim odmawiaj" też byłaby zielona.
      const { error: settingsError } = await ownerClient.from("tenant_settings").upsert(
        {
          tenant_id: tenantId,
          key: "globkurier_credentials",
          value: { email: "kurier@example.com", environment: "test" },
        },
        { onConflict: "tenant_id,key" },
      );
      expect(settingsError, `owner nie zapisał ustawień: ${settingsError?.message}`).toBeNull();

      const envelope = encryptTenantSecret(
        COURIER_PLAINTEXT,
        { tenantId, key: GLOBKURIER_PASSWORD_SECRET_KEY },
        KEYRING,
      );
      const { error: secretError } = await ownerClient.from("tenant_secrets").upsert(
        {
          tenant_id: tenantId,
          key: GLOBKURIER_PASSWORD_SECRET_KEY,
          ciphertext: envelope.ciphertext,
          key_version: envelope.keyVersion,
        },
        { onConflict: "tenant_id,key" },
      );
      expect(secretError, `owner nie zapisał sekretu: ${secretError?.message}`).toBeNull();
    });

    it("zwykły członek NIE nadpisze istniejącego sekretu (UPDATE poza zasięgiem)", async () => {
      // UPDATE odfiltrowany klauzulą USING nie narusza WITH CHECK, więc nie
      // wraca 42501 — wraca „zero wierszy". Dowodem jest STAN po operacji,
      // nie kod błędu: asercja wyłącznie na kodzie przegapiłaby zmianę.
      const before = await sql<{ ciphertext: string }[]>`
        select ciphertext from public.tenant_secrets
        where tenant_id = ${tenantId} and key = ${GLOBKURIER_PASSWORD_SECRET_KEY}
      `;
      expect(before, "brak sekretu do obrony — kontrola pozytywna nie zadziałała").toHaveLength(1);

      await staffClient
        .from("tenant_secrets")
        .update({ ciphertext: "v1:1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB:ZZZZZZZZZZZZ" })
        .eq("tenant_id", tenantId)
        .eq("key", GLOBKURIER_PASSWORD_SECRET_KEY);

      const after = await sql<{ ciphertext: string }[]>`
        select ciphertext from public.tenant_secrets
        where tenant_id = ${tenantId} and key = ${GLOBKURIER_PASSWORD_SECRET_KEY}
      `;
      expect(after[0].ciphertext, "członek nadpisał sekret tenanta").toBe(before[0].ciphertext);
    });

    it("zwykły członek CZYTA szyfrogram (świadoma decyzja ADR-052)", async () => {
      // Pracownik nadaje przesyłki, a nadanie biegnie jego sesją — odcięcie
      // odczytu oznaczałoby „tylko właściciel nadaje paczki". Szyfrogram bez
      // klucza (ten mieszka w env aplikacji) nie jest credentialem.
      const { data, error } = await staffClient
        .from("tenant_secrets")
        .select("key, ciphertext")
        .eq("tenant_id", tenantId);
      expect(error, `członek nie odczytał sekretu: ${error?.message}`).toBeNull();
      expect(data ?? []).toHaveLength(1);
      expect(data![0].ciphertext).not.toContain(COURIER_PLAINTEXT);
    });
  });

  // -------------------------------------------------------------------
  // 2. W KOLUMNIE nie ma wartości jawnej
  // -------------------------------------------------------------------

  describe("kolumna tenant_secrets.ciphertext nie zawiera wartości jawnej", () => {
    it("odczyt KOLUMNY wprost z Postgresa nie ujawnia hasła", async () => {
      // Celowo bezpośrednim połączeniem, z pominięciem aplikacji i PostgREST:
      // pytamy o to, co NAPRAWDĘ leży na dysku. Asercja na wyniku funkcji
      // odczytu przepuściłaby mutanta, który szyfruje dopiero w drodze
      // powrotnej.
      const rows = await sql<{ ciphertext: string; key_version: number }[]>`
        select ciphertext, key_version from public.tenant_secrets
        where tenant_id = ${tenantId} and key = ${GLOBKURIER_PASSWORD_SECRET_KEY}
      `;
      expect(rows, "brak wiersza sekretu").toHaveLength(1);
      const stored = rows[0].ciphertext;

      // Sama nieobecność napisu to ZA MAŁO: wykryte dowodem mutacyjnym (b) —
      // mutant, który wkłada do koperty wartość jawną zamiast szyfrogramu,
      // przechodził tę asercję, bo człon koperty jest zakodowany base64url
      // i literalnego hasła w kolumnie nie widać. Sprawdzamy więc też
      // trywialne kodowania ORAZ zdekodowaną zawartość członu danych.
      const plain = Buffer.from(COURIER_PLAINTEXT, "utf8");
      for (const [nazwa, forma] of [
        ["surowa", COURIER_PLAINTEXT],
        ["base64", plain.toString("base64")],
        ["base64url", plain.toString("base64url")],
        ["hex", plain.toString("hex")],
      ] as const) {
        expect(stored, `hasło leży w bazie w postaci ${nazwa}`).not.toContain(forma);
      }
      const dataMember = Buffer.from(stored.split(":")[4] ?? "", "base64url").toString("utf8");
      expect(dataMember, "człon danych koperty NIESIE wartość jawną").not.toContain(
        COURIER_PLAINTEXT,
      );

      expect(stored).toMatch(/^v1:1:/);
      expect(rows[0].key_version).toBe(1);
    });

    it("zawartość koperty zależy OD KLUCZA — obcym kluczem się nie odczyta", async () => {
      // Najmocniejsza z asercji tej grupy i drugi wniosek z dowodu (b):
      // mutant przepisujący wartość jawną „odszyfrowuje się" dowolnym kluczem,
      // bo klucza w ogóle nie używa. Test wymaga, żeby PODMIANA klucza
      // popsuła odczyt — czyli żeby szyfrowanie było prawdziwe, a nie pozorne.
      const rows = await sql<{ ciphertext: string }[]>`
        select ciphertext from public.tenant_secrets
        where tenant_id = ${tenantId} and key = ${GLOBKURIER_PASSWORD_SECRET_KEY}
      `;
      const obcyKeyring = resolveSecretsKeyring({
        AVABLY_SECRETS_KEY_CURRENT: "1",
        AVABLY_SECRETS_KEY_V1: Buffer.alloc(32, 99).toString("base64"),
      });
      expect(() =>
        decryptTenantSecret(
          rows[0].ciphertext,
          { tenantId, key: GLOBKURIER_PASSWORD_SECRET_KEY },
          obcyKeyring,
        ),
      ).toThrow();

      // Kontrola pozytywna tej samej asercji: WŁAŚCIWY klucz odczytuje.
      expect(
        decryptTenantSecret(
          rows[0].ciphertext,
          { tenantId, key: GLOBKURIER_PASSWORD_SECRET_KEY },
          KEYRING,
        ),
      ).toBe(COURIER_PLAINTEXT);
    });

    it("wartości jawnej nie ma NIGDZIE w tabeli sekretów", async () => {
      // Szersza sieć niż jedna kolumna jednego wiersza: gdyby regres odłożył
      // hasło pod inny klucz albo do innej kolumny, ta asercja to złapie.
      const rows = await sql<{ row: string }[]>`
        select t::text as row from public.tenant_secrets t
        where t.tenant_id = ${tenantId}
      `;
      for (const { row } of rows) {
        expect(row, "wartość jawna znaleziona w wierszu tenant_secrets").not.toContain(
          COURIER_PLAINTEXT,
        );
      }
    });

    it("wartości jawnej nie ma w tenant_settings (hasło opuściło jsonb)", async () => {
      const rows = await sql<{ value: unknown }[]>`
        select value::text as value from public.tenant_settings where tenant_id = ${tenantId}
      `;
      for (const { value } of rows) {
        expect(String(value)).not.toContain(COURIER_PLAINTEXT);
      }
    });

    it("baza ODRZUCA hasło zapisane pod kluczem globkurier_credentials", async () => {
      // Zapora przed cofnięciem długu: gdyby kod panelu zaczął znów odkładać
      // hasło do jsonb, testy szyfrowania (inna tabela!) nadal byłyby zielone.
      // Ta bramka jest w bazie i pali się natychmiast.
      const { error } = await ownerClient.from("tenant_settings").upsert(
        {
          tenant_id: tenantId,
          key: "globkurier_credentials",
          value: { email: "kurier@example.com", environment: "test", password: "jawne" },
        },
        { onConflict: "tenant_id,key" },
      );
      expect(error, "baza przyjęła hasło jawnie w tenant_settings").not.toBeNull();
      expect(error?.code, `odmowa z innego powodu niż CHECK: ${error?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );
    });
  });

  // -------------------------------------------------------------------
  // 3. Kształt koperty i spójność wersji klucza (CHECK-i 0024)
  // -------------------------------------------------------------------

  describe("CHECK-i kształtu koperty", () => {
    it("odrzuca ciphertext, który nie jest kopertą", async () => {
      const { error } = await ownerClient.from("tenant_secrets").insert({
        tenant_id: tenantId,
        key: `probny_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
        ciphertext: "zwykłe-hasło-wpisane-wprost",
        key_version: 1,
      });
      expect(error?.code, `baza przyjęła nie-kopertę: ${error?.message}`).toBe(PG_CHECK_VIOLATION);
    });

    it("odrzuca rozjazd key_version z wersją zapisaną w kopercie", async () => {
      // Rozjazd oznaczałby raport rotacji kłamiący o stanie faktycznym:
      // wiersz raportowałby się jako przeszyfrowany, będąc na starym kluczu.
      const envelope = encryptTenantSecret(
        "wartość",
        { tenantId, key: "probny_rozjazd" },
        KEYRING,
      );
      const { error } = await ownerClient.from("tenant_secrets").insert({
        tenant_id: tenantId,
        key: "probny_rozjazd",
        ciphertext: envelope.ciphertext,
        key_version: envelope.keyVersion + 1,
      });
      expect(error?.code, `baza przyjęła rozjazd wersji: ${error?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );
    });
  });

  // -------------------------------------------------------------------
  // 4. Sekret nie trafia do audit_log ani do komunikatów błędów
  // -------------------------------------------------------------------

  describe("sekret nie wycieka poza tabelę", () => {
    it("wartości jawnej nie ma w audit_log", async () => {
      // Zasiew JEST częścią dowodu, nie przygotowaniem: bez niego pętla niżej
      // nie wykonuje ani jednego obiegu i test jest zielony przez PUSTKĘ
      // (dziś nic nie loguje zmian ustawień). Taka asercja przepuściłaby
      // regres, który zacznie logować sekret — złapane przy dowodzie (d).
      const { error: seedError } = await admin.from("audit_log").insert({
        tenant_id: tenantId,
        action: "tenant_settings.updated",
        subject: GLOBKURIER_PASSWORD_SECRET_KEY,
        details: { key: GLOBKURIER_PASSWORD_SECRET_KEY, changed: true },
      });
      expect(seedError, `zasiew audit_log: ${seedError?.message}`).toBeNull();

      const rows = await sql<{ row: string }[]>`
        select l::text as row from public.audit_log l
        where l.tenant_id = ${tenantId}
      `;
      expect(
        rows.length,
        "skan audit_log nie objął ANI JEDNEGO wiersza — asercja byłaby pusta",
      ).toBeGreaterThan(0);
      for (const { row } of rows) {
        expect(row, "wartość jawna trafiła do audit_log").not.toContain(COURIER_PLAINTEXT);
      }
    });

    it("komunikat odmowy nie niesie wartości jawnej ani szyfrogramu", async () => {
      // Komunikat błędu z bazy wraca do panelu i bywa logowany. Gdyby niósł
      // sekret, szyfrowanie kolumny straciłoby sens przy pierwszej odmowie.
      const envelope = encryptTenantSecret(
        COURIER_PLAINTEXT,
        { tenantId, key: GLOBKURIER_PASSWORD_SECRET_KEY },
        KEYRING,
      );
      const { error } = await staffClient.from("tenant_secrets").insert({
        tenant_id: tenantId,
        key: GLOBKURIER_PASSWORD_SECRET_KEY,
        ciphertext: envelope.ciphertext,
        key_version: envelope.keyVersion,
      });
      const serialized = JSON.stringify(error ?? {});
      expect(serialized).not.toContain(COURIER_PLAINTEXT);
      expect(serialized).not.toContain(envelope.ciphertext);
    });

    it("app.tenant_secret_is_set zwraca sam stan, nigdy wartości", async () => {
      const { data: set, error } = await staffClient
        .schema("app")
        .rpc("tenant_secret_is_set", { p_key: GLOBKURIER_PASSWORD_SECRET_KEY });
      expect(error, `RPC stanu sekretu: ${error?.message}`).toBeNull();
      expect(set).toBe(true);
      expect(JSON.stringify(set)).not.toContain(COURIER_PLAINTEXT);

      const { data: absent } = await staffClient
        .schema("app")
        .rpc("tenant_secret_is_set", { p_key: "nie_ma_takiego_sekretu" });
      expect(absent).toBe(false);
    });
  });
});
