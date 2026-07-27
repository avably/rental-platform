import { beforeEach, describe, expect, it, vi } from "vitest";

import { runProductImageUpload } from "@/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-flow";
import type { FormState } from "@/lib/form-state";
import type { PrepareProductImageUploadResult } from "@/lib/product-image-upload";

const PATH =
  "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";

function imageFile(): File {
  return new File([PNG], "photo.png", { type: "image/png" });
}

describe("runProductImageUpload", () => {
  const calls: string[] = [];
  const prepare = vi.fn(async (): Promise<PrepareProductImageUploadResult> => {
    calls.push("prepare");
    return {
      ok: true as const,
      upload: { uploadId: UPLOAD_ID, path: PATH, token: "signed-token" },
    };
  });
  const upload = vi.fn(async (): Promise<{ error: string | null }> => {
    calls.push("upload");
    return { error: null };
  });
  const finalize = vi.fn(async (): Promise<FormState> => {
    calls.push("finalize");
    return { success: "added" };
  });
  const message = vi.fn((problem: string) => `message:${problem}`);

  beforeEach(() => {
    calls.length = 0;
    prepare.mockClear();
    upload.mockClear();
    finalize.mockClear();
    message.mockClear();
  });

  it("lokalny błąd metadanych nie rozpoczyna żadnego etapu", async () => {
    await expect(
      runProductImageUpload(null, { prepare, upload, finalize, message }),
    ).resolves.toEqual({ formError: "message:missing" });

    expect(prepare).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("wywołuje prepare, signed upload i finalize dokładnie w tej kolejności", async () => {
    const file = imageFile();

    await expect(
      runProductImageUpload(file, { prepare, upload, finalize, message }),
    ).resolves.toEqual({ success: "added" });

    expect(calls).toEqual(["prepare", "upload", "finalize"]);
    expect(prepare).toHaveBeenCalledWith({ mime: "image/png", size: PNG.length });
    expect(upload).toHaveBeenCalledWith({
      path: PATH,
      token: "signed-token",
      file,
      contentType: "image/png",
    });
    expect(finalize).toHaveBeenCalledWith(UPLOAD_ID);
  });

  it("błąd signed upload zatrzymuje finalizację", async () => {
    upload.mockResolvedValueOnce({ error: "storage failed" });

    await expect(
      runProductImageUpload(imageFile(), { prepare, upload, finalize, message }),
    ).resolves.toEqual({ formError: "message:upload" });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("odmowa prepare przechodzi bez zmian i zatrzymuje upload", async () => {
    prepare.mockResolvedValueOnce({ ok: false, error: "Nie można wgrać." });

    await expect(
      runProductImageUpload(imageFile(), { prepare, upload, finalize, message }),
    ).resolves.toEqual({ formError: "Nie można wgrać." });
    expect(upload).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("błąd finalize jest zwracany bez zmian", async () => {
    finalize.mockResolvedValueOnce({ formError: "Finalizacja nie powiodła się." });

    await expect(
      runProductImageUpload(imageFile(), { prepare, upload, finalize, message }),
    ).resolves.toEqual({ formError: "Finalizacja nie powiodła się." });
  });
});
