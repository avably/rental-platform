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
 * Podpisane uploady zdjęć SEKCJI (0043) — LUSTRO testów zdjęć produktów (0038),
 * z rodzicem `sites` zamiast `products`. Te same osie: tenant-bound bilet,
 * jednorazowy claim, autorytatywne metadane, brak bezpośredniego API dla
 * authenticated, bramka Storage po otwartym bilecie, kontrakt bucketa. Dodatkowo
 * dowód działania app.site_image_paths_in_use (prymityw crona sierot — logika
 * NOWA, nie lustrzana).
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
const MAX_BYTES = 5 * 1024 * 1024;
const DENIED = "Nie można wykonać tego uploadu zdjęcia.";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let admin: SupabaseClient;
let anon: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;
let sameTenantClient: SupabaseClient;
let sameTenantUserId: string;
let siteAId: string;
let siteBId: string;
const uploadedPaths: string[] = [];

/** Get-or-create strony tenanta (sites ma UNIQUE(tenant_id)). */
async function ensureSite(tenantId: string): Promise<string> {
  const existing = await admin.from("sites").select("id").eq("tenant_id", tenantId).maybeSingle();
  if (existing.data) return existing.data.id as string;
  const { data, error } = await admin
    .from("sites")
    .insert({ tenant_id: tenantId, template: "classic" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się utworzyć strony: ${error?.message}`);
  return data.id as string;
}

async function issue(client: SupabaseClient, siteId: string, mime = "image/png", size = 68) {
  return client
    .schema("app")
    .rpc("issue_site_image_upload", {
      p_site_id: siteId,
      p_declared_mime: mime,
      p_declared_size: size,
    })
    .single();
}

async function claim(client: SupabaseClient, uploadId: string) {
  return client.schema("app").rpc("claim_site_image_upload", { p_upload_id: uploadId }).single();
}

async function finish(client: SupabaseClient, uploadId: string, outcome: string) {
  return client
    .schema("app")
    .rpc("finish_site_image_upload", { p_upload_id: uploadId, p_outcome: outcome });
}

function expectUniformDenial(error: { code?: string; message?: string } | null) {
  expect(error, "operacja powinna zostać odrzucona").not.toBeNull();
  expect(error?.code).toBe("22023");
  expect(error?.message).toContain(DENIED);
}

describe.skipIf(!hasEnv)("podpisane uploady zdjęć sekcji (0043)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    anon = createClient(
      process.env.SUPABASE_LOCAL_API_URL!,
      process.env.SUPABASE_LOCAL_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    ({ a, b } = await seedTwoTenants());

    const sameTenantEmail = `site-upload-same-tenant-${randomUUID()}@test.local`;
    const { data: sameTenantUser, error: sameTenantUserError } = await admin.auth.admin.createUser({
      email: sameTenantEmail,
      password: "SiteUploadTest!12345678",
      email_confirm: true,
      app_metadata: { tenant_id: a.tenantId, role: "staff" },
    });
    if (sameTenantUserError || !sameTenantUser.user) {
      throw new Error(`Nie udało się utworzyć drugiego użytkownika tenanta: ${sameTenantUserError?.message}`);
    }
    sameTenantUserId = sameTenantUser.user.id;
    const { error: sameTenantMemberError } = await admin.from("members").insert({
      tenant_id: a.tenantId,
      user_id: sameTenantUserId,
      role: "staff",
    });
    if (sameTenantMemberError) throw sameTenantMemberError;
    sameTenantClient = createClient(
      process.env.SUPABASE_LOCAL_API_URL!,
      process.env.SUPABASE_LOCAL_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    const { error: signInError } = await sameTenantClient.auth.signInWithPassword({
      email: sameTenantEmail,
      password: "SiteUploadTest!12345678",
    });
    if (signInError) throw signInError;

    siteAId = await ensureSite(a.tenantId);
    siteBId = await ensureSite(b.tenantId);
  }, 30_000);

  afterAll(async () => {
    if (uploadedPaths.length > 0) {
      await admin.storage.from(BUCKET).remove(uploadedPaths);
    }
    if (sameTenantUserId) {
      await admin.auth.admin.deleteUser(sameTenantUserId);
    }
    await cleanupSeeded(admin);
    await sql?.end({ timeout: 5 });
  });

  it("tabela public.site_image_uploads istnieje i ma włączone RLS", async () => {
    const rows = await sql!<{ rowsecurity: boolean }[]>`
      select rowsecurity from pg_tables
      where schemaname = 'public' and tablename = 'site_image_uploads'
    `;
    expect(rows, "tabela public.site_image_uploads nie istnieje").toHaveLength(1);
    expect(rows[0]?.rowsecurity, "RLS jest wyłączone").toBe(true);
  });

  it("owner wydaje bilet tylko dla własnej strony i dostaje dokładną ścieżkę", async () => {
    const { data, error } = await issue(a.ownerClient, siteAId);
    expect(error, error?.message).toBeNull();
    expect(data).toMatchObject({ upload_id: expect.any(String) });
    expect(data.storage_path).toBe(`${a.tenantId}/${siteAId}/${data.upload_id as string}.png`);
  });

  it("obca i losowa strona dają tę samą odmowę i nie tworzą wiersza", async () => {
    const before = await admin
      .from("site_image_uploads")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", a.ownerUserId);
    const foreign = await issue(a.ownerClient, siteBId);
    const missing = await issue(a.ownerClient, randomUUID());
    const after = await admin
      .from("site_image_uploads")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", a.ownerUserId);

    expectUniformDenial(foreign.error);
    expectUniformDenial(missing.error);
    expect(foreign.error?.message).toBe(missing.error?.message);
    expect(after.count).toBe(before.count);
  });

  it("anon nie ma EXECUTE do funkcji wydającej bilet", async () => {
    const { error } = await issue(anon, siteAId);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("claim jest jednorazowy, tenant-bound i zwraca autorytatywne metadane", async () => {
    const issued = await issue(a.ownerClient, siteAId, "image/webp", 123);
    expect(issued.error, issued.error?.message).toBeNull();
    const uploadId = issued.data.upload_id as string;

    expectUniformDenial((await claim(b.ownerClient, uploadId)).error);

    const first = await claim(a.ownerClient, uploadId);
    expect(first.error, first.error?.message).toBeNull();
    expect(first.data).toEqual({
      upload_id: uploadId,
      tenant_id: a.tenantId,
      site_id: siteAId,
      storage_path: `${a.tenantId}/${siteAId}/${uploadId}.webp`,
      declared_mime: "image/webp",
      declared_size: 123,
    });

    expectUniformDenial((await claim(a.ownerClient, uploadId)).error);
  });

  it("wygasłego biletu nie można przejąć", async () => {
    const issued = await issue(a.ownerClient, siteAId);
    const uploadId = issued.data.upload_id as string;
    const { error: expireError } = await admin
      .from("site_image_uploads")
      .update({
        created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
        expires_at: new Date(Date.now() - 15 * 60_000).toISOString(),
      })
      .eq("id", uploadId);
    expect(expireError, expireError?.message).toBeNull();
    expectUniformDenial((await claim(a.ownerClient, uploadId)).error);
  });

  it("finish domyka tylko własny processing i tylko do completed albo rejected", async () => {
    const issued = await issue(a.ownerClient, siteAId);
    const uploadId = issued.data.upload_id as string;
    expect((await claim(a.ownerClient, uploadId)).error).toBeNull();

    expectUniformDenial((await finish(a.ownerClient, uploadId, "pending")).error);
    expectUniformDenial((await finish(b.ownerClient, uploadId, "completed")).error);

    const completed = await finish(a.ownerClient, uploadId, "completed");
    expect(completed.error, completed.error?.message).toBeNull();
    const row = await admin
      .from("site_image_uploads")
      .select("status,finished_at")
      .eq("id", uploadId)
      .single();
    expect(row.data?.status).toBe("completed");
    expect(row.data?.finished_at).toEqual(expect.any(String));

    expectUniformDenial((await finish(a.ownerClient, uploadId, "rejected")).error);
  });

  it("drugi użytkownik tego samego tenanta nie może przejąć ani domknąć biletu", async () => {
    const issuedForOwner = await issue(a.ownerClient, siteAId);
    expect(issuedForOwner.error, issuedForOwner.error?.message).toBeNull();
    expectUniformDenial((await claim(sameTenantClient, issuedForOwner.data.upload_id as string)).error);

    const issuedForStaff = await issue(sameTenantClient, siteAId);
    expect(issuedForStaff.error, issuedForStaff.error?.message).toBeNull();
    const staffUploadId = issuedForStaff.data.upload_id as string;
    expect((await claim(sameTenantClient, staffUploadId)).error).toBeNull();
    expectUniformDenial((await finish(a.ownerClient, staffUploadId, "completed")).error);
    expect((await finish(sameTenantClient, staffUploadId, "completed")).error).toBeNull();
  });

  it("authenticated nie ma bezpośredniego SELECT/INSERT/UPDATE/DELETE tabeli biletów", async () => {
    const id = randomUUID();
    const row = {
      id,
      tenant_id: a.tenantId,
      site_id: siteAId,
      requested_by: a.ownerUserId,
      storage_path: `${a.tenantId}/${siteAId}/${id}.png`,
      declared_mime: "image/png",
      declared_size: 68,
      expires_at: new Date(Date.now() + 900_000).toISOString(),
    };
    const attempts = [
      await a.ownerClient.from("site_image_uploads").select("id"),
      await a.ownerClient.from("site_image_uploads").insert(row),
      await a.ownerClient.from("site_image_uploads").update({ status: "rejected" }).eq("id", id),
      await a.ownerClient.from("site_image_uploads").delete().eq("id", id),
    ];
    for (const attempt of attempts) {
      expect(attempt.error).not.toBeNull();
      expect(attempt.error?.code).toBe("42501");
    }
  });

  it("bramka Storage ma SECURITY DEFINER, stały search_path i minimalny EXECUTE", async () => {
    const rows = await sql!<{
      security_definer: boolean;
      config: string[] | null;
      authenticated_execute: boolean;
      anon_execute: boolean;
    }[]>`
      select
        p.prosecdef as security_definer,
        p.proconfig as config,
        has_function_privilege('authenticated', 'app.can_upload_site_image(text)', 'EXECUTE') as authenticated_execute,
        has_function_privilege('anon', 'app.can_upload_site_image(text)', 'EXECUTE') as anon_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname = 'can_upload_site_image'
        and pg_get_function_identity_arguments(p.oid) = 'p_storage_path text'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      security_definer: true,
      authenticated_execute: true,
      anon_execute: false,
    });
    expect(rows[0]?.config).toContain("search_path=pg_catalog, public, app");
  });

  it("Storage nie ma polityki UPDATE dla authenticated", async () => {
    const rows = await sql!<{ policyname: string }[]>`
      select policyname from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and cmd = 'UPDATE' and 'authenticated' = any(roles)
        and policyname = 'site_images_tenant_update'
    `;
    expect(rows).toEqual([]);
  });

  it("bucket ma dokładny publiczny kontrakt 5 MiB i cztery MIME", async () => {
    const rows = await sql!<{
      public: boolean;
      file_size_limit: number | string | null;
      allowed_mime_types: string[] | null;
    }[]>`
      select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'site-images'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.public).toBe(true);
    expect(Number(rows[0]?.file_size_limit)).toBe(MAX_BYTES);
    expect([...(rows[0]?.allowed_mime_types ?? [])].sort()).toEqual(
      ["image/jpeg", "image/png", "image/webp", "image/avif"].sort(),
    );
  });

  it("signed upload działa tylko dla dokładnej własnej ścieżki", async () => {
    const issued = await issue(a.ownerClient, siteAId);
    const path = issued.data.storage_path as string;
    const signed = await a.ownerClient.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
    expect(signed.error, signed.error?.message).toBeNull();

    const uploaded = await a.ownerClient.storage
      .from(BUCKET)
      .uploadToSignedUrl(path, signed.data!.token, PNG, { contentType: "image/png", upsert: false });
    expect(uploaded.error, uploaded.error?.message).toBeNull();
    uploadedPaths.push(path);

    const foreignPath = `${b.tenantId}/${siteBId}/${randomUUID()}.png`;
    const foreign = await a.ownerClient.storage.from(BUCKET).createSignedUploadUrl(foreignPath, { upsert: false });
    expect(foreign.error).not.toBeNull();
  });

  it("odrzuca ścieżkę własnej strony bez biletu i nie tworzy obiektu", async () => {
    const path = `${a.tenantId}/${siteAId}/${randomUUID()}.png`;
    const signed = await a.ownerClient.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
    expect(signed.error).not.toBeNull();
    const { error: missingError } = await admin.storage.from(BUCKET).download(path);
    expect(missingError).not.toBeNull();
  });

  it("odrzuca podpis dla cudzego, wygasłego i biletu innego użytkownika tego samego tenanta", async () => {
    const foreign = await issue(b.ownerClient, siteBId);
    expect(foreign.error, foreign.error?.message).toBeNull();

    const expired = await issue(a.ownerClient, siteAId);
    expect(expired.error, expired.error?.message).toBeNull();
    const { error: expireError } = await admin
      .from("site_image_uploads")
      .update({
        created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
        expires_at: new Date(Date.now() - 15 * 60_000).toISOString(),
      })
      .eq("id", expired.data.upload_id as string);
    expect(expireError, expireError?.message).toBeNull();

    const sameTenant = await issue(sameTenantClient, siteAId);
    expect(sameTenant.error, sameTenant.error?.message).toBeNull();

    for (const path of [
      foreign.data.storage_path as string,
      expired.data.storage_path as string,
      sameTenant.data.storage_path as string,
    ]) {
      const signed = await a.ownerClient.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
      expect(signed.error, `podpis nie powinien powstać dla ${path}`).not.toBeNull();
    }
  });

  it("bucket przyjmuje dokładnie 5 MiB i odrzuca jeden bajt więcej", async () => {
    const exactIntent = await issue(a.ownerClient, siteAId, "image/png", MAX_BYTES);
    const exactPath = exactIntent.data.storage_path as string;
    const exactSigned = await a.ownerClient.storage.from(BUCKET).createSignedUploadUrl(exactPath, { upsert: false });
    const exact = await a.ownerClient.storage
      .from(BUCKET)
      .uploadToSignedUrl(exactPath, exactSigned.data!.token, new Uint8Array(MAX_BYTES), {
        contentType: "image/png",
        upsert: false,
      });
    expect(exact.error, exact.error?.message).toBeNull();
    uploadedPaths.push(exactPath);

    const tooLargeIntent = await issue(a.ownerClient, siteAId, "image/png", MAX_BYTES);
    const tooLargePath = tooLargeIntent.data.storage_path as string;
    const tooLargeSigned = await a.ownerClient.storage.from(BUCKET).createSignedUploadUrl(tooLargePath, { upsert: false });
    const tooLarge = await a.ownerClient.storage
      .from(BUCKET)
      .uploadToSignedUrl(tooLargePath, tooLargeSigned.data!.token, new Uint8Array(MAX_BYTES + 1), {
        contentType: "image/png",
        upsert: false,
      });
    expect(tooLarge.error).not.toBeNull();
  }, 20_000);

  it("bucket odrzuca MIME spoza allowlisty", async () => {
    const issued = await issue(a.ownerClient, siteAId);
    const path = issued.data.storage_path as string;
    const signed = await a.ownerClient.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
    const uploaded = await a.ownerClient.storage
      .from(BUCKET)
      .uploadToSignedUrl(path, signed.data!.token, new TextEncoder().encode("<svg/>"), {
        contentType: "image/svg+xml",
        upsert: false,
      });
    expect(uploaded.error).not.toBeNull();
  });

  it("site_image_paths_in_use zwraca WYŁĄCZNIE ścieżki w użyciu (draft/published, hero + gallery)", async () => {
    const usedHero = `${a.tenantId}/${siteAId}/used-hero.png`;
    const usedGalleryDraft = `${a.tenantId}/${siteAId}/used-draft.webp`;
    const usedGalleryPublished = `${a.tenantId}/${siteAId}/used-published.webp`;
    const unused = `${a.tenantId}/${siteAId}/unused.png`;

    const hero = await admin
      .from("site_sections")
      .insert({
        tenant_id: a.tenantId,
        site_id: siteAId,
        type: "hero",
        content_draft: { heading: "H", imagePath: usedHero },
      })
      .select("id")
      .single();
    expect(hero.error, hero.error?.message).toBeNull();
    const gallery = await admin
      .from("site_sections")
      .insert({
        tenant_id: a.tenantId,
        site_id: siteAId,
        type: "gallery",
        content_draft: { items: [{ imagePath: usedGalleryDraft, alt: "x" }] },
        content_published: { items: [{ imagePath: usedGalleryPublished, alt: "y" }] },
      })
      .select("id")
      .single();
    expect(gallery.error, gallery.error?.message).toBeNull();

    const inUse = await sql!<{ path: string }[]>`
      select path from app.site_image_paths_in_use(
        ${sql!.array([usedHero, usedGalleryDraft, usedGalleryPublished, unused])}::text[]
      ) as path
    `;
    expect(inUse.map((r) => r.path).sort()).toEqual(
      [usedHero, usedGalleryDraft, usedGalleryPublished].sort(),
    );

    await admin.from("site_sections").delete().in("id", [hero.data!.id, gallery.data!.id]);
  });
});
