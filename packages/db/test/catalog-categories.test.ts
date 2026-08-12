/**
 * Taksonomia katalogu — migracja 0072, ADR-155.
 *
 * Trzy osie, każda z dowodem z OBU stron (jest / nie ma, sukces / odmowa):
 *
 *   1. SLUG ZAREZERWOWANY. Kategoria o slugu `checkout` (i każdym innym
 *      z listy) jest odrzucana PRZEZ BAZĘ, nie przez formularz — dowód idzie
 *      ścieżką `service_role`, czyli z BYPASSRLS i bez Zoda panelu. Kontrola
 *      pozytywna pilnuje, żeby „wszystko odrzucone" nie wyglądało jak sukces.
 *      Bramka działa też na UPDATE: slug wolno zmienić, ale nie na systemowy.
 *
 *   2. ZGODNOŚĆ LIST (anty-rozjazd). `app.reserved_store_paths()` jest równe
 *      RESERVED_CATEGORY_SLUGS z @avably/core. Bez tego lista byłaby pilnowana
 *      po jednej stronie i wolna po drugiej — dokładnie ta luka, którą 0023
 *      zamknęło dla subdomen.
 *
 *   3. IZOLACJA W ODCZYCIE PUBLICZNYM. `app.get_public_catalog` jest SECURITY
 *      DEFINER (RLS jej nie dotyczy), więc jedyną bramką są jawne filtry
 *      `tenant_id`. Test sprawdza, że katalog najemcy A nie niesie ani
 *      kategorii najemcy B, ani przypisań do niej.
 *
 * Osobno: DELETE kategorii jest zastrzeżony dla WŁAŚCICIELA (rozstrzygnięcie
 * 3 w nagłówku migracji), a przypisanie produktu do kategorii jest czynnością
 * KAŻDEGO członka — obie granice mają tu dowód behawioralny sesją pracownika.
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

import { RESERVED_CATEGORY_SLUGS } from "@avably/core";

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

/** 22023 = invalid_parameter_value — konwencja odmów 0010/0020/0023. */
const PG_INVALID_PARAMETER = "22023";
/** 42501 = insufficient_privilege — odmowa RLS albo brak GRANT-u. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";
/** 23503 = foreign_key_violation — rodzic spoza tenanta. */
const PG_FOREIGN_KEY_VIOLATION = "23503";

const TEST_PASSWORD = "CategoryTest!12345678";

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
const createdUserIds: string[] = [];

async function seedTenant(admin: SupabaseClient, label: string): Promise<string> {
  const slug = `kat-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: `Kategorie test ${label}`, status: "active", locale: "pl" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać tenanta ${label}: ${error?.message}`);
  createdTenantIds.push(data.id as string);
  return data.id as string;
}

/** Zalogowany klient członka tenanta o zadanej roli (owner|staff). */
async function seedMemberClient(
  admin: SupabaseClient,
  tenantId: string,
  role: "owner" | "staff",
): Promise<SupabaseClient> {
  const email = `kat-${role}-${randomUUID().slice(0, 8)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role },
  });
  if (error || !data.user) throw new Error(`createUser(${role}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const { error: memberError } = await admin
    .from("members")
    .insert({ tenant_id: tenantId, user_id: data.user.id, role });
  if (memberError) throw new Error(`members(${role}): ${memberError.message}`);

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError) throw new Error(`signIn(${role}): ${signInError.message}`);
  return client;
}

async function seedProduct(admin: SupabaseClient, tenantId: string, name: string): Promise<string> {
  const { data, error } = await admin
    .from("products")
    .insert({ tenant_id: tenantId, name, base_price_day_grosze: 10_000 })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać produktu: ${error?.message}`);
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

interface PublicCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
}

interface PublicCatalogShape {
  categories: PublicCategory[];
  products: { id: string; name: string; category_ids: string[] }[];
}

describe.skipIf(!hasEnv)("taksonomia katalogu — 0072 (ADR-155)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    await sql?.end({ timeout: 5 });
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Zgodność list (anty-rozjazd TS ↔ baza)
  // -------------------------------------------------------------------
  describe("zgodność list", () => {
    it("app.reserved_store_paths() == RESERVED_CATEGORY_SLUGS z @avably/core", async () => {
      const rows = await sql!<{ reserved: string[] }[]>`
        select app.reserved_store_paths() as reserved
      `;
      const fromDb = [...rows[0]!.reserved].sort();
      const fromCore = [...RESERVED_CATEGORY_SLUGS].sort();

      expect(
        fromDb,
        "lista w migracji 0072 rozjechała się z RESERVED_CATEGORY_SLUGS " +
          "(packages/core/src/catalog/categories.ts)",
      ).toEqual(fromCore);
    });

    it("KAŻDY wpis z listy trafia w warunek bramki (nie tylko kilka wybranych)", async () => {
      // Sprawdzane na TYM SAMYM wyrażeniu, którego używa trigger — bez
      // zakładania kilkunastu kategorii.
      const rows = await sql!<{ slug: string; blocked: boolean }[]>`
        select s.slug, lower(btrim(s.slug)) = any (app.reserved_store_paths()) as blocked
        from unnest(${sql!.array([...RESERVED_CATEGORY_SLUGS])}::text[]) as s(slug)
      `;
      const passing = rows.filter((row) => !row.blocked).map((row) => row.slug);
      expect(passing, `slugi przepuszczone mimo rezerwacji: ${passing.join(", ")}`).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // 2. Slug zarezerwowany — bramka stoi w BAZIE
  // -------------------------------------------------------------------
  describe("slug zarezerwowany", () => {
    let tenantId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant(admin, "reserved");
    }, 60_000);

    it.each(["checkout", "cart", "product", "store", "regulamin", "pl"])(
      "slug `%s` jest odrzucony kodem 22023 — ścieżką service_role (bez RLS i bez Zoda)",
      async (slug) => {
        // service_role omija RLS: gdyby odmowa pochodziła z polityki, ten
        // INSERT by przeszedł. Przechodzi wyłącznie przez trigger.
        const { error } = await admin
          .from("catalog_categories")
          .insert({ tenant_id: tenantId, name: `Nazwa ${slug}`, slug });

        expect(error, `slug \`${slug}\` przeszedł, a jest zarezerwowany`).not.toBeNull();
        expect(
          error!.code,
          `oczekiwany SQLSTATE ${PG_INVALID_PARAMETER}, dostałem ${error!.code}: ${error!.message}`,
        ).toBe(PG_INVALID_PARAMETER);
      },
    );

    it("bramka działa też na UPDATE — kategorii nie da się PRZEMIANOWAĆ na systemową", async () => {
      const categoryId = await seedCategory(admin, tenantId);

      const { error } = await admin
        .from("catalog_categories")
        .update({ slug: "checkout" })
        .eq("id", categoryId);

      expect(error, "UPDATE przemianował kategorię na slug systemowy").not.toBeNull();
      expect(error!.code).toBe(PG_INVALID_PARAMETER);

      // Kontrola pozytywna TEJ SAMEJ ścieżki: zwykły slug nadal przechodzi,
      // więc czerwień wyżej pochodzi z bramki, a nie z zablokowanego UPDATE-u.
      const wolny = `zwykly-${randomUUID().slice(0, 8)}`;
      const { error: okError } = await admin
        .from("catalog_categories")
        .update({ slug: wolny })
        .eq("id", categoryId);
      expect(okError, `zwykły slug odrzucony przy UPDATE: ${okError?.message}`).toBeNull();
    });

    it("kontrola pozytywna: zwykły slug przechodzi, slug ZAWIERAJĄCY zarezerwowany też", async () => {
      // Bramka jest na RÓWNOŚĆ, nie na zawieranie: „wozki-do-checkout" nie
      // przejmuje żadnej ścieżki, więc odrzucenie go byłoby nadgorliwością.
      const unique = randomUUID().slice(0, 8);
      const { error } = await admin.from("catalog_categories").insert({
        tenant_id: tenantId,
        name: `Wózki ${unique}`,
        slug: `wozki-do-checkout-${unique}`,
      });
      expect(error, `zwykły slug został odrzucony: ${error?.message}`).toBeNull();
    });

    it("kształt sluga pilnuje CHECK — wielkie litery i spacje odpadają (23514)", async () => {
      const { error } = await admin.from("catalog_categories").insert({
        tenant_id: tenantId,
        name: `Zły kształt ${randomUUID().slice(0, 8)}`,
        slug: "Namioty Duze",
      });
      expect(error, "slug ze spacjami i wielkimi literami przeszedł").not.toBeNull();
      expect(error!.code).toBe("23514");
    });
  });

  // -------------------------------------------------------------------
  // 3. Granice ról: DELETE kategorii vs przypisanie produktu
  // -------------------------------------------------------------------
  describe("granice ról", () => {
    let tenantId: string;
    let staff: SupabaseClient;
    let owner: SupabaseClient;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant(admin, "role");
      owner = await seedMemberClient(admin, tenantId, "owner");
      staff = await seedMemberClient(admin, tenantId, "staff");
    }, 60_000);

    it("pracownik ZAKŁADA kategorię i przypisuje do niej produkt (to praca lady)", async () => {
      const unique = randomUUID().slice(0, 8);
      const { data: created, error } = await staff
        .from("catalog_categories")
        .insert({ tenant_id: tenantId, name: `Namioty ${unique}`, slug: `namioty-${unique}` })
        .select("id")
        .single();
      expect(error, `pracownik nie założył kategorii: ${error?.message}`).toBeNull();

      const productId = await seedProduct(admin, tenantId, `Namiot ${unique}`);
      const { error: linkError } = await staff.from("product_categories").insert({
        tenant_id: tenantId,
        product_id: productId,
        category_id: created!.id as string,
      });
      expect(linkError, `pracownik nie przypisał produktu: ${linkError?.message}`).toBeNull();

      const { error: unlinkError } = await staff
        .from("product_categories")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("product_id", productId)
        .eq("category_id", created!.id as string);
      expect(unlinkError, `pracownik nie zdjął przypisania: ${unlinkError?.message}`).toBeNull();
    });

    it("pracownik NIE usuwa kategorii, właściciel usuwa (dowód z obu stron)", async () => {
      const categoryId = await seedCategory(admin, tenantId);

      // RLS nie zgłasza błędu przy DELETE, który nie dosięgnął wiersza —
      // jedynym sygnałem jest TRWAŁY stan, czytany service-rolem.
      await staff.from("catalog_categories").delete().eq("id", categoryId);
      const afterStaff = await admin
        .from("catalog_categories")
        .select("id")
        .eq("id", categoryId);
      expect(
        afterStaff.data ?? [],
        "pracownik usunął kategorię — bramka właściciela nie działa",
      ).toHaveLength(1);

      await owner.from("catalog_categories").delete().eq("id", categoryId);
      const afterOwner = await admin
        .from("catalog_categories")
        .select("id")
        .eq("id", categoryId);
      expect(
        afterOwner.data ?? [],
        "właściciel NIE usunął kategorii — bramka jest za ciasna",
      ).toHaveLength(0);
    });

    it("anon nie ma dostępu do tabel taksonomii (odmowa na GRANCIE)", async () => {
      const { error: categoriesError } = await anon.from("catalog_categories").select("id");
      const { error: linksError } = await anon.from("product_categories").select("product_id");
      expect(categoriesError?.code, "anon czyta catalog_categories wprost").toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
      expect(linksError?.code, "anon czyta product_categories wprost").toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
    });
  });

  // -------------------------------------------------------------------
  // 4. Izolacja międzytenantowa
  // -------------------------------------------------------------------
  describe("izolacja", () => {
    let tenantA: string;
    let tenantB: string;
    let categoryB: string;
    let productA: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantA = await seedTenant(admin, "a");
      tenantB = await seedTenant(admin, "b");
      categoryB = await seedCategory(admin, tenantB, {
        name: "KATEGORIA_CUDZA",
        slug: `kategoria-cudza-${randomUUID().slice(0, 8)}`,
      });
      productA = await seedProduct(admin, tenantA, "PRODUKT_A");
    }, 60_000);

    it("produktu A nie da się przypiąć do kategorii najemcy B (FK złożony)", async () => {
      // Próba idzie service-rolem, czyli z BYPASSRLS: gdyby jedyną bramką
      // była polityka, ten INSERT by przeszedł. Bramką jest klucz obcy po
      // (tenant_id, category_id) — przypisanie międzytenantowe jest
      // NIEREPREZENTOWALNE, niezależnie od tego, kto pisze.
      const { error } = await admin.from("product_categories").insert({
        tenant_id: tenantA,
        product_id: productA,
        category_id: categoryB,
      });
      expect(error, "przypisanie do cudzej kategorii przeszło").not.toBeNull();
      expect(error!.code, `oczekiwany ${PG_FOREIGN_KEY_VIOLATION}, dostałem ${error!.code}`).toBe(
        PG_FOREIGN_KEY_VIOLATION,
      );
    });

    it("odczyt publiczny najemcy A nie niesie kategorii najemcy B", async () => {
      const categoryA = await seedCategory(admin, tenantA, {
        name: "KATEGORIA_WLASNA",
        slug: `kategoria-wlasna-${randomUUID().slice(0, 8)}`,
        position: 3,
      });
      const { error: linkError } = await admin
        .from("product_categories")
        .insert({ tenant_id: tenantA, product_id: productA, category_id: categoryA });
      if (linkError) throw new Error(`seed przypisania: ${linkError.message}`);

      const { data, error } = await anon
        .schema("app")
        .rpc("get_public_catalog", { p_tenant_id: tenantA });
      expect(error, `get_public_catalog jako anon zawiódł: ${error?.message}`).toBeNull();

      const catalog = data as unknown as PublicCatalogShape;

      // KONTROLA POZYTYWNA NAJPIERW: asercja „nie zawiera X" przechodzi
      // również wtedy, gdy koperta jest pusta — najpierw dowodzimy, że
      // kategorie w ogóle są, potem że są WYŁĄCZNIE własne.
      expect(
        catalog.categories.map((c) => c.name),
        "koperta nie niesie własnej kategorii — dowód niżej byłby po pustym zbiorze",
      ).toContain("KATEGORIA_WLASNA");
      expect(catalog.categories.map((c) => c.name)).not.toContain("KATEGORIA_CUDZA");
      expect(JSON.stringify(catalog), "identyfikator cudzej kategorii w kopercie").not.toContain(
        categoryB,
      );

      const product = catalog.products.find((p) => p.id === productA);
      expect(product, "produkt A zniknął z katalogu").toBeDefined();
      expect(product!.category_ids, "przypisanie własnej kategorii nie doszło").toContain(
        categoryA,
      );
      expect(product!.category_ids).not.toContain(categoryB);

      // Kształt pozycji kategorii — konsument (Faza 7) opiera na nim kolejność
      // i adres, więc brak klucza jest zmianą kontraktu, nie kosmetyką.
      const own = catalog.categories.find((c) => c.name === "KATEGORIA_WLASNA")!;
      expect(Object.keys(own).sort()).toEqual([
        "description",
        "id",
        "name",
        "position",
        "slug",
      ]);
      expect(own.position).toBe(3);
    });
  });
});
