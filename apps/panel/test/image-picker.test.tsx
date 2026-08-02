// @vitest-environment jsdom

/**
 * PICKER ZDJĘCIA — DWIE KARTY, DWA ŚWIATY (K3, ADR-086).
 *
 * Picker jest miejscem, w którym spotykają się nasz bucket i cudzy host, więc
 * broni tu trzech rzeczy naraz i każda potrafi zepsuć się cicho:
 *
 *   1. FAIL-SAFE — bez klucza dostawcy karta wyszukiwarki ma być UKRYTA, a nie
 *      zepsuta. Brak klucza to normalny stan wdrożenia, nie awaria;
 *   2. WARUNKI LICENCJI — atrybucja autora jest widoczna JUŻ NA LIŚCIE, a
 *      wyzwalacz pobrania leci przy WYBORZE zdjęcia, zanim adres wróci do
 *      płótna. Jedno i drugie jest wymogiem, a nie miłym dodatkiem;
 *   3. JEDEN TOR UPLOADU — karta „Wgraj" jedzie istniejącymi biletami
 *      (ADR-082), a nie drugim kanałem zbudowanym obok.
 *
 * Dostępność karty rozstrzyga SERWER (klucz nigdy nie schodzi do przeglądarki),
 * więc w testach sterujemy nią mockiem akcji — dokładnie tak, jak robi to
 * prawdziwy komponent.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

const images = vi.hoisted(() => ({
  photoSearchAvailable: vi.fn(async () => true),
  searchPhotos: vi.fn(),
  confirmPhotoChoice: vi.fn(async () => {}),
}));
const uploads = vi.hoisted(() => ({
  prepareSiteImageUploadAction: vi.fn(),
  finalizeSiteImageUploadAction: vi.fn(),
}));

vi.mock("@/lib/actions/site-images", () => images);
vi.mock("@/app/[locale]/(panel)/strona/upload-actions", () => uploads);
/*
 * Podmieniamy WYŁĄCZNIE transfer bajtów (wymaga klienta przeglądarki i env
 * Supabase). Orkiestracja biletu — przygotowanie, wysyłka, finalizacja —
 * zostaje PRAWDZIWA, bo to jej właśnie dowodzi ten plik: picker nie ma
 * własnego kanału uploadu, tylko woła tor z ADR-082.
 */
vi.mock("@/app/[locale]/(panel)/strona/upload-flow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[locale]/(panel)/strona/upload-flow")>()),
  uploadSiteImageToSignedUrl: vi.fn(async () => ({ error: null })),
}));

const { ImagePicker } = await import("@/app/[locale]/(kreator)/strona/kreator/image-picker");

const PHOTO = {
  id: "abc",
  thumbUrl: "https://images.example.com/thumb.jpg",
  url: "https://images.example.com/photo.jpg",
  alt: "Koparka na budowie",
  authorName: "Jan Kowalski",
  authorUrl: "https://example.com/@jan?utm_source=avably&utm_medium=referral",
  downloadLocation: "https://api.unsplash.com/photos/abc/download",
};

function renderPicker(onPick = vi.fn()) {
  const result = render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <ImagePicker siteId="site-1" open onClose={() => {}} onPick={onPick} />
    </NextIntlClientProvider>,
  );
  return { ...result, onPick };
}

beforeEach(() => {
  images.photoSearchAvailable.mockReset().mockResolvedValue(true);
  images.searchPhotos.mockReset().mockResolvedValue({ ok: true, photos: [PHOTO] });
  images.confirmPhotoChoice.mockReset().mockResolvedValue(undefined);
  uploads.prepareSiteImageUploadAction.mockReset();
  uploads.finalizeSiteImageUploadAction.mockReset();
});

afterEach(cleanup);

describe("fail-safe: karta wyszukiwarki bez klucza", () => {
  it("BEZ klucza karty wyszukiwarki NIE MA — zostaje sam upload", async () => {
    images.photoSearchAvailable.mockResolvedValue(false);
    const { baseElement } = renderPicker();

    await waitFor(() => expect(images.photoSearchAvailable).toHaveBeenCalled());
    expect(baseElement.querySelector('[data-picker-tab="search"]'), "karta wyszukiwarki bez klucza").toBeNull();
    // Picker nadal działa: upload jest widoczny, a nie zablokowany komunikatem.
    expect(baseElement.querySelector("[data-picker-upload]")).not.toBeNull();
  });

  it("Z kluczem karta jest dostępna i przełącza widok", async () => {
    const { baseElement } = renderPicker();
    const tab = await waitFor(() => {
      const node = baseElement.querySelector<HTMLElement>('[data-picker-tab="search"]');
      expect(node, "karta wyszukiwarki nie pojawiła się mimo klucza").not.toBeNull();
      return node!;
    });

    expect(baseElement.querySelector("[data-picker-upload]")).not.toBeNull();
    fireEvent.click(tab);
    expect(baseElement.querySelector("[data-picker-search]")).not.toBeNull();
    expect(baseElement.querySelector("[data-picker-upload]")).toBeNull();
  });

  it("o dostępności decyduje SERWER — klient nie czyta żadnej zmiennej", async () => {
    // Gdyby dostępność liczyła się z `NEXT_PUBLIC_*`, klucz (albo jego
    // obecność) byłby wpieczony w bundel przeglądarki.
    renderPicker();
    await waitFor(() => expect(images.photoSearchAvailable).toHaveBeenCalled());
  });
});

describe("warunki licencji", () => {
  it("atrybucja autora jest widoczna JUŻ NA LIŚCIE wyników", async () => {
    const { baseElement } = renderPicker();
    fireEvent.click(await screen.findByRole("tab", { name: plMessages.site.picker.tabSearch }));
    fireEvent.change(screen.getByLabelText(plMessages.site.picker.searchLabel), {
      target: { value: "koparka" },
    });
    fireEvent.click(baseElement.querySelector<HTMLElement>("[data-picker-search-run]")!);

    const author = await waitFor(() => {
      const node = baseElement.querySelector("[data-picker-photo-author]");
      expect(node, "wynik bez podpisu autora").not.toBeNull();
      return node!;
    });
    expect(author.textContent).toContain("Jan Kowalski");
  });

  it("wybór zdjęcia woła WYZWALACZ POBRANIA, zanim adres wróci do płótna", async () => {
    const order: string[] = [];
    images.confirmPhotoChoice.mockImplementation(async () => {
      order.push("download");
    });
    const onPick = vi.fn(() => {
      order.push("pick");
    });

    const { baseElement } = renderPicker(onPick);
    fireEvent.click(await screen.findByRole("tab", { name: plMessages.site.picker.tabSearch }));
    fireEvent.change(screen.getByLabelText(plMessages.site.picker.searchLabel), {
      target: { value: "koparka" },
    });
    fireEvent.click(baseElement.querySelector<HTMLElement>("[data-picker-search-run]")!);

    const tile = await waitFor(() => {
      const node = baseElement.querySelector<HTMLElement>(`[data-picker-photo="${PHOTO.id}"]`);
      expect(node).not.toBeNull();
      return node!;
    });
    fireEvent.click(tile);

    expect(images.confirmPhotoChoice).toHaveBeenCalledWith(PHOTO.downloadLocation);
    expect(order, "wyzwalacz pobrania poszedł PO oddaniu adresu").toEqual(["download", "pick"]);
  });

  it("wybrane zdjęcie oddaje KOMPLET atrybucji, nie sam adres", async () => {
    const { baseElement, onPick } = renderPicker();
    fireEvent.click(await screen.findByRole("tab", { name: plMessages.site.picker.tabSearch }));
    fireEvent.change(screen.getByLabelText(plMessages.site.picker.searchLabel), {
      target: { value: "koparka" },
    });
    fireEvent.click(baseElement.querySelector<HTMLElement>("[data-picker-search-run]")!);
    const tile = await waitFor(() => {
      const node = baseElement.querySelector<HTMLElement>(`[data-picker-photo="${PHOTO.id}"]`);
      expect(node).not.toBeNull();
      return node!;
    });
    fireEvent.click(tile);

    expect(onPick).toHaveBeenCalledWith(
      {
        kind: "unsplash",
        url: PHOTO.url,
        authorName: PHOTO.authorName,
        authorUrl: PHOTO.authorUrl,
        downloadLocation: PHOTO.downloadLocation,
      },
      PHOTO.alt,
    );
  });

  it("odmowa wyszukiwania pokazuje komunikat, a nie pustą siatkę", async () => {
    images.searchPhotos.mockResolvedValue({ ok: false, error: "Nie udało się pobrać zdjęć." });
    const { baseElement } = renderPicker();
    fireEvent.click(await screen.findByRole("tab", { name: plMessages.site.picker.tabSearch }));
    fireEvent.change(screen.getByLabelText(plMessages.site.picker.searchLabel), {
      target: { value: "koparka" },
    });
    fireEvent.click(baseElement.querySelector<HTMLElement>("[data-picker-search-run]")!);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("karta Wgraj jedzie ISTNIEJACYM torem biletow", () => {
  it("wybór pliku uruchamia bilet uploadu, a po finalizacji oddaje ŚCIEŻKĘ Storage", async () => {
    // Sedno: picker nie ma własnego kanału wysyłki. Woła te same akcje, co
    // pole zdjęcia sekcji (ADR-082) — przygotowanie biletu i finalizację.
    uploads.prepareSiteImageUploadAction.mockResolvedValue({
      ok: true,
      upload: { path: "tenant/nowe.jpg", token: "tok", uploadId: "up-1" },
    });
    uploads.finalizeSiteImageUploadAction.mockResolvedValue({ ok: true, path: "tenant/nowe.jpg" });

    const { baseElement, onPick } = renderPicker();
    const input = baseElement.querySelector<HTMLInputElement>("[data-picker-upload] input[type=file]")!;
    const file = new File(["x"], "koparka gasienicowa.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);

    await waitFor(() => expect(uploads.prepareSiteImageUploadAction).toHaveBeenCalled());
    // Bilet jest wystawiany DLA TEJ strony — bez `siteId` upload trafiłby donikąd.
    expect(uploads.prepareSiteImageUploadAction.mock.calls[0]![0]).toBe("site-1");

    await waitFor(() => expect(onPick).toHaveBeenCalled());
    const [source, alt] = onPick.mock.calls[0]!;
    expect(source).toEqual({ kind: "storage", path: "tenant/nowe.jpg" });
    // Opis alternatywny podpowiadany z nazwy pliku — a11y bez pustki.
    expect(alt).toBe("koparka gasienicowa");
  });

  it("odmowa biletu zostaje komunikatem — bez wstawiania zdjęcia", async () => {
    uploads.prepareSiteImageUploadAction.mockResolvedValue({ ok: false, error: "Za duży plik." });

    const { baseElement, onPick } = renderPicker();
    const input = baseElement.querySelector<HTMLInputElement>("[data-picker-upload] input[type=file]")!;
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "a.jpg", { type: "image/jpeg" })],
    });
    fireEvent.change(input);

    await waitFor(() => expect(uploads.prepareSiteImageUploadAction).toHaveBeenCalled());
    expect(onPick).not.toHaveBeenCalled();
  });
});
