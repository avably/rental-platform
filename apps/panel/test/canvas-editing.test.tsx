import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * EDYCJA ELEMENTÓW NA PŁÓTNIE (K2, ADR-084; silnik gestów K2c, ADR-087) —
 * kontrakt warstwy klienta.
 *
 * Arytmetykę przyciągania, prowadnic i miary płótna dowodzi `@avably/core` bez
 * DOM-u (geometry.test.ts). TU pilnujemy tego, czego funkcja czysta nie widzi:
 *
 *   1. sekcja rodzi się jako PŁÓTNO — dodanie z palety zapisuje treść v2;
 *   2. klik w element go ZAZNACZA i wystawia osiem uchwytów rozmiaru;
 *   3. gest wskaźnika ZMIENIA GEOMETRIĘ w dokumencie (styl pudełka), a nie
 *      tylko stan w pamięci;
 *   4. warstwy: „na wierzch" przestawia KOLEJNOŚĆ malowania;
 *   5. strzałki przesuwają o jednostkę, Shift o dziesięć;
 *   6. cofnij/ponów wraca do stanu, który operator widział, i ZAPISUJE go;
 *   7. autozapis geometrii idzie kanałem BEZ odświeżenia RSC i NIE blokuje
 *      płótna;
 *   8. cały gest to JEDEN wpis w historii, a płótno na czas gestu wycisza
 *      interfejs najechania i zaznaczanie tekstu.
 *
 * Zapis geometrii jest opóźniony (autosave), więc testy przewijają zegar
 * jawnie — czekanie „aż samo" zamieniłoby kontrakt w loterię czasową.
 *
 * Geometria idzie w DOM-ie procentami obu osi (ADR-087), więc asercje liczą
 * procent z `rows`/`CANVAS_COLUMNS`, a nie piksele. W jsdom płótno nie ma
 * zmierzonej szerokości, więc miara spada na projektową — jednostka ma wtedy
 * dokładnie `GRID_UNIT_PX`, co pozwala pisać ruchy wskaźnika w pikselach.
 *
 * Od K4 (ADR-088) pudełko niesie DWA komplety współrzędnych naraz — desktopowy
 * (`--el-*`) i mobilny (`--el-m*`) — a wybiera między nimi arkusz, zapytaniem
 * o szerokość kontenera. Asercje czytają więc właściwość niestandardową, a nie
 * `style.left`: to nadal jest dowód „geometria trafiła do dokumentu", tylko pod
 * nazwą, którą dokument naprawdę nosi.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  updateSiteStyle: vi.fn(),
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
const { sectionCanvasFrom, presetContentFor, paintOrder, GRID_UNIT_PX, CANVAS_COLUMNS } =
  await import("@avably/core/site");

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
      <SiteBuilder siteId={SITE_ID} siteName="Strona sklepu" style={STYL} sections={sections} products={[]} />
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

/** Płótno sekcji w kształcie v2 — wysokość i elementy potrzebne w asercjach. */
function canvasOf(section: Section) {
  return section.content as unknown as {
    rows: number;
    elements: { id: string; layout: { desktop: { x: number; y: number; w: number; h: number } } }[];
  };
}

/** Procent, którym renderer opisuje pozycję na osi (ADR-087). */
function pct(units: number, span: number): string {
  return `${(units / span) * 100}%`;
}

/**
 * GEST WSKAŹNIKA na przechwyconym węźle. Zdarzenia idą na TEN sam element,
 * który gest zaczął — tak działa `setPointerCapture` i tak trzeba go zawołać
 * w teście. jsdom nie zna `PointerEvent`, więc niesiemy `MouseEvent`
 * z dopisanymi polami wskaźnika: silnik czyta z niego wyłącznie `clientX`,
 * `clientY`, `altKey`, `button`, `isPrimary` i `pointerId`.
 */
function pointer(node: Element, type: string, init: MouseEventInit & { alt?: boolean } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.assign(event, { pointerId: 1, isPrimary: true });
  act(() => {
    node.dispatchEvent(event);
  });
  return event;
}

/**
 * Przewinięcie do NASTĘPNEJ KLATKI. Silnik rysuje ruch w `requestAnimationFrame`,
 * więc test, który klatki nie puszcza, w ogóle nie wchodzi w pętlę rysowania —
 * i przespałby mutację przenoszącą zapis geometrii z powrotem na każdy ruch.
 */
function nextFrame() {
  act(() => {
    vi.advanceTimersToNextFrame();
  });
}

/** Pełne przeciągnięcie: wciśnięcie, `steps` ruchów po drodze, puszczenie. */
function drag(
  node: Element,
  { dx, dy, steps = 4, alt = false }: { dx: number; dy: number; steps?: number; alt?: boolean },
) {
  const startX = 400;
  const startY = 300;
  pointer(node, "pointerdown", { clientX: startX, clientY: startY });
  for (let step = 1; step <= steps; step += 1) {
    pointer(node, "pointermove", {
      clientX: startX + (dx * step) / steps,
      clientY: startY + (dy * step) / steps,
      altKey: alt,
    });
    nextFrame();
  }
  pointer(node, "pointerup", { clientX: startX + dx, clientY: startY + dy });
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
    const canvas = canvasOf(section);
    const target = paintOrder(canvas.elements as never)[0]! as (typeof canvas.elements)[number];
    const { container } = renderBuilder([section]);

    const frame = frameFor(container, target.id);
    // Zaznaczenie DOMKNIĘTYM kliknięciem: samo wciśnięcie zostawiłoby na ramce
    // gest w toku, a ruchy uchwytu przechodzą przez nią bąbelkiem.
    drag(frame, { dx: 0, dy: 0, steps: 1 });
    const handle = within(frame).getByRole("button", { name: plMessages.site.resizeHandles.s });

    // Ciągnięcie dolnej krawędzi w dół o cztery jednostki siatki. `altKey`
    // zdejmuje przyciąganie do sąsiadów — tu mierzymy SAM ruch krawędzi, a nie
    // to, w co się po drodze wyrówna (od tego jest geometry.test.ts).
    drag(handle, { dx: 0, dy: 4 * GRID_UNIT_PX, alt: true });

    const box = container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;
    expect(box.style.getPropertyValue("--el-h"), "wysokość pudełka nie poszła za uchwytem").toBe(
      pct(target.layout.desktop.h + 4, canvas.rows),
    );

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
    const canvas = canvasOf(section);
    const target = paintOrder(canvas.elements as never)[0]! as (typeof canvas.elements)[number];
    const { container } = renderBuilder([section]);
    const frame = frameFor(container, target.id);
    const box = () => container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;

    fireEvent.pointerDown(frame);
    fireEvent.keyDown(frame, { key: "ArrowDown" });
    expect(box().style.getPropertyValue("--el-y")).toBe(pct(target.layout.desktop.y + 1, canvas.rows));

    fireEvent.keyDown(frame, { key: "ArrowDown", shiftKey: true });
    expect(box().style.getPropertyValue("--el-y")).toBe(pct(target.layout.desktop.y + 11, canvas.rows));
  });
});

describe("cofnij / ponów", () => {
  it("cofnięcie wraca do układu sprzed zmiany i ZAPISUJE go", async () => {
    const section = heroSection();
    const canvas = section.content as { elements: { id: string; layout: { desktop: { y: number } } }[] };
    const target = paintOrder(canvas.elements as never)[0]!;
    const { container } = renderBuilder([section]);
    const box = () => container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;
    const startTop = box().style.getPropertyValue("--el-y");

    const frame = frameFor(container, target.id);
    fireEvent.pointerDown(frame);
    fireEvent.keyDown(frame, { key: "ArrowDown", shiftKey: true });
    expect(box().style.getPropertyValue("--el-y")).not.toBe(startTop);

    const undo = container.querySelector<HTMLButtonElement>('[data-builder-history-button="undo"]')!;
    expect(undo.disabled, "cofnij nie zauważyło zmiany").toBe(false);
    fireEvent.click(undo);
    expect(box().style.getPropertyValue("--el-y")).toBe(startTop);

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
    const movedTop = box().style.getPropertyValue("--el-y");

    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-builder-history-button="undo"]')!);
    const redo = container.querySelector<HTMLButtonElement>('[data-builder-history-button="redo"]')!;
    expect(redo.disabled).toBe(false);
    fireEvent.click(redo);
    expect(box().style.getPropertyValue("--el-y")).toBe(movedTop);
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

  it("zapis w tle NIE blokuje płótna — kolejny gest idzie od razu", async () => {
    // Zapis, który nigdy nie odpowiada: dokładnie ten stan, w którym operator
    // dostawał wyszarzone paski i kursor „zakaz" między jednym ruchem a drugim.
    actions.upsertSection.mockReturnValue(new Promise(() => {}));
    const section = heroSection();
    const canvas = canvasOf(section);
    const target = paintOrder(canvas.elements as never)[0]! as (typeof canvas.elements)[number];
    const { container } = renderBuilder([section]);

    drag(frameFor(container, target.id), { dx: 3 * GRID_UNIT_PX, dy: 0, alt: true });
    await flushAutosave();
    expect(actions.upsertSection, "autozapis w ogóle nie wyszedł").toHaveBeenCalled();

    const undo = container.querySelector<HTMLButtonElement>('[data-builder-history-button="undo"]')!;
    expect(undo.disabled, "zapis w tle wyłączył historię płótna").toBe(false);
    const duplicate = screen.getByRole("button", {
      name: plMessages.site.sections.duplicate,
    }) as HTMLButtonElement;
    expect(duplicate.disabled, "zapis w tle wyszarzył pasek narzędzi sekcji").toBe(false);

    // Drugi gest w trakcie trwającego zapisu musi dojść do skutku.
    const box = () => container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;
    const afterFirst = box().style.getPropertyValue("--el-x");
    drag(frameFor(container, target.id), { dx: 3 * GRID_UNIT_PX, dy: 0, alt: true });
    expect(box().style.getPropertyValue("--el-x")).not.toBe(afterFirst);
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

/**
 * SILNIK GESTÓW (K2c, ADR-087). Werdykt właściciela z produkcji brzmiał
 * „przesuwanie działa bardzo źle", a przyczyny leżały w trzech różnych
 * miejscach naraz. Każdy test niżej broni jednej z nich — i każdy zapala się na
 * czerwono po cofnięciu dokładnie tej jednej zmiany.
 */
describe("gest wskaźnika: jeden ruch, jeden wpis, jedno przyciągnięcie", () => {
  function firstElement(section: Section) {
    const canvas = canvasOf(section);
    return paintOrder(canvas.elements as never)[0]! as (typeof canvas.elements)[number];
  }

  it("CAŁE przeciągnięcie to JEDEN wpis w historii — cofnij wraca na start jednym kliknięciem", () => {
    const section = heroSection();
    const target = firstElement(section);
    const { container } = renderBuilder([section]);
    const box = () => container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;
    const start = { left: box().style.getPropertyValue("--el-x"), top: box().style.getPropertyValue("--el-y") };

    // Osiem kroków pośrednich: gdyby commit szedł na KAŻDY ruch, historia
    // dostałaby osiem wpisów i jedno cofnięcie zdjęłoby tylko ostatni piksel.
    drag(frameFor(container, target.id), {
      dx: 6 * GRID_UNIT_PX,
      dy: 3 * GRID_UNIT_PX,
      steps: 8,
      alt: true,
    });
    expect(box().style.getPropertyValue("--el-x"), "element nie ruszył się w ogóle").not.toBe(start.left);

    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-builder-history-button="undo"]')!);
    expect(box().style.getPropertyValue("--el-x"), "cofnij cofnęło mniej niż cały gest").toBe(start.left);
    expect(box().style.getPropertyValue("--el-y")).toBe(start.top);
    expect(
      container.querySelector<HTMLButtonElement>('[data-builder-history-button="undo"]')!.disabled,
      "po jednym cofnięciu w historii został jeszcze jeden wpis z tego samego gestu",
    ).toBe(true);
  });

  it("w trakcie ruchu szkic STOI — geometria powstaje dopiero przy puszczeniu", () => {
    const section = heroSection();
    const target = firstElement(section);
    const { container } = renderBuilder([section]);
    const box = () => container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;
    const frame = frameFor(container, target.id);
    const startLeft = box().style.getPropertyValue("--el-x");

    pointer(frame, "pointerdown", { clientX: 400, clientY: 300 });
    pointer(frame, "pointermove", { clientX: 400 + 5 * GRID_UNIT_PX, clientY: 300, altKey: true });
    nextFrame();
    pointer(frame, "pointermove", { clientX: 400 + 9 * GRID_UNIT_PX, clientY: 300, altKey: true });
    nextFrame();

    expect(box().style.getPropertyValue("--el-x"), "ruch dopisał geometrię do szkicu przed puszczeniem").toBe(startLeft);
    expect(
      container.querySelector<HTMLButtonElement>('[data-builder-history-button="undo"]')!.disabled,
      "ruch dopisał wpis do historii przed puszczeniem",
    ).toBe(true);

    pointer(frame, "pointerup", { clientX: 400 + 9 * GRID_UNIT_PX, clientY: 300 });
    expect(box().style.getPropertyValue("--el-x"), "puszczenie nie zapisało geometrii").not.toBe(startLeft);
  });

  it("sam klik ZAZNACZA i nic nie rusza — próg gestu chroni przed przyciągnięciem bez ruchu", () => {
    const section = heroSection();
    const target = firstElement(section);
    const { container } = renderBuilder([section]);
    const box = () => container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;
    const start = { left: box().style.getPropertyValue("--el-x"), top: box().style.getPropertyValue("--el-y") };
    const frame = frameFor(container, target.id);

    pointer(frame, "pointerdown", { clientX: 400, clientY: 300 });
    pointer(frame, "pointermove", { clientX: 401, clientY: 300 });
    pointer(frame, "pointerup", { clientX: 401, clientY: 300 });

    expect(frame.getAttribute("data-element-selected")).toBe("on");
    expect(box().style.getPropertyValue("--el-x"), "klik przesunął element").toBe(start.left);
    expect(box().style.getPropertyValue("--el-y")).toBe(start.top);
    expect(
      container.querySelector<HTMLButtonElement>('[data-builder-history-button="undo"]')!.disabled,
      "klik bez ruchu dopisał wpis do historii",
    ).toBe(true);
  });

  it("płótno na czas gestu nosi `data-dragging` i zdejmuje je przy puszczeniu", () => {
    const section = heroSection();
    const target = firstElement(section);
    const { container } = renderBuilder([section]);
    const root = container.querySelector<HTMLElement>("[data-builder-canvas]")!;
    const frame = frameFor(container, target.id);

    expect(root.getAttribute("data-dragging")).toBeNull();
    pointer(frame, "pointerdown", { clientX: 400, clientY: 300 });
    expect(root.getAttribute("data-dragging"), "płótno nie wie, że trwa gest").toBe("on");

    pointer(frame, "pointermove", { clientX: 440, clientY: 300, altKey: true });
    expect(root.getAttribute("data-dragging")).toBe("on");

    pointer(frame, "pointerup", { clientX: 440, clientY: 300 });
    expect(root.getAttribute("data-dragging"), "flaga gestu została po puszczeniu").toBeNull();
  });

  it("gest przerwany przez system (`pointercancel`) sprząta po sobie", () => {
    const section = heroSection();
    const target = firstElement(section);
    const { container } = renderBuilder([section]);
    const root = container.querySelector<HTMLElement>("[data-builder-canvas]")!;
    const frame = frameFor(container, target.id);

    pointer(frame, "pointerdown", { clientX: 400, clientY: 300 });
    pointer(frame, "pointercancel", { clientX: 400, clientY: 300 });
    expect(root.getAttribute("data-dragging")).toBeNull();
  });

  it("przeciągnięcie poza sekcję zatrzymuje element W płótnie, nie pod kartą", () => {
    const section = heroSection();
    const canvas = canvasOf(section);
    const target = firstElement(section);
    const { container } = renderBuilder([section]);
    const box = () => container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;

    // Ruch daleko poza prawy dolny róg płótna — tysiąc jednostek w każdą stronę.
    drag(frameFor(container, target.id), {
      dx: 1000 * GRID_UNIT_PX,
      dy: 1000 * GRID_UNIT_PX,
      alt: true,
    });

    expect(box().style.getPropertyValue("--el-y"), "element wyjechał pod widoczną kartę sekcji").toBe(
      pct(canvas.rows - target.layout.desktop.h, canvas.rows),
    );
    expect(box().style.getPropertyValue("--el-x"), "element wyjechał poza prawą krawędź sekcji").toBe(
      pct(CANVAS_COLUMNS - target.layout.desktop.w, CANVAS_COLUMNS),
    );
  });
});

/**
 * ZAZNACZANIE TEKSTU I INTERFEJS NAJECHANIA (K2c, ADR-087).
 *
 * Reguły są w arkuszu, a nie w Reakcie — świadomie, bo ich zadaniem jest NIE
 * wywoływać przerysowania w środku ruchu. jsdom nie stosuje arkuszy z plików,
 * więc kontrakt broni ŹRÓDŁA: flaga `data-dragging` (dowiedziona wyżej na
 * dokumencie) musi mieć po drugiej stronie regułę, która coś robi.
 */
describe("arkusz płótna wycisza gest", () => {
  const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
  const dragScope = css.slice(css.indexOf('[data-builder-canvas][data-dragging="on"]'));

  it("plik naprawdę zawiera blok gestu (kontrola pozytywna)", () => {
    expect(css).toContain('[data-builder-canvas][data-dragging="on"]');
    expect(dragScope.length).toBeGreaterThan(100);
  });

  it("na czas gestu płótno nie daje się zaznaczyć — z prefiksem dla Safari", () => {
    expect(dragScope, "brak `user-select: none` na czas gestu").toMatch(/user-select:\s*none/);
    expect(dragScope, "brak wariantu -webkit- (Safari)").toMatch(/-webkit-user-select:\s*none/);
  });

  it("na czas gestu znika pasek narzędzi, miejsca wstawienia i obrys sekcji", () => {
    for (const marker of ["data-section-toolbar", "data-insert-slot", "data-section-outline"]) {
      expect(dragScope, `interfejs najechania zostaje w trakcie gestu: ${marker}`).toContain(marker);
    }
  });
});

// -----------------------------------------------------------------------
// TŁO PEŁNOEKRANOWE ZOSTAJE EDYTOWALNE (regres z recenzji PR #172)
// -----------------------------------------------------------------------

/**
 * Sekcja z hero na PEŁNYM KADRZE: zdjęcie i welon rozciągnięte na całą
 * szerokość płótna, tekst w kolumnie. Dokładnie ten kształt, który produkuje
 * archetyp `overlay` szablonów startowych.
 */
function heroPelnoekranowy(): Section {
  const base = sectionCanvasFrom("hero", presetContentFor("hero", "pl")) as unknown as {
    version: 2;
    rows: number;
    background: "default";
    elements: unknown[];
  };
  const tlo = [
    {
      id: "hero-image-1",
      kind: "image",
      alt: "Kadr hero",
      fit: "cover",
      layout: { desktop: { x: 0, y: 0, w: CANVAS_COLUMNS, h: base.rows, z: 0 } },
    },
    {
      id: "hero-shape-1",
      kind: "shape",
      shape: "box",
      fill: "scrim",
      layout: { desktop: { x: 0, y: 0, w: CANVAS_COLUMNS, h: base.rows, z: 1 } },
    },
  ];
  return {
    id: SECTION_ID,
    type: "hero",
    position: 0,
    enabled: true,
    content: { ...base, elements: [...tlo, ...base.elements] },
  } as unknown as Section;
}

describe("element pełnoekranowy nie wypada z warstwy edycyjnej", () => {
  it("KAŻDY element sekcji ma ramkę — także zdjęcie i welon rozciągnięte na całe płótno", () => {
    // Regres z recenzji PR #172: elementy tła malowały się w osobnej warstwie
    // i BYŁY ODFILTROWANE z siatki, czyli z jedynego miejsca, przez które
    // kreator wnosi ramkę. Rozciągnięcie zdjęcia na pełną szerokość odbierało
    // do niego dostęp na zawsze — pułapka jednokierunkowa.
    const section = heroPelnoekranowy();
    const { container } = renderBuilder([section]);

    const wszystkie = canvasOf(section).elements.map((element) => element.id);
    expect(wszystkie, "fixture bez tła — kontrola po pustym zbiorze").toContain("hero-image-1");

    const zRamka = frames(container).map((node) => node.getAttribute("data-element-frame"));
    expect(zRamka.length, `ramek ${zRamka.length} przy ${wszystkie.length} elementach`).toBe(
      wszystkie.length,
    );
    for (const id of ["hero-image-1", "hero-shape-1"]) {
      expect(zRamka, `element pełnoekranowy ${id} bez ramki`).toContain(id);
    }
  });

  it("tło maluje się RAZ — w warstwie pełnoekranowej, nie dwa razy", () => {
    // Ramka w siatce nie może oznaczać drugiego renderu zdjęcia: dwa <img> to
    // dwa pobrania i dwa różne kadry przy każdej zmianie.
    const { container } = renderBuilder([heroPelnoekranowy()]);
    const kopie = container.querySelectorAll('[data-element-id="hero-image-1"]');
    expect(kopie).toHaveLength(1);
    expect(
      container.querySelector("[data-canvas-bleed]")?.contains(kopie[0]!),
      "tło wyrenderowało się poza warstwą pełnoekranową",
    ).toBe(true);
  });

  it("klik w zdjęcie hero zaznacza je, a drugi otwiera picker — scenariusz właściciela", () => {
    const { container } = renderBuilder([heroPelnoekranowy()]);
    const frame = frameFor(container, "hero-image-1");

    /** Klik BEZ ruchu — gest nie przekracza progu, więc kończy się zaznaczeniem. */
    const clickNoMove = (node: Element) => {
      pointer(node, "pointerdown", { clientX: 400, clientY: 300 });
      pointer(node, "pointerup", { clientX: 400, clientY: 300 });
      act(() => {
        node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };

    clickNoMove(frame);
    expect(frame.getAttribute("data-element-selected"), "zdjęcie tła nie dało się zaznaczyć").toBe("on");

    clickNoMove(frameFor(container, "hero-image-1"));
    // Dialog wyboru zdjęcia renderuje się w PORTALU (poza kontenerem testu).
    expect(
      document.querySelector("[data-image-picker]"),
      "drugi klik w zdjęcie tła nie otworzył wyboru zdjęcia",
    ).not.toBeNull();
  });
});
