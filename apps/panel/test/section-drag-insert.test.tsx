import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * PRZECIĄGNIĘCIE SEKCJI NA KONKRETNE MIEJSCE I PRZYPIĘTA STOPKA (K6, ADR-092).
 *
 * Dwie wady zgłoszone przez właściciela po przejściu kreatora na produkcji,
 * obie o tym samym kształcie: kreator ROBI coś sensownego, ale nie pokazuje,
 * co zrobi, więc jedyną drogą sprawdzenia jest wykonanie i cofnięcie.
 *
 *   1. Kafel sekcji dokładał sekcję ZAWSZE na końcu. Przeciągnięcie było
 *      pierwszym odruchem i nie robiło nic.
 *   2. Stopki nie było wcale — a gdy jest, jej miejsce nie może być wyborem:
 *      stopka nad hero to błąd, którego operator nie ma prawa móc popełnić.
 *
 * Plik stoi na trzech osiach, bo każda łapie inną klasę mutacji:
 *
 *   • ARYTMETYKA bez DOM-u (`insertIndexAtPointer`) — łapie zgubienie pozycji
 *     („zawsze na koniec") i zgubienie limitu („pod stopkę");
 *   • GEST przez RTL — łapie kafel, który nie jest źródłem przeciągania
 *     (dokładnie ta luka, którą K3 przepuściło aż do przeglądarki), oraz
 *     wskazanie miejsca, które nie odpowiada zapisowi;
 *   • PRZYPIĘCIE w interfejsie — łapie stopkę, którą da się przesunąć.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";
import {
  insertIndexAtPointer,
  type SectionBand,
} from "@/app/[locale]/(kreator)/strona/kreator/insert-position";

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

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/kreator/site-builder");
const { sectionCanvasFrom, presetContentFor } = await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const HERO_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const CTA_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const FOOTER_ID = "cccccccc-3333-4333-8333-333333333333";
const NOWA_ID = "dddddddd-4444-4444-8444-444444444444";

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
      <SiteBuilder siteId={SITE_ID} style={STYL} sections={sections} products={[]} />
    </NextIntlClientProvider>,
  );
}

function pointerOn(node: Element, type: string, init: PointerEventInit) {
  fireEvent(
    node,
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 7,
      isPrimary: true,
      button: 0,
      ...init,
    }),
  );
}

/**
 * Podstawia pomiar sekcji na płótnie. jsdom nie układa niczego, więc bez tego
 * każda sekcja miałaby pudełko zerowe i arytmetyka miejsca badałaby zera.
 */
function layout(container: HTMLElement, bands: Record<string, [number, number]>) {
  const canvas = container.querySelector<HTMLElement>("[data-builder-canvas]")!;
  for (const [id, [top, bottom]] of Object.entries(bands)) {
    const node = container.querySelector<HTMLElement>(`[data-canvas-section="${id}"]`)!;
    node.getBoundingClientRect = () =>
      ({ top, bottom, left: 0, right: 800, width: 800, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  }
  return canvas;
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: NOWA_ID });
  actions.reorderSections.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

// -----------------------------------------------------------------------
// 1. Arytmetyka miejsca — bez DOM-u
// -----------------------------------------------------------------------

describe("miejsce wstawienia pod kursorem (czysta funkcja)", () => {
  const bands: SectionBand[] = [
    { index: 0, top: 0, bottom: 100 },
    { index: 1, top: 100, bottom: 300 },
    { index: 2, top: 300, bottom: 400 },
  ];

  it("kontrola po pustym zbiorze: pudełka mają wysokość", () => {
    // Bez tego wszystkie asercje niżej liczyłyby połowę zera.
    expect(bands.every((band) => band.bottom > band.top)).toBe(true);
  });

  it("nad połową sekcji — nowa wchodzi PRZED nią", () => {
    expect(insertIndexAtPointer(bands, 20, 3)).toBe(0);
    expect(insertIndexAtPointer(bands, 140, 3)).toBe(1);
  });

  it("pod połową sekcji — nowa wchodzi ZA nią", () => {
    expect(insertIndexAtPointer(bands, 80, 3)).toBe(1);
    expect(insertIndexAtPointer(bands, 260, 3)).toBe(2);
  });

  it("połowa liczy się z WYSOKOŚCI sekcji, nie z odległości do krawędzi", () => {
    // Sekcja środkowa jest dwa razy wyższa od sąsiadów. Kursor na 220 px stoi
    // bliżej jej krawędzi DOLNEJ, ale powyżej jej połowy (200) — reguła
    // „najbliższa krawędź" dałaby tu 2, reguła połowy daje 1.
    expect(insertIndexAtPointer(bands, 190, 3)).toBe(1);
    expect(insertIndexAtPointer(bands, 210, 3)).toBe(2);
  });

  it("kursor pod ostatnią sekcją — koniec strony", () => {
    expect(insertIndexAtPointer(bands, 900, 3)).toBe(3);
  });

  it("LIMIT przycina wynik — stopka odbiera miejsce pod sobą", () => {
    // Ta sama strona, ale ostatnia sekcja jest przypięta: miejsc jest 2, nie 3.
    expect(insertIndexAtPointer(bands, 900, 2)).toBe(2);
    expect(insertIndexAtPointer(bands, 380, 2)).toBe(2);
  });

  it("pusta strona ma dokładnie jedno miejsce", () => {
    expect(insertIndexAtPointer([], 500, 0)).toBe(0);
  });
});

// -----------------------------------------------------------------------
// 2. Gest kafla sekcji
// -----------------------------------------------------------------------

describe("paleta sekcji: przeciągnięcie wstawia w WYBRANE miejsce", () => {
  it("upuszczenie MIĘDZY dwie sekcje zapisuje kolejność z nową sekcją w środku", async () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0), sekcja(CTA_ID, "cta", 1)]);
    const canvas = layout(container, { [HERO_ID]: [0, 200], [CTA_ID]: [200, 400] });
    const tile = container.querySelector<HTMLElement>('[data-add-section-tile="faq"]')!;

    // Kursor na 180 px — poniżej połowy hero (100), czyli miejsce nr 1.
    const fromPoint = vi.spyOn(document, "elementsFromPoint").mockReturnValue([canvas]);
    pointerOn(tile, "pointerdown", { clientX: 40, clientY: 40 });
    pointerOn(tile, "pointermove", { clientX: 400, clientY: 180 });

    const slot = container.querySelector<HTMLElement>('[data-insert-slot="1"]');
    expect(slot?.getAttribute("data-insert-active"), "slot celu nie został wskazany").toBe("on");

    pointerOn(tile, "pointerup", { clientX: 400, clientY: 180 });
    await vi.waitFor(() => expect(actions.reorderSections).toHaveBeenCalled());

    expect(actions.upsertSection).toHaveBeenCalledTimes(1);
    expect(actions.reorderSections).toHaveBeenCalledWith(SITE_ID, [HERO_ID, NOWA_ID, CTA_ID]);
    fromPoint.mockRestore();
  });

  it("upuszczenie NAD pierwszą sekcją wstawia na początku", async () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0), sekcja(CTA_ID, "cta", 1)]);
    const canvas = layout(container, { [HERO_ID]: [0, 200], [CTA_ID]: [200, 400] });
    const tile = container.querySelector<HTMLElement>('[data-add-section-tile="faq"]')!;
    const fromPoint = vi.spyOn(document, "elementsFromPoint").mockReturnValue([canvas]);

    pointerOn(tile, "pointerdown", { clientX: 40, clientY: 40 });
    pointerOn(tile, "pointermove", { clientX: 400, clientY: 30 });
    pointerOn(tile, "pointerup", { clientX: 400, clientY: 30 });
    await vi.waitFor(() => expect(actions.reorderSections).toHaveBeenCalled());

    expect(actions.reorderSections).toHaveBeenCalledWith(SITE_ID, [NOWA_ID, HERO_ID, CTA_ID]);
    fromPoint.mockRestore();
  });

  it("ruch POD progiem to klik — sekcja ląduje na końcu treści, bez pomiaru", async () => {
    // Kontrola negatywna do obu testów wyżej: bez niej próg mógłby zniknąć
    // i każde kliknięcie byłoby przeciągnięciem o zero pikseli.
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0), sekcja(CTA_ID, "cta", 1)]);
    const tile = container.querySelector<HTMLElement>('[data-add-section-tile="faq"]')!;
    const fromPoint = vi.spyOn(document, "elementsFromPoint").mockReturnValue([]);

    pointerOn(tile, "pointerdown", { clientX: 40, clientY: 40 });
    pointerOn(tile, "pointerup", { clientX: 41, clientY: 40 });
    fireEvent.click(tile);
    await vi.waitFor(() => expect(actions.reorderSections).toHaveBeenCalled());

    expect(fromPoint, "ruch pod progiem policzony jak przeciągnięcie").not.toHaveBeenCalled();
    expect(actions.reorderSections).toHaveBeenCalledWith(SITE_ID, [HERO_ID, CTA_ID, NOWA_ID]);
    fromPoint.mockRestore();
  });

  it("upuszczenie POZA płótnem nie dodaje niczego", async () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0)]);
    layout(container, { [HERO_ID]: [0, 200] });
    const tile = container.querySelector<HTMLElement>('[data-add-section-tile="faq"]')!;
    // Pusty wynik `elementsFromPoint` = kursor nad paletą, nie nad płótnem.
    const fromPoint = vi.spyOn(document, "elementsFromPoint").mockReturnValue([]);

    pointerOn(tile, "pointerdown", { clientX: 40, clientY: 40 });
    pointerOn(tile, "pointermove", { clientX: 60, clientY: 300 });
    pointerOn(tile, "pointerup", { clientX: 60, clientY: 300 });

    expect(actions.upsertSection, "sekcja dodana mimo upuszczenia poza płótnem").not.toHaveBeenCalled();
    expect(container.querySelector("[data-insert-active]")).toBeNull();
    fromPoint.mockRestore();
  });
});

// -----------------------------------------------------------------------
// 3. Stopka jest przypięta i jedyna
// -----------------------------------------------------------------------

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

    fireEvent.mouseEnter(node);
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
    const node = container.querySelector<HTMLElement>(`[data-canvas-section="${CTA_ID}"]`)!;
    fireEvent.mouseEnter(node);
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

  it("kafel stopki jest WYŁĄCZONY, gdy strona już ją ma", () => {
    const { container } = zeStopka();
    const tile = container.querySelector<HTMLButtonElement>('[data-add-section-tile="footer"]')!;
    expect(tile.disabled, "da się dołożyć drugą stopkę").toBe(true);
  });

  it("kafel stopki jest CZYNNY na stronie bez stopki (kontrola pozytywna)", () => {
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0)]);
    const tile = container.querySelector<HTMLButtonElement>('[data-add-section-tile="footer"]')!;
    expect(tile.disabled).toBe(false);
  });

  it("klik kafla dokłada sekcję PRZED stopką, nie za nią", async () => {
    const { container } = zeStopka();
    const tile = container.querySelector<HTMLElement>('[data-add-section-tile="faq"]')!;
    fireEvent.click(tile);
    await vi.waitFor(() => expect(actions.reorderSections).toHaveBeenCalled());
    expect(actions.reorderSections).toHaveBeenCalledWith(SITE_ID, [HERO_ID, CTA_ID, NOWA_ID, FOOTER_ID]);
  });
});
