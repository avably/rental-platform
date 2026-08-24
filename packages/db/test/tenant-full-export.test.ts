/**
 * Pełny eksport JEDNEGO najemcy (I5.6, ADR-258) — bramka kompletności,
 * izolacji cross-tenant, sekretów-kopert i manifestu Storage.
 *
 * CO JEST MIERZONE (integracja RPC 0104 + moduł apps/panel/lib/export/
 * tenant-full.ts na ŻYWEJ bazie): zasiewamy DWÓCH niezależnych najemców (A, B)
 * kompletem wierszy — po jednym w KAŻDEJ tabeli per-tenant zwróconej przez
 * introspekcję (`listTenantTables`, ten sam harness co macierz izolacji RLS) —
 * a potem eksportujemy A rolą service_role i sprawdzamy, że:
 *
 *   1. KOMPLETNOŚĆ — manifest wymienia każdą tabelę per-tenant + korzeń tenants,
 *      a każdy wpis ma swój plik danych; sekrety mają własny wpis.
 *   2. IZOLACJA — `JSON.stringify(export A)` nie zawiera ANI JEDNEGO
 *      identyfikatora/wartości najemcy B (kontrola pozytywna: zawiera A).
 *   3. SEKRETY-KOPERTY — `tenant_secrets` wychodzą wyłącznie jako koperty
 *      `v1:…`; wartość jawna NIE pojawia się w eksporcie, także po zdekodowaniu
 *      base64url członu szyfrogramu (pamięć: mutation-proof-base64-vacuous-scan).
 *   4. MANIFEST STORAGE — pliki (zdjęcia/umowy) wymienione per bucket z prefiksem
 *      najemcy; żadna ścieżka nie należy do B.
 *   5. GRANTY — anon NIE może wywołać RPC (job wyłącznie service_role);
 *      najemca nieistniejący → twarda odmowa (pusty korzeń), nie „pusty backup".
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (jak rls-isolation).
 * WAŻNE: migracja 0104 musi być zastosowana na lokalnej bazie — PM wdraża ją
 * PRZED mergem; bez niej RPC nie istnieje i ta suita jest czerwona (nie zielona
 * po cichu).
 */
import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import { encryptTenantSecret, resolveSecretsKeyring } from "@avably/core";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  listTenantTables,
  seedSampleRow,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";
import {
  exportTenantFull,
  tenantExportFileList,
  TenantExportIsolationError,
  type TenantExportBundle,
} from "../../../apps/panel/lib/export/tenant-full";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

// Lustro wzorca koperty (0024 / packages/core/src/secrets/envelope.ts) — pakiety
// nie współdzielą regexów; ta kopia broni asercji sekretów w teście.
const SECRET_ENVELOPE_PATTERN = /^v1:[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

/** Zasiewa realną kopertę znanego plaintextu — do dowodu „sekret nie wycieka". */
async function seedRealSecret(
  admin: SupabaseClient,
  tenantId: string,
  plaintext: string,
): Promise<void> {
  const key = "export_test_real";
  const keyring = resolveSecretsKeyring({
    AVABLY_SECRETS_KEY_CURRENT: "1",
    AVABLY_SECRETS_KEY_V1: Buffer.from(randomBytes(32)).toString("base64"),
  });
  const envelope = encryptTenantSecret(plaintext, { tenantId, key }, keyring);
  const { error } = await admin.from("tenant_secrets").insert({
    tenant_id: tenantId,
    key,
    ciphertext: envelope.ciphertext,
    key_version: envelope.keyVersion,
  });
  if (error) throw new Error(`Nie udało się zasiać realnego sekretu: ${error.message}`);
}

describe.skipIf(!hasEnv)("Pełny eksport najemcy (I5.6, ADR-258)", () => {
  let admin: SupabaseClient;
  let a: TenantCtx;
  let b: TenantCtx;
  let perTenantTables: string[];
  let bundleA: TenantExportBundle;
  const secretPlaintextA = `PLAINTEXT-A-${randomUUID()}`;
  const secretPlaintextB = `PLAINTEXT-B-${randomUUID()}`;

  beforeAll(async () => {
    admin = createAdminClient();
    const seeded = await seedTwoTenants();
    a = seeded.a;
    b = seeded.b;

    perTenantTables = await listTenantTables();
    // Komplet danych obu najemców: jeden wiersz w KAŻDEJ tabeli per-tenant.
    for (const table of perTenantTables) {
      await seedSampleRow(admin, table, a.tenantId);
      await seedSampleRow(admin, table, b.tenantId);
    }
    // Realne koperty znanych plaintextów (dowód „nie wycieka").
    await seedRealSecret(admin, a.tenantId, secretPlaintextA);
    await seedRealSecret(admin, b.tenantId, secretPlaintextB);

    bundleA = await exportTenantFull(admin, a.tenantId, {
      now: new Date("2026-08-24T21:00:00.000Z"),
      supabaseProject: "local-test",
    });
  }, 120_000);

  afterAll(async () => {
    if (admin) await cleanupSeeded(admin);
  });

  it("czujnik: introspekcja widzi nietrywialny zbiór tabel per-tenant", () => {
    // `toContain` na pustej liście przechodziłoby wszędzie — bramka kompletności
    // musi mieć czego pilnować.
    expect(perTenantTables.length).toBeGreaterThan(20);
    expect(perTenantTables).toContain("tenant_secrets");
  });

  it("KOMPLETNOŚĆ: manifest wymienia każdą tabelę per-tenant + korzeń + sekrety", () => {
    const manifestNames = new Set(bundleA.manifest.tables.map((t) => t.name));
    const fileNames = new Set(bundleA.files.map((f) => f.path));

    expect(manifestNames.has("tenants")).toBe(true);
    expect(bundleA.manifest.secrets).not.toBeNull();

    for (const table of perTenantTables) {
      if (table === "tenant_secrets") {
        // Sekrety mają WŁASNY wpis manifestu (nie w `tables`), własny plik.
        expect(bundleA.manifest.secrets?.file).toBe("data/tenant_secrets.jsonl");
        expect(fileNames.has("data/tenant_secrets.jsonl")).toBe(true);
        continue;
      }
      expect(manifestNames.has(table), `manifest.tables pomija ${table}`).toBe(true);
      expect(fileNames.has(`data/${table}.jsonl`), `brak pliku danych dla ${table}`).toBe(true);
    }
    // Manifest odpowiada plikom co do liczby (korzeń + tabele + sekrety).
    expect(fileNames.has("data/tenants.jsonl")).toBe(true);
  });

  it("KOMPLETNOŚĆ: paczka plików ma manifest.json + wszystkie dane", () => {
    const files = tenantExportFileList(bundleA);
    expect(files[0]?.path).toBe("manifest.json");
    const parsed = JSON.parse(files[0]!.contents);
    expect(parsed.manifestVersion).toBe("0.1-draft");
    expect(parsed.tenant.id).toBe(a.tenantId);
    expect(parsed.exportedAt).toBe("2026-08-24T21:00:00.000Z");
  });

  it("IZOLACJA: eksport A nie zawiera żadnego identyfikatora/wartości B", () => {
    const json = JSON.stringify(bundleA);
    // Kontrola NEGATYWNA — nic z B.
    expect(json.includes(b.tenantId), "wyciek b.tenantId").toBe(false);
    expect(json.includes(b.ownerUserId), "wyciek b.ownerUserId").toBe(false);
    expect(json.includes(b.ownerEmail), "wyciek b.ownerEmail").toBe(false);
    expect(json.includes(secretPlaintextB), "wyciek jawnego sekretu B").toBe(false);
    // Kontrola POZYTYWNA — coś A tam jest (inaczej pusty eksport też by „przeszedł").
    // owner_user_id A siedzi w `members` (per-tenant); e-mail ownera NIE — mieszka
    // w auth.users (GoTrue, warstwa platformy odtwarzana osobno, poza tym zrzutem).
    expect(json.includes(a.tenantId), "brak a.tenantId — eksport pusty?").toBe(true);
    expect(json.includes(a.ownerUserId), "brak a.ownerUserId w members A").toBe(true);
  });

  it("IZOLACJA: każdy wiersz każdego pliku niesie tenant_id A (korzeń: id A)", () => {
    for (const file of bundleA.files) {
      const table = file.path.replace(/^data\//, "").replace(/\.jsonl$/, "");
      const rows = file.contents.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      for (const row of rows) {
        if (table === "tenants") expect(row.id).toBe(a.tenantId);
        else expect(row.tenant_id, `${table} niesie cudzy tenant_id`).toBe(a.tenantId);
      }
    }
  });

  it("SEKRETY-KOPERTY: wychodzą jako koperty; plaintext nieobecny nawet po dekodowaniu base64url", () => {
    const secretsFile = bundleA.files.find((f) => f.path === "data/tenant_secrets.jsonl");
    expect(secretsFile).toBeDefined();
    const rows = secretsFile!.contents.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(rows.length).toBeGreaterThan(0);

    let sawRealEnvelope = false;
    for (const row of rows) {
      expect(typeof row.ciphertext).toBe("string");
      expect(SECRET_ENVELOPE_PATTERN.test(row.ciphertext), `zła koperta: ${row.ciphertext}`).toBe(true);
      // Człon szyfrogramu zdekodowany — plaintext NIE może się w nim pojawić
      // (base64 maskowałby plaintext; dekodujemy i sprawdzamy u źródła).
      const ct = String(row.ciphertext).split(":")[4] ?? "";
      const decodedUtf8 = Buffer.from(ct, "base64url").toString("utf8");
      const decodedLatin = Buffer.from(ct, "base64url").toString("latin1");
      expect(decodedUtf8.includes(secretPlaintextA)).toBe(false);
      expect(decodedLatin.includes(secretPlaintextA)).toBe(false);
      if (row.key === "export_test_real") sawRealEnvelope = true;
    }
    // Dowód, że skan nie jest próżny: realna koperta A faktycznie tam była.
    expect(sawRealEnvelope, "realna koperta A nie trafiła do eksportu").toBe(true);
    // Jawny plaintext nie występuje NIGDZIE w pliku sekretów.
    expect(secretsFile!.contents.includes(secretPlaintextA)).toBe(false);

    expect(bundleA.manifest.secrets?.encrypted).toBe(true);
    expect(bundleA.manifest.secrets?.envelopeFormat).toBe("v1:<wersja>:<iv>:<tag>:<ct>");
    expect(bundleA.manifest.secrets?.keyVersions).toContain(1);
    expect(bundleA.manifest.secrets?.requiresEnv).toContain("AVABLY_SECRETS_KEY_CURRENT");
    expect(bundleA.manifest.secrets?.requiresEnv).toContain("AVABLY_SECRETS_KEY_V1");
  });

  it("MANIFEST STORAGE: pliki per bucket z prefiksem A; żadna ścieżka B", () => {
    const buckets = new Set(bundleA.manifest.storage.map((s) => s.bucket));
    // Harness zasiewa zdjęcia produktu, bilet uploadu, obraz sklepu i umowę.
    expect(buckets.has("product-images")).toBe(true);
    expect(buckets.has("site-images")).toBe(true);
    expect(buckets.has("rental-contracts")).toBe(true);

    for (const entry of bundleA.manifest.storage) {
      expect(entry.prefix).toBe(`${a.tenantId}/`);
      expect(entry.objectCount).toBe(entry.paths.length);
      expect(entry.paths.length).toBeGreaterThan(0);
      for (const path of entry.paths) {
        expect(path.startsWith(a.tenantId), `ścieżka spoza prefiksu A: ${path}`).toBe(true);
        expect(path.includes(b.tenantId), `ścieżka B w manifeście A: ${path}`).toBe(false);
      }
    }
  });

  it("GRANTY: anon nie może wywołać RPC eksportu (job wyłącznie service_role)", async () => {
    const anon = createClient(
      process.env.SUPABASE_LOCAL_API_URL as string,
      process.env.SUPABASE_LOCAL_ANON_KEY as string,
      { ...realtimeTransport },
    );
    const { error } = await anon.schema("app").rpc("export_tenant_full", { p_tenant_id: a.tenantId });
    expect(error, "anon zdołał wywołać eksport — grant przecieka").not.toBeNull();
  });

  it("ODMOWA: najemca nieistniejący → TenantExportIsolationError, nie pusty backup", async () => {
    await expect(exportTenantFull(admin, randomUUID())).rejects.toBeInstanceOf(
      TenantExportIsolationError,
    );
  });
});
