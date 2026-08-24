/**
 * Baner kategorii w kopercie katalogu — migracja 0103, ADR-251.
 *
 * `app.get_public_catalog` (0072) nosi pełne obiekty kategorii, ale do 0103 NIE
 * projektował `image_path` (kolumna z Fazy A, 0101). Kafel kategorii na home i
 * przyszła sekcja „kategorie" czytają PEŁNY katalog i potrzebują banera — 0103
 * dokłada JEDEN klucz w bloku kategorii. Ten plik pilnuje dwóch rzeczy z obu
 * stron (jest / nie ma), bo asercja „nie zawiera X" jest zielona także po pustym
 * zbiorze:
 *
 *   1. KONTROLA POZYTYWNA. Kategoria z ustawionym `image_path` NIESIE tę ścieżkę
 *      w kopercie; kategoria bez banera niesie `null` (klucz jest ZAWSZE — to
 *      projekcja, nie pole warunkowe). Bez dodatniej strony test przeszedłby,
 *      gdyby funkcja w ogóle przestała projektować kategorie.
 *
 *   2. IZOLACJA MIĘDZYTENANTOWA. Funkcja jest SECURITY DEFINER (RLS jej nie
 *      dotyczy), więc jedyną bramką jest jawny filtr `c.tenant_id = t.id`.
 *      `image_path` jedzie tym SAMYM podzapytaniem, co reszta pól kategorii, więc
 *      koperta najemcy A nie może nieść banera (ani kategorii) najemcy B.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_* — patrz
 * helpers/integration-env.ts. Bez nich plik jest pomijany JAWNIE.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

const sql = hasEnv ? postgres(env("SUPABASE_LOCAL_URL"), { max: 1 }) : null;

const createdTenantIds: string[] = [];

async function seedTenant(admin: SupabaseClient, label: string): Promise<string> {
  const slug = `banner-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: `Baner test ${label}`, status: "active", locale: "pl" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać tenanta ${label}: ${error?.message}`);
  createdTenantIds.push(data.id as string);
  return data.id as string;
}

async function seedCategory(
  admin: SupabaseClient,
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const unique = randomUUID().slice(0, 8);
  const { data, error } = await admin
    .from("catalog_categories")
    .insert({
      tenant_id: tenantId,
      name: `Kategoria ${unique}`,
      slug: `kategoria-${unique}`,
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać kategorii: ${error?.message}`);
  return data.id as string;
}

interface PublicCategoryShape {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_path: string | null;
  position: number;
}

interface PublicCatalogShape {
  categories: PublicCategoryShape[];
}

async function readCatalog(anon: SupabaseClient, tenantId: string): Promise<PublicCatalogShape> {
  const { data, error } = await anon
    .schema("app")
    .rpc("get_public_catalog", { p_tenant_id: tenantId });
  expect(error, `get_public_catalog jako anon zawiódł: ${error?.message}`).toBeNull();
  return data as unknown as PublicCatalogShape;
}

describe.skipIf(!hasEnv)("baner kategorii w kopercie katalogu — 0103 (ADR-251)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    await sql?.end({ timeout: 5 });
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Kontrola pozytywna: baner niesiony, brak banera → null
  // -------------------------------------------------------------------
  describe("projekcja image_path", () => {
    let tenantId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant(admin, "proj");
    }, 60_000);

    it("kategoria z image_path NIESIE tę ścieżkę; kategoria bez banera niesie null", async () => {
      const bannerPath = `banners/${randomUUID()}.webp`;
      const withBanner = await seedCategory(admin, tenantId, {
        name: "Z_BANEREM",
        slug: `z-banerem-${randomUUID().slice(0, 8)}`,
        image_path: bannerPath,
        position: 1,
      });
      const withoutBanner = await seedCategory(admin, tenantId, {
        name: "BEZ_BANERU",
        slug: `bez-baneru-${randomUUID().slice(0, 8)}`,
        position: 2,
      });

      const catalog = await readCatalog(anon, tenantId);

      // KONTROLA POZYTYWNA NAJPIERW: dowodzimy, że kategorie w ogóle są, zanim
      // asertujemy wartości — inaczej wszystko niżej byłoby po pustym zbiorze.
      const byId = new Map(catalog.categories.map((c) => [c.id, c]));
      const seeded = catalog.categories.filter((c) => byId.has(c.id) && [withBanner, withoutBanner].includes(c.id));
      expect(seeded.map((c) => c.name).sort(), "koperta nie niesie zasianych kategorii").toEqual([
        "BEZ_BANERU",
        "Z_BANEREM",
      ]);

      const banered = byId.get(withBanner)!;
      const plain = byId.get(withoutBanner)!;

      // Klucz `image_path` jest ZAWSZE obecny — to projekcja, nie pole warunkowe.
      expect(Object.keys(banered), "brak klucza image_path w bloku kategorii").toContain(
        "image_path",
      );
      expect(banered.image_path, "baner kategorii nie doszedł do koperty").toBe(bannerPath);
      expect(plain.image_path, "kategoria bez banera powinna nieść null, nie undefined").toBeNull();
    });

    it("kształt kategorii to id,name,slug,description,image_path,position", async () => {
      // Zmiana kontraktu koperty (nowy/znikły klucz) jest zmianą API, nie
      // kosmetyką — konsument (kafel kategorii) opiera na nim baner i adres.
      const catalog = await readCatalog(anon, tenantId);
      const some = catalog.categories.find((c) => c.name === "Z_BANEREM");
      expect(some, "kategoria Z_BANEREM zniknęła z koperty").toBeDefined();
      expect(Object.keys(some!).sort()).toEqual([
        "description",
        "id",
        "image_path",
        "name",
        "position",
        "slug",
      ]);
    });
  });

  // -------------------------------------------------------------------
  // 2. Izolacja: baner kategorii najemcy B nie wychodzi u najemcy A
  // -------------------------------------------------------------------
  describe("izolacja międzytenantowa banera", () => {
    let tenantA: string;
    let tenantB: string;
    let bannerA: string;
    let bannerB: string;
    let categoryB: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantA = await seedTenant(admin, "a");
      tenantB = await seedTenant(admin, "b");
      bannerA = `banners/A-${randomUUID()}.webp`;
      bannerB = `banners/B-${randomUUID()}.webp`;
      await seedCategory(admin, tenantA, {
        name: "KATEGORIA_A",
        slug: `kategoria-a-${randomUUID().slice(0, 8)}`,
        image_path: bannerA,
      });
      categoryB = await seedCategory(admin, tenantB, {
        name: "KATEGORIA_B",
        slug: `kategoria-b-${randomUUID().slice(0, 8)}`,
        image_path: bannerB,
      });
    }, 60_000);

    it("koperta najemcy A niesie WŁASNY baner, a nie ścieżki najemcy B", async () => {
      const catalog = await readCatalog(anon, tenantA);

      // KONTROLA POZYTYWNA: najpierw dowód, że baner A W OGÓLE wychodzi — bez
      // niego asercje „nie zawiera B" byłyby prawdziwe nad pustą kopertą.
      const own = catalog.categories.find((c) => c.name === "KATEGORIA_A");
      expect(own, "koperta A nie niesie własnej kategorii").toBeDefined();
      expect(own!.image_path, "własny baner najemcy A nie doszedł").toBe(bannerA);

      // Cudzej kategorii ani jej banera nie ma — ani po nazwie, ani po ścieżce,
      // ani po identyfikatorze gdziekolwiek w kopercie.
      expect(catalog.categories.map((c) => c.name)).not.toContain("KATEGORIA_B");
      expect(catalog.categories.map((c) => c.image_path)).not.toContain(bannerB);
      const serialized = JSON.stringify(catalog);
      expect(serialized, "ścieżka banera najemcy B w kopercie najemcy A").not.toContain(bannerB);
      expect(serialized, "identyfikator kategorii najemcy B w kopercie najemcy A").not.toContain(
        categoryB,
      );
    });
  });
});
