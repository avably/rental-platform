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

// `useRouter` z i18n woła `refresh` po zakończeniu wysyłki — w jsdom nie ma
// routera Next, więc podstawiamy atrapę, żeby komponent się nie wywrócił.
const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("@/i18n/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/navigation")>();
  return { ...actual, useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn() }) };
});

const { MultiUploadImageForm } = await import(
  "@/app/[locale]/(panel)/katalog/[id]/zdjecia/photo-forms"
);

const images = messages.catalog.images;

function file(name = "photo.png"): File {
  return new File([PNG], name, { type: "image/png" });
}

type Prepare = (input: { mime: string; size: number }) => Promise<
  { ok: true; upload: { uploadId: string; path: string; token: string } } | { ok: false; error: string }
>;
type Finalize = (uploadId: string) => Promise<{ success?: string; formError?: string }>;

function mount(prepare: Prepare, finalize: Finalize) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <MultiUploadImageForm prepare={prepare} finalize={finalize} />
    </NextIntlClientProvider>,
  );
}

function selectFiles(selected: File[]): HTMLInputElement {
  const input = screen.getByLabelText(images.multiPrompt) as HTMLInputElement;
  fireEvent.change(input, { target: { files: selected } });
  return input;
}

const okPrepare: Prepare = async () => ({
  ok: true as const,
  upload: { uploadId: UPLOAD_ID, path: PATH, token: "signed-token" },
});

beforeEach(() => {
  uploadMock.mockReset();
  uploadMock.mockResolvedValue({ error: null });
  refreshMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MultiUploadImageForm — wielo-upload (uwaga właściciela #1)", () => {
  it("wybór wielu plików naraz kolejkuje każdy z nich", () => {
    mount(okPrepare, async () => ({ success: "added" }));
    selectFiles([file("a.png"), file("b.png"), file("c.png")]);

    const queue = screen.getByRole("list");
    expect(queue.querySelectorAll("li")).toHaveLength(3);
    expect(screen.getByText("a.png")).toBeTruthy();
    expect(screen.getByText("c.png")).toBeTruthy();
  });

  it("wgrywa WSZYSTKIE zakolejkowane pliki jednym kliknięciem", async () => {
    const prepare = vi.fn(okPrepare);
    const finalize = vi.fn(async () => ({ success: "added" }));
    mount(prepare, finalize);
    selectFiles([file("a.png"), file("b.png")]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: images.uploadSelected }));
    });

    await waitFor(() => {
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(finalize).toHaveBeenCalledTimes(2);
    });
    // Podsumowanie „Wgrano 2 z 2" pojawia się po zakończeniu obu wysyłek.
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("2");
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("plik z odmową zostaje w błędzie i da się go ponowić razem z kolejnymi", async () => {
    // Pierwszy plik odrzucony na etapie biletu, drugi przyjęty.
    const prepare = vi
      .fn<Prepare>()
      .mockResolvedValueOnce({ ok: false, error: "Odmowa." })
      .mockResolvedValue({
        ok: true,
        upload: { uploadId: UPLOAD_ID, path: PATH, token: "signed-token" },
      });
    const finalize = vi.fn(async () => ({ success: "added" }));
    mount(prepare, finalize);
    selectFiles([file("zly.png"), file("dobry.png")]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: images.uploadSelected }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Odmowa.");
    });
    // Drugi plik przeszedł — finalize dotknął tylko jego.
    expect(finalize).toHaveBeenCalledTimes(1);

    // Ponowienie: przycisk znów aktywny (jest jeszcze plik w stanie błędu),
    // kolejne kliknięcie próbuje wysłać zaległy plik raz jeszcze.
    prepare.mockResolvedValue({
      ok: true,
      upload: { uploadId: UPLOAD_ID, path: PATH, token: "signed-token" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: images.uploadSelected }));
    });
    await waitFor(() => {
      expect(finalize).toHaveBeenCalledTimes(2);
    });
  });

  it("nieoczekiwany wyjątek wysyłki pokazuje błąd pliku, nie wywraca formularza", async () => {
    uploadMock.mockRejectedValue(new Error("Brak zmiennej NEXT_PUBLIC_SUPABASE_URL"));
    const finalize = vi.fn(async () => ({ success: "added" }));
    mount(okPrepare, finalize);
    selectFiles([file("a.png")]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: images.uploadSelected }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(images.errors.upload);
    });
    expect(finalize).not.toHaveBeenCalled();
  });
});
