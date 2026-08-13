import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "../../../packages/db/test/helpers/seed-tenants";

/**
 * PEŁNA DROGA LOGO NAJEMCY NA ŻYWYM SUPABASE (ADR-160) — z dowodem, że
 * SPRZĄTACZ SIEROT NIE KASUJE ŻYWEGO ZNAKU.
 *
 * ==================== DLACZEGO TEN TEST ISTNIEJE ====================
 *
 * Sprzątacz (`src/jobs/cleanup-site-image-uploads.ts`) pyta bazę, które ze
 * ścieżek kandydujących są jeszcze w użyciu, i kasuje CAŁĄ RESZTĘ. Do 0076
 * pytanie obejmowało wyłącznie treść sekcji — a logo nie leży w sekcjach.
 *
 * „Ale przecież bilet logo kończy jako `completed`, a sprzątacz kasuje obiekty
 * tylko dla biletów NIE-completed" — i właśnie dlatego stan `processing` jest
 * tu odtworzony, a nie zmyślony. `finalizeSiteImageUpload` DOMYKA bilet
 * w bloku, który połyka wyjątek:
 *
 *     try { await deps.finish(uploadId, "completed"); }
 *     catch (error) { await report(deps, error); }
 *     return { ok: true, path: claimed.storagePath };
 *
 * Zerwane połączenie przy `finish` zostawia więc bilet w `processing`, a mimo
 * to zwraca ŚCIEŻKĘ — panel zapisuje ją jako znak i publikuje. Doba później
 * sprzątacz widzi „stary bilet processing" i bez wpisu z 0076 kasuje plik,
 * który wisi w nagłówku sklepu. Objawem jest znikające logo i licznik
 * `removedObjects` w logu crona; błędu nie ma żadnego.
 *
 * KONTROLA POZYTYWNA jest w tym samym przebiegu: drugi plik, w identycznym
 * stanie, ale NIEUŻYWANY, MUSI zniknąć. Bez niej zielony wynik znaczyłby
 * najwyżej „sprzątacz nic nie zrobił".
 */
const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const BUCKET = "site-images";
const DAY_MS = 24 * 60 * 60 * 1000;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const liveHarness = vi.hoisted(() => ({
  tenant: null as TenantCtx | null,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
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

const {
  finalizeTenantLogoUploadAction,
  prepareTenantLogoUploadAction,
  publishTenantLogoAction,
  saveTenantLogoAction,
} = await import("@/app/[locale]/(panel)/strona/logo-actions");
const { cleanupSiteImageUploads } = await import("@/src/jobs/cleanup-site-image-uploads");

describe.skipIf(!hasEnv)("logo najemcy: pełna droga i sprzątacz sierot", () => {
  let admin: SupabaseClient;
  let tenant: TenantCtx;
  const storagePaths: string[] = [];

  /** Wgrywa plik przez PEŁNĄ drogę produkcyjną i zwraca (bilet, ścieżka). */
  async function uploadLogoFile(): Promise<{ uploadId: string; path: string }> {
    const prepared = await prepareTenantLogoUploadAction({
      mime: "image/png",
      size: PNG.byteLength,
    });
    if (!prepared.ok) throw new Error(`prepare: ${prepared.error}`);

    const uploaded = await tenant.ownerClient.storage
      .from(BUCKET)
      .uploadToSignedUrl(prepared.upload.path, prepared.upload.token, PNG, {
        contentType: "image/png",
        upsert: false,
      });
    expect(uploaded.error, uploaded.error?.message).toBeNull();
    storagePaths.push(prepared.upload.path);

    const finalized = await finalizeTenantLogoUploadAction(prepared.upload.uploadId);
    if (!finalized.ok) throw new Error(`finalize: ${finalized.error}`);
    return { uploadId: prepared.upload.uploadId, path: finalized.path };
  }

  /**
   * Bilet w stanie, który zostawia po sobie POŁKNIĘTA awaria `finish`
   * (patrz nagłówek): `processing`, wystawiony ponad dobę temu.
   */
  async function ageAsProcessing(uploadId: string): Promise<void> {
    const { error } = await admin
      .from("site_image_uploads")
      .update({
        status: "processing",
        finished_at: null,
        created_at: new Date(Date.now() - 2 * DAY_MS).toISOString(),
      })
      .eq("id", uploadId);
    expect(error, error?.message).toBeNull();
  }

  async function objectExists(path: string): Promise<boolean> {
    const { error } = await admin.storage.from(BUCKET).download(path);
    return error === null;
  }

  beforeAll(async () => {
    admin = createAdminClient();
    ({ a: tenant } = await seedTwoTenants());
    liveHarness.tenant = tenant;
  }, 60_000);

  afterAll(async () => {
    if (storagePaths.length > 0) await admin.storage.from(BUCKET).remove(storagePaths);
    await cleanupSeeded(admin);
  });

  it("wgranie, zapis szkicu i publikacja stawiają znak w kopercie sklepu", async () => {
    const { path } = await uploadLogoFile();
    expect(path).toMatch(new RegExp(`^${tenant.tenantId}/logo/`));

    const saved = await saveTenantLogoAction({ path, alt: "Znak", inFooter: true });
    expect(saved, JSON.stringify(saved)).toEqual({ ok: true });

    const published = await publishTenantLogoAction();
    expect(published, JSON.stringify(published)).toEqual({ ok: true });

    const { data } = await admin
      .schema("app")
      .rpc("get_published_site", { p_tenant_id: tenant.tenantId });
    // Sklep tenanta bez opublikowanej strony oddaje NULL — koperty tu nie ma
    // i nie o nią w tym przypadku chodzi; znak sprawdzamy w kolumnie.
    if (data) expect((data as { logo?: unknown }).logo).toEqual({
      path,
      alt: "Znak",
      inFooter: true,
    });

    const [row] = [
      (
        await admin
          .from("tenants")
          .select("logo_published")
          .eq("id", tenant.tenantId)
          .single()
      ).data,
    ];
    expect(row?.logo_published).toEqual({ path, alt: "Znak", inFooter: true });
  }, 30_000);

  it("SPRZĄTACZ nie kasuje żywego znaku, a sierotę w tym samym stanie kasuje", async () => {
    // ŻYWY ZNAK — ten sam plik, który stoi w nagłówku sklepu po przypadku wyżej.
    const live = storagePaths[0]!;
    const [liveIntent] = [
      (
        await admin
          .from("site_image_uploads")
          .select("id")
          .eq("storage_path", live)
          .single()
      ).data,
    ];
    await ageAsProcessing(liveIntent!.id as string);

    // SIEROTA — wgrana tą samą drogą, nigdy nie zapisana jako znak.
    const orphan = await uploadLogoFile();
    await ageAsProcessing(orphan.uploadId);

    expect(await objectExists(live), "plik żywego znaku nie istnieje przed sprzątaniem").toBe(true);
    expect(await objectExists(orphan.path), "plik sieroty nie istnieje przed sprzątaniem").toBe(
      true,
    );

    const result = await cleanupSiteImageUploads({ db: admin });

    // KONTROLA POZYTYWNA: sprzątacz NAPRAWDĘ pracował w tym przebiegu.
    expect(result.removedObjects, "sprzątacz nie skasował ani jednej sieroty").toBeGreaterThan(0);
    expect(await objectExists(orphan.path), "sierota przeżyła sprzątanie").toBe(false);

    // DOWÓD WŁAŚCIWY: żywy znak przeżył.
    expect(
      await objectExists(live),
      "sprzątacz skasował ŻYWE logo najemcy — app.site_image_paths_in_use nie widzi tenants.logo_*",
    ).toBe(true);
  }, 60_000);
});
