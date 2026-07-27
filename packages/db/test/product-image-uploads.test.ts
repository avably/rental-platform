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

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const LOCAL_DB_URL = process.env.SUPABASE_LOCAL_URL;
const sql = LOCAL_DB_URL ? postgres(LOCAL_DB_URL, { max: 1 }) : null;
const BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024;
const DENIED = "Nie można wykonać tego uploadu zdjęcia.";

let admin: SupabaseClient;
let anon: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;
let productAId: string;
let productBId: string;
const uploadedPaths: string[] = [];

async function createProduct(tenantId: string): Promise<string> {
  const { data, error } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: `Signed upload ${randomUUID().slice(0, 8)}`,
      base_price_day_grosze: 10_000,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się utworzyć produktu: ${error?.message}`);
  return data.id as string;
}

async function issue(
  client: SupabaseClient,
  productId: string,
  mime = "image/png",
  size = 68,
) {
  return client
    .schema("app")
    .rpc("issue_product_image_upload", {
      p_product_id: productId,
      p_declared_mime: mime,
      p_declared_size: size,
    })
    .single();
}

async function claim(client: SupabaseClient, uploadId: string) {
  return client
    .schema("app")
    .rpc("claim_product_image_upload", { p_upload_id: uploadId })
    .single();
}

async function finish(client: SupabaseClient, uploadId: string, outcome: string) {
  return client
    .schema("app")
    .rpc("finish_product_image_upload", {
      p_upload_id: uploadId,
      p_outcome: outcome,
    });
}

function expectUniformDenial(error: { code?: string; message?: string } | null) {
  expect(error, "operacja powinna zostać odrzucona").not.toBeNull();
  expect(error?.code).toBe("22023");
  expect(error?.message).toContain(DENIED);
}

describe.skipIf(!hasEnv)("podpisane uploady zdjęć produktów (0038)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    anon = createClient(
      process.env.SUPABASE_LOCAL_API_URL!,
      process.env.SUPABASE_LOCAL_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    ({ a, b } = await seedTwoTenants());
    productAId = await createProduct(a.tenantId);
    productBId = await createProduct(b.tenantId);
  }, 30_000);

  afterAll(async () => {
    if (uploadedPaths.length > 0) {
      await admin.storage.from(BUCKET).remove(uploadedPaths);
    }
    await cleanupSeeded(admin);
    await sql?.end({ timeout: 5 });
  });

  it("tabela public.product_image_uploads istnieje i ma włączone RLS", async () => {
    const rows = await sql!<{ rowsecurity: boolean }[]>`
      select rowsecurity
      from pg_tables
      where schemaname = 'public' and tablename = 'product_image_uploads'
    `;
    expect(rows, "tabela public.product_image_uploads nie istnieje").toHaveLength(1);
    expect(rows[0]?.rowsecurity, "RLS jest wyłączone").toBe(true);
  });

  it("owner wydaje bilet tylko dla własnego produktu i dostaje dokładną ścieżkę", async () => {
    const { data, error } = await issue(a.ownerClient, productAId);
    expect(error, error?.message).toBeNull();
    expect(data).toMatchObject({ upload_id: expect.any(String) });
    expect(data.storage_path).toBe(
      `${a.tenantId}/${productAId}/${data.upload_id as string}.png`,
    );
  });

  it("obcy i losowy produkt dają tę samą odmowę i nie tworzą wiersza", async () => {
    const before = await admin
      .from("product_image_uploads")
      .select("id", { count: "exact", head: true });
    const foreign = await issue(a.ownerClient, productBId);
    const missing = await issue(a.ownerClient, randomUUID());
    const after = await admin
      .from("product_image_uploads")
      .select("id", { count: "exact", head: true });

    expectUniformDenial(foreign.error);
    expectUniformDenial(missing.error);
    expect(foreign.error?.message).toBe(missing.error?.message);
    expect(after.count).toBe(before.count);
  });

  it("anon nie ma EXECUTE do funkcji wydającej bilet", async () => {
    const { error } = await issue(anon, productAId);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("claim jest jednorazowy, tenant-bound i zwraca autorytatywne metadane", async () => {
    const issued = await issue(a.ownerClient, productAId, "image/webp", 123);
    expect(issued.error, issued.error?.message).toBeNull();
    const uploadId = issued.data.upload_id as string;

    const foreign = await claim(b.ownerClient, uploadId);
    expectUniformDenial(foreign.error);

    const first = await claim(a.ownerClient, uploadId);
    expect(first.error, first.error?.message).toBeNull();
    expect(first.data).toEqual({
      upload_id: uploadId,
      tenant_id: a.tenantId,
      product_id: productAId,
      storage_path: `${a.tenantId}/${productAId}/${uploadId}.webp`,
      declared_mime: "image/webp",
      declared_size: 123,
    });

    const second = await claim(a.ownerClient, uploadId);
    expectUniformDenial(second.error);
  });

  it("wygasłego biletu nie można przejąć", async () => {
    const issued = await issue(a.ownerClient, productAId);
    expect(issued.error, issued.error?.message).toBeNull();
    const uploadId = issued.data.upload_id as string;
    const createdAt = new Date(Date.now() - 30 * 60_000).toISOString();
    const expiresAt = new Date(Date.now() - 15 * 60_000).toISOString();
    const { error: expireError } = await admin
      .from("product_image_uploads")
      .update({ created_at: createdAt, expires_at: expiresAt })
      .eq("id", uploadId);
    expect(expireError, expireError?.message).toBeNull();

    const expired = await claim(a.ownerClient, uploadId);
    expectUniformDenial(expired.error);
  });

  it("finish domyka tylko własny processing i tylko do completed albo rejected", async () => {
    const issued = await issue(a.ownerClient, productAId);
    const uploadId = issued.data.upload_id as string;
    expect((await claim(a.ownerClient, uploadId)).error).toBeNull();

    const invalid = await finish(a.ownerClient, uploadId, "pending");
    expectUniformDenial(invalid.error);

    const foreign = await finish(b.ownerClient, uploadId, "completed");
    expectUniformDenial(foreign.error);

    const completed = await finish(a.ownerClient, uploadId, "completed");
    expect(completed.error, completed.error?.message).toBeNull();
    const row = await admin
      .from("product_image_uploads")
      .select("status,finished_at")
      .eq("id", uploadId)
      .single();
    expect(row.data?.status).toBe("completed");
    expect(row.data?.finished_at).toEqual(expect.any(String));

    expectUniformDenial((await finish(a.ownerClient, uploadId, "rejected")).error);
  });

  it("authenticated nie ma bezpośredniego SELECT/INSERT/UPDATE/DELETE tabeli biletów", async () => {
    const id = randomUUID();
    const row = {
      id,
      tenant_id: a.tenantId,
      product_id: productAId,
      requested_by: a.ownerUserId,
      storage_path: `${a.tenantId}/${productAId}/${id}.png`,
      declared_mime: "image/png",
      declared_size: 68,
      expires_at: new Date(Date.now() + 900_000).toISOString(),
    };

    const attempts = [
      await a.ownerClient.from("product_image_uploads").select("id"),
      await a.ownerClient.from("product_image_uploads").insert(row),
      await a.ownerClient.from("product_image_uploads").update({ status: "rejected" }).eq("id", id),
      await a.ownerClient.from("product_image_uploads").delete().eq("id", id),
    ];
    for (const attempt of attempts) {
      expect(attempt.error).not.toBeNull();
      expect(attempt.error?.code).toBe("42501");
    }
  });

  it("bucket ma dokładny publiczny kontrakt 5 MiB i cztery MIME", async () => {
    const rows = await sql!<{
      public: boolean;
      file_size_limit: number | string | null;
      allowed_mime_types: string[] | null;
    }[]>`
      select public, file_size_limit, allowed_mime_types
      from storage.buckets
      where id = 'product-images'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.public).toBe(true);
    expect(Number(rows[0]?.file_size_limit)).toBe(MAX_BYTES);
    expect([...(rows[0]?.allowed_mime_types ?? [])].sort()).toEqual(
      ["image/jpeg", "image/png", "image/webp", "image/avif"].sort(),
    );
  });

  it("signed upload działa tylko dla dokładnej własnej ścieżki", async () => {
    const issued = await issue(a.ownerClient, productAId);
    const path = issued.data.storage_path as string;
    const signed = await a.ownerClient.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    expect(signed.error, signed.error?.message).toBeNull();

    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const uploaded = await a.ownerClient.storage
      .from(BUCKET)
      .uploadToSignedUrl(path, signed.data!.token, bytes, {
        contentType: "image/png",
        upsert: false,
      });
    expect(uploaded.error, uploaded.error?.message).toBeNull();
    uploadedPaths.push(path);

    const foreignPath = `${b.tenantId}/${productBId}/${randomUUID()}.png`;
    const foreign = await a.ownerClient.storage
      .from(BUCKET)
      .createSignedUploadUrl(foreignPath, { upsert: false });
    expect(foreign.error).not.toBeNull();
  });

  it("bucket przyjmuje dokładnie 5 MiB i odrzuca jeden bajt więcej", async () => {
    const exactIntent = await issue(a.ownerClient, productAId, "image/png", MAX_BYTES);
    const exactPath = exactIntent.data.storage_path as string;
    const exactSigned = await a.ownerClient.storage
      .from(BUCKET)
      .createSignedUploadUrl(exactPath, { upsert: false });
    const exact = await a.ownerClient.storage
      .from(BUCKET)
      .uploadToSignedUrl(exactPath, exactSigned.data!.token, new Uint8Array(MAX_BYTES), {
        contentType: "image/png",
        upsert: false,
      });
    expect(exact.error, exact.error?.message).toBeNull();
    uploadedPaths.push(exactPath);

    const tooLargeIntent = await issue(a.ownerClient, productAId, "image/png", MAX_BYTES);
    const tooLargePath = tooLargeIntent.data.storage_path as string;
    const tooLargeSigned = await a.ownerClient.storage
      .from(BUCKET)
      .createSignedUploadUrl(tooLargePath, { upsert: false });
    const tooLarge = await a.ownerClient.storage
      .from(BUCKET)
      .uploadToSignedUrl(tooLargePath, tooLargeSigned.data!.token, new Uint8Array(MAX_BYTES + 1), {
        contentType: "image/png",
        upsert: false,
      });
    expect(tooLarge.error).not.toBeNull();
  }, 20_000);

  it("bucket odrzuca MIME spoza allowlisty", async () => {
    const issued = await issue(a.ownerClient, productAId);
    const path = issued.data.storage_path as string;
    const signed = await a.ownerClient.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    const uploaded = await a.ownerClient.storage
      .from(BUCKET)
      .uploadToSignedUrl(path, signed.data!.token, new TextEncoder().encode("<svg/>"), {
        contentType: "image/svg+xml",
        upsert: false,
      });
    expect(uploaded.error).not.toBeNull();
  });
});
