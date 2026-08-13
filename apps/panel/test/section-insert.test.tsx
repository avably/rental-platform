import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * WSTAWIANIE SEKCJI PICKEREM (E2) I PRZYPIĘTA STOPKA (K6, ADR-092).
 *
 * ===================== CO SIĘ ZMIENIŁO =====================
 *
 * Decyzja właściciela z grilla planu „Sekcje 2.0”: przeciąganie sekcji Z PALETY
 * jest WYCIĘTE. Klik w „+” między sekcjami to jedyna droga dodania i wskazuje
 * miejsce dokładnie; przeciąganie ISTNIEJĄCYCH sekcji (uchwyt, strzałki ↑↓)
 * zostaje bez zmian. Kontrakty wstawiania przeszły więc z gestu na picker.
 *
 * ===================== NA CZYM STOI TEN PLIK =====================
 *
 *   • MIEJSCE JEST KOTWICĄ, NIE INDEKSEM — „+” nad sekcją N+1 wysyła
 *     `insertBefore` z jej identyfikatorem, a nie liczbę. Asercje patrzą na
 *     TREŚĆ wywołania, nie na sam fakt dodania;
 *   • KLIENT NIE ZAPISUJE KOLEJNOŚCI przy dodawaniu — drugiego kroku nie ma,
 *     więc nie ma czego przegrać w wyścigu (dowód po stronie bazy:
 *     `site-order-race.test.ts`);
 *   • PRZYPIĘCIE STOPKI działa jak dotąd (brak miejsca pod nią, uchwyt i
 *     strzałki wyłączone, kafel niedostępny) — z kontrolami pozytywnymi;
 *   • ŚCIEŻKI DRAG-Z-PALETY NIE MA: wciśnięcie i ruch nad płótnem nie dodaje
 *     niczego. To jest kontrola NEGATYWNA do całego wycięcia.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

const STYL = DEFAULT_SITE_STYLE;

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
  if (!document.elementsFromPoint) {
    (document as Document & { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [];
  }
});

const actions = vi.hoisted(() => ({
  upsertSection: vi.fn(),
  reorderSections: vi.fn(),
  toggleSection: vi.fn(),
  duplicateSection: vi.fn(),
  deleteSection: vi.fn(),
  restoreSection: vi.fn(),
  updateStoreStyle: vi.fn(),
  applyStarterTemplate: vi.fn(),
  publishSite: vi.fn(),
}));

vi.mock("@/lib/actions/site", () => actions);
vi.mock("@/lib/actions/site-images", () => ({
  photoSearchAvailable: vi.fn(async () => false),
  searchPhotos: vi.fn(async () => ({ ok: true, photos: [] })),
  confirmPhotoChoice: vi.fn(async () => {}),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: () => {} }),
}));

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder");
const { sectionCanvasFrom, presetContentFor, structuredPresetFor, withStructuredLayout } =
  await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const HERO_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const CTA_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const FOOTER_ID = "cccccccc-3333-4333-8333-333333333333";
const NOWA_ID = "dddddddd-4444-4444-8444-444444444444";

const sec = plMessages.site.sections;

function sekcja(id: string, type: "hero" | "cta" | "footer", position: number): Section {
  return {
    id,
    type,
    position,
    enabled: true,
    content: sectionCanvasFrom(type, presetContentFor(type, "pl")),
  } as Section;
}

function renderBuilder(sections: Section[]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder siteId={SITE_ID} siteName="Strona sklepu" style={STYL} sections={sections} products={[]} money={{ currency: "PLN", locale: "pl" }} />
    </NextIntlClientProvider>,
  );
}

/** Otwiera picker z miejsca „+” o danym indeksie. */
function openPicker(container: HTMLElement, at: number): HTMLElement {
  const trigger = container.querySelector<HTMLElement>(`[data-insert-at="${at}"]`);
  expect(trigger, `brak miejsca wstawienia o indeksie ${at}`).not.toBeNull();
  fireEvent.click(trigger!);
  const dialog = document.querySelector<HTMLElement>("[data-section-picker]");
  expect(dialog, "picker się nie otworzył").not.toBeNull();
  return dialog!;
}

/** Wybiera typ w lewej kolumnie i klika PODGLĄD po prawej. */
function pick(dialog: HTMLElement, type: string, variant = "default") {
  fireEvent.click(dialog.querySelector<HTMLElement>(`[data-picker-type="${type}"]`)!);
  const add = dialog.querySelector<HTMLElement>(`[data-picker-add="${variant}"]`);
  expect(add, `picker nie pokazał podglądu wariantu ${variant} dla typu ${type}`).not.toBeNull();
  fireEvent.click(add!);
}

/** Argument ostatniego DODANIA sekcji (bez `sectionId` = wstawka, nie zapis treści). */
function lastInsert() {
  return actions.upsertSection.mock.calls
    .map(([arg]) => arg as { sectionId?: string; type: string; content: unknown; insertBefore?: string })
    .filter((arg) => !arg.sectionId)
    .at(-1);
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: NOWA_ID });
  actions.reorderSections.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("„+” wstawia DOKŁADNIE tam, gdzie kliknięto — miejscem jest sąsiad", () => {
  it("„+” między sekcjami N i N+1 kotwiczy nową sekcję na sekcji N+1", async () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0), sekcja(CTA_ID, "cta", 1)]);
    pick(openPicker(container, 1), "faq", "accordion");

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    expect(lastInsert()?.insertBefore, "kotwica nie wskazuje sekcji, nad którą stał „+”").toBe(CTA_ID);
    expect(lastInsert()?.type).toBe("faq");
  });

  it("„+” na samej górze kotwiczy na PIERWSZEJ sekcji", async () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0), sekcja(CTA_ID, "cta", 1)]);
    pick(openPicker(container, 0), "faq", "accordion");

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    expect(lastInsert()?.insertBefore).toBe(HERO_ID);
  });

  it("„+” pod ostatnią sekcją NIE MA kotwicy — to jest koniec strony", async () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0), sekcja(CTA_ID, "cta", 1)]);
    pick(openPicker(container, 2), "faq", "accordion");

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    expect(lastInsert()?.insertBefore, "koniec strony dostał kotwicę").toBeUndefined();
  });

  it("KLIENT NIE ZAPISUJE KOLEJNOŚCI przy dodawaniu — kroku drugiego nie ma", async () => {
    // Sedno przeniesienia niezmiennika na serwer: dopóki miejsce liczył klient,
    // dwa dodania w locie kończyły się sekcją nie tam, gdzie wskazał operator.
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0), sekcja(CTA_ID, "cta", 1)]);
    pick(openPicker(container, 1), "faq", "accordion");

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    expect(actions.reorderSections, "dodanie sekcji poszło drugim krokiem u klienta").not.toHaveBeenCalled();
  });

  it("paleta i pusta strona dodają NA KOŃCU (brak kotwicy)", async () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0)]);
    fireEvent.click(container.querySelector<HTMLElement>("[data-palette-add-section]")!);
    pick(document.querySelector<HTMLElement>("[data-section-picker]")!, "faq", "accordion");
    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    expect(lastInsert()?.insertBefore).toBeUndefined();

    cleanup();
    actions.upsertSection.mockClear();
    const pusta = renderBuilder([]);
    pick(openPicker(pusta.container, 0), "faq", "accordion");
    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    expect(lastInsert()?.insertBefore).toBeUndefined();
  });
});

describe("picker: typy po lewej, PODGLĄDY po prawej", () => {
  it("wariant układu wybrany w podglądzie ląduje w treści (typ strukturalny)", async () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0)]);
    const dialog = openPicker(container, 0);
    fireEvent.click(dialog.querySelector<HTMLElement>('[data-picker-type="faq"]')!);

    // Typ strukturalny pokazuje PO JEDNYM podglądzie na wariant układu — to jest
    // realny wybór operatora, a nie dwa odcienie tej samej sekcji.
    const warianty = [...dialog.querySelectorAll("[data-picker-add]")].map((node) =>
      node.getAttribute("data-picker-add"),
    );
    expect(warianty).toEqual(["accordion", "open-list"]);

    fireEvent.click(dialog.querySelector<HTMLElement>('[data-picker-add="open-list"]')!);
    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    expect(lastInsert()?.content, "wybrany wariant nie trafił do treści").toEqual(
      withStructuredLayout(structuredPresetFor("faq", "pl"), "open-list"),
    );
  });

  it("typ płótnowy ma JEDEN podgląd i wstawia preset płótna", async () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0)]);
    const dialog = openPicker(container, 0);
    /*
     * Typ PŁÓTNOWY, czyli taki, którego rejestr ADR-094 nie zna. Rola przechodzi
     * z typu na typ, w miarę jak rejestr rośnie: opinie do E6, atuty do E7,
     * teraz treść dowolna. Po E7 poza rejestrem zostają już tylko `hero`,
     * `freeform` i `footer` — sedno testu zostaje bez zmian.
     */
    fireEvent.click(dialog.querySelector<HTMLElement>('[data-picker-type="freeform"]')!);
    expect(dialog.querySelectorAll("[data-picker-add]").length).toBe(1);

    fireEvent.click(dialog.querySelector<HTMLElement>('[data-picker-add="default"]')!);
    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    expect(lastInsert()?.content).toEqual(
      sectionCanvasFrom("freeform", presetContentFor("freeform", "pl")),
    );
  });

  it("PODGLĄD POKAZUJE WYBRANY WARIANT, a nie zawsze ten sam", () => {
    /*
     * Bez tej asercji podgląd mógłby rysować preset domyślny pod KAŻDYM
     * wariantem — treść zapisu byłaby poprawna, a okno kłamałoby o wyglądzie.
     * Rozróżnienie jest behawioralne: układ „rozwijane odpowiedzi” montuje
     * przyciski accordionu (`aria-expanded`), „lista otwarta” nie ma czego
     * rozwijać i żadnego nie ma.
     */
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0)]);
    const dialog = openPicker(container, 0);
    fireEvent.click(dialog.querySelector<HTMLElement>('[data-picker-type="faq"]')!);

    const accordion = dialog.querySelector<HTMLElement>('[data-picker-add="accordion"]')!;
    const lista = dialog.querySelector<HTMLElement>('[data-picker-add="open-list"]')!;
    expect(
      accordion.querySelectorAll("[aria-expanded]").length,
      "podgląd wariantu „rozwijane odpowiedzi” nie zmontował accordionu",
    ).toBeGreaterThan(0);
    expect(
      lista.querySelectorAll("[aria-expanded]").length,
      "podgląd wariantu „lista otwarta” pokazuje accordion — okno kłamie o wyglądzie",
    ).toBe(0);
    // Kontrola pozytywna: oba pokazują TĘ SAMĄ treść, różni je wyłącznie układ.
    const pytanie = (structuredPresetFor("faq", "pl") as { items: { q: string }[] }).items[0]!.q;
    expect(accordion.textContent).toContain(pytanie);
    expect(lista.textContent).toContain(pytanie);
  });

  it("PODGLĄD JEST RENDEREM strony, a nie ikonką", () => {
    // Bez tego „podgląd” mógłby być pustym pudełkiem i nikt by tego nie zauważył
    // — a to jest cały powód, dla którego picker zastąpił listę kafli.
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0)]);
    const dialog = openPicker(container, 0);
    fireEvent.click(dialog.querySelector<HTMLElement>('[data-picker-type="faq"]')!);

    const podglad = dialog.querySelector<HTMLElement>('[data-picker-add="accordion"]')!;
    expect(podglad.querySelector(".site-root"), "podgląd bez korzenia strony").not.toBeNull();
    expect(
      podglad.textContent,
      "podgląd nie pokazuje treści, którą wstawi",
    ).toContain((structuredPresetFor("faq", "pl") as { items: { q: string }[] }).items[0]!.q);
  });

  it("okno mówi, GDZIE wstawi — i to zdanie zmienia się z miejscem", () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0), sekcja(CTA_ID, "cta", 1)]);
    expect(openPicker(container, 1).querySelector("[data-picker-target]")?.getAttribute("data-picker-target")).toBe(
      CTA_ID,
    );
    fireEvent.keyDown(document, { key: "Escape" });

    const koniec = openPicker(container, 2);
    expect(koniec.querySelector("[data-picker-target]")?.getAttribute("data-picker-target")).toBe("end");
  });
});

describe("świeża sekcja MIGA (E2)", () => {
  it("znacznik błysku wchodzi po udanym zapisie i gaśnie sam", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { container, rerender } = renderBuilder([sekcja(HERO_ID, "hero", 0)]);
      pick(openPicker(container, 0), "faq", "accordion");
      await vi.waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());

      // Sekcja wraca z serwera przy odświeżeniu RSC — w teście podajemy ją
      // propsami, dokładnie tak, jak zrobi to `router.refresh()`.
      const zNowa = [sekcja(HERO_ID, "hero", 0), sekcja(NOWA_ID, "cta", 1)];
      rerender(
        <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
          <SiteBuilder siteId={SITE_ID} siteName="Strona sklepu" style={STYL} sections={zNowa} products={[]} money={{ currency: "PLN", locale: "pl" }} />
        </NextIntlClientProvider>,
      );

      await vi.waitFor(() =>
        expect(
          container.querySelector(`[data-canvas-section="${NOWA_ID}"]`)?.getAttribute("data-section-flash"),
          "świeża sekcja nie mignęła",
        ).toBe("on"),
      );
      expect(
        container.querySelector(`[data-canvas-section="${HERO_ID}"]`)?.getAttribute("data-section-flash"),
        "mignęła sekcja, która nie jest nowa",
      ).toBeNull();

      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(
        container.querySelector(`[data-canvas-section="${NOWA_ID}"]`)?.getAttribute("data-section-flash"),
        "błysk został na stałe",
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("nieudany zapis NIE miga i zostawia komunikat", async () => {
    actions.upsertSection.mockResolvedValue({ ok: false, error: "Nie udało się." });
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0)]);
    pick(openPicker(container, 0), "faq", "accordion");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Nie udało się."));
    expect(container.querySelector("[data-section-flash]")).toBeNull();
  });
});

describe("stopka: przypięta do końca i jedyna na stronie", () => {
  function zeStopka() {
    return renderBuilder([
      sekcja(HERO_ID, "hero", 0),
      sekcja(CTA_ID, "cta", 1),
      sekcja(FOOTER_ID, "footer", 2),
    ]);
  }

  it("stopka nie ma czynnego uchwytu przeciągania ani strzałek", () => {
    const { container } = zeStopka();
    const node = container.querySelector<HTMLElement>(`[data-canvas-section="${FOOTER_ID}"]`)!;
    expect(node.getAttribute("data-section-pinned"), "stopka nieoznaczona jako przypięta").toBe("on");

    fireEvent.pointerDown(node);
    const toolbar = container.querySelector<HTMLElement>(`[data-section-toolbar="${FOOTER_ID}"]`)!;
    expect(toolbar, "pasek stopki nie wyszedł").not.toBeNull();
    expect(toolbar.querySelector<HTMLButtonElement>("[data-drag-handle]")!.disabled).toBe(true);
    expect(toolbar.querySelector<HTMLButtonElement>('[data-toolbar-action="move-up"]')!.disabled).toBe(true);
    expect(toolbar.querySelector<HTMLButtonElement>('[data-toolbar-action="move-down"]')!.disabled).toBe(true);
  });

  it("sekcja zwykła ma te same akcje CZYNNE (kontrola pozytywna)", () => {
    // Bez tej kontroli test wyżej przechodziłby także wtedy, gdyby pasek był
    // wyłączony dla wszystkich sekcji naraz.
    const { container } = zeStopka();
    fireEvent.pointerDown(container.querySelector<HTMLElement>(`[data-canvas-section="${CTA_ID}"]`)!);
    const toolbar = container.querySelector<HTMLElement>(`[data-section-toolbar="${CTA_ID}"]`)!;
    expect(toolbar.querySelector<HTMLButtonElement>("[data-drag-handle]")!.disabled).toBe(false);
    expect(toolbar.querySelector<HTMLButtonElement>('[data-toolbar-action="move-up"]')!.disabled).toBe(false);
  });

  it("pod stopką NIE MA miejsca wstawienia", () => {
    const { container } = zeStopka();
    const sloty = [...container.querySelectorAll("[data-insert-slot]")].map((node) =>
      Number(node.getAttribute("data-insert-slot")),
    );
    expect(sloty.length, "kontrola po pustym zbiorze: brak miejsc wstawienia").toBeGreaterThan(0);
    expect(Math.max(...sloty), "istnieje miejsce POD stopką").toBe(2);
  });

  it("strona BEZ stopki ma miejsce na samym końcu (kontrola pozytywna)", () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0), sekcja(CTA_ID, "cta", 1)]);
    const sloty = [...container.querySelectorAll("[data-insert-slot]")].map((node) =>
      Number(node.getAttribute("data-insert-slot")),
    );
    expect(Math.max(...sloty)).toBe(2);
  });

  it("typ stopki jest w pickerze WYŁĄCZONY, gdy strona już ją ma", () => {
    const { container } = zeStopka();
    const dialog = openPicker(container, 1);
    fireEvent.click(dialog.querySelector<HTMLElement>('[data-picker-type="footer"]')!);
    expect(dialog.querySelector("[data-picker-blocked]")?.textContent).toBe(sec.alreadyOnPage);
    expect(dialog.querySelector<HTMLButtonElement>("[data-picker-add]")!.disabled).toBe(true);
  });

  it("typ PRZYPIĘTY jest wyłączony w środku strony, a czynny na końcu", () => {
    // „+” w środku strony obiecuje miejsce; stopka i tak zjechałaby na koniec
    // (normalizacja serwera), więc kafel, który by to przepuścił, kłamałby.
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0), sekcja(CTA_ID, "cta", 1)]);
    const srodek = openPicker(container, 1);
    fireEvent.click(srodek.querySelector<HTMLElement>('[data-picker-type="footer"]')!);
    expect(srodek.querySelector("[data-picker-blocked]")?.textContent).toBe(
      plMessages.site.sectionPicker.pinnedOnlyAtEnd,
    );
    expect(srodek.querySelector<HTMLButtonElement>("[data-picker-add]")!.disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });

    const koniec = openPicker(container, 2);
    fireEvent.click(koniec.querySelector<HTMLElement>('[data-picker-type="footer"]')!);
    expect(koniec.querySelector("[data-picker-blocked]")).toBeNull();
    expect(koniec.querySelector<HTMLButtonElement>("[data-picker-add]")!.disabled).toBe(false);
  });
});

describe("po ścieżce drag-z-palety nie został ślad (kontrola negatywna)", () => {
  it("wciśnięcie i ruch nad płótnem nie dodaje sekcji", () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0)]);
    const wejscie = container.querySelector<HTMLElement>("[data-palette-add-section]")!;
    const canvas = container.querySelector<HTMLElement>("[data-builder-canvas]")!;
    const fromPoint = vi.spyOn(document, "elementsFromPoint").mockReturnValue([canvas]);

    fireEvent(
      wejscie,
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 5, isPrimary: true, button: 0, clientX: 40, clientY: 40 }),
    );
    fireEvent(
      wejscie,
      new PointerEvent("pointermove", { bubbles: true, pointerId: 5, isPrimary: true, button: 0, clientX: 400, clientY: 180 }),
    );
    fireEvent(
      wejscie,
      new PointerEvent("pointerup", { bubbles: true, pointerId: 5, isPrimary: true, button: 0, clientX: 400, clientY: 180 }),
    );

    expect(actions.upsertSection, "przeciągnięcie z palety wciąż coś dodaje").not.toHaveBeenCalled();
    expect(container.querySelector("[data-insert-slot][data-insert-active]")).toBeNull();
    fromPoint.mockRestore();
  });
});
