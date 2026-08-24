import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
 * SONDA IZOLACJI BANERA KATEGORII (0106, ADR-260) — trzeci rodzaj biletu
 * `site-images` (obok sekcji 0043 i logo 0076), z rodzicem = kategoria zamiast
 * strony. Cztery wektory ataku + kontrola pozytywna:
 *
 *   (1) bilet ZAWSZE rozwiązuje się do app.tenant_id(), nie z argumentu —
 *       ścieżka jest prefiksowana tenantem wołającego, a p_category_id nie ma
 *       jak wskazać cudzego najemcy (odmowa na cudzą kategorię);
 *   (2) storage INSERT bez biletu → odrzucony (polityka site_images_tenant_insert
 *       jest agnostyczna wobec kind, ale wymaga OTWARTEGO biletu na ścieżkę);
 *   (3) set_category_image na CUDZEJ kategorii albo ścieżce spoza własnego
 *       prefiksu → 22023;
 *   (4) były członek (usunięty z members) NIE wystawi biletu ani nie zapisze.
 *
 *   Kontrola POZYTYWNA: pełny cykl issue → signed upload → claim → finish → set
 *   zapisuje image_path, a koperta katalogu (app.get_public_catalog, 0103) go
 *   niesie.
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
const BUCKET = "site-images";
const ISSUE_DENIED = "Nie można wykonać tego uploadu zdjęcia.";
const SET_DENIED = "Nie można zapisać banera kategorii.";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let admin: SupabaseClient;
let anon: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;
let categoryAId: string;
let categoryBId: string;
let formerClient: SupabaseClient;
let formerUserId: string;
const uploadedPaths: string[] = [];

async function createCategory(tenantId: string): Promise<string> {
  const unique = randomUUID().slice(0, 8);
  const { data, error } = await admin
    .from("catalog_categories")
    .insert({
      tenant_id: tenantId,
      name: `Baner test ${unique}`,
      slug: `rls-test-banner-${unique}`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się utworzyć kategorii: ${error?.message}`);
  return data.id as string;
}

async function issue(client: SupabaseClient, categoryId: string, mime = "image/png", size = 8) {
  return client
    .schema("app")
    .rpc("issue_category_image_upload", {
      p_category_id: categoryId,
      p_declared_mime: mime,
      p_declared_size: size,
    })
    .single();
}

async function setImage(client: SupabaseClient, categoryId: string, path: string | null) {
  return client.schema("app").rpc("set_category_image", {
    p_category_id: categoryId,
    p_path: path,
  });
}

async function claim(client: SupabaseClient, uploadId: string) {
  return client.schema("app").rpc("claim_site_image_upload", { p_upload_id: uploadId }).single();
}

async function finish(client: SupabaseClient, uploadId: string, outcome: string) {
  return client
    .schema("app")
    .rpc("finish_site_image_upload", { p_upload_id: uploadId, p_outcome: outcome });
}

function expectDenial(error: { code?: string; message?: string } | null, message: string) {
  expect(error, "operacja powinna zostać odrzucona").not.toBeNull();
  expect(error?.code).toBe("22023");
  expect(error?.message).toContain(message);
}

describe.skipIf(!hasEnv)("sonda izolacji banera kategorii (0106, ADR-260)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    anon = createClient(
      process.env.SUPABASE_LOCAL_API_URL!,
      process.env.SUPABASE_LOCAL_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    ({ a, b } = await seedTwoTenants());
    categoryAId = await createCategory(a.tenantId);
    categoryBId = await createCategory(b.tenantId);

    // Członek-do-usunięcia: staff tenanta A z żywą sesją. Wektor (4) usunie mu
    // wiersz members i sprawdzi, że bilet ani zapis już nie przechodzą.
    const email = `former-member-${randomUUID()}@test.local`;
    const { data: user, error: userError } = await admin.auth.admin.createUser({
      email,
      password: "CategoryBanner!12345678",
      email_confirm: true,
      app_metadata: { tenant_id: a.tenantId, role: "staff" },
    });
    if (userError || !user.user) throw new Error(`Nie udało się utworzyć członka: ${userError?.message}`);
    formerUserId = user.user.id;
    const { error: memberError } = await admin
      .from("members")
      .insert({ tenant_id: a.tenantId, user_id: formerUserId, role: "staff" });
    if (memberError) throw memberError;
    formerClient = createClient(
      process.env.SUPABASE_LOCAL_API_URL!,
      process.env.SUPABASE_LOCAL_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    const { error: signInError } = await formerClient.auth.signInWithPassword({
      email,
      password: "CategoryBanner!12345678",
    });
    if (signInError) throw signInError;
  }, 30_000);

  afterAll(async () => {
    if (uploadedPaths.length > 0) await admin.storage.from(BUCKET).remove(uploadedPaths);
    if (formerUserId) await admin.auth.admin.deleteUser(formerUserId);
    await cleanupSeeded(admin);
    await sql?.end({ timeout: 5 });
  });

  // ----- struktura funkcji (bramki DEFINER, search_path, minimalny EXECUTE) -----

  it("obie funkcje mają SECURITY DEFINER, stały search_path i EXECUTE tylko dla authenticated", async () => {
    const rows = await sql!<{
      proname: string;
      security_definer: boolean;
      config: string[] | null;
      authenticated_execute: boolean;
      anon_execute: boolean;
    }[]>`
      select
        p.proname,
        p.prosecdef as security_definer,
        p.proconfig as config,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname in ('issue_category_image_upload', 'set_category_image')
      order by p.proname
    `;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.security_definer, `${row.proname} nie jest SECURITY DEFINER`).toBe(true);
      expect(row.authenticated_execute, `${row.proname} bez EXECUTE dla authenticated`).toBe(true);
      expect(row.anon_execute, `${row.proname} ma EXECUTE dla anon`).toBe(false);
      expect(row.config).toContain("search_path=pg_catalog, public, app");
    }
  });

  // ----- WEKTOR 1: bilet z app.tenant_id(), nie z argumentu -----

  it("(1) bilet rozwiązuje się do tenanta wołającego, ścieżka {tenant}/category/{upload}.ext", async () => {
    const { data, error } = await issue(a.ownerClient, categoryAId);
    expect(error, error?.message).toBeNull();
    expect(data).toMatchObject({ upload_id: expect.any(String) });
    expect(data.storage_path).toBe(`${a.tenantId}/category/${data.upload_id as string}.png`);
  });

  it("(1) kategoria innego najemcy nie wystawi biletu i nie tworzy wiersza", async () => {
    const before = await admin
      .from("site_image_uploads")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", a.ownerUserId);
    const foreign = await issue(a.ownerClient, categoryBId);
    const missing = await issue(a.ownerClient, randomUUID());
    const after = await admin
      .from("site_image_uploads")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", a.ownerUserId);

    expectDenial(foreign.error, ISSUE_DENIED);
    expectDenial(missing.error, ISSUE_DENIED);
    // Odmowa jednym zdaniem — cudza i nieistniejąca kategoria nierozróżnialne.
    expect(foreign.error?.message).toBe(missing.error?.message);
    expect(after.count).toBe(before.count);
  });

  it("(1) anon nie ma EXECUTE do wystawienia biletu", async () => {
    const { error } = await issue(anon, categoryAId);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  // ----- WEKTOR 2: storage INSERT bez biletu -----

  it("(2) signed upload na ścieżkę category bez biletu jest odrzucony i nie tworzy obiektu", async () => {
    const path = `${a.tenantId}/category/${randomUUID()}.png`;
    const signed = await a.ownerClient.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
    expect(signed.error, "podpis nie powinien powstać bez biletu").not.toBeNull();
    const { error: missingError } = await admin.storage.from(BUCKET).download(path);
    expect(missingError).not.toBeNull();
  });

  it("(2) cudzy najemca nie podpisze ścieżki category tenanta A", async () => {
    const issued = await issue(a.ownerClient, categoryAId);
    const path = issued.data.storage_path as string;
    // Bilet należy do A; B nie ma jak go użyć nawet znając ścieżkę.
    const foreign = await b.ownerClient.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
    expect(foreign.error, "B nie powinien podpisać ścieżki A").not.toBeNull();
  });

  // ----- WEKTOR 3: set_category_image na cudzej kategorii / ścieżce -----

  it("(3) zapis na CUDZĄ kategorię → 22023", async () => {
    const path = `${a.tenantId}/category/${randomUUID()}.png`;
    // A celuje w kategorię B — UPDATE nie trafia żadnego wiersza tenanta A.
    expectDenial((await setImage(a.ownerClient, categoryBId, path)).error, SET_DENIED);
  });

  it("(3) zapis WŁASNEJ kategorii ścieżką spoza własnego prefiksu → 22023", async () => {
    const foreignPath = `${b.tenantId}/category/${randomUUID()}.png`;
    const logoPath = `${a.tenantId}/logo/${randomUUID()}.png`;
    const sectionPath = `${a.tenantId}/${randomUUID()}/${randomUUID()}.png`;
    const traversal = `${a.tenantId}/category/../../etc/passwd`;
    for (const path of [foreignPath, logoPath, sectionPath, traversal]) {
      expectDenial(
        (await setImage(a.ownerClient, categoryAId, path)).error,
        SET_DENIED,
      );
    }
    // Żadna z prób nie zapisała image_path.
    const row = await admin
      .from("catalog_categories")
      .select("image_path")
      .eq("id", categoryAId)
      .single();
    expect(row.data?.image_path).toBeNull();
  });

  it("(3) anon nie ma EXECUTE do zapisu banera", async () => {
    const { error } = await setImage(anon, categoryAId, null);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  // ----- WEKTOR 4: były członek -----

  it("(4) po usunięciu z members bilet ani zapis nie przechodzą (22023)", async () => {
    // Sesja żyje (JWT z claimem tenant_id), ale żywe członkostwo zniknęło.
    const { error: delError } = await admin
      .from("members")
      .delete()
      .eq("tenant_id", a.tenantId)
      .eq("user_id", formerUserId);
    expect(delError, delError?.message).toBeNull();

    const validPath = `${a.tenantId}/category/${randomUUID()}.png`;
    expectDenial((await issue(formerClient, categoryAId)).error, ISSUE_DENIED);
    expectDenial((await setImage(formerClient, categoryAId, validPath)).error, SET_DENIED);

    // Kontrola: właściciel tenanta A dalej działa — odmowa dotyczy członkostwa,
    // nie samej funkcji.
    const ownerIssue = await issue(a.ownerClient, categoryAId);
    expect(ownerIssue.error, ownerIssue.error?.message).toBeNull();
  });

  // ----- KONTROLA POZYTYWNA: pełny cykl + koperta katalogu -----

  it("pozytyw: issue → upload → claim → finish → set zapisuje image_path, koperta katalogu go niesie", async () => {
    const issued = await issue(a.ownerClient, categoryAId);
    expect(issued.error, issued.error?.message).toBeNull();
    const uploadId = issued.data.upload_id as string;
    const path = issued.data.storage_path as string;

    const signed = await a.ownerClient.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
    expect(signed.error, signed.error?.message).toBeNull();
    const uploaded = await a.ownerClient.storage
      .from(BUCKET)
      .uploadToSignedUrl(path, signed.data!.token, PNG, { contentType: "image/png", upsert: false });
    expect(uploaded.error, uploaded.error?.message).toBeNull();
    uploadedPaths.push(path);

    expect((await claim(a.ownerClient, uploadId)).error).toBeNull();
    expect((await finish(a.ownerClient, uploadId, "completed")).error).toBeNull();

    const set = await setImage(a.ownerClient, categoryAId, path);
    expect(set.error, set.error?.message).toBeNull();

    const row = await admin
      .from("catalog_categories")
      .select("image_path")
      .eq("id", categoryAId)
      .single();
    expect(row.data?.image_path).toBe(path);

    // Koperta publicznego katalogu (0103) niesie baner w bloku kategorii.
    const { data: catalog, error: catalogError } = await anon
      .schema("app")
      .rpc("get_public_catalog", { p_tenant_id: a.tenantId });
    expect(catalogError, catalogError?.message).toBeNull();
    const categories = (catalog as { categories?: Array<{ id: string; image_path: string | null }> })
      ?.categories ?? [];
    const banner = categories.find((c) => c.id === categoryAId);
    expect(banner?.image_path).toBe(path);

    // Sprzątanie: zdejmujemy baner, żeby rerun bez db reset zastał kategorię czystą.
    expect((await setImage(a.ownerClient, categoryAId, null)).error).toBeNull();
  }, 20_000);
});
