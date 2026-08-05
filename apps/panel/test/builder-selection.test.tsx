import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * HIERARCHIA ZAZNACZENIA W KREATORZE (E2, pinezki 39a4327a i 8751c29a).
 *
 * ===================== CO ZGŁOSIŁ WŁAŚCICIEL =====================
 *
 * Kliknięcie elementu pokazywało JEDEN pasek z akcjami sekcji I elementu naraz
 * — dwa „usuń” w odległości dwóch ikon, każde o czymś innym. Nie było też jak
 * powiedzieć, na czym się stoi ani jak wrócić o poziom wyżej.
 *
 * ===================== CZEGO PILNUJE TEN PLIK =====================
 *
 * Kontrakty są BEHAWIORALNE — mierzą, co robi klik i klawiatura, a nie jak
 * nazywa się stan w kodzie:
 *
 *   1. NAJECHANIE maluje obrys i NIE wystawia narzędzi (najechanie nie jest
 *      wyborem);
 *   2. KLIK W TŁO SEKCJI daje narzędzia SEKCJI;
 *   3. KLIK W ELEMENT daje narzędzia ELEMENTU i ANI JEDNEJ akcji sekcji w DOM-ie
 *      narzędzi aktywnych — to jest sedno pinezki, więc asercja jest wyliczana
 *      z KOMPLETU akcji paska, a nie z jednej wybranej;
 *   4. SEKCJA-KONTEKST edytowanego elementu trzyma własny, stały obrys;
 *   5. PASEK ŚCIEŻKI jest klikalny i prowadzi w górę;
 *   6. ESCAPE wspina się po poziomach: element → sekcja → nic.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
const { sectionCanvasFrom, presetContentFor, structuredPresetFor } = await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const HERO_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const CTA_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const FAQ_ID = "cccccccc-3333-4333-8333-333333333333";

const sec = plMessages.site.sections;
const builder = plMessages.site.builder;
const els = plMessages.site.elements;

function canvasSection(id: string, type: "hero" | "cta"): Section {
  return {
    id,
    type,
    position: 0,
    enabled: true,
    content: sectionCanvasFrom(type, presetContentFor(type, "pl")),
  } as Section;
}

function faqSection(): Section {
  return {
    id: FAQ_ID,
    type: "faq",
    position: 2,
    enabled: true,
    content: structuredPresetFor("faq", "pl"),
  } as Section;
}

function renderBuilder(sections: Section[] = [canvasSection(HERO_ID, "hero"), canvasSection(CTA_ID, "cta")]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder siteId={SITE_ID} siteName="Strona sklepu" style={STYL} sections={sections} products={[]} money={{ currency: "PLN", locale: "pl" }} />
    </NextIntlClientProvider>,
  );
}

/** Wciśnięcie w TŁO sekcji — dokładnie to, co robi operator klikając stronę. */
function clickSection(container: HTMLElement, id: string) {
  fireEvent.pointerDown(container.querySelector<HTMLElement>(`[data-canvas-section="${id}"]`)!);
}

/** Wciśnięcie w ramkę pierwszego elementu sekcji (zaznaczenie idzie z `pointerdown`). */
function clickFirstElement(container: HTMLElement, id: string) {
  const frame = container
    .querySelector<HTMLElement>(`[data-canvas-section="${id}"]`)!
    .querySelector<HTMLElement>("[data-element-frame]")!;
  fireEvent.pointerDown(frame, { clientX: 10, clientY: 10 });
  fireEvent.pointerUp(frame, { clientX: 10, clientY: 10 });
}

function toolbar(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-section-toolbar="${id}"]`);
}

function outlineOf(container: HTMLElement, id: string): string | null {
  return container
    .querySelector<HTMLElement>(`[data-canvas-section="${id}"] [data-section-outline]`)!
    .getAttribute("data-section-outline");
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: "nowa" });
  actions.deleteSection.mockResolvedValue({ ok: true, mode: "marked" });
});

afterEach(cleanup);

describe("najechanie maluje obrys — i nic poza tym", () => {
  it("hover NIE wystawia narzędzi", () => {
    const { container } = renderBuilder();
    fireEvent.mouseEnter(container.querySelector<HTMLElement>(`[data-canvas-section="${HERO_ID}"]`)!);

    expect(outlineOf(container, HERO_ID), "najechanie nie namalowało obrysu").toBe("hover");
    expect(
      container.querySelectorAll("[data-section-toolbar]").length,
      "najechanie wystawiło narzędzia — hover nie jest wyborem",
    ).toBe(0);
  });

  it("obrys schodzi razem z kursorem, a zaznaczenie zostaje (kontrola pozytywna)", () => {
    const { container } = renderBuilder();
    const node = container.querySelector<HTMLElement>(`[data-canvas-section="${HERO_ID}"]`)!;
    fireEvent.mouseEnter(node);
    fireEvent.mouseLeave(node);
    expect(outlineOf(container, HERO_ID)).toBe("off");

    clickSection(container, HERO_ID);
    fireEvent.mouseLeave(node);
    expect(outlineOf(container, HERO_ID), "zaznaczenie zniknęło razem z kursorem").toBe("selected");
  });
});

describe("klik w tło sekcji = narzędzia SEKCJI", () => {
  it("pasek wychodzi przy TEJ sekcji i niesie komplet akcji sekcji", () => {
    const { container } = renderBuilder();
    clickSection(container, CTA_ID);

    const bar = toolbar(container, CTA_ID);
    expect(bar, "klik w sekcję nie wystawił narzędzi").not.toBeNull();
    expect(bar!.getAttribute("data-toolbar-scope")).toBe("section");
    expect(container.querySelectorAll("[data-section-toolbar]").length, "dwa paski naraz").toBe(1);

    expect(within(bar!).getByLabelText(sec.dragHandle)).toBeTruthy();
    for (const label of [sec.moveUp, sec.moveDown, sec.duplicate, builder.settings, sec.remove]) {
      expect(within(bar!).getByRole("button", { name: label }), `brak akcji ${label}`).toBeTruthy();
    }
  });

  it("zaznaczenie przechodzi na sekcję kliknięcą jako ostatnia", () => {
    const { container } = renderBuilder();
    clickSection(container, HERO_ID);
    clickSection(container, CTA_ID);
    expect(toolbar(container, HERO_ID)).toBeNull();
    expect(toolbar(container, CTA_ID)).not.toBeNull();
  });
});

describe("klik w element = narzędzia ELEMENTU i NIC z sekcji", () => {
  it("w DOM-ie narzędzi aktywnych nie ma ANI JEDNEJ akcji sekcji", () => {
    const { container } = renderBuilder();
    clickFirstElement(container, HERO_ID);

    const bar = toolbar(container, HERO_ID);
    expect(bar, "zaznaczenie elementu nie wystawiło narzędzi").not.toBeNull();
    expect(bar!.getAttribute("data-toolbar-scope")).toBe("element");

    // Komplet akcji paska — nie wybrane trzy: pasek łączony wróciłby wtedy
    // każdą akcją, której test nie zna z nazwy.
    const akcje = [...bar!.querySelectorAll("[data-toolbar-action]")].map((node) =>
      node.getAttribute("data-toolbar-action"),
    );
    expect(akcje.length, "pasek elementu bez akcji — kontrola po pustym zbiorze").toBeGreaterThan(0);
    expect(
      akcje.filter((akcja) => !akcja!.startsWith("element-")),
      `w pasku elementu stoją akcje sekcji: ${akcje.join(", ")}`,
    ).toEqual([]);
    expect(bar!.querySelector("[data-drag-handle]"), "uchwyt sekcji w pasku elementu").toBeNull();
    expect(bar!.querySelector("[data-section-remove]"), "kosz sekcji w pasku elementu").toBeNull();

    // Kontrola pozytywna: akcje elementu naprawdę tam są.
    for (const label of [els.toFront, els.toBack, els.duplicate, els.remove]) {
      expect(within(bar!).getByRole("button", { name: label }), `brak akcji ${label}`).toBeTruthy();
    }
  });

  it("sekcja-kontekst trzyma WŁASNY obrys, a sąsiadka nie jest przygaszana", () => {
    const { container } = renderBuilder();
    clickFirstElement(container, HERO_ID);

    expect(outlineOf(container, HERO_ID), "sekcja edytowanego elementu bez obrysu").toBe("context");
    expect(outlineOf(container, CTA_ID), "sąsiednia sekcja zmieniła stan").toBe("off");
  });

  it("kliknięcie w tło sekcji WRACA na poziom sekcji", () => {
    const { container } = renderBuilder();
    clickFirstElement(container, HERO_ID);
    clickSection(container, HERO_ID);
    expect(toolbar(container, HERO_ID)!.getAttribute("data-toolbar-scope")).toBe("section");
  });
});

describe("pasek ścieżki „Sekcja › Element”", () => {
  it("na poziomie sekcji ma JEDEN człon, na poziomie elementu DWA", () => {
    const { container } = renderBuilder();
    clickSection(container, HERO_ID);
    expect(
      [...toolbar(container, HERO_ID)!.querySelectorAll("[data-path-step]")].map((node) =>
        node.getAttribute("data-path-step"),
      ),
    ).toEqual(["section"]);

    clickFirstElement(container, HERO_ID);
    const kroki = [...toolbar(container, HERO_ID)!.querySelectorAll("[data-path-step]")];
    expect(kroki.map((node) => node.getAttribute("data-path-step"))).toEqual(["section", "element"]);
    expect(kroki[0]!.textContent, "człon sekcji nie nazywa sekcji").toBe(
      plMessages.site.sectionTypes.hero,
    );
    expect(kroki[1]!.textContent!.length, "człon elementu bez nazwy").toBeGreaterThan(0);
  });

  it("KLIK w człon „Sekcja” zaznacza sekcję (droga w górę myszą)", () => {
    const { container } = renderBuilder();
    clickFirstElement(container, HERO_ID);
    const krok = toolbar(container, HERO_ID)!.querySelector<HTMLElement>('[data-path-step="section"]')!;
    expect(krok.tagName, "człon sekcji nie jest przyciskiem").toBe("BUTTON");

    fireEvent.click(krok);
    expect(toolbar(container, HERO_ID)!.getAttribute("data-toolbar-scope")).toBe("section");
  });

  it("człon BIEŻĄCY nie jest przyciskiem — nie ma dokąd prowadzić", () => {
    const { container } = renderBuilder();
    clickSection(container, HERO_ID);
    const krok = toolbar(container, HERO_ID)!.querySelector<HTMLElement>('[data-path-step="section"]')!;
    expect(krok.tagName).not.toBe("BUTTON");
    expect(krok.getAttribute("aria-current")).toBe("true");
  });
});

describe("Escape wspina się o poziom wyżej", () => {
  it("element → sekcja → nic", () => {
    const { container } = renderBuilder();
    clickFirstElement(container, HERO_ID);
    expect(toolbar(container, HERO_ID)!.getAttribute("data-toolbar-scope")).toBe("element");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      toolbar(container, HERO_ID)?.getAttribute("data-toolbar-scope"),
      "Escape z elementu nie zszedł na poziom sekcji",
    ).toBe("section");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(toolbar(container, HERO_ID), "Escape z sekcji nie zdjął zaznaczenia").toBeNull();
    expect(container.querySelectorAll("[data-section-toolbar]").length).toBe(0);
  });

  it("Escape przy OTWARTYM oknie nie rusza poziomu — okno ma pierwszeństwo", () => {
    // Bez tego zamknięcie szuflady Escape'em gasiłoby przy okazji zaznaczenie,
    // którego operator nie puszczał.
    const { container } = renderBuilder();
    clickSection(container, HERO_ID);
    fireEvent.click(
      within(toolbar(container, HERO_ID)!).getByRole("button", { name: builder.settings }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      toolbar(container, HERO_ID)?.getAttribute("data-toolbar-scope"),
      "Escape zjadł zaznaczenie razem z zamknięciem okna",
    ).toBe("section");
  });
});

describe("sekcja strukturalna nie ma poziomu elementu (E1, ADR-094)", () => {
  it("klik otwiera szufladę mini-CMS i zaznacza CAŁĄ sekcję", () => {
    const { container } = renderBuilder([canvasSection(HERO_ID, "hero"), faqSection()]);
    const opener = container.querySelector<HTMLElement>(`[data-cms-open="${FAQ_ID}"]`);
    expect(opener, "sekcja strukturalna bez powierzchni otwierającej szufladę").not.toBeNull();

    fireEvent.click(opener!);
    expect(screen.getByRole("dialog"), "szuflada się nie otworzyła").toBeTruthy();
    expect(
      toolbar(container, FAQ_ID)?.getAttribute("data-toolbar-scope"),
      "klik w sekcję strukturalną nie zaznaczył jej",
    ).toBe("section");
  });
});
