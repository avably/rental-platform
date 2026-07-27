import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "../../../packages/db/test/helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const liveHarness = vi.hoisted(() => ({
  tenant: null as TenantCtx | null,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => {
    if (!liveHarness.tenant) throw new Error("brak kontekstu testowego");
    return {
      supabase: liveHarness.tenant.ownerClient,
      tenantId: liveHarness.tenant.tenantId,
      user: { id: liveHarness.tenant.ownerUserId },
    };
  },
}));

const { finalizeProductImageUploadAction, prepareProductImageUploadAction } = await import(
  "@/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-actions"
);

describe.skipIf(!hasEnv)("pełna droga signed uploadu zdjęcia", () => {
  let admin: SupabaseClient;
  let tenant: TenantCtx;
  let productId: string;
  const storagePaths: string[] = [];

  beforeAll(async () => {
    admin = createAdminClient();
    ({ a: tenant } = await seedTwoTenants());
    liveHarness.tenant = tenant;
    const { data, error } = await admin
      .from("products")
      .insert({
        tenant_id: tenant.tenantId,
        name: `Produkt live ${randomUUID()}`,
        base_price_day_grosze: 1000,
        deposit_grosze: 2000,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "brak produktu");
    productId = data.id as string;
  }, 60_000);

  afterAll(async () => {
    liveHarness.tenant = null;
    if (storagePaths.length > 0) {
      const { error: metadataError } = await admin
        .from("product_images")
        .delete()
        .in("storage_path", storagePaths);
      if (metadataError) throw metadataError;
      const { error: storageError } = await admin.storage
        .from("product-images")
        .remove(storagePaths);
      if (storageError) throw storageError;
    }
    await cleanupSeeded(admin);
  }, 60_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tworzy dokładnie jeden wiersz, publicznie oddaje te same bajty i odmawia drugi raz", async () => {
    const reportSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const prepared = await prepareProductImageUploadAction(productId, {
      mime: "image/png",
      size: PNG.length,
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) throw new Error(prepared.error);
    storagePaths.push(prepared.upload.path);

    const { error: uploadError } = await tenant.ownerClient.storage
      .from("product-images")
      .uploadToSignedUrl(
        prepared.upload.path,
        prepared.upload.token,
        new Blob([PNG], { type: "image/png" }),
        { contentType: "image/png", upsert: false },
      );
    expect(uploadError).toBeNull();

    await expect(finalizeProductImageUploadAction(prepared.upload.uploadId)).resolves.toEqual({
      success: "added",
    });
    expect(reportSpy).not.toHaveBeenCalled();

    const { data: rows, error: rowsError } = await admin
      .from("product_images")
      .select("storage_path")
      .eq("storage_path", prepared.upload.path);
    expect(rowsError).toBeNull();
    expect(rows).toEqual([{ storage_path: prepared.upload.path }]);

    const publicUrl = tenant.ownerClient.storage
      .from("product-images")
      .getPublicUrl(prepared.upload.path).data.publicUrl;
    const response = await fetch(publicUrl);
    expect(response.ok).toBe(true);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);

    const { data: intent } = await admin
      .from("product_image_uploads")
      .select("status")
      .eq("id", prepared.upload.uploadId)
      .single();
    expect(intent?.status).toBe("completed");

    await expect(finalizeProductImageUploadAction(prepared.upload.uploadId)).resolves.toEqual({
      formError: "errors.denied",
    });
    const { count } = await admin
      .from("product_images")
      .select("id", { count: "exact", head: true })
      .eq("storage_path", prepared.upload.path);
    expect(count).toBe(1);
  }, 60_000);

  it("realny PostgREST zwraca data null i error null dla finish RETURNS void", async () => {
    const issued = await tenant.ownerClient
      .schema("app")
      .rpc("issue_product_image_upload", {
        p_product_id: productId,
        p_declared_mime: "image/png",
        p_declared_size: PNG.length,
      })
      .single();
    expect(issued.error, issued.error?.message).toBeNull();

    const claimed = await tenant.ownerClient
      .schema("app")
      .rpc("claim_product_image_upload", {
        p_upload_id: issued.data.upload_id as string,
      })
      .single();
    expect(claimed.error, claimed.error?.message).toBeNull();

    const finished = await tenant.ownerClient
      .schema("app")
      .rpc("finish_product_image_upload", {
        p_upload_id: issued.data.upload_id as string,
        p_outcome: "rejected",
      });
    expect(finished).toMatchObject({ data: null, error: null });
  });

  it("usuwa tekst podszywający się pod PNG i nie tworzy metadanych", async () => {
    const fake = new TextEncoder().encode("to nie jest plik PNG");
    const prepared = await prepareProductImageUploadAction(productId, {
      mime: "image/png",
      size: fake.length,
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) throw new Error(prepared.error);
    storagePaths.push(prepared.upload.path);

    const { error: uploadError } = await tenant.ownerClient.storage
      .from("product-images")
      .uploadToSignedUrl(
        prepared.upload.path,
        prepared.upload.token,
        new Blob([fake], { type: "image/png" }),
        { contentType: "image/png", upsert: false },
      );
    expect(uploadError).toBeNull();

    await expect(finalizeProductImageUploadAction(prepared.upload.uploadId)).resolves.toEqual({
      formError: "errors.content",
    });
    const { count } = await admin
      .from("product_images")
      .select("id", { count: "exact", head: true })
      .eq("storage_path", prepared.upload.path);
    expect(count).toBe(0);

    const { data: intent } = await admin
      .from("product_image_uploads")
      .select("status")
      .eq("id", prepared.upload.uploadId)
      .single();
    expect(intent?.status).toBe("rejected");

    const { error: missingError } = await tenant.ownerClient.storage
      .from("product-images")
      .download(prepared.upload.path);
    expect(missingError).not.toBeNull();
  }, 60_000);
});
