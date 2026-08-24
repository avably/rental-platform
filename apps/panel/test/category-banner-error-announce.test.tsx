// @vitest-environment jsdom

/**
 * BŁĄD BANERA KATEGORII JEST OGŁASZANY PRZEZ CZYTNIK EKRANU (a11y, audyt
 * przedlaunchowy, ADR-265).
 *
 * Pole banera (`CategoryBannerField` w category-form.tsx) ma DWA widoki, a błąd
 * uploadu może paść w KAŻDYM z nich — i w każdym musi trafić do `role="alert"`,
 * inaczej użytkownik czytnika nie dowie się, że wgranie się nie powiodło:
 *
 *   1. STAN PUSTY (bez banera) — błąd niesie `FileField`, który renderuje go w
 *      `role="alert"` (dowód jednostkowy pola: packages/ui …/file-field.test.tsx);
 *      tu pilnujemy, że ścieżka pola banera faktycznie ten błąd pokazuje.
 *   2. STAN „BANER USTAWIONY" — miniatura nie ma miejsca na błąd pod polem, więc
 *      komunikat idzie osobnym akapitem. PRZED poprawką był to goły `<p>` (bez
 *      roli), więc czytnik go nie ogłaszał; po poprawce przechodzi przez helper
 *      `FieldError` (ADR-057), który nadaje `role="alert"`.
 *
 * Dowód mutacyjny (opis w raporcie): zamiana `<FieldError …/>` z powrotem na
 * goły `<p>` bez `role="alert"` w stanie „ustawiony" → test 2 czerwony
 * (`getByRole("alert")` nie znajduje komunikatu), test 1 nadal zielony (jego
 * błąd niesie `FileField`).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CategoryForm } from "@/app/[locale]/(panel)/katalog/kategorie/category-form";
import { setCategoryImageAction } from "@/app/[locale]/(panel)/katalog/kategorie/category-image-actions";
import { runCategoryImageUpload } from "@/app/[locale]/(panel)/katalog/kategorie/category-image-flow";
import type { FormState } from "@/lib/form-state";

import plMessages from "../messages/pl.json";

// Akcje serwerowe i przepływ uploadu podmieniamy — test jest o WARSTWIE UI
// (ogłaszanie błędu), nie o rozmowie z bazą/Storage.
vi.mock("@/app/[locale]/(panel)/katalog/kategorie/category-image-actions", () => ({
  prepareCategoryImageUploadAction: vi.fn(),
  finalizeCategoryImageUploadAction: vi.fn(),
  setCategoryImageAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(panel)/katalog/kategorie/category-image-flow", () => ({
  uploadCategoryBannerToSignedUrl: vi.fn(),
  runCategoryImageUpload: vi.fn(),
}));

const messages = { catalog: { categories: plMessages.catalog.categories } };
const noopAction = async (_p: FormState, _f: FormData): Promise<FormState> => ({});

function renderForm(bannerPath: string | null) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <CategoryForm
        action={noopAction}
        defaults={{ name: "", slug: "", description: "" }}
        submitLabel="Zapisz"
        isNew={false}
        categoryId="kat-1"
        bannerPath={bannerPath}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("CategoryBannerField — błąd uploadu ogłaszany w role=alert", () => {
  it("STAN PUSTY: nieudany upload pokazuje błąd w role=alert (przez FileField)", async () => {
    const komunikat = "Baner może mieć najwyżej 5 MB.";
    vi.mocked(runCategoryImageUpload).mockResolvedValue({ ok: false, error: komunikat });

    const { container } = renderForm(null);
    // W stanie pustym pole banera to strefa FileField z natywnym <input type=file>.
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    const plik = new File(["x"], "baner.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [plik] } });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(komunikat);
  });

  it("STAN „BANER USTAWIONY”: nieudany zapis pokazuje błąd w role=alert", async () => {
    const komunikat = "Nie udało się zapisać banera kategorii.";
    vi.mocked(setCategoryImageAction).mockResolvedValue({ ok: false, error: komunikat });

    renderForm("kat-1/baner.jpg");
    // Sekcja banera jest w stanie „ustawiony” — miniatura + „Zmień”/„Usuń”.
    const sekcja = document.querySelector("[data-category-banner]") as HTMLElement;
    expect(sekcja.getAttribute("data-category-banner-state")).toBe("set");

    // Klik „Usuń” woła (podmienioną) akcję, która zawraca błąd.
    fireEvent.click(screen.getByRole("button", { name: "Usuń" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(komunikat);
    // Błąd żyje W SEKCJI banera (a nie np. jako błąd formularza pól).
    expect(sekcja.contains(alert)).toBe(true);
    // Stan sekcji się nie zmienił — baner dalej „ustawiony”, błąd jest OBOK.
    expect(sekcja.getAttribute("data-category-banner-state")).toBe("set");
  });
});
