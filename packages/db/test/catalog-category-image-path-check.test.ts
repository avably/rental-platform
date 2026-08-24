import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";

/**
 * SONDA CHECK-a PREFIKSU TENANTA NA catalog_categories.image_path
 * (0108, ADR-264) — warstwa TABELI, niezależna od drogi zapisu.
 *
 * DLACZEGO OSOBNO OD 0106. app.set_category_image (0106) zawęża ścieżkę w
 * CIELE funkcji (22023). Ale catalog_categories ma GRANT UPDATE dla
 * `authenticated` (0072), a RLS `tenant_update` bramkuje WIERSZ, nie WARTOŚĆ —
 * więc członek może OMINĄĆ RPC i bezpośrednim UPDATE-em PostgREST wpisać w
 * `image_path` dowolny tekst. CHECK 0108 zamyka tę lukę na poziomie tabeli:
 * odmowa to 23514 (check_violation), nie 22023 — inna warstwa, inny kod.
 *
 * WEKTORY (bezpośredni UPDATE własnego wiersza, z pominięciem RPC):
 *   (1) ścieżka spoza własnego prefiksu (cudzy tenant)      -> 23514
 *   (2) łańcuch spoza wzorca (traversal po zgodnym prefiksie) -> 23514
 *       — tego SAM warunek prefiksu by NIE złapał; pełny wzorzec łapie
 *   (3) własny prefiks, zły segment (logo zamiast category) -> 23514
 *   (4) własny poprawny wzorzec {tenant}/category/{uuid}.ext -> zapis OK
 *   (5) NULL (zdjęcie banera)                                -> zapis OK
 *
 * KONTROLA POZYTYWNA: app.set_category_image dalej zapisuje poprawną ścieżkę
 * (CHECK nie psuje drogi przez RPC).
 */
const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const LOCAL_DB_URL = process.env.SUPABASE_LOCAL_URL;
const sql = LOCAL_DB_URL ? postgres(LOCAL_DB_URL, { max: 1 }) : null;
const CONSTRAINT = "catalog_categories_image_path_tenant_scope";
const CHECK_VIOLATION = "23514";
const SET_DENIED = "Nie można zapisać banera kategorii.";

let admin: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;
let categoryAId: string;

async function createCategory(tenantId: string): Promise<string> {
  const unique = randomUUID().slice(0, 8);
  const { data, error } = await admin
    .from("catalog_categories")
    .insert({
      tenant_id: tenantId,
      name: `CHECK test ${unique}`,
      slug: `check-test-image-path-${unique}`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się utworzyć kategorii: ${error?.message}`);
  return data.id as string;
}

/** Bezpośredni UPDATE image_path rolą OWNERA A (z pominięciem RPC). */
async function directUpdate(categoryId: string, imagePath: string | null) {
  return a.ownerClient
    .from("catalog_categories")
    .update({ image_path: imagePath })
    .eq("id", categoryId)
    .select("id");
}

function validPath(tenantId: string): string {
  return `${tenantId}/category/${randomUUID()}.png`;
}

describe.skipIf(!hasEnv)("CHECK prefiksu tenanta na catalog_categories.image_path (0108, ADR-264)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    ({ a, b } = await seedTwoTenants());
    categoryAId = await createCategory(a.tenantId);
  }, 30_000);

  afterAll(async () => {
    await cleanupSeeded(admin);
    await sql?.end({ timeout: 5 });
  });

  // ----- struktura: CHECK istnieje na tabeli -----

  it("constraint CHECK istnieje na public.catalog_categories", async () => {
    const rows = await sql!<{ contype: string }[]>`
      select c.contype
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'catalog_categories'
        and c.conname = ${CONSTRAINT}
    `;
    expect(rows, `brak constraintu ${CONSTRAINT} — migracja 0108 niezastosowana?`).toHaveLength(1);
    expect(rows[0]!.contype).toBe("c");
  });

  // ----- WEKTOR 1: ścieżka spoza własnego prefiksu -----

  it("(1) bezpośredni UPDATE na CUDZY prefiks → 23514", async () => {
    const { error } = await directUpdate(categoryAId, validPath(b.tenantId));
    expect(error, "cudzy prefiks powinien zostać odrzucony przez CHECK").not.toBeNull();
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  // ----- WEKTOR 2: traversal po zgodnym prefiksie (sam prefiks by nie złapał) -----

  it("(2) bezpośredni UPDATE na traversal z własnym prefiksem → 23514", async () => {
    const { error } = await directUpdate(categoryAId, `${a.tenantId}/category/../../etc/passwd`);
    expect(error, "traversal po zgodnym prefiksie powinien paść na CHECK").not.toBeNull();
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  // ----- WEKTOR 3: własny prefiks, zły segment -----

  it("(3) bezpośredni UPDATE na własny prefiks, segment 'logo' → 23514", async () => {
    const { error } = await directUpdate(categoryAId, `${a.tenantId}/logo/${randomUUID()}.png`);
    expect(error).not.toBeNull();
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("(3b) bezpośredni UPDATE na własny prefiks, złe rozszerzenie (svg) → 23514", async () => {
    const { error } = await directUpdate(categoryAId, `${a.tenantId}/category/${randomUUID()}.svg`);
    expect(error).not.toBeNull();
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  // Żadna z odrzuconych prób nie zapisała image_path.
  it("po odmowach image_path pozostaje NULL", async () => {
    const { data } = await admin
      .from("catalog_categories")
      .select("image_path")
      .eq("id", categoryAId)
      .single();
    expect(data?.image_path).toBeNull();
  });

  // ----- WEKTOR 4/5: własny poprawny wzorzec oraz NULL przechodzą -----

  it("(4) bezpośredni UPDATE na WŁASNY poprawny wzorzec → zapis OK", async () => {
    const path = validPath(a.tenantId);
    const { data, error } = await directUpdate(categoryAId, path);
    expect(error, error?.message).toBeNull();
    expect(data).toHaveLength(1);
    const row = await admin
      .from("catalog_categories")
      .select("image_path")
      .eq("id", categoryAId)
      .single();
    expect(row.data?.image_path).toBe(path);
  });

  it("(5) bezpośredni UPDATE na NULL (zdjęcie banera) → zapis OK", async () => {
    const { error } = await directUpdate(categoryAId, null);
    expect(error, error?.message).toBeNull();
    const row = await admin
      .from("catalog_categories")
      .select("image_path")
      .eq("id", categoryAId)
      .single();
    expect(row.data?.image_path).toBeNull();
  });

  // ----- KONTROLA POZYTYWNA: RPC dalej działa (CHECK nie psuje drogi funkcji) -----

  it("pozytyw: app.set_category_image zapisuje poprawną ścieżkę mimo CHECK-a", async () => {
    const path = validPath(a.tenantId);
    const set = await a.ownerClient
      .schema("app")
      .rpc("set_category_image", { p_category_id: categoryAId, p_path: path });
    expect(set.error, set.error?.message).toBeNull();
    const row = await admin
      .from("catalog_categories")
      .select("image_path")
      .eq("id", categoryAId)
      .single();
    expect(row.data?.image_path).toBe(path);

    // RPC odrzuca ścieżkę spoza wzorca WŁASNĄ bramką (22023) — inna warstwa
    // niż CHECK (23514), obie zamknięte.
    const denied = await a.ownerClient
      .schema("app")
      .rpc("set_category_image", { p_category_id: categoryAId, p_path: `${b.tenantId}/category/${randomUUID()}.png` });
    expect(denied.error?.code).toBe("22023");
    expect(denied.error?.message).toContain(SET_DENIED);

    // Sprzątanie: zdejmujemy baner, żeby rerun bez db reset zastał czystą kategorię.
    const cleared = await a.ownerClient
      .schema("app")
      .rpc("set_category_image", { p_category_id: categoryAId, p_path: null });
    expect(cleared.error).toBeNull();
  });
});
