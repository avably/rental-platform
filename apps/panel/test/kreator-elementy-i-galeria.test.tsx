// @vitest-environment jsdom

/**
 * MARTWE KAFLE, KOLIZJA WSTAWIENIA, CICHA KONWERSJA I ZNIKAJĄCA GALERIA
 * (K-09, K-11, K-12, K-15, K-20 — audyt UX 2026-08-25).
 *
 * ===================== CZTERY MILCZENIA, KTÓRE TEN PLIK ZAMYKA =====================
 *
 *   1. K-09: na stronie BEZ SEKCJI kafle „Elementy" wyglądały normalnie i po
 *      kliknięciu nie robiły NIC — `addElement` wychodził przez `return` przy
 *      pustej liście sekcji. Operator klikał kilka razy i szedł szukać wady
 *      w przeglądarce;
 *   2. K-11: klik kafla na sekcji WYPEŁNIONEJ kładł nowy element NA treści —
 *      `freeSpotFor` przycinał pozycję do wysokości sekcji (`rows - h`), więc
 *      gdy zapasu nie było, „pod spodem" znaczyło „na wierzchu";
 *   3. K-12: pierwszy element w sekcji ZASTANEJ (v1) przepisywał ją na
 *      swobodne płótno — bez pytania i bez śladu. Układ przestawał być
 *      automatyczny, a operator dowiadywał się o tym z zachowania sekcji;
 *   4. K-20: widoczność galerii szablonów była liczona RAZ, w inicjalizatorze
 *      stanu. Nawigacja klienta między kreatorami nie montuje komponentu od
 *      nowa, więc na świeżej, pustej stronie galeria potrafiła się nie pokazać
 *      — a z pustego płótna nie było do niej żadnej drogi powrotnej.
 *
 * ===================== CO JEST MIERZONE =====================
 *
 * Na PRAWDZIWYM `SiteBuilder`, przez klik i przez treść, którą zobaczyłby
 * serwer (`upsertSection`), a nie przez stan komponentu. Zapis geometrii jest
 * odłożony (autozapis), więc zegar przewijamy jawnie — czekanie „aż samo"
 * zamieniłoby kontrakt w loterię czasową.
 */
import { DEFAULT_SITE_STYLE } from "@avably/core/site";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
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
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/site", () => actions);
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder");
const { sectionCanvasFrom, presetContentFor } = await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const INNY_SITE_ID = "88888888-8888-4888-8888-888888888888";
const SECTION_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const builder = plMessages.site.builder;
const starter = plMessages.site.starter;

interface Canvas {
  rows: number;
  elements: {
    id: string;
    kind: string;
    layout: { desktop: { x: number; y: number; w: number; h: number; z: number } };
  }[];
}

/** Najniższa krawędź treści sekcji w jednostkach siatki. */
function bottomOf(canvas: Canvas): number {
  return canvas.elements.reduce(
    (lowest, element) => Math.max(lowest, element.layout.desktop.y + element.layout.desktop.h),
    0,
  );
}

/**
 * Sekcja WYPEŁNIONA PO BRZEGI — wysokość płótna równa najniższej krawędzi
 * treści. To jest kształt każdej gotowej sekcji z szablonu (wysokość dobrana
 * do treści) i dokładnie ten, w którym stara arytmetyka kładła nowy element na
 * istniejącym.
 */
function pelnaSekcja(): { section: Section; canvas: Canvas } {
  const canvas = sectionCanvasFrom("hero", presetContentFor("hero", "pl")) as unknown as Canvas;
  const wypelniona: Canvas = { ...canvas, rows: Math.max(8, bottomOf(canvas)) };
  return {
    section: {
      id: SECTION_ID,
      type: "hero",
      position: 0,
      enabled: true,
      deletedInDraft: false,
      published: true,
      content: wypelniona,
    } as unknown as Section,
    canvas: wypelniona,
  };
}

/** Sekcja w generacji ZASTANEJ (v1) — zwykły obiekt treści, bez płótna. */
function sekcjaV1(id = SECTION_ID, position = 0): Section {
  return {
    id,
    type: "hero",
    position,
    enabled: true,
    deletedInDraft: false,
    published: true,
    content: presetContentFor("hero", "pl"),
  } as unknown as Section;
}

function renderBuilder(sections: Section[], siteId = SITE_ID) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={siteId}
        siteName="Strona sklepu"
        style={STYL}
        sections={sections}
        products={[]}
        money={{ currency: "PLN", locale: "pl" }}
      />
    </NextIntlClientProvider>,
  );
}

function przeladuj(
  rerender: (ui: React.ReactElement) => void,
  sections: Section[],
  siteId: string,
) {
  rerender(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={siteId}
        siteName="Strona sklepu"
        style={STYL}
        sections={sections}
        products={[]}
        money={{ currency: "PLN", locale: "pl" }}
      />
    </NextIntlClientProvider>,
  );
}

/** Otwiera zakładkę „Elementy" i oddaje jej panel. */
function paletaElementow(container: HTMLElement): HTMLElement {
  fireEvent.click(container.querySelector<HTMLElement>('[data-palette-tab="elements"]')!);
  const panel = container.querySelector<HTMLElement>("[data-palette-elements]");
  expect(panel, "panel elementów się nie otworzył").not.toBeNull();
  return panel!;
}

async function flushAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(1_500);
  });
}

/** Treść ostatniego zapisu sekcji — tak, jak zobaczyłby ją serwer. */
function ostatniZapis(): Canvas | undefined {
  const call = actions.upsertSection.mock.calls.at(-1)?.[0] as { content: Canvas } | undefined;
  return call?.content;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  refresh.mockClear();
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: SECTION_ID });
  actions.reorderSections.mockResolvedValue({ ok: true });
  actions.applyStarterTemplate.mockResolvedValue({ ok: true, sectionIds: [] });
  actions.publishSite.mockResolvedValue({ ok: true, publishedAt: "2026-08-25T10:00:00Z" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("K-09: paleta elementów nie udaje, że działa bez sekcji", () => {
  it("na stronie BEZ SEKCJI kafle są wygaszone i mówią, co zrobić najpierw", () => {
    const { container } = renderBuilder([]);
    // Galeria zasłania płótno na pustej stronie — paleta stoi obok i tak.
    const panel = paletaElementow(container);

    const kafle = [...panel.querySelectorAll<HTMLButtonElement>("[data-element-tile]")];
    expect(kafle.length, "paleta nie ma ani jednego kafla — sonda mierzy nie to, co trzeba")
      .toBeGreaterThan(0);

    const hint = panel.querySelector<HTMLElement>("[data-element-palette-hint]")!;
    expect(hint.dataset.elementPaletteHint).toBe("blocked");
    expect(hint.textContent).toBe(builder.tabElementsNoTarget);

    for (const kafel of kafle) {
      expect(kafel.disabled, `kafel ${kafel.dataset.elementTile} nie jest wygaszony`).toBe(true);
      expect(kafel.getAttribute("aria-disabled")).toBe("true");
      expect(kafel.getAttribute("aria-describedby")).toBe(hint.id);
    }
  });

  it("klik w wygaszony kafel NIE zapisuje niczego", async () => {
    const { container } = renderBuilder([]);
    const panel = paletaElementow(container);
    fireEvent.click(panel.querySelector<HTMLElement>('[data-element-tile="heading"]')!);
    await flushAutosave();
    expect(actions.upsertSection).not.toHaveBeenCalled();
  });

  it("gdy sekcja JEST, kafle działają i podpowiedź wraca do instrukcji", () => {
    const { container } = renderBuilder([pelnaSekcja().section]);
    const panel = paletaElementow(container);
    const hint = panel.querySelector<HTMLElement>("[data-element-palette-hint]")!;
    expect(hint.dataset.elementPaletteHint).toBe("ready");
    expect(hint.textContent).toBe(builder.tabElementsHint);
    for (const kafel of panel.querySelectorAll<HTMLButtonElement>("[data-element-tile]")) {
      expect(kafel.disabled).toBe(false);
    }
  });
});

describe("K-11: kliknięty element ląduje POD treścią, a sekcja rośnie", () => {
  it("w sekcji wypełnionej po brzegi nowy element nie nachodzi na istniejące", async () => {
    const { section, canvas } = pelnaSekcja();
    const dno = bottomOf(canvas);
    // Kontrola przyrządu: sekcja MUSI być pełna, inaczej test niczego nie mierzy.
    expect(canvas.rows).toBe(dno);
    expect(canvas.elements.length).toBeGreaterThan(0);

    const { container } = renderBuilder([section]);
    const panel = paletaElementow(container);
    fireEvent.click(panel.querySelector<HTMLElement>('[data-element-tile="heading"]')!);
    await flushAutosave();

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    const zapis = ostatniZapis()!;
    expect(zapis.elements).toHaveLength(canvas.elements.length + 1);

    const nowy = zapis.elements.at(-1)!.layout.desktop;
    expect(
      nowy.y,
      `nowy element stoi na wysokości ${nowy.y}, a treść sekcji kończy się na ${dno}`,
    ).toBeGreaterThanOrEqual(dno);
    // Sekcja MUSI urosnąć — inaczej schemat odrzuciłby zapis (element poza płótnem).
    expect(zapis.rows).toBeGreaterThanOrEqual(nowy.y + nowy.h);
    expect(zapis.rows).toBeGreaterThan(canvas.rows);

    // Żadne z istniejących pudełek nie leży pod nowym.
    for (const element of zapis.elements.slice(0, -1)) {
      const box = element.layout.desktop;
      const nachodzi =
        box.x < nowy.x + nowy.w &&
        nowy.x < box.x + box.w &&
        box.y < nowy.y + nowy.h &&
        nowy.y < box.y + box.h;
      expect(nachodzi, `nowy element nachodzi na ${element.id}`).toBe(false);
    }
  });
});

describe("K-12: przejście sekcji zastanej na swobodne płótno ma potwierdzenie", () => {
  it("klik kafla otwiera pytanie i NIE zapisuje niczego, dopóki nie padnie zgoda", async () => {
    const { container, baseElement } = renderBuilder([sekcjaV1()]);
    const panel = paletaElementow(container);
    fireEvent.click(panel.querySelector<HTMLElement>('[data-element-tile="heading"]')!);

    const dialog = await waitFor(() => {
      const node = baseElement.querySelector<HTMLElement>("[data-builder-convert-dialog]");
      expect(node, "okno konwersji się nie otworzyło").not.toBeNull();
      return node!;
    });
    expect(dialog.textContent).toContain(builder.convertBody);

    await flushAutosave();
    expect(actions.upsertSection, "sekcja poszła do zapisu przed zgodą").not.toHaveBeenCalled();
  });

  it("po potwierdzeniu element wchodzi", async () => {
    const { container, baseElement } = renderBuilder([sekcjaV1()]);
    const panel = paletaElementow(container);
    fireEvent.click(panel.querySelector<HTMLElement>('[data-element-tile="heading"]')!);

    const przycisk = await waitFor(() => {
      const node = baseElement.querySelector<HTMLElement>("[data-builder-convert-confirm]");
      expect(node).not.toBeNull();
      return node!;
    });
    fireEvent.click(przycisk);
    await flushAutosave();

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    const zapis = ostatniZapis()!;
    expect(zapis.elements.some((element) => element.kind === "heading")).toBe(true);
  });

  it("anulowanie zostawia sekcję w spokoju", async () => {
    const { container, baseElement } = renderBuilder([sekcjaV1()]);
    const panel = paletaElementow(container);
    fireEvent.click(panel.querySelector<HTMLElement>('[data-element-tile="text"]')!);

    const dialog = await waitFor(() => {
      const node = baseElement.querySelector<HTMLElement>("[data-builder-convert-dialog]");
      expect(node).not.toBeNull();
      return node!;
    });
    fireEvent.click(within(dialog).getByRole("button", { name: builder.convertCancel }));
    await flushAutosave();
    expect(actions.upsertSection).not.toHaveBeenCalled();
  });

  it("„nie pytaj ponownie” gasi pytanie dla NASTĘPNEJ sekcji zastanej", async () => {
    const DRUGA = "bbbbbbbb-2222-4222-8222-222222222222";
    const { container, baseElement } = renderBuilder([sekcjaV1(), sekcjaV1(DRUGA, 1)]);
    const panel = paletaElementow(container);

    fireEvent.click(panel.querySelector<HTMLElement>('[data-element-tile="heading"]')!);
    const dialog = await waitFor(() => {
      const node = baseElement.querySelector<HTMLElement>("[data-builder-convert-dialog]");
      expect(node).not.toBeNull();
      return node!;
    });
    fireEvent.click(dialog.querySelector<HTMLElement>("[data-builder-convert-remember]")!);
    fireEvent.click(dialog.querySelector<HTMLElement>("[data-builder-convert-confirm]")!);
    await flushAutosave();

    // Zaznaczamy DRUGĄ sekcję, żeby kafel trafił w nią, a nie w pierwszą
    // (która jest już płótnem i tak by nie zapytała).
    fireEvent.pointerDown(container.querySelector<HTMLElement>(`[data-canvas-section="${DRUGA}"]`)!);
    fireEvent.click(panel.querySelector<HTMLElement>('[data-element-tile="text"]')!);
    await flushAutosave();

    expect(baseElement.querySelector("[data-builder-convert-dialog]")).toBeNull();
    const zapisy = actions.upsertSection.mock.calls.map((call) => (call[0] as { sectionId: string }).sectionId);
    expect(zapisy).toContain(DRUGA);
  });
});

describe("K-20: galeria punktów wyjścia jest deterministyczna i ma drogę powrotną", () => {
  it("strona BEZ SEKCJI pokazuje galerię, strona z treścią — nie", () => {
    const pusta = renderBuilder([]);
    expect(pusta.container.querySelector("[data-template-gallery]")).not.toBeNull();
    cleanup();

    const zTrescia = renderBuilder([pelnaSekcja().section]);
    expect(zTrescia.container.querySelector("[data-template-gallery]")).toBeNull();
  });

  it("PRZEJŚCIE z gotowej strony na świeżą, pustą też ją pokazuje (wada wyścigu)", () => {
    // Ta sama instancja komponentu, inna strona — dokładnie to, co robi
    // nawigacja klienta między kreatorami. Warunek liczony RAZ, w
    // inicjalizatorze stanu, zostawiłby galerię zamkniętą.
    const { container, rerender } = renderBuilder([pelnaSekcja().section], SITE_ID);
    expect(container.querySelector("[data-template-gallery]")).toBeNull();

    przeladuj(rerender, [], INNY_SITE_ID);
    expect(
      container.querySelector("[data-template-gallery]"),
      "galeria nie pokazała się na świeżej, pustej stronie",
    ).not.toBeNull();
  });

  it("WOLA OPERATORA nie przenosi się na inną stronę", async () => {
    // Operator zamknął galerię na stronie, która treść MA („wróć do kreatora").
    // Ta odpowiedź dotyczy TAMTEJ strony — świeża, pusta zadaje pytanie od nowa.
    const { container, rerender } = renderBuilder([pelnaSekcja().section], SITE_ID);
    fireEvent.click(container.querySelector<HTMLElement>("[data-builder-start-over]")!);
    fireEvent.click(document.querySelector<HTMLElement>("[data-start-over-confirm]")!);
    await waitFor(() =>
      expect(container.querySelector("[data-template-gallery]")).not.toBeNull(),
    );
    fireEvent.click(container.querySelector<HTMLElement>("[data-template-gallery-dismiss]")!);
    expect(container.querySelector("[data-template-gallery]")).toBeNull();

    przeladuj(rerender, [], INNY_SITE_ID);
    expect(
      container.querySelector("[data-template-gallery]"),
      "zamknięcie galerii na jednej stronie zgasiło ją na innej",
    ).not.toBeNull();
  });

  it("z pustego płótna prowadzi droga POWROTNA do szablonów", async () => {
    const { container } = renderBuilder([]);
    // „Pusta strona” zamyka galerię — od tej chwili operator stoi na pustym płótnie.
    fireEvent.click(container.querySelector<HTMLElement>("[data-starter-empty]")!);
    await waitFor(() =>
      expect(container.querySelector("[data-template-gallery]")).toBeNull(),
    );

    const powrot = container.querySelector<HTMLElement>("[data-canvas-start-from-template]");
    expect(powrot, "puste płótno nie ma wejścia do szablonów").not.toBeNull();
    expect(powrot!.textContent).toContain(starter.startFromTemplate);

    fireEvent.click(powrot!);
    expect(container.querySelector("[data-template-gallery]")).not.toBeNull();
  });
});

describe("K-15: treść, w którą można wejść, mówi o tym ołówkiem", () => {
  it("ramka elementu tekstowego niesie podpowiedź edycji, kształt — nie", () => {
    const { section, canvas } = pelnaSekcja();
    const { container } = renderBuilder([section]);

    const tekstowy = canvas.elements.find(
      (element) => element.kind === "heading" || element.kind === "text",
    );
    expect(tekstowy, "sekcja hero nie ma elementu tekstowego — sonda mierzy nie to, co trzeba")
      .toBeDefined();

    const ramka = container.querySelector<HTMLElement>(
      `[data-element-frame="${tekstowy!.id}"]`,
    )!;
    const hint = ramka.querySelector<HTMLElement>("[data-element-edit-hint]");
    expect(hint, "element edytowalny bez afordancji edycji").not.toBeNull();
    expect(hint!.getAttribute("title")).toBe(plMessages.site.elements.editHint);
  });
});
