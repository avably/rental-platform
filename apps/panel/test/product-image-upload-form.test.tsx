// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

const PATH =
  "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-flow", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-flow")
  >();
  return {
    ...actual,
    uploadProductImageToSignedUrl: (...args: unknown[]) => uploadMock(...args),
  };
});

const { UploadImageForm } = await import(
  "@/app/[locale]/(panel)/katalog/[id]/zdjecia/photo-forms"
);

function file(): File {
  return new File([PNG], "photo.png", { type: "image/png" });
}

function mount(
  prepare: (input: { mime: string; size: number }) => Promise<
    | {
        ok: true;
        upload: { uploadId: string; path: string; token: string };
      }
    | { ok: false; error: string }
  >,
  finalize: (uploadId: string) => Promise<{ success?: string; formError?: string }>,
) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <UploadImageForm prepare={prepare} finalize={finalize} />
    </NextIntlClientProvider>,
  );
}

function selectFile(selected: File): HTMLInputElement {
  const input = screen.getByLabelText(messages.catalog.images.file) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [selected] } });
  return input;
}

beforeEach(() => {
  uploadMock.mockReset();
  uploadMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UploadImageForm", () => {
  it("podwójny submit podczas oczekiwania rozpoczyna tylko jedno prepare", async () => {
    let resolvePrepare!: (value: {
      ok: true;
      upload: { uploadId: string; path: string; token: string };
    }) => void;
    const prepare = vi.fn(
      () =>
        new Promise<{
          ok: true;
          upload: { uploadId: string; path: string; token: string };
        }>((resolve) => {
          resolvePrepare = resolve;
        }),
    );
    const finalize = vi.fn(async () => ({ success: "added" }));
    mount(prepare, finalize);
    selectFile(file());

    const form = screen.getByRole("button", { name: messages.catalog.images.add }).closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button").textContent).toContain(messages.catalog.images.uploading);

    await act(async () => {
      resolvePrepare({
        ok: true,
        upload: { uploadId: UPLOAD_ID, path: PATH, token: "signed-token" },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("sukces czyści wybrany plik", async () => {
    const prepare = vi.fn(async () => ({
      ok: true as const,
      upload: { uploadId: UPLOAD_ID, path: PATH, token: "signed-token" },
    }));
    const finalize = vi.fn(async () => ({ success: "added" }));
    mount(prepare, finalize);
    const input = selectFile(file());

    fireEvent.click(screen.getByRole("button", { name: messages.catalog.images.add }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(messages.catalog.images.added);
    });
    const resetInput = screen.getByLabelText(
      messages.catalog.images.file,
    ) as HTMLInputElement;
    expect(resetInput).not.toBe(input);
    expect(resetInput.files).toHaveLength(0);
  });

  it("błąd zachowuje wybrany plik do ponowienia", async () => {
    const prepare = vi.fn(async () => ({ ok: false as const, error: "Odmowa." }));
    const finalize = vi.fn(async () => ({ success: "added" }));
    mount(prepare, finalize);
    const selected = file();
    const input = selectFile(selected);

    fireEvent.click(screen.getByRole("button", { name: messages.catalog.images.add }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Odmowa.");
    });
    expect(input.files?.[0]).toBe(selected);
    expect(finalize).not.toHaveBeenCalled();
  });

  it("nieoczekiwany wyjątek podczas wysyłki (np. brak env klienta przeglądarki) pokazuje błąd", async () => {
    const prepare = vi.fn(async () => ({
      ok: true as const,
      upload: { uploadId: UPLOAD_ID, path: PATH, token: "signed-token" },
    }));
    const finalize = vi.fn(async () => ({ success: "added" }));
    uploadMock.mockRejectedValue(new Error("Brak zmiennej środowiskowej NEXT_PUBLIC_SUPABASE_URL"));
    mount(prepare, finalize);
    selectFile(file());

    fireEvent.click(screen.getByRole("button", { name: messages.catalog.images.add }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(messages.catalog.images.errors.upload);
    });
    expect(finalize).not.toHaveBeenCalled();
  });
});
