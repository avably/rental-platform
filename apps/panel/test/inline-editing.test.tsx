// @vitest-environment jsdom

/**
 * EDYCJA W MIEJSCU WSPÓŁŻYJE Z GESTEM PŁÓTNA (K3 na silniku K2c — ADR-086
 * + ADR-087).
 *
 * Oba mechanizmy startują z TEGO SAMEGO wciśnięcia na tym samym pudełku, więc
 * granica między nimi jest miejscem, w którym najłatwiej zepsuć jedno drugim.
 * Ten plik pilnuje jej z czterech stron:
 *
 *   1. KLIK otwiera treść — drugie kliknięcie w zaznaczony tekst wchodzi
 *      w edycję, dwuklik działa też na elemencie jeszcze niezaznaczonym;
 *   2. PRZECIĄGNIĘCIE JEJ NIE OTWIERA — po ruchu ponad próg gestu element ma
 *      zmienić pozycję, a nie zacząć przyjmować litery;
 *   3. EDYCJA NIE JEST GESTEM — w jej trakcie flaga `data-dragging` nie
 *      podnosi się ani razu, więc `user-select: none` z arkusza (K2c) nie
 *      odbiera `contenteditable` możliwości zaznaczania tekstu;
 *   4. TREŚĆ WRACA DO SZKICU — zatwierdzenie zapisuje runy i tekst razem,
 *      a Escape kończy edycję.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  // Edytor stawia kursor na końcu treści — jsdom nie ma pełnego Selection API.
  if (!document.createRange().selectNodeContents) {
    Range.prototype.selectNodeContents = vi.fn();
  }
  document.execCommand = vi.fn(() => true);
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
const { sectionCanvasFrom, presetContentFor, paintOrder } = await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const SECTION_ID = "aaaaaaaa-1111-4111-8111-111111111111";

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

function pointer(node: Element, type: string, init: PointerEventInit) {
  fireEvent(node, new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, ...init }));
}

function nextFrame() {
  act(() => {
    vi.advanceTimersToNextFrame();
  });
}

/** Pierwszy element tekstowy sekcji hero w kolejności malowania. */
function firstTextElement(section: Section) {
  const canvas = section.content as { elements: { id: string; kind: string; text?: string }[] };
  const element = paintOrder(canvas.elements as never).find(
    (item) => (item as { kind: string }).kind === "heading",
  );
  return element as unknown as { id: string; text: string };
}

function frameFor(container: HTMLElement, id: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-element-frame="${id}"]`);
  expect(node, `brak ramki elementu ${id}`).not.toBeNull();
  return node!;
}

/** Klik bez ruchu: wciśnięcie, puszczenie, kliknięcie — tak jak robi to myszka. */
function clickNoMove(node: Element) {
  pointer(node, "pointerdown", { clientX: 400, clientY: 300 });
  pointer(node, "pointerup", { clientX: 400, clientY: 300 });
  fireEvent.click(node);
}

/** Przeciągnięcie ponad próg gestu (4 px), zakończone kliknięciem jak w przeglądarce. */
function dragElement(node: Element, dx: number, dy: number) {
  pointer(node, "pointerdown", { clientX: 400, clientY: 300 });
  for (let step = 1; step <= 4; step += 1) {
    pointer(node, "pointermove", { clientX: 400 + (dx * step) / 4, clientY: 300 + (dy * step) / 4 });
    nextFrame();
  }
  pointer(node, "pointerup", { clientX: 400 + dx, clientY: 300 + dy });
  // Przeglądarka po przeciągnięciu i tak wysyła `click` na elemencie startowym.
  fireEvent.click(node);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: SECTION_ID });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("wejście w edycję", () => {
  it("drugi klik w ZAZNACZONY tekst otwiera edytor w miejscu", () => {
    const section = heroSection();
    const target = firstTextElement(section);
    const { container } = renderBuilder([section]);
    const frame = frameFor(container, target.id);

    clickNoMove(frame); // pierwszy klik: zaznaczenie
    expect(container.querySelector("[data-inline-editor]")).toBeNull();

    clickNoMove(frameFor(container, target.id)); // drugi klik: edycja
    const editor = container.querySelector("[data-inline-editor]");
    expect(editor, "drugi klik nie otworzył edytora").not.toBeNull();
    expect(editor?.getAttribute("contenteditable")).toBe("true");
    expect(editor?.textContent).toContain(target.text);
  });

  it("dwuklik otwiera edytor także na elemencie jeszcze niezaznaczonym", () => {
    const section = heroSection();
    const target = firstTextElement(section);
    const { container } = renderBuilder([section]);
    fireEvent.doubleClick(frameFor(container, target.id));
    expect(container.querySelector("[data-inline-editor]")).not.toBeNull();
  });

  it("PRZECIĄGNIĘCIE zaznaczonego tekstu NIE otwiera edytora", () => {
    // Sedno współżycia z silnikiem K2c: zaznaczenie zdarza się na wciśnięciu,
    // bo od niego zaczyna się gest — więc decyzja o edycji musi zapaść dopiero
    // po puszczeniu i tylko wtedy, gdy gest nie ruszył.
    const section = heroSection();
    const target = firstTextElement(section);
    const { container } = renderBuilder([section]);

    clickNoMove(frameFor(container, target.id)); // zaznaczenie
    dragElement(frameFor(container, target.id), 60, 40);

    expect(
      container.querySelector("[data-inline-editor]"),
      "przeciągnięcie zamieniło się w pisanie",
    ).toBeNull();
  });

  it("dwuklik PO przeciągnięciu też nie otwiera edytora", () => {
    const section = heroSection();
    const target = firstTextElement(section);
    const { container } = renderBuilder([section]);
    const frame = frameFor(container, target.id);
    pointer(frame, "pointerdown", { clientX: 400, clientY: 300 });
    pointer(frame, "pointermove", { clientX: 460, clientY: 340 });
    nextFrame();
    pointer(frame, "pointerup", { clientX: 460, clientY: 340 });
    fireEvent.doubleClick(frame);
    expect(container.querySelector("[data-inline-editor]")).toBeNull();
  });

  it("kształt nie ma treści, więc klikanie go NIE otwiera edytora", () => {
    const section = {
      id: SECTION_ID,
      type: "cta",
      position: 0,
      enabled: true,
      content: sectionCanvasFrom("cta", presetContentFor("cta", "pl")),
    } as Section;
    const canvas = section.content as { elements: { id: string; kind: string }[] };
    const shape = canvas.elements.find((element) => element.kind === "shape")!;
    const { container } = renderBuilder([section]);
    clickNoMove(frameFor(container, shape.id));
    clickNoMove(frameFor(container, shape.id));
    expect(container.querySelector("[data-inline-editor]")).toBeNull();
  });
});

describe("edycja NIE jest gestem", () => {
  it("w trakcie edycji flaga gestu nie podnosi się ani razu", () => {
    // `user-select: none` z arkusza (K2c) wisi na `[data-dragging="on"]`.
    // Gdyby edycja podnosiła tę flagę, `contenteditable` przestałby pozwalać
    // na zaznaczanie tekstu — czyli edytor byłby nie do użycia.
    const section = heroSection();
    const target = firstTextElement(section);
    const { container } = renderBuilder([section]);
    const canvas = container.querySelector("[data-builder-canvas]")!;

    clickNoMove(frameFor(container, target.id));
    clickNoMove(frameFor(container, target.id));
    expect(container.querySelector("[data-inline-editor]")).not.toBeNull();
    expect(canvas.getAttribute("data-dragging")).not.toBe("on");

    // Pisanie w edytorze też nie jest gestem.
    const editor = container.querySelector<HTMLElement>("[data-inline-editor]")!;
    fireEvent.keyDown(editor, { key: "a" });
    expect(canvas.getAttribute("data-dragging")).not.toBe("on");
  });

  it("ramka elementu znika na czas edycji — jedno pudełko nie robi dwóch rzeczy naraz", () => {
    const section = heroSection();
    const target = firstTextElement(section);
    const { container } = renderBuilder([section]);
    clickNoMove(frameFor(container, target.id));
    clickNoMove(frameFor(container, target.id));
    expect(container.querySelector(`[data-element-frame="${target.id}"]`)).toBeNull();
    expect(container.querySelector(`[data-element-editing="${target.id}"]`)).not.toBeNull();
  });
});

describe("zatwierdzenie treści", () => {
  it("Escape kończy edycję", () => {
    const section = heroSection();
    const target = firstTextElement(section);
    const { container } = renderBuilder([section]);
    clickNoMove(frameFor(container, target.id));
    clickNoMove(frameFor(container, target.id));

    const editor = container.querySelector<HTMLElement>("[data-inline-editor]")!;
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(container.querySelector("[data-inline-editor]")).toBeNull();
  });

  it("zmieniona treść trafia do szkicu i do zapisu — RAZEM z tekstem prostym", async () => {
    const section = heroSection();
    const target = firstTextElement(section);
    const { container } = renderBuilder([section]);
    clickNoMove(frameFor(container, target.id));
    clickNoMove(frameFor(container, target.id));

    const editor = container.querySelector<HTMLElement>("[data-inline-editor]")!;
    // Tak wygląda drzewo po pogrubieniu fragmentu w `contenteditable`.
    editor.innerHTML = "<h1>Nowy <strong>mocny</strong> tytuł</h1>";
    fireEvent.blur(editor);

    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());

    const saved = actions.upsertSection.mock.calls.at(-1)![0].content as {
      elements: { id: string; text?: string; runs?: { text: string; bold?: boolean }[] }[];
    };
    const element = saved.elements.find((item) => item.id === target.id)!;
    expect(element.text).toBe("Nowy mocny tytuł");
    expect(element.runs).toEqual([{ text: "Nowy " }, { text: "mocny", bold: true }, { text: " tytuł" }]);
  });

  it("skasowanie CAŁEJ treści zostawia poprzednią — pusty element zniknąłby ze strony", () => {
    const section = heroSection();
    const target = firstTextElement(section);
    const { container } = renderBuilder([section]);
    clickNoMove(frameFor(container, target.id));
    clickNoMove(frameFor(container, target.id));

    const editor = container.querySelector<HTMLElement>("[data-inline-editor]")!;
    editor.innerHTML = "";
    fireEvent.blur(editor);

    expect(container.textContent).toContain(target.text);
  });

  it("pasek formatowania ma komplet akcji z etykietami", () => {
    const section = heroSection();
    const target = firstTextElement(section);
    const { container } = renderBuilder([section]);
    clickNoMove(frameFor(container, target.id));
    clickNoMove(frameFor(container, target.id));

    const toolbar = container.querySelector<HTMLElement>("[data-inline-toolbar]")!;
    const buttons = [...toolbar.querySelectorAll("[data-inline-format]")];
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button.getAttribute("aria-label"), "akcja formatowania bez etykiety").toBeTruthy();
    }
  });

  it("wrogi adres linku jest ODRZUCANY w pasku, zanim dojdzie do zapisu", async () => {
    const section = heroSection();
    const target = firstTextElement(section);
    const { container } = renderBuilder([section]);
    clickNoMove(frameFor(container, target.id));
    clickNoMove(frameFor(container, target.id));

    fireEvent.click(screen.getByRole("button", { name: plMessages.site.inline.link }));
    const input = screen.getByLabelText(plMessages.site.inline.linkAddress);
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(container.querySelector<HTMLElement>("[data-inline-link-apply]")!);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(document.execCommand).not.toHaveBeenCalledWith("createLink", false, "javascript:alert(1)");
  });
});

describe("arkusz gestu nie blokuje edycji", () => {
  it("user-select: none jest ZAKRESOWE — tylko płótno i tylko w trakcie gestu", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

    const rule = /\[data-builder-canvas\]\[data-dragging="on"\]\s*\{[^}]*user-select:\s*none/;
    expect(rule.test(css), "reguła wyciszenia zniknęła albo przestała być zakresowa").toBe(true);
    // Gdyby regułę zapisano bez warunku flagi, edytor treści straciłby
    // zaznaczanie na stałe — a tego nie widać w żadnym teście renderu.
    expect(css).not.toMatch(/\[data-builder-canvas\]\s*\{[^}]*user-select:\s*none/);
  });
});
