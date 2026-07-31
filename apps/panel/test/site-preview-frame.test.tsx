// @vitest-environment jsdom

/**
 * PODGLĄD NA ŻYWO obok edytora (kreator A3) — kontrakt warstwy klienta.
 *
 * Podgląd jest OSOBNYM dokumentem w ramce (własny viewport → prawdziwe media
 * queries storefrontu), więc `router.refresh()` edytora go nie dotyka. Cały
 * mechanizm sprowadza się do jednej reguły, której pilnują te testy:
 *
 *   1. udany zapis sekcji przeładowuje ramkę — adres dostaje NOWY licznik
 *      zmian i sekcję do przewinięcia (`focus`), a element ramki jest nowy
 *      (zmiana `key`). Asercja idzie po adresie i tożsamości węzła, NIE po
 *      sztucznym zegarze: nie ma tu odpytywania, które trzeba by przeczekać;
 *   2. zmiana kolejności (i każda inna mutacja szkicu) też przeładowuje ramkę,
 *      ale BEZ `focus` — reorder nie dotyczy jednej sekcji;
 *   3. przełącznik szerokości zmienia szerokość ramki (viewport w ramce), a nie
 *      udaje innej przeglądarki;
 *   4. nieudany zapis NIE przeładowuje podglądu — ramka pokazywałaby wtedy
 *      stan, którego nie ma w bazie.
 *
 * Dowód mutacyjny (opis w raporcie): zdjęcie `refreshPreview()` z sygnału
 * zapisu w `site-editor.tsx` zapala testy 1 i 2 na czerwono.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorSection } from "@/app/[locale]/(panel)/strona/content";
import { SiteEditor } from "@/app/[locale]/(panel)/strona/site-editor";
import { PREVIEW_VIEWPORT_CLASS } from "@/app/[locale]/(panel)/strona/site-preview-frame";

import plMessages from "../messages/pl.json";

const refresh = vi.fn();
// Częściowy mock: podmieniamy WYŁĄCZNIE useRouter (chcemy widzieć refresh),
// reszta zostaje prawdziwa — next-intl buduje na niej nawigację locale.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const upsertSection = vi.fn(async () => ({ ok: true, sectionId: "new" }) as const);
const reorderSections = vi.fn(async () => ({ ok: true }) as const);
vi.mock("@/lib/actions/site", () => ({
  upsertSection: (...args: unknown[]) => upsertSection(...(args as [])),
  reorderSections: (...args: unknown[]) => reorderSections(...(args as [])),
  deleteSection: vi.fn(async () => ({ ok: true })),
  duplicateSection: vi.fn(async () => ({ ok: true })),
  publishSite: vi.fn(async () => ({ ok: true })),
  toggleSection: vi.fn(async () => ({ ok: true })),
  updateTemplate: vi.fn(async () => ({ ok: true })),
}));

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const HERO_ID = "11111111-1111-4111-8111-111111111111";
const FAQ_ID = "22222222-2222-4222-8222-222222222222";

const sections: EditorSection[] = [
  { id: HERO_ID, type: "hero", position: 0, enabled: true, content: { heading: "Sprzęt na już" } },
  { id: FAQ_ID, type: "freeform", position: 1, enabled: true, content: { heading: "O nas", body: "Treść." } },
];

function renderEditor() {
  render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteEditor
        siteId="99999999-9999-4999-8999-999999999999"
        template="classic"
        sections={sections}
        publishedAtLabel={null}
      />
    </NextIntlClientProvider>,
  );
}

/** Ramka podglądu — jeden element, po kotwicy z komponentu ramki. */
function frame(): HTMLIFrameElement {
  const element = document.querySelector("iframe[data-preview-frame]");
  if (!element) throw new Error("brak ramki podglądu");
  return element as HTMLIFrameElement;
}

/** Wiersz sekcji po widocznym nagłówku (numer · typ). */
function row(heading: string): HTMLElement {
  return screen.getByRole("heading", { name: heading }).closest("li") as HTMLElement;
}

describe("podgląd w ramce odświeża się sygnałem zapisu, bez odpytywania", () => {
  it("zapis sekcji przeładowuje ramkę i wskazuje ZAPISANĄ sekcję", async () => {
    renderEditor();
    const before = frame();
    expect(before.getAttribute("src")).toContain("v=0");
    expect(before.getAttribute("src")).not.toContain("focus=");

    fireEvent.click(
      within(row("01 · Baner (hero)")).getByRole("button", {
        name: plMessages.site.fields.saveSection,
      }),
    );

    await waitFor(() => {
      expect(frame().getAttribute("src")).toContain("v=1");
    });
    expect(upsertSection).toHaveBeenCalledTimes(1);
    expect(frame().getAttribute("src")).toContain(`focus=${HERO_ID}`);
    // Zmiana `key` — ramka jest NOWYM elementem, więc dokument ładuje się od
    // zera zamiast zostać z poprzednim renderem szkicu.
    expect(frame()).not.toBe(before);
  });

  it("zmiana kolejności też przeładowuje ramkę, ale bez skoku do sekcji", async () => {
    renderEditor();

    fireEvent.click(
      within(row("01 · Baner (hero)")).getByRole("button", {
        name: plMessages.site.sections.moveDown,
      }),
    );

    await waitFor(() => {
      expect(frame().getAttribute("src")).toContain("v=1");
    });
    expect(reorderSections).toHaveBeenCalledTimes(1);
    expect(frame().getAttribute("src")).not.toContain("focus=");
  });

  it("nieudany zapis NIE przeładowuje podglądu", async () => {
    upsertSection.mockResolvedValueOnce({ ok: false, error: "Nie udało się zapisać." } as never);
    renderEditor();

    fireEvent.click(
      within(row("01 · Baner (hero)")).getByRole("button", {
        name: plMessages.site.fields.saveSection,
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Nie udało się zapisać.");
    });
    expect(frame().getAttribute("src")).toContain("v=0");
  });
});

describe("przełącznik szerokości podglądu", () => {
  it("telefon zwęża ramkę do szerokości telefonu, komputer wraca do pełnej", () => {
    renderEditor();
    expect(frame().className).toContain(PREVIEW_VIEWPORT_CLASS.desktop);

    const viewport = screen.getByRole("group", { name: plMessages.site.preview.viewportLabel });
    fireEvent.click(within(viewport).getByRole("button", { name: plMessages.site.preview.viewport_mobile }));
    expect(frame().className).toContain(PREVIEW_VIEWPORT_CLASS.mobile);
    expect(frame().className).not.toContain(`${PREVIEW_VIEWPORT_CLASS.desktop} `);
    expect(PREVIEW_VIEWPORT_CLASS.mobile).not.toBe(PREVIEW_VIEWPORT_CLASS.desktop);

    fireEvent.click(within(viewport).getByRole("button", { name: plMessages.site.preview.viewport_desktop }));
    expect(frame().className).toContain(PREVIEW_VIEWPORT_CLASS.desktop);
  });

  it("zmiana szerokości nie przeładowuje ramki — to ten sam szkic", () => {
    renderEditor();
    const before = frame();
    const viewport = screen.getByRole("group", { name: plMessages.site.preview.viewportLabel });
    fireEvent.click(within(viewport).getByRole("button", { name: plMessages.site.preview.viewport_mobile }));

    expect(frame()).toBe(before);
    expect(frame().getAttribute("src")).toContain("v=0");
  });
});
