/**
 * ZNAK SKLEPU ZMNIEJSZA SIĘ PRZED WYSŁANIEM (S-46, audyt UX 2026-08-25).
 *
 * ===================== WADA, KTÓRĄ TEN PLIK ZAMYKA =====================
 *
 * Logo wgrane przez właściciela miało 3722 px wysokości i szło do Storage
 * w całości, a nagłówek sklepu PRELOADUJE je na każdej stronie i skaluje do
 * kilkudziesięciu pikseli. Klient pobierał megabajty, żeby ich natychmiast nie
 * użyć. Do tego plik większy niż 512 KiB odbijał się od kontroli wstępnej —
 * choć po zmniejszeniu waży kilkadziesiąt kilobajtów.
 *
 * ===================== CO JEST MIERZONE =====================
 *
 *   1. REGUŁA (`logoResizePlan`) — funkcja czysta: kiedy zmniejszać, do czego
 *      i z zachowaniem proporcji. Razem z kontrolą negatywną (mały plik zostaje
 *      nietknięty), bo reguła, która „zmniejsza zawsze", psuje gotowe znaki;
 *   2. KOLEJNOŚĆ KONTROLI w `runTenantLogoUpload` — na serwer idzie WYNIK
 *      zmniejszenia, a sufit rozmiaru mierzy właśnie jego. Zmniejszenie jest
 *      wstrzykiwane, bo `canvas` nie istnieje w jsdom;
 *   3. ZMNIEJSZENIE NIE JEST BRAMKĄ — jego awaria zostawia oryginał i upload
 *      idzie dalej.
 */
import { describe, expect, it, vi } from "vitest";

import { LOGO_MAX_HEIGHT_PX, logoResizePlan } from "@/lib/image-downscale";
import { runTenantLogoUpload } from "@/app/[locale]/(panel)/strona/logo-flow";
import { MAX_SITE_LOGO_BYTES } from "@/lib/tenant-logo";

describe("logoResizePlan: reguła zmniejszania", () => {
  it("obraz niższy niż sufit zostaje NIETKNIĘTY", () => {
    expect(logoResizePlan(800, LOGO_MAX_HEIGHT_PX)).toBeNull();
    expect(logoResizePlan(120, 40)).toBeNull();
  });

  it("obraz wyższy niż sufit schodzi DO sufitu, z zachowaniem proporcji", () => {
    // Przypadek właściciela: PNG 3722 px wysokości.
    const plan = logoResizePlan(3722, 3722)!;
    expect(plan.height).toBe(LOGO_MAX_HEIGHT_PX);
    expect(plan.width).toBe(LOGO_MAX_HEIGHT_PX);

    const poziome = logoResizePlan(4000, 1000)!;
    expect(poziome.height).toBe(LOGO_MAX_HEIGHT_PX);
    expect(poziome.width / poziome.height).toBeCloseTo(4, 5);
  });

  it("skrajnie wąski, wysoki plik nie dostaje zerowej szerokości", () => {
    expect(logoResizePlan(1, 5_000)!.width).toBeGreaterThanOrEqual(1);
  });

  it("wymiary bez sensu nie dają planu (dekoder oddał śmieć)", () => {
    expect(logoResizePlan(0, 0)).toBeNull();
    expect(logoResizePlan(Number.NaN, 100)).toBeNull();
  });
});

/* ====================== PRZEBIEG UPLOADU ====================== */

function plik(name: string, type: string, size: number): File {
  const file = new File([new Uint8Array(1)], name, { type });
  // `File` w jsdom liczy rozmiar z zawartości — podmieniamy go, bo test mówi
  // o megabajtach, a alokowanie ich w pamięci niczego by nie dowiodło.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

type UploadInput = { path: string; token: string; file: File; contentType: string };

function deps(overrides: Record<string, unknown> = {}) {
  return {
    prepare: vi.fn(async (_input: { mime: string; size: number }) => ({
      ok: true as const,
      upload: { path: "tenant/logo.webp", token: "t", uploadId: "u" },
    })),
    upload: vi.fn(async (_input: UploadInput) => ({ error: null as string | null })),
    finalize: vi.fn(async (_uploadId: string) => ({ ok: true as const, path: "tenant/logo.webp" })),
    message: (problem: string) => `problem:${problem}`,
    ...overrides,
  };
}

describe("runTenantLogoUpload: na serwer idzie WYNIK zmniejszenia", () => {
  it("plik większy niż sufit przechodzi, bo mierzony jest wynik", async () => {
    const oryginal = plik("logo.png", "image/png", MAX_SITE_LOGO_BYTES * 6);
    const maly = plik("logo.webp", "image/webp", 40_000);
    const resize = vi.fn(async () => maly);
    const d = deps({ resize });

    const outcome = await runTenantLogoUpload(oryginal, d);

    expect(outcome.ok, `upload odrzucony: ${!outcome.ok && outcome.error}`).toBe(true);
    expect(resize).toHaveBeenCalledWith(oryginal);
    // Bilet i bajty dotyczą WYNIKU, nie oryginału — inaczej Storage dostałby
    // ścieżkę pod jeden typ, a plik pod drugi.
    expect(d.prepare).toHaveBeenCalledWith({ mime: "image/webp", size: 40_000 });
    expect(d.upload.mock.calls[0]![0].file).toBe(maly);
    expect(d.upload.mock.calls[0]![0].contentType).toBe("image/webp");
  });

  it("KONTROLA NEGATYWNA: gdy zmniejszenie oddaje oryginał, jedzie oryginał", async () => {
    const oryginal = plik("logo.png", "image/png", 30_000);
    const d = deps({ resize: async (file: File) => file });

    await runTenantLogoUpload(oryginal, d);

    expect(d.prepare).toHaveBeenCalledWith({ mime: "image/png", size: 30_000 });
    expect(d.upload.mock.calls[0]![0].file).toBe(oryginal);
  });

  it("awaria zmniejszenia NIE wywraca uploadu — jedzie oryginał", async () => {
    const oryginal = plik("logo.png", "image/png", 30_000);
    const d = deps({
      resize: async () => {
        throw new Error("brak createImageBitmap");
      },
    });

    const outcome = await runTenantLogoUpload(oryginal, d);

    expect(outcome.ok).toBe(true);
    expect(d.upload.mock.calls[0]![0].file).toBe(oryginal);
  });

  it("plik spoza allowlisty pada PRZED dekoderem", async () => {
    const resize = vi.fn(async (file: File) => file);
    const d = deps({ resize });
    const outcome = await runTenantLogoUpload(plik("logo.svg", "image/svg+xml", 1_000), d);

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toBe("problem:type");
    expect(resize, "nie-obraz poszedł do dekodera").not.toHaveBeenCalled();
    expect(d.prepare).not.toHaveBeenCalled();
  });

  it("pusty plik pada od razu", async () => {
    const d = deps();
    const outcome = await runTenantLogoUpload(plik("logo.png", "image/png", 0), d);
    expect(!outcome.ok && outcome.error).toBe("problem:empty");
    expect(d.prepare).not.toHaveBeenCalled();
  });

  it("wynik DALEJ za duży kończy się odmową o rozmiarze", async () => {
    const wielki = plik("logo.png", "image/png", MAX_SITE_LOGO_BYTES * 3);
    const d = deps({ resize: async (file: File) => file });
    const outcome = await runTenantLogoUpload(wielki, d);

    expect(!outcome.ok && outcome.error).toBe("problem:size");
    expect(d.prepare).not.toHaveBeenCalled();
  });
});
