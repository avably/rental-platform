/**
 * Orkiestracja podpisanego uploadu zdjęcia SEKCJI (0043) — lustro
 * product-image-upload.test.ts, z różnicą modelu: finalize NIE wstawia wiersza
 * do tabeli-katalogu, tylko domyka bilet i ZWRACA ścieżkę Storage. Testy
 * pilnują kolejności (claim → info → download → magiczne bajty → finish) i
 * kompensacji (niezgodność metadanych/treści usuwa obiekt i odrzuca bilet).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  finalizeSiteImageUpload,
  prepareSiteImageUpload,
  type ClaimedSiteImageUpload,
  type FinalizeSiteImageUploadDependencies,
} from "@/lib/site-image-upload";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const PATH = `${TENANT_ID}/${SITE_ID}/${UPLOAD_ID}.png`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const actionHarness = vi.hoisted(() => ({
  locale: "pl",
  requireMember: vi.fn(),
  rpc: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  info: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => `${actionHarness.locale}:${key}`,
}));

vi.mock("@/lib/supabase-server", () => ({
  requireMember: (...args: unknown[]) => actionHarness.requireMember(...args),
}));

const memberSupabase = {
  schema: (schema: string) => {
    if (schema !== "app") throw new Error(`nieoczekiwany schemat: ${schema}`);
    return { rpc: (...args: unknown[]) => actionHarness.rpc(...args) };
  },
  storage: {
    from: () => ({
      createSignedUploadUrl: (...args: unknown[]) => actionHarness.createSignedUploadUrl(...args),
      info: (...args: unknown[]) => actionHarness.info(...args),
      download: (...args: unknown[]) => actionHarness.download(...args),
      remove: (...args: unknown[]) => actionHarness.remove(...args),
    }),
  },
};

const CLAIMED: ClaimedSiteImageUpload = {
  uploadId: UPLOAD_ID,
  tenantId: TENANT_ID,
  siteId: SITE_ID,
  storagePath: PATH,
  declaredMime: "image/png",
  declaredSize: PNG.length,
};

function finalizeDeps(
  overrides: Partial<FinalizeSiteImageUploadDependencies> = {},
): FinalizeSiteImageUploadDependencies {
  return {
    claim: vi.fn(async () => CLAIMED),
    info: vi.fn(async () => ({ size: PNG.length, contentType: "image/png" })),
    download: vi.fn(async () => PNG),
    remove: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    report: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("prepareSiteImageUpload", () => {
  it("wydaje intencję przed podpisem i nie zwraca bajtów", async () => {
    const calls: string[] = [];
    const result = await prepareSiteImageUpload(
      { siteId: SITE_ID, mime: "image/png", size: PNG.length },
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
  });

  it("odrzuca metadane przed wydaniem intencji", async () => {
    const issue = vi.fn();
    const sign = vi.fn();
    await expect(
      prepareSiteImageUpload({ siteId: SITE_ID, mime: "image/svg+xml", size: 10 }, { issue, sign }),
    ).resolves.toEqual({ ok: false, error: "type" });
    expect(issue).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("mapuje błędy adapterów na stabilne kody", async () => {
    await expect(
      prepareSiteImageUpload(
        { siteId: SITE_ID, mime: "image/png", size: PNG.length },
        {
          issue: async () => {
            throw new Error("szczegół RPC");
          },
          sign: vi.fn(),
        },
      ),
    ).resolves.toEqual({ ok: false, error: "denied" });

    await expect(
      prepareSiteImageUpload(
        { siteId: SITE_ID, mime: "image/png", size: PNG.length },
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

describe("finalizeSiteImageUpload", () => {
  it("claim poprzedza odczyt Storage; poprawny plik domyka bilet i zwraca ścieżkę", async () => {
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
      finish: async (uploadId, status) => {
        calls.push(`finish:${status}`);
        expect(uploadId).toBe(UPLOAD_ID);
      },
    });

    await expect(finalizeSiteImageUpload(UPLOAD_ID, deps)).resolves.toEqual({ ok: true, path: PATH });
    expect(calls).toEqual(["claim", "info", "download", "finish:completed"]);
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it("niezgodne metadane usuwają ścieżkę i odrzucają bilet (bez czytania bajtów)", async () => {
    const deps = finalizeDeps({
      info: vi.fn(async () => ({ size: PNG.length + 1, contentType: "image/png" })),
    });
    await expect(finalizeSiteImageUpload(UPLOAD_ID, deps)).resolves.toEqual({
      ok: false,
      error: "metadata",
    });
    expect(deps.remove).toHaveBeenCalledWith(PATH);
    expect(deps.finish).toHaveBeenCalledWith(UPLOAD_ID, "rejected");
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("podszyte bajty (nie-obraz) usuwają ścieżkę i odrzucają bilet", async () => {
    const fake = new TextEncoder().encode("to nie jest obraz");
    const deps = finalizeDeps({
      claim: vi.fn(async () => ({ ...CLAIMED, declaredSize: fake.length })),
      info: vi.fn(async () => ({ size: fake.length, contentType: "image/png" })),
      download: vi.fn(async () => fake),
    });
    await expect(finalizeSiteImageUpload(UPLOAD_ID, deps)).resolves.toEqual({
      ok: false,
      error: "content",
    });
    expect(deps.remove).toHaveBeenCalledWith(PATH);
    expect(deps.finish).toHaveBeenCalledWith(UPLOAD_ID, "rejected");
  });

  it("błąd drugiego claim nie czyta Storage", async () => {
    const deps = finalizeDeps({
      claim: vi.fn(async () => {
        throw new Error("already claimed");
      }),
    });
    await expect(finalizeSiteImageUpload(UPLOAD_ID, deps)).resolves.toEqual({
      ok: false,
      error: "denied",
    });
    expect(deps.info).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it("brak obiektu odrzuca bilet stabilnym kodem", async () => {
    const deps = finalizeDeps({
      info: vi.fn(async () => {
        throw new Error("not found");
      }),
    });
    await expect(finalizeSiteImageUpload(UPLOAD_ID, deps)).resolves.toEqual({
      ok: false,
      error: "missing",
    });
    expect(deps.finish).toHaveBeenCalledWith(UPLOAD_ID, "rejected");
  });

  it("błąd finish po poprawnej treści raportuje problem, ale zachowuje sukces", async () => {
    const finishError = new Error("finish failed");
    const deps = finalizeDeps({
      finish: vi.fn(async () => {
        throw finishError;
      }),
    });
    await expect(finalizeSiteImageUpload(UPLOAD_ID, deps)).resolves.toEqual({ ok: true, path: PATH });
    expect(deps.remove).not.toHaveBeenCalled();
    expect(deps.report).toHaveBeenCalledWith(finishError);
  });
});

describe("akcje signed uploadu zdjęcia sekcji", () => {
  beforeEach(() => {
    actionHarness.locale = "pl";
    actionHarness.rpc.mockReset();
    actionHarness.createSignedUploadUrl.mockReset();
    actionHarness.info.mockReset();
    actionHarness.download.mockReset();
    actionHarness.remove.mockReset();
    actionHarness.requireMember.mockReset();
    actionHarness.requireMember.mockResolvedValue({
      supabase: memberSupabase,
      tenantId: TENANT_ID,
      user: { id: "44444444-4444-4444-8444-444444444444" },
    });
    actionHarness.rpc.mockImplementation(async (name: string) => {
      if (name === "issue_site_image_upload") {
        return { data: [{ upload_id: UPLOAD_ID, storage_path: PATH }], error: null };
      }
      if (name === "claim_site_image_upload") {
        return {
          data: [
            {
              upload_id: UPLOAD_ID,
              tenant_id: TENANT_ID,
              site_id: SITE_ID,
              storage_path: PATH,
              declared_mime: "image/png",
              declared_size: PNG.length,
            },
          ],
          error: null,
        };
      }
      if (name === "finish_site_image_upload") return { data: null, error: null };
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
  });

  it("prepare wysyła do RPC wyłącznie stronę, MIME i rozmiar oraz podpisuje sesją członka", async () => {
    const { prepareSiteImageUploadAction } = await import(
      "@/app/[locale]/(panel)/strona/upload-actions"
    );
    await expect(
      prepareSiteImageUploadAction(SITE_ID, { mime: "image/png", size: PNG.length }),
    ).resolves.toEqual({
      ok: true,
      upload: { uploadId: UPLOAD_ID, path: PATH, token: "signed-token" },
    });
    expect(actionHarness.rpc).toHaveBeenCalledWith("issue_site_image_upload", {
      p_site_id: SITE_ID,
      p_declared_mime: "image/png",
      p_declared_size: PNG.length,
    });
    expect(actionHarness.createSignedUploadUrl).toHaveBeenCalledWith(PATH, { upsert: false });
  });

  it("finalize bierze tenant, stronę i ścieżkę z claim RPC i ZWRACA ścieżkę", async () => {
    const { finalizeSiteImageUploadAction } = await import(
      "@/app/[locale]/(panel)/strona/upload-actions"
    );
    await expect(finalizeSiteImageUploadAction(UPLOAD_ID)).resolves.toEqual({ ok: true, path: PATH });
    expect(actionHarness.rpc).toHaveBeenNthCalledWith(1, "claim_site_image_upload", {
      p_upload_id: UPLOAD_ID,
    });
    expect(actionHarness.rpc).toHaveBeenNthCalledWith(2, "finish_site_image_upload", {
      p_outcome: "completed",
      p_upload_id: UPLOAD_ID,
    });
  });

  it("mapuje błędy prepare na lokalizowane, stabilne komunikaty", async () => {
    const { prepareSiteImageUploadAction } = await import(
      "@/app/[locale]/(panel)/strona/upload-actions"
    );
    await expect(
      prepareSiteImageUploadAction(SITE_ID, { mime: "image/png", size: 0 }),
    ).resolves.toEqual({ ok: false, error: "pl:errors.empty" });

    actionHarness.rpc.mockResolvedValueOnce({ data: null, error: new Error("provider detail") });
    await expect(
      prepareSiteImageUploadAction(SITE_ID, { mime: "image/png", size: PNG.length }),
    ).resolves.toEqual({ ok: false, error: "pl:errors.denied" });

    actionHarness.createSignedUploadUrl.mockResolvedValueOnce({ data: null, error: new Error("x") });
    await expect(
      prepareSiteImageUploadAction(SITE_ID, { mime: "image/png", size: PNG.length }),
    ).resolves.toEqual({ ok: false, error: "pl:errors.upload" });
  });

  it("mapuje podszyte bajty na komunikat treści bez ujawniania szczegółów dostawcy", async () => {
    const { finalizeSiteImageUploadAction } = await import(
      "@/app/[locale]/(panel)/strona/upload-actions"
    );
    const fake = new TextEncoder().encode("fałszywy obraz");
    actionHarness.rpc.mockImplementationOnce(async () => ({
      data: [
        {
          upload_id: UPLOAD_ID,
          tenant_id: TENANT_ID,
          site_id: SITE_ID,
          storage_path: PATH,
          declared_mime: "image/png",
          declared_size: fake.length,
        },
      ],
      error: null,
    }));
    actionHarness.info.mockResolvedValueOnce({ data: { size: fake.length, contentType: "image/png" }, error: null });
    actionHarness.download.mockResolvedValueOnce({ data: new Blob([fake], { type: "image/png" }), error: null });
    await expect(finalizeSiteImageUploadAction(UPLOAD_ID)).resolves.toEqual({
      ok: false,
      error: "pl:errors.content",
    });
  });

  it("ma wierne i kompletne komunikaty PL/EN", () => {
    expect(pl.site.images.errors).toMatchObject({
      missing: "Wybierz plik.",
      empty: "Plik jest pusty.",
      size: "Plik przekracza 5 MB.",
      type: "Dozwolone formaty: JPEG, PNG, WebP, AVIF.",
      denied: "Nie masz uprawnień do tego uploadu.",
      upload: "Nie udało się wgrać pliku.",
      content: "Zawartość pliku nie jest obrazem zadeklarowanego typu.",
      finalize: "Nie udało się zakończyć uploadu.",
    });
    expect(en.site.images.errors).toMatchObject({
      missing: "Choose a file.",
      empty: "The file is empty.",
      size: "The file exceeds 5 MB.",
      type: "Allowed formats: JPEG, PNG, WebP, AVIF.",
      denied: "You are not allowed to do this upload.",
      upload: "Could not upload the file.",
      content: "The file content is not the declared image type.",
      finalize: "Could not finish the upload.",
    });
  });
});
