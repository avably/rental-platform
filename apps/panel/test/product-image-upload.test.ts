import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  finalizeProductImageUpload,
  prepareProductImageUpload,
  type ClaimedProductImageUpload,
  type FinalizeProductImageUploadDependencies,
} from "@/lib/product-image-upload";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const PATH = `${TENANT_ID}/${PRODUCT_ID}/${UPLOAD_ID}.png`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const actionHarness = vi.hoisted(() => ({
  locale: "pl",
  requireMember: vi.fn(),
  rpc: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  info: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  insert: vi.fn(),
  nextSortOrder: 0,
  existingPath: false,
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: actionHarness.revalidatePath,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => `${actionHarness.locale}:${key}`,
}));

vi.mock("@/lib/supabase-server", () => ({
  requireMember: (...args: unknown[]) => actionHarness.requireMember(...args),
}));

class ProductImagesQuery {
  private selected = "";

  select(columns: string): this {
    this.selected = columns;
    return this;
  }

  eq(): this {
    return this;
  }

  order(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  async maybeSingle() {
    if (this.selected === "sort_order") {
      return {
        data:
          actionHarness.nextSortOrder === 0
            ? null
            : { sort_order: actionHarness.nextSortOrder - 1 },
        error: null,
      };
    }
    return {
      data: actionHarness.existingPath ? { storage_path: PATH } : null,
      error: null,
    };
  }
}

const memberSupabase = {
  rpc: (...args: unknown[]) => actionHarness.rpc(...args),
  storage: {
    from: () => ({
      createSignedUploadUrl: (...args: unknown[]) =>
        actionHarness.createSignedUploadUrl(...args),
      info: (...args: unknown[]) => actionHarness.info(...args),
      download: (...args: unknown[]) => actionHarness.download(...args),
      remove: (...args: unknown[]) => actionHarness.remove(...args),
    }),
  },
  from: (table: string) => {
    if (table !== "product_images") throw new Error(`nieoczekiwana tabela: ${table}`);
    return {
      select: (columns: string) => new ProductImagesQuery().select(columns),
      insert: (...args: unknown[]) => actionHarness.insert(...args),
    };
  },
};

const CLAIMED: ClaimedProductImageUpload = {
  uploadId: UPLOAD_ID,
  tenantId: TENANT_ID,
  productId: PRODUCT_ID,
  storagePath: PATH,
  declaredMime: "image/png",
  declaredSize: PNG.length,
};

function finalizeDeps(
  overrides: Partial<FinalizeProductImageUploadDependencies> = {},
): FinalizeProductImageUploadDependencies {
  return {
    claim: vi.fn(async () => CLAIMED),
    info: vi.fn(async () => ({
      size: PNG.length,
      contentType: "image/png",
    })),
    download: vi.fn(async () => PNG),
    nextSortOrder: vi.fn(async () => 4),
    insert: vi.fn(async () => undefined),
    exists: vi.fn(async () => false),
    remove: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    report: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("prepareProductImageUpload", () => {
  it("wydaje intencję przed podpisem i nie zwraca bajtów", async () => {
    const calls: string[] = [];
    const result = await prepareProductImageUpload(
      { productId: PRODUCT_ID, mime: "image/png", size: PNG.length },
      {
        issue: async () => {
          calls.push("issue");
          return { uploadId: UPLOAD_ID, storagePath: PATH };
        },
        sign: async (path) => {
          calls.push(`sign:${path}`);
          return { token: "signed-token" };
        },
      },
    );

    expect(calls).toEqual(["issue", `sign:${PATH}`]);
    expect(result).toEqual({
      ok: true,
      upload: { uploadId: UPLOAD_ID, path: PATH, token: "signed-token" },
    });
    expect(JSON.stringify(result)).not.toContain("137,80,78,71");
  });

  it("odrzuca metadane przed wydaniem intencji", async () => {
    const issue = vi.fn();
    const sign = vi.fn();

    await expect(
      prepareProductImageUpload(
        { productId: PRODUCT_ID, mime: "image/svg+xml", size: 10 },
        { issue, sign },
      ),
    ).resolves.toEqual({ ok: false, error: "type" });
    expect(issue).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("mapuje błędy adapterów na stabilne kody", async () => {
    await expect(
      prepareProductImageUpload(
        { productId: PRODUCT_ID, mime: "image/png", size: PNG.length },
        {
          issue: async () => {
            throw new Error("szczegół RPC");
          },
          sign: vi.fn(),
        },
      ),
    ).resolves.toEqual({ ok: false, error: "denied" });

    await expect(
      prepareProductImageUpload(
        { productId: PRODUCT_ID, mime: "image/png", size: PNG.length },
        {
          issue: async () => ({ uploadId: UPLOAD_ID, storagePath: PATH }),
          sign: async () => {
            throw new Error("szczegół Storage");
          },
        },
      ),
    ).resolves.toEqual({ ok: false, error: "sign" });
  });
});

describe("finalizeProductImageUpload", () => {
  it("claim poprzedza odczyt Storage, a poprawny plik tworzy jeden wiersz", async () => {
    const calls: string[] = [];
    const deps = finalizeDeps({
      claim: async () => {
        calls.push("claim");
        return CLAIMED;
      },
      info: async () => {
        calls.push("info");
        return { size: PNG.length, contentType: "image/png" };
      },
      download: async () => {
        calls.push("download");
        return PNG;
      },
      nextSortOrder: async () => {
        calls.push("sort");
        return 4;
      },
      insert: async (row) => {
        calls.push("insert");
        expect(row).toEqual({
          tenantId: TENANT_ID,
          productId: PRODUCT_ID,
          storagePath: PATH,
          sortOrder: 4,
        });
      },
      finish: async (uploadId, status) => {
        calls.push(`finish:${status}`);
        expect(uploadId).toBe(UPLOAD_ID);
      },
    });

    await expect(finalizeProductImageUpload(UPLOAD_ID, deps)).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      "claim",
      "info",
      "download",
      "sort",
      "insert",
      "finish:completed",
    ]);
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it("niezgodne metadane usuwają ścieżkę i kończą bilet jako rejected", async () => {
    const deps = finalizeDeps({
      info: vi.fn(async () => ({ size: PNG.length + 1, contentType: "image/png" })),
    });

    await expect(finalizeProductImageUpload(UPLOAD_ID, deps)).resolves.toEqual({
      ok: false,
      error: "metadata",
    });
    expect(deps.remove).toHaveBeenCalledWith(PATH);
    expect(deps.finish).toHaveBeenCalledWith(UPLOAD_ID, "rejected");
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.insert).not.toHaveBeenCalled();
  });

  it("podszyte bajty usuwają ścieżkę i kończą bilet jako rejected", async () => {
    const fakePng = new TextEncoder().encode("to nie jest obraz");
    const deps = finalizeDeps({
      claim: vi.fn(async () => ({ ...CLAIMED, declaredSize: fakePng.length })),
      info: vi.fn(async () => ({
        size: fakePng.length,
        contentType: "image/png",
      })),
      download: vi.fn(async () => fakePng),
    });

    await expect(finalizeProductImageUpload(UPLOAD_ID, deps)).resolves.toEqual({
      ok: false,
      error: "content",
    });
    expect(deps.remove).toHaveBeenCalledWith(PATH);
    expect(deps.finish).toHaveBeenCalledWith(UPLOAD_ID, "rejected");
    expect(deps.insert).not.toHaveBeenCalled();
  });

  it("błąd INSERT usuwa wyłącznie przejętą ścieżkę i odrzuca bilet", async () => {
    const deps = finalizeDeps({
      insert: vi.fn(async () => {
        throw new Error("insert failed");
      }),
    });

    await expect(finalizeProductImageUpload(UPLOAD_ID, deps)).resolves.toEqual({
      ok: false,
      error: "insert",
    });
    expect(deps.exists).toHaveBeenCalledWith(PATH);
    expect(deps.remove).toHaveBeenCalledTimes(1);
    expect(deps.remove).toHaveBeenCalledWith(PATH);
    expect(deps.finish).toHaveBeenCalledWith(UPLOAD_ID, "rejected");
  });

  it("po błędzie INSERT zachowuje już istniejący wiersz i obiekt", async () => {
    const deps = finalizeDeps({
      insert: vi.fn(async () => {
        throw new Error("unikalna ścieżka");
      }),
      exists: vi.fn(async () => true),
    });

    await expect(finalizeProductImageUpload(UPLOAD_ID, deps)).resolves.toEqual({ ok: true });
    expect(deps.remove).not.toHaveBeenCalled();
    expect(deps.finish).toHaveBeenCalledWith(UPLOAD_ID, "completed");
  });

  it("błąd finish po INSERT raportuje problem, ale zachowuje sukces", async () => {
    const finishError = new Error("finish failed");
    const deps = finalizeDeps({
      finish: vi.fn(async () => {
        throw finishError;
      }),
    });

    await expect(finalizeProductImageUpload(UPLOAD_ID, deps)).resolves.toEqual({ ok: true });
    expect(deps.remove).not.toHaveBeenCalled();
    expect(deps.report).toHaveBeenCalledWith(finishError);
  });

  it("błąd drugiego claim nie czyta Storage i nie wykonuje INSERT", async () => {
    const deps = finalizeDeps({
      claim: vi.fn(async () => {
        throw new Error("already claimed");
      }),
    });

    await expect(finalizeProductImageUpload(UPLOAD_ID, deps)).resolves.toEqual({
      ok: false,
      error: "denied",
    });
    expect(deps.info).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.insert).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it("brak obiektu odrzuca bilet stabilnym kodem", async () => {
    const deps = finalizeDeps({
      info: vi.fn(async () => {
        throw new Error("not found");
      }),
    });

    await expect(finalizeProductImageUpload(UPLOAD_ID, deps)).resolves.toEqual({
      ok: false,
      error: "missing",
    });
    expect(deps.finish).toHaveBeenCalledWith(UPLOAD_ID, "rejected");
    expect(deps.insert).not.toHaveBeenCalled();
  });
});

describe("akcje signed uploadu", () => {
  beforeEach(() => {
    actionHarness.locale = "pl";
    actionHarness.rpc.mockReset();
    actionHarness.createSignedUploadUrl.mockReset();
    actionHarness.info.mockReset();
    actionHarness.download.mockReset();
    actionHarness.remove.mockReset();
    actionHarness.insert.mockReset();
    actionHarness.revalidatePath.mockReset();
    actionHarness.nextSortOrder = 4;
    actionHarness.existingPath = false;
    actionHarness.requireMember.mockReset();
    actionHarness.requireMember.mockResolvedValue({
      supabase: memberSupabase,
      tenantId: TENANT_ID,
      user: { id: "44444444-4444-4444-8444-444444444444" },
    });
    actionHarness.rpc.mockImplementation(async (name: string) => {
      if (name === "issue_product_image_upload") {
        return {
          data: [{ upload_id: UPLOAD_ID, storage_path: PATH }],
          error: null,
        };
      }
      if (name === "claim_product_image_upload") {
        return {
          data: [
            {
              upload_id: UPLOAD_ID,
              tenant_id: TENANT_ID,
              product_id: PRODUCT_ID,
              storage_path: PATH,
              declared_mime: "image/png",
              declared_size: PNG.length,
            },
          ],
          error: null,
        };
      }
      if (name === "finish_product_image_upload") {
        return { data: true, error: null };
      }
      throw new Error(`nieoczekiwane RPC: ${name}`);
    });
    actionHarness.createSignedUploadUrl.mockResolvedValue({
      data: { token: "signed-token", path: PATH, signedUrl: "https://storage.invalid" },
      error: null,
    });
    actionHarness.info.mockResolvedValue({
      data: { size: PNG.length, contentType: "image/png" },
      error: null,
    });
    actionHarness.download.mockResolvedValue({
      data: new Blob([PNG], { type: "image/png" }),
      error: null,
    });
    actionHarness.remove.mockResolvedValue({ data: [], error: null });
    actionHarness.insert.mockResolvedValue({ data: null, error: null });
  });

  it("prepare wysyła do RPC wyłącznie produkt, MIME i rozmiar oraz podpisuje sesją członka", async () => {
    const { prepareProductImageUploadAction } = await import(
      "@/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-actions"
    );

    await expect(
      prepareProductImageUploadAction(PRODUCT_ID, {
        mime: "image/png",
        size: PNG.length,
      }),
    ).resolves.toEqual({
      ok: true,
      upload: { uploadId: UPLOAD_ID, path: PATH, token: "signed-token" },
    });

    expect(actionHarness.requireMember).toHaveBeenCalledTimes(1);
    expect(actionHarness.rpc).toHaveBeenCalledWith("issue_product_image_upload", {
      p_product_id: PRODUCT_ID,
      p_declared_mime: "image/png",
      p_declared_size: PNG.length,
    });
    expect(actionHarness.createSignedUploadUrl).toHaveBeenCalledWith(PATH, {
      upsert: false,
    });
  });

  it("finalize bierze tenant, produkt i ścieżkę wyłącznie z claim RPC", async () => {
    const { finalizeProductImageUploadAction } = await import(
      "@/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-actions"
    );

    await expect(finalizeProductImageUploadAction(UPLOAD_ID)).resolves.toEqual({
      success: "added",
    });

    expect(actionHarness.rpc).toHaveBeenNthCalledWith(1, "claim_product_image_upload", {
      p_upload_id: UPLOAD_ID,
    });
    expect(actionHarness.insert).toHaveBeenCalledWith({
      tenant_id: TENANT_ID,
      product_id: PRODUCT_ID,
      storage_path: PATH,
      sort_order: 4,
    });
    expect(actionHarness.rpc).toHaveBeenNthCalledWith(2, "finish_product_image_upload", {
      p_status: "completed",
      p_upload_id: UPLOAD_ID,
    });
    expect(actionHarness.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("mapuje błędy prepare na lokalizowane, stabilne komunikaty", async () => {
    const { prepareProductImageUploadAction } = await import(
      "@/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-actions"
    );

    await expect(
      prepareProductImageUploadAction(PRODUCT_ID, { mime: "image/png", size: 0 }),
    ).resolves.toEqual({ ok: false, error: "pl:errors.empty" });

    actionHarness.rpc.mockResolvedValueOnce({
      data: null,
      error: new Error("provider detail"),
    });
    await expect(
      prepareProductImageUploadAction(PRODUCT_ID, {
        mime: "image/png",
        size: PNG.length,
      }),
    ).resolves.toEqual({ ok: false, error: "pl:errors.denied" });

    actionHarness.createSignedUploadUrl.mockResolvedValueOnce({
      data: null,
      error: new Error("signed URL provider detail"),
    });
    await expect(
      prepareProductImageUploadAction(PRODUCT_ID, {
        mime: "image/png",
        size: PNG.length,
      }),
    ).resolves.toEqual({ ok: false, error: "pl:errors.upload" });
  });

  it("mapuje odmowę i błędy finalizacji bez ujawniania szczegółów dostawcy", async () => {
    const { finalizeProductImageUploadAction } = await import(
      "@/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-actions"
    );

    actionHarness.rpc.mockResolvedValueOnce({
      data: null,
      error: new Error("raw claim detail"),
    });
    await expect(finalizeProductImageUploadAction(UPLOAD_ID)).resolves.toEqual({
      formError: "pl:errors.denied",
    });

    actionHarness.info.mockResolvedValueOnce({
      data: { size: PNG.length + 1, contentType: "image/png" },
      error: null,
    });
    await expect(finalizeProductImageUploadAction(UPLOAD_ID)).resolves.toEqual({
      formError: "pl:errors.finalize",
    });

    const fake = new TextEncoder().encode("fałszywy obraz");
    actionHarness.rpc.mockImplementationOnce(async () => ({
      data: [
        {
          upload_id: UPLOAD_ID,
          tenant_id: TENANT_ID,
          product_id: PRODUCT_ID,
          storage_path: PATH,
          declared_mime: "image/png",
          declared_size: fake.length,
        },
      ],
      error: null,
    }));
    actionHarness.info.mockResolvedValueOnce({
      data: { size: fake.length, contentType: "image/png" },
      error: null,
    });
    actionHarness.download.mockResolvedValueOnce({
      data: new Blob([fake], { type: "image/png" }),
      error: null,
    });
    await expect(finalizeProductImageUploadAction(UPLOAD_ID)).resolves.toEqual({
      formError: "pl:errors.content",
    });
  });

  it("ma wierne i kompletne komunikaty PL/EN", () => {
    expect(pl.catalog.images).toMatchObject({
      uploading: "Wgrywanie…",
      errors: {
        missing: "Wybierz plik zdjęcia do wgrania.",
        empty: "Wybrany plik jest pusty.",
        size: "Zdjęcie może mieć najwyżej 5 MB.",
        type: "Dozwolone formaty zdjęć: JPEG, PNG, WebP, AVIF.",
        denied: "Nie można wgrać zdjęcia do tego produktu.",
        upload: "Nie udało się przesłać zdjęcia.",
        content: "Plik nie jest prawidłowym obrazem w wybranym formacie.",
        finalize: "Nie udało się dodać zdjęcia. Spróbuj ponownie.",
      },
    });
    expect(en.catalog.images).toMatchObject({
      uploading: "Uploading…",
      errors: {
        missing: "Choose an image file to upload.",
        empty: "The selected file is empty.",
        size: "The image can be up to 5 MB.",
        type: "Allowed image formats: JPEG, PNG, WebP, AVIF.",
        denied: "This photo cannot be uploaded to the selected product.",
        upload: "The photo could not be uploaded.",
        content: "The file is not a valid image in the selected format.",
        finalize: "The photo could not be added. Try again.",
      },
    });
  });
});
