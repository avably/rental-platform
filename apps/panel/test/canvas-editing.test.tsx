// @vitest-environment jsdom

/**
 * EDYCJA ELEMENTÓW NA PŁÓTNIE (K2, ADR-084) — kontrakt warstwy klienta.
 *
 * Arytmetykę przyciągania i prowadnic dowodzi `@avably/core` bez DOM-u
 * (geometry.test.ts). TU pilnujemy tego, czego funkcja czysta nie widzi:
 *
 *   1. sekcja rodzi się jako PŁÓTNO — dodanie z palety zapisuje treść v2;
 *   2. klik w element go ZAZNACZA i wystawia osiem uchwytów rozmiaru;
 *   3. przeciągnięcie uchwytu ZMIENIA GEOMETRIĘ w dokumencie (styl pudełka),
 *      a nie tylko stan w pamięci;
 *   4. warstwy: „na wierzch" przestawia KOLEJNOŚĆ malowania;
 *   5. strzałki przesuwają o jednostkę, Shift o dziesięć;
 *   6. cofnij/ponów wraca do stanu, który operator widział, i ZAPISUJE go;
 *   7. autozapis geometrii idzie kanałem BEZ odświeżenia RSC.
 *
 * Zapis geometrii jest opóźniony (autosave), więc testy przewijają zegar
 * jawnie — czekanie „aż samo" zamieniłoby kontrakt w loterię czasową.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const actions = vi.hoisted(() => ({
  upsertSection: vi.fn(),
  reorderSections: vi.fn(),
  toggleSection: vi.fn(),
  duplicateSection: vi.fn(),
  deleteSection: vi.fn(),
  updateTemplate: vi.fn(),
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

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/kreator/site-builder");
const { sectionCanvasFrom, presetContentFor, paintOrder, GRID_UNIT_PX } = await import(
  "@avably/core/site"
);

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const SECTION_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const builder = plMessages.site.builder;
const elements = plMessages.site.elements;

/** Sekcja hero już w kształcie v2 — tak wygląda każda sekcja dodana od K2. */
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
      <SiteBuilder siteId={SITE_ID} template="classic" sections={sections} products={[]} />
    </NextIntlClientProvider>,
  );
}

/** Ramki elementów w KOLEJNOŚCI MALOWANIA (czyli w kolejności w dokumencie). */
function frames(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-element-frame]")];
}

function frameFor(container: HTMLElement, id: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-element-frame="${id}"]`);
  expect(node, `brak ramki elementu ${id}`).not.toBeNull();
  return node!;
}

/** Wymusza wysłanie odłożonego autozapisu. */
async function flushAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(1_500);
  });
}

/** Treść ostatniego zapisu płótna (ostatnie wywołanie upsertSection). */
function lastSavedCanvas() {
  const call = actions.upsertSection.mock.calls.at(-1)?.[0] as { content: unknown } | undefined;
  return call?.content as { elements: { id: string; layout: { desktop: { x: number; y: number; w: number; h: number; z: number } } }[]; rows: number } | undefined;
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

describe("sekcja rodzi się jako płótno z elementami", () => {
  it("płótno rysuje ramkę dla KAŻDEGO elementu sekcji", () => {
    const section = heroSection();
    const { container } = renderBuilder([section]);
    const canvas = section.content as { elements: { id: string }[] };
    expect(frames(container)).toHaveLength(canvas.elements.length);
    expect(canvas.elements.length).toBeGreaterThan(1);
  });

  it("dodanie sekcji z palety zapisuje treść v2, a nie formularz v1", async () => {
    const { baseElement } = renderBuilder([]);
    fireEvent.click(screen.getAllByRole("button", { name: plMessages.site.sections.add })[0]!);
    const tile = await waitFor(() => {
      const node = baseElement.querySelector<HTMLElement>('[data-add-section-tile="hero"]');
      expect(node, "galeria sekcji się nie otworzyła").not.toBeNull();
      return node!;
    });
    fireEvent.click(tile);

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    const content = actions.upsertSection.mock.calls[0]![0].content as { version?: number };
    expect(content.version, "nowa sekcja nie jest płótnem v2").toBe(2);
  });
});

describe("zaznaczenie i uchwyty rozmiaru", () => {
  it("klik w element zaznacza JEDEN element i wystawia osiem uchwytów", () => {
    const { container } = renderBuilder();
    const first = frames(container)[0]!;
    fireEvent.pointerDown(first);

    expect(first.getAttribute("data-element-selected")).toBe("on");
    expect(
      frames(container).filter((frame) => frame.getAttribute("data-element-selected") === "on"),
    ).toHaveLength(1);
    expect(within(first).getAllByRole("button")).toHaveLength(8);
  });

  it("zaznaczenie przenosi się na INNY element, a nie sumuje (multi-select poza zakresem)", () => {
    const { container } = renderBuilder();
    const [first, second] = frames(container);
    fireEvent.pointerDown(first!);
    fireEvent.pointerDown(second!);
    expect(first!.getAttribute("data-element-selected")).toBe("off");
    expect(second!.getAttribute("data-element-selected")).toBe("on");
  });

  it("uchwyt zmienia GEOMETRIĘ w dokumencie i zapisuje ją autozapisem", async () => {
    const section = heroSection();
    const canvas = section.content as { elements: { id: string; layout: { desktop: { h: number } } }[] };
    const target = paintOrder(canvas.elements as never)[0]!;
    const { container } = renderBuilder([section]);

    const frame = frameFor(container, target.id);
    fireEvent.pointerDown(frame);
    const handle = within(frame).getByRole("button", { name: plMessages.site.resizeHandles.s });

    // Ciągnięcie dolnej krawędzi w dół o cztery jednostki siatki. `altKey`
    // zdejmuje przyciąganie do sąsiadów — tu mierzymy SAM ruch krawędzi, a nie
    // to, w co się po drodze wyrówna (od tego jest geometry.test.ts).
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 });
    fireEvent(
      window,
      new MouseEvent("pointermove", { clientX: 100, clientY: 100 + 4 * GRID_UNIT_PX, altKey: true }),
    );
    fireEvent(window, new MouseEvent("pointerup", { clientX: 100, clientY: 100 + 4 * GRID_UNIT_PX }));

    const box = container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;
    const expected = (target.layout.desktop.h + 4) * GRID_UNIT_PX;
    expect(box.style.height, "wysokość pudełka nie poszła za uchwytem").toBe(`${expected}px`);

    await flushAutosave();
    const saved = lastSavedCanvas();
    expect(saved?.elements.find((element) => element.id === target.id)?.layout.desktop.h).toBe(
      target.layout.desktop.h + 4,
    );
  });
});

describe("warstwy", () => {
  it("„na wierzch” przestawia kolejność malowania i zapisuje warstwy", async () => {
    const section = heroSection();
    const { container } = renderBuilder([section]);
    const before = frames(container).map((frame) => frame.getAttribute("data-element-frame"));
    const firstId = before[0]!;

    fireEvent.pointerDown(frameFor(container, firstId));
    fireEvent.click(screen.getByRole("button", { name: elements.toFront }));

    const after = frames(container).map((frame) => frame.getAttribute("data-element-frame"));
    expect(after.at(-1), "element nie wskoczył na wierzch").toBe(firstId);
    expect(after).not.toEqual(before);

    await flushAutosave();
    const saved = lastSavedCanvas();
    const top = saved?.elements.find((element) => element.id === firstId)?.layout.desktop.z ?? -1;
    const others = saved?.elements
      .filter((element) => element.id !== firstId)
      .map((element) => element.layout.desktop.z) ?? [];
    expect(Math.min(...others)).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThan(Math.max(...others));
  });

  it("„na spód” schodzi na pierwszą pozycję malowania", () => {
    const { container } = renderBuilder();
    const lastId = frames(container).at(-1)!.getAttribute("data-element-frame")!;
    fireEvent.pointerDown(frameFor(container, lastId));
    fireEvent.click(screen.getByRole("button", { name: elements.toBack }));
    expect(frames(container)[0]!.getAttribute("data-element-frame")).toBe(lastId);
  });
});

describe("klawiatura", () => {
  it("strzałka przesuwa o JEDNĄ jednostkę, Shift o dziesięć", () => {
    const section = heroSection();
    const canvas = section.content as { elements: { id: string; layout: { desktop: { y: number } } }[] };
    const target = paintOrder(canvas.elements as never)[0]!;
    const { container } = renderBuilder([section]);
    const frame = frameFor(container, target.id);
    const box = () => container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;

    fireEvent.pointerDown(frame);
    fireEvent.keyDown(frame, { key: "ArrowDown" });
    expect(box().style.top).toBe(`${(target.layout.desktop.y + 1) * GRID_UNIT_PX}px`);

    fireEvent.keyDown(frame, { key: "ArrowDown", shiftKey: true });
    expect(box().style.top).toBe(`${(target.layout.desktop.y + 11) * GRID_UNIT_PX}px`);
  });
});

describe("cofnij / ponów", () => {
  it("cofnięcie wraca do układu sprzed zmiany i ZAPISUJE go", async () => {
    const section = heroSection();
    const canvas = section.content as { elements: { id: string; layout: { desktop: { y: number } } }[] };
    const target = paintOrder(canvas.elements as never)[0]!;
    const { container } = renderBuilder([section]);
    const box = () => container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;
    const startTop = box().style.top;

    const frame = frameFor(container, target.id);
    fireEvent.pointerDown(frame);
    fireEvent.keyDown(frame, { key: "ArrowDown", shiftKey: true });
    expect(box().style.top).not.toBe(startTop);

    const undo = container.querySelector<HTMLButtonElement>('[data-builder-history-button="undo"]')!;
    expect(undo.disabled, "cofnij nie zauważyło zmiany").toBe(false);
    fireEvent.click(undo);
    expect(box().style.top).toBe(startTop);

    await flushAutosave();
    expect(lastSavedCanvas()?.elements.find((item) => item.id === target.id)?.layout.desktop.y).toBe(
      target.layout.desktop.y,
    );
  });

  it("ponów wraca do stanu sprzed cofnięcia", () => {
    const section = heroSection();
    const canvas = section.content as { elements: { id: string; layout: { desktop: { y: number } } }[] };
    const target = paintOrder(canvas.elements as never)[0]!;
    const { container } = renderBuilder([section]);
    const box = () => container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;

    const frame = frameFor(container, target.id);
    fireEvent.pointerDown(frame);
    fireEvent.keyDown(frame, { key: "ArrowDown" });
    const movedTop = box().style.top;

    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-builder-history-button="undo"]')!);
    const redo = container.querySelector<HTMLButtonElement>('[data-builder-history-button="redo"]')!;
    expect(redo.disabled).toBe(false);
    fireEvent.click(redo);
    expect(box().style.top).toBe(movedTop);
  });

  it("usunięcie elementu da się cofnąć — dlatego nie pyta o potwierdzenie", () => {
    const { container } = renderBuilder();
    const count = frames(container).length;
    const victim = frames(container)[0]!.getAttribute("data-element-frame")!;

    fireEvent.pointerDown(frameFor(container, victim));
    fireEvent.click(screen.getByRole("button", { name: elements.remove }));
    expect(frames(container)).toHaveLength(count - 1);

    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-builder-history-button="undo"]')!);
    expect(frames(container)).toHaveLength(count);
  });

  it("kopia elementu dokłada JEDEN element o nowym identyfikatorze", () => {
    const { container } = renderBuilder();
    const before = frames(container).map((frame) => frame.getAttribute("data-element-frame"));

    fireEvent.pointerDown(frameFor(container, before[0]!));
    fireEvent.click(screen.getByRole("button", { name: elements.duplicate }));

    const after = frames(container).map((frame) => frame.getAttribute("data-element-frame"));
    expect(after).toHaveLength(before.length + 1);
    expect(new Set(after).size, "kopia dostała ten sam identyfikator co oryginał").toBe(after.length);
  });
});

describe("autozapis geometrii", () => {
  it("idzie kanałem BEZ odświeżenia RSC — inaczej podmieniałby propsy w trakcie ruchu", async () => {
    const section = heroSection();
    const target = paintOrder((section.content as { elements: never[] }).elements)[0]! as {
      id: string;
    };
    const { container } = renderBuilder([section]);
    refresh.mockClear();

    const frame = frameFor(container, target.id);
    fireEvent.pointerDown(frame);
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    await flushAutosave();

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    expect(refresh, "autozapis geometrii odświeżył trasę").not.toHaveBeenCalled();
    expect(container.querySelector("[data-builder-save-state]")?.textContent).toBe(builder.saved);
  });

  it("wiele kroków pod rząd składa się na JEDEN zapis, nie na jeden na klawisz", async () => {
    const section = heroSection();
    const target = paintOrder((section.content as { elements: never[] }).elements)[0]! as {
      id: string;
    };
    const { container } = renderBuilder([section]);
    const frame = frameFor(container, target.id);
    fireEvent.pointerDown(frame);
    for (let step = 0; step < 5; step += 1) fireEvent.keyDown(frame, { key: "ArrowRight" });

    await flushAutosave();
    expect(actions.upsertSection).toHaveBeenCalledTimes(1);
  });
});
