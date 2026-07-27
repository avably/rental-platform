import { describe, expect, it, vi } from "vitest";

import {
  finalizeProductImageUpload,
  prepareProductImageUpload,
  type ClaimedProductImageUpload,
  type FinalizeProductImageUploadDependencies,
} from "@/lib/product-image-upload";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const PATH = `${TENANT_ID}/${PRODUCT_ID}/${UPLOAD_ID}.png`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
