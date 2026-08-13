import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * WIDOK MOBILNY I PUDEŁKO OBEJMUJĄCE TREŚĆ (K4, ADR-088) — kontrakt warstwy
 * klienta.
 *
 * Sam auto-układ jest funkcją czystą i dowodzi go `@avably/core`
 * (mobile-layout.test.ts) bez DOM-u. TU pilnujemy tego, czego funkcja czysta
 * nie widzi — a co jest sednem etapu:
 *
 *   1. GEST W WIDOKU TELEFONU zapisuje do slotu MOBILNEGO, a desktop zostaje
 *      bajtowo taki, jaki był (kontrola negatywna całego K4);
 *   2. ELEMENT ODPIĘTY od automatu mówi to SAM — ramka niesie znacznik;
 *   3. „WRÓĆ DO AUTO" kasuje poprawkę, a nie zeruje ją do jakiejś wartości;
 *   4. UCHWYT ROZMIARU na desktopie zamienia wymiar Z TREŚCI na JAWNY —
 *      i tylko na osi, której naprawdę dotknął;
 *   5. RAMKA ZAZNACZENIA RÓWNA SIĘ PUDEŁKU TREŚCI, gdy wymiar wynika z treści
 *      (jedyny sposób, żeby ramka nie obejmowała pustki wokół napisu).
 *
 * Zapis geometrii jest opóźniony (autosave), więc testy przewijają zegar
 * jawnie — czekanie „aż samo" zamieniłoby kontrakt w loterię czasową.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});

const actions = vi.hoisted(() => ({
  upsertSection: vi.fn(),
  reorderSections: vi.fn(),
  toggleSection: vi.fn(),
  duplicateSection: vi.fn(),
  deleteSection: vi.fn(),
  updateStoreStyle: vi.fn(),
  applyStarterTemplate: vi.fn(),
  publishSite: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/site", () => actions);
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh }),
}));

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder");
const { sectionCanvasFrom, presetContentFor, mobileLayoutOf, sizeOf } = await import(
  "@avably/core/site"
);

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];
type Canvas = ReturnType<typeof sectionCanvasFrom>;

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const SECTION_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const builder = plMessages.site.builder;
const elements = plMessages.site.elements;

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
      <SiteBuilder siteId={SITE_ID} siteName="Strona sklepu" style={STYL} sections={sections} products={[]} money={{ currency: "PLN", locale: "pl" }} />
    </NextIntlClientProvider>,
  );
}

function pointer(node: Element, type: string, init: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.assign(event, { pointerId: 1, isPrimary: true });
  act(() => {
    node.dispatchEvent(event);
  });
}

function nextFrame() {
  act(() => {
    vi.advanceTimersToNextFrame();
  });
}

/** Pełne przeciągnięcie: wciśnięcie, ruchy po drodze, puszczenie. */
function drag(node: Element, { dx, dy }: { dx: number; dy: number }) {
  const startX = 400;
  const startY = 300;
  pointer(node, "pointerdown", { clientX: startX, clientY: startY });
  for (let step = 1; step <= 4; step += 1) {
    pointer(node, "pointermove", {
      clientX: startX + (dx * step) / 4,
      clientY: startY + (dy * step) / 4,
    });
    nextFrame();
  }
  pointer(node, "pointerup", { clientX: startX + dx, clientY: startY + dy });
}

async function flushAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(1_500);
  });
}

/** Treść ostatniego zapisu płótna. */
function lastSavedCanvas(): Canvas | undefined {
  const call = actions.upsertSection.mock.calls.at(-1)?.[0] as { content: Canvas } | undefined;
  return call?.content;
}

function frameFor(container: HTMLElement, id: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-element-frame="${id}"]`);
  expect(node, `brak ramki elementu ${id}`).not.toBeNull();
  return node!;
}

/** Przełączenie płótna w widok telefonu — ten sam przycisk, co w pasku. */
function switchToMobile() {
  fireEvent.click(screen.getByLabelText(builder.viewportMobile));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  refresh.mockClear();
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: SECTION_ID });
  actions.reorderSections.mockResolvedValue({ ok: true });
  actions.publishSite.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("widok telefonu: gest zapisuje deltę, a nie źródło", () => {
  it("przeciągnięcie w widoku telefonu tworzy RĘCZNĄ poprawkę mobilną", async () => {
    const section = heroSection();
    const canvas = section.content as unknown as Canvas;
    const target = canvas.elements[0]!;
    const auto = mobileLayoutOf(canvas).boxes[target.id]!;

    const { container } = renderBuilder([section]);
    switchToMobile();
    drag(frameFor(container, target.id), { dx: 0, dy: 80 });
    await flushAutosave();

    const saved = lastSavedCanvas();
    const zapisany = saved?.elements.find((element) => element.id === target.id);
    expect(zapisany?.layout.mobile, "gest w widoku telefonu nie zapisał poprawki").toBeDefined();
    // Ruch o 80 px przy jednostce 8 px (jsdom nie mierzy płótna, więc miara
    // spada na projektową) to dziesięć jednostek w dół.
    expect(zapisany!.layout.mobile!.y).toBe(auto.y + 10);
    expect(zapisany!.layout.mobile!.x).toBe(auto.x);
  });

  it("KONTROLA NEGATYWNA: edycja na telefonie nie rusza desktopu ANI o jednostkę", async () => {
    const section = heroSection();
    const canvas = section.content as unknown as Canvas;
    const przed = canvas.elements.map((element) => ({ ...element.layout.desktop }));

    const { container } = renderBuilder([section]);
    switchToMobile();
    drag(frameFor(container, canvas.elements[0]!.id), { dx: 40, dy: 80 });
    await flushAutosave();

    const saved = lastSavedCanvas()!;
    expect(saved.elements.map((element) => element.layout.desktop)).toEqual(przed);
    // …i wysokość sekcji desktopowej też zostaje.
    expect(saved.rows).toBe(canvas.rows);
  });

  it("KONTROLA NEGATYWNA: edycja na desktopie nie tworzy poprawki mobilnej", async () => {
    const section = heroSection();
    const canvas = section.content as unknown as Canvas;

    const { container } = renderBuilder([section]);
    drag(frameFor(container, canvas.elements[0]!.id), { dx: 0, dy: 80 });
    await flushAutosave();

    const saved = lastSavedCanvas()!;
    expect(saved.elements.filter((element) => element.layout.mobile !== undefined)).toEqual([]);
  });

  it("element z poprawką NIESIE znacznik odpięcia — i tylko on", () => {
    const section = heroSection();
    const canvas = section.content as unknown as Canvas;
    const target = canvas.elements[0]!;

    const { container } = renderBuilder([section]);
    switchToMobile();
    expect(
      container.querySelectorAll("[data-element-detached]"),
      "coś jest odpięte, zanim ktokolwiek cokolwiek ruszył",
    ).toHaveLength(0);

    drag(frameFor(container, target.id), { dx: 0, dy: 80 });

    const odpiete = [...container.querySelectorAll("[data-element-frame][data-element-detached]")];
    expect(odpiete.map((node) => node.getAttribute("data-element-frame"))).toEqual([target.id]);
  });

  it("znacznik odpięcia NIE pokazuje się w widoku komputera", () => {
    const section = heroSection();
    const canvas = section.content as unknown as Canvas;
    const target = canvas.elements[0]!;

    const { container } = renderBuilder([section]);
    switchToMobile();
    drag(frameFor(container, target.id), { dx: 0, dy: 80 });
    // Powrót na desktop: poprawka nadal istnieje, ale opisuje INNY breakpoint,
    // więc na desktopie nie ma czego oznaczać.
    fireEvent.click(screen.getByLabelText(builder.viewportDesktop));
    expect(container.querySelectorAll("[data-element-detached]")).toHaveLength(0);
  });
});

describe("powrót pod auto-układ", () => {
  it("akcji powrotu pod automat NIE MA, dopóki nie ma czego cofać", () => {
    const section = heroSection();
    const canvas = section.content as unknown as Canvas;
    const { container } = renderBuilder([section]);
    switchToMobile();
    // Zaznaczenie samo w sobie nie odpina elementu.
    pointer(frameFor(container, canvas.elements[0]!.id), "pointerdown", { clientX: 10, clientY: 10 });
    pointer(frameFor(container, canvas.elements[0]!.id), "pointerup", { clientX: 10, clientY: 10 });
    expect(container.querySelector('[data-toolbar-action="element-auto-mobile"]')).toBeNull();
  });

  it("powrót pod automat KASUJE poprawkę, a nie zeruje ją do jakiejś wartości", async () => {
    const section = heroSection();
    const canvas = section.content as unknown as Canvas;
    const target = canvas.elements[0]!;

    const { container } = renderBuilder([section]);
    switchToMobile();
    drag(frameFor(container, target.id), { dx: 0, dy: 80 });

    const przycisk = container.querySelector<HTMLElement>(
      '[data-toolbar-action="element-auto-mobile"]',
    );
    expect(przycisk, "brak akcji powrotu pod automat").not.toBeNull();
    expect(przycisk!.getAttribute("aria-label")).toBe(elements.autoMobile);
    fireEvent.click(przycisk!);
    await flushAutosave();

    const zapisany = lastSavedCanvas()!.elements.find((element) => element.id === target.id)!;
    expect(zapisany.layout.mobile, "poprawka została, tylko z inną wartością").toBeUndefined();
    expect(Object.keys(zapisany.layout)).toEqual(["desktop"]);
    // Znacznik odpięcia znika razem z poprawką.
    expect(container.querySelectorAll("[data-element-detached]")).toHaveLength(0);
  });
});

describe("uchwyt rozmiaru zamienia wymiar Z TREŚCI na JAWNY", () => {
  /** Element, który rodzi się z pudełkiem obejmującym treść (przycisk hero). */
  function buttonId(canvas: Canvas): string {
    const button = canvas.elements.find((element) => element.kind === "button");
    expect(button, "preset hero nie ma przycisku — nie ma czego mierzyć").toBeDefined();
    expect(sizeOf(button!), "przycisk presetu nie rodzi się z wymiarem z treści").toEqual({
      w: "hug",
      h: "hug",
    });
    return button!.id;
  }

  it("uchwyt boczny ustawia JAWNĄ szerokość, a wysokość zostawia treści", async () => {
    const section = heroSection();
    const canvas = section.content as unknown as Canvas;
    const id = buttonId(canvas);

    const { container } = renderBuilder([section]);
    const frame = frameFor(container, id);
    pointer(frame, "pointerdown", { clientX: 10, clientY: 10 });
    pointer(frame, "pointerup", { clientX: 10, clientY: 10 });
    drag(frame.querySelector('[data-resize-handle="e"]')!, { dx: 80, dy: 0 });
    await flushAutosave();

    const zapisany = lastSavedCanvas()!.elements.find((element) => element.id === id)!;
    expect(sizeOf(zapisany)).toEqual({ w: "fixed", h: "hug" });
  });

  it("uchwyt narożny ustawia OBA wymiary", async () => {
    const section = heroSection();
    const canvas = section.content as unknown as Canvas;
    const id = buttonId(canvas);

    const { container } = renderBuilder([section]);
    const frame = frameFor(container, id);
    pointer(frame, "pointerdown", { clientX: 10, clientY: 10 });
    pointer(frame, "pointerup", { clientX: 10, clientY: 10 });
    drag(frame.querySelector('[data-resize-handle="se"]')!, { dx: 80, dy: 40 });
    await flushAutosave();

    expect(sizeOf(lastSavedCanvas()!.elements.find((element) => element.id === id)!)).toEqual({
      w: "fixed",
      h: "fixed",
    });
  });

  it("samo PRZESUNIĘCIE nie odbiera pudełku wymiaru z treści", async () => {
    const section = heroSection();
    const canvas = section.content as unknown as Canvas;
    const id = buttonId(canvas);

    const { container } = renderBuilder([section]);
    drag(frameFor(container, id), { dx: 80, dy: 0 });
    await flushAutosave();

    expect(sizeOf(lastSavedCanvas()!.elements.find((element) => element.id === id)!)).toEqual({
      w: "hug",
      h: "hug",
    });
  });

  it("uchwyt w widoku TELEFONU nie rusza trybu wymiaru (opisuje projekt desktopowy)", async () => {
    const section = heroSection();
    const canvas = section.content as unknown as Canvas;
    const id = buttonId(canvas);

    const { container } = renderBuilder([section]);
    switchToMobile();
    const frame = frameFor(container, id);
    pointer(frame, "pointerdown", { clientX: 10, clientY: 10 });
    pointer(frame, "pointerup", { clientX: 10, clientY: 10 });
    drag(frame.querySelector('[data-resize-handle="e"]')!, { dx: 80, dy: 0 });
    await flushAutosave();

    const zapisany = lastSavedCanvas()!.elements.find((element) => element.id === id)!;
    expect(sizeOf(zapisany), "widok telefonu przestawił tryb wymiaru desktopu").toEqual({
      w: "hug",
      h: "hug",
    });
    // Poprawka mobilna niesie za to KONKRETNE pudełko — bo operator je narysował.
    expect(zapisany.layout.mobile).toBeDefined();
  });
});

/**
 * RAMKA ZAZNACZENIA RÓWNA SIĘ PUDEŁKU TREŚCI (decyzja właściciela 2026-08-03).
 *
 * jsdom nie liczy układu, więc pudełka mierzone są STUBEM — i to jest uczciwy
 * zakres tej nogi: dowodzi, że ramka bierze rozmiar z POMIARU pudełka treści,
 * a nie z zapisanej geometrii. Że pudełko na stronie naprawdę obejmuje treść,
 * dowodzi kontrakt renderu (`max-content`) i weryfikacja w przeglądarce.
 */
describe("ramka zaznaczenia = pudełko treści", () => {
  const SZEROKOSC = 168;
  const WYSOKOSC = 44;

  function stubRects() {
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement): DOMRect {
      if (this.hasAttribute("data-canvas-grid")) {
        return { left: 0, top: 0, width: 1152, height: 520, right: 1152, bottom: 520, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      }
      if (this.hasAttribute("data-element-id")) {
        return {
          left: 96,
          top: 384,
          width: SZEROKOSC,
          height: WYSOKOSC,
          right: 96 + SZEROKOSC,
          bottom: 384 + WYSOKOSC,
          x: 96,
          y: 384,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return original.call(this);
    };
    return () => {
      HTMLElement.prototype.getBoundingClientRect = original;
    };
  }

  it("pudełko z treści: ramka bierze ZMIERZONY rozmiar, nie zapisaną geometrię", () => {
    const restore = stubRects();
    try {
      const section = heroSection();
      const canvas = section.content as unknown as Canvas;
      const button = canvas.elements.find((element) => element.kind === "button")!;
      const { container } = renderBuilder([section]);

      const frame = frameFor(container, button.id);
      expect(frame.style.width, "ramka nie zmierzyła pudełka treści").toBe(`${SZEROKOSC}px`);
      expect(frame.style.height).toBe(`${WYSOKOSC}px`);
    } finally {
      restore();
    }
  });

  it("pudełko o wymiarze JAWNYM zostaje przy procencie płótna (kontrola negatywna)", () => {
    const restore = stubRects();
    try {
      const section = heroSection();
      const canvas = section.content as unknown as Canvas;
      const heading = canvas.elements.find((element) => element.kind === "heading")!;
      const { container } = renderBuilder([section]);

      const frame = frameFor(container, heading.id);
      expect(frame.style.width, "ramka mierzy pudełko, choć wymiar jest jawny").toBe(
        `${(heading.layout.desktop.w / 144) * 100}%`,
      );
    } finally {
      restore();
    }
  });
});
