import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * PASKI AKCJI KREATORA SĄ IKONAMI — I NADAL DAJĄ SIĘ PRZECZYTAĆ (K3, ADR-086).
 *
 * Decyzja właściciela (2026-08-01): pasek sekcji i pasek elementu mają nieść
 * ikony, nie napisy — sześć napisów nad sekcją zasłaniało to, czego dotyczą.
 * Zamiana napisu na ikonę USUWA jednak jedyną rzecz, która mówiła, co przycisk
 * robi: dla czytnika ekranu, dla wyszukiwania po tekście i dla operatora, który
 * widzi symbol pierwszy raz.
 *
 * Ten kontrakt pilnuje, żeby znaczenie nie zniknęło razem z napisem. Iteruje
 * WSZYSTKIE akcje obu pasków (a nie wybrane) i wymaga od każdej dostępnej
 * nazwy — więc akcja dołożona bez etykiety zapala test, zamiast wejść po cichu.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

/** Styl szkicu w motywie zastanym — dokładnie to, czym strona jest bez wyboru. */
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
  // jsdom nie implementuje `elementsFromPoint` — silnik upuszczania pyta nim
  // o płótno pod kursorem, więc podstawiamy atrapę do szpiegowania.
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
  updateSiteStyle: vi.fn(),
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
const { sectionCanvasFrom, presetContentFor } = await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const SECTION_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const sec = plMessages.site.sections;
const els = plMessages.site.elements;

function heroSection(): Section {
  return {
    id: SECTION_ID,
    type: "hero",
    position: 0,
    enabled: true,
    content: sectionCanvasFrom("hero", presetContentFor("hero", "pl")),
  } as Section;
}

function renderBuilder(sections: Section[] = [heroSection()]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder siteId={SITE_ID} siteName="Strona sklepu" style={STYL} sections={sections} products={[]} />
    </NextIntlClientProvider>,
  );
}

/** Odsłania pasek sekcji — dokładnie tak, jak robi to kursor. */
function sectionToolbar(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-canvas-section="${SECTION_ID}"]`)!;
  fireEvent.mouseEnter(node);
  const toolbar = container.querySelector<HTMLElement>(`[data-section-toolbar="${SECTION_ID}"]`);
  expect(toolbar, "pasek sekcji nie wyszedł").not.toBeNull();
  return toolbar!;
}

/** Zaznacza pierwszy element — przy nim pasek sekcji dostaje akcje elementu. */
function selectFirstElement(container: HTMLElement) {
  const frame = container.querySelector<HTMLElement>("[data-element-frame]")!;
  fireEvent.pointerDown(frame, { clientX: 10, clientY: 10 });
  fireEvent.pointerUp(frame, { clientX: 10, clientY: 10 });
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: SECTION_ID });
});

afterEach(cleanup);

describe("pasek sekcji: ikony z etykietami", () => {
  it("KAŻDA akcja paska ma dostępną nazwę", () => {
    const { container } = renderBuilder();
    const toolbar = sectionToolbar(container);
    const buttons = [...toolbar.querySelectorAll("[data-toolbar-action]")];

    // Kontrola po pustym zbiorze: gdyby selektor przestał cokolwiek znajdować,
    // pętla niżej broniłaby niczego.
    expect(buttons.length, "pasek sekcji bez akcji").toBeGreaterThanOrEqual(6);
    for (const button of buttons) {
      const label = button.getAttribute("aria-label");
      expect(label, `akcja ${button.getAttribute("data-toolbar-action")} bez etykiety`).toBeTruthy();
      expect(label!.trim().length).toBeGreaterThan(2);
    }
  });

  it("akcje są IKONAMI — nie niosą własnego napisu", () => {
    // Sedno decyzji właściciela: gdyby ktoś wrócił do napisów, pasek znowu
    // zasłoniłby sekcję. Napis mieszka w etykiecie i w tooltipie, nie w treści.
    const { container } = renderBuilder();
    for (const button of sectionToolbar(container).querySelectorAll("[data-toolbar-action]")) {
      expect(button.textContent?.trim(), "akcja paska wróciła do napisu").toBe("");
      expect(button.querySelector("svg"), "akcja paska bez ikony").not.toBeNull();
    }
  });

  it("komplet akcji sekcji jest na miejscu", () => {
    const { container } = renderBuilder();
    const toolbar = sectionToolbar(container);
    for (const label of [sec.moveUp, sec.moveDown, sec.disable, sec.duplicate, sec.remove]) {
      expect(within(toolbar).getByRole("button", { name: label }), `brak akcji ${label}`).toBeTruthy();
    }
    expect(within(toolbar).getByRole("button", { name: plMessages.site.builder.settings })).toBeTruthy();
  });

  it("USUNIĘCIE zostaje destrukcyjne i nadal pyta o potwierdzenie", () => {
    // Zamiana napisu na ikonę nie może po cichu zdjąć bariery: pasek wychodzi
    // od samego najechania, więc pomyłka jest tu łatwiejsza niż gdziekolwiek.
    const { container } = renderBuilder();
    const remove = within(sectionToolbar(container)).getByRole("button", { name: sec.remove });
    fireEvent.click(remove);
    expect(actions.deleteSection, "usunięcie poszło bez potwierdzenia").not.toHaveBeenCalled();
    expect(screen.getByText(sec.confirmRemoveTitle)).toBeTruthy();
  });
});

describe("pasek elementu: ikony z etykietami", () => {
  it("KAŻDA akcja elementu ma dostępną nazwę i ikonę", () => {
    const { container } = renderBuilder();
    selectFirstElement(container);
    const bar = container.querySelector<HTMLElement>("[data-element-actions]");
    expect(bar, "pasek akcji elementu nie wyszedł przy zaznaczeniu").not.toBeNull();

    const buttons = [...bar!.querySelectorAll("[data-toolbar-action]")];
    expect(buttons.length, "pasek elementu bez akcji").toBe(4);
    for (const button of buttons) {
      expect(button.getAttribute("aria-label"), "akcja elementu bez etykiety").toBeTruthy();
      expect(button.textContent?.trim()).toBe("");
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });

  it("komplet akcji elementu jest na miejscu", () => {
    const { container } = renderBuilder();
    selectFirstElement(container);
    const bar = container.querySelector<HTMLElement>("[data-element-actions]")!;
    for (const label of [els.toFront, els.toBack, els.duplicate, els.remove]) {
      expect(within(bar).getByRole("button", { name: label }), `brak akcji ${label}`).toBeTruthy();
    }
  });
});

describe("etykiety mają parytet PL/EN", () => {
  it("każda etykieta akcji obu pasków istnieje w obu językach", async () => {
    // Ikona bez tłumaczenia zostawiłaby angielskiego operatora z symbolem
    // i pustym tooltipem — a tego nie widać w teście renderu po polsku.
    const en = (await import("../messages/en.json")).default;
    const keys = [
      ["sections", "moveUp"],
      ["sections", "moveDown"],
      ["sections", "disable"],
      ["sections", "enable"],
      ["sections", "duplicate"],
      ["sections", "remove"],
      ["builder", "settings"],
      ["elements", "toFront"],
      ["elements", "toBack"],
      ["elements", "duplicate"],
      ["elements", "remove"],
    ] as const;

    for (const [group, key] of keys) {
      const read = (messages: unknown) =>
        (messages as { site: Record<string, Record<string, string>> }).site[group]?.[key];
      const pl = read(plMessages);
      const value = read(en);
      expect(pl, `brak PL dla ${group}.${key}`).toBeTruthy();
      expect(value, `brak EN dla ${group}.${key}`).toBeTruthy();
    }
  });
});

/**
 * KAFEL PALETY NAPRAWDĘ SIĘ PRZECIĄGA (K3, delta recenzji PM do PR #156).
 *
 * Pierwsza wersja wieszała na kaflu `useDraggable`, ale paleta jest
 * RODZEŃSTWEM płótna w drzewie, a `DndContext` siedzi wewnątrz płótna — więc
 * kafel po prostu nie był źródłem przeciągania. Klik działał, testy palety
 * patrzyły na klik, i luka przeszła aż do weryfikacji w przeglądarce.
 *
 * Ten kontrakt patrzy na to, czego tamte nie sprawdzały: czy WCIŚNIĘCIE
 * i przesunięcie ponad próg kończy się upuszczeniem elementu POD KURSOREM.
 */
describe("paleta: przeciągnięcie kafla, nie tylko klik", () => {
  function pointerOn(node: Element, type: string, init: PointerEventInit) {
    fireEvent(
      node,
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, isPrimary: true, button: 0, ...init }),
    );
  }

  it("wciśnięcie + ruch ponad próg + puszczenie UPUSZCZA element", () => {
    const { container } = renderBuilder();
    fireEvent.click(container.querySelector<HTMLElement>('[data-palette-tab="elements"]')!);
    const tile = container.querySelector<HTMLElement>('[data-element-tile="button"]')!;

    // Płótno jest celem upuszczenia — podstawiamy je pod współrzędne kursora.
    const grid = container.querySelector<HTMLElement>("[data-canvas-grid]")!;
    grid.getBoundingClientRect = () => ({ left: 300, top: 100, width: 600, height: 400, right: 900, bottom: 500, x: 300, y: 100, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(grid, "clientWidth", { value: 600, configurable: true });
    const fromPoint = vi.spyOn(document, "elementsFromPoint").mockReturnValue([grid]);

    const before = container.querySelectorAll("[data-element-frame]").length;
    pointerOn(tile, "pointerdown", { clientX: 100, clientY: 200 });
    pointerOn(tile, "pointermove", { clientX: 400, clientY: 300 });
    pointerOn(tile, "pointerup", { clientX: 500, clientY: 350 });

    expect(container.querySelectorAll("[data-element-frame]").length, "kafel nie dał się przeciągnąć").toBe(
      before + 1,
    );
    // Element wylądował tam, gdzie był kursor — a nie „gdzieś na końcu".
    expect(fromPoint).toHaveBeenCalledWith(500, 350);
    fromPoint.mockRestore();
  });

  it("wciśnięcie BEZ ruchu nie upuszcza niczego — to jest klik", () => {
    const { container } = renderBuilder();
    fireEvent.click(container.querySelector<HTMLElement>('[data-palette-tab="elements"]')!);
    const tile = container.querySelector<HTMLElement>('[data-element-tile="button"]')!;
    const fromPoint = vi.spyOn(document, "elementsFromPoint").mockReturnValue([]);

    pointerOn(tile, "pointerdown", { clientX: 100, clientY: 200 });
    pointerOn(tile, "pointerup", { clientX: 101, clientY: 200 });

    expect(fromPoint, "ruch pod progiem potraktowany jak przeciągnięcie").not.toHaveBeenCalled();
    fromPoint.mockRestore();
  });
});
