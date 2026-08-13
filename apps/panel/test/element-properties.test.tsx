import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * DROGA OD ZAZNACZONEGO ELEMENTU DO JEGO WŁAŚCIWOŚCI (ADR-166).
 *
 * ==================== CZEGO TEN KONTRAKT *NIE* SPRAWDZA ====================
 *
 * Nie sprawdza, czy szuflada UMIE narysować pole etykiety przycisku — to
 * przechodziło już przed ADR-166 i przechodziłoby dalej, gdyby do szuflady nie
 * dało się dojść. Dokładnie tak wyglądała wada zgłoszona przez właściciela
 * („ej a jak niby mam edytować przycisk?"): pola były w kodzie, a wejścia
 * w interfejsie nie było, bo jedyny przycisk otwierający szufladę stał na pasku
 * SEKCJI — znikającym w chwili zaznaczenia elementu.
 *
 * ==================== CO SPRAWDZA ====================
 *
 * DROGĘ, i to wyłącznie tą samą ręką, którą ma operator: wciśnięcie w element
 * na płótnie, przycisk odnaleziony po DOSTĘPNEJ NAZWIE (a nie po markerze
 * testowym), pole odnalezione po ETYKIECIE (a nie po selektorze). Asercja
 * kończy się na tym, co ZOSTAŁO ZAPISANE — bo „pole jest w drzewie" przechodzi
 * także wtedy, gdy pole jest martwe.
 *
 * Miejsce, w którym pole stoi, jest sprawdzone osobno i wprost: musi leżeć
 * w OTWARTYM oknie (`role="dialog"`), a nie w odciętej od świata gałęzi DOM-u.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
const { sectionCanvasSchema } = await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const SECTION_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const BUTTON_ID = "el-przycisk";
const SHAPE_ID = "el-ksztalt";
const canvasMsg = plMessages.site.canvas;
const els = plMessages.site.elements;

/**
 * Sekcja z DOKŁADNIE jednym elementem badanego rodzaju. Płótno budujemy sami,
 * a nie z presetu: preset bywa przebudowany przy kolejnym etapie, a ten kontrakt
 * ma mówić o przycisku, nie o zawartości hero.
 */
function sectionWith(element: Record<string, unknown>): Section {
  const content = sectionCanvasSchema.parse({
    version: 2,
    rows: 24,
    background: "default",
    elements: [element],
  });
  return { id: SECTION_ID, type: "freeform", position: 0, enabled: true, content } as Section;
}

function buttonSection(): Section {
  return sectionWith({
    id: BUTTON_ID,
    kind: "button",
    label: "Przycisk",
    href: "#",
    variant: "solid",
    align: "left",
    layout: { desktop: { x: 12, y: 4, w: 24, h: 6, z: 0 } },
  });
}

function shapeSection(): Section {
  return sectionWith({
    id: SHAPE_ID,
    kind: "shape",
    shape: "box",
    fill: "paper",
    layout: { desktop: { x: 12, y: 4, w: 40, h: 10, z: 0 } },
  });
}

function renderBuilder(sections: Section[]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={SITE_ID}
        siteName="Strona sklepu"
        style={STYL}
        sections={sections}
        products={[]}
        money={{ currency: "PLN", locale: "pl" }}
      />
    </NextIntlClientProvider>,
  );
}

/** Zaznaczenie elementu na płótnie — dokładnie to, co robi wskaźnik operatora. */
function selectElement(container: HTMLElement, elementId: string): HTMLElement {
  const frame = container.querySelector<HTMLElement>(`[data-element-frame="${elementId}"]`);
  expect(frame, `element ${elementId} nie ma ramki na płótnie`).not.toBeNull();
  fireEvent.pointerDown(frame!, { clientX: 10, clientY: 10 });
  fireEvent.pointerUp(frame!, { clientX: 10, clientY: 10 });
  return frame!;
}

/**
 * DROGA WŁAŚCIWA: pasek zaznaczonego elementu → przycisk o dostępnej nazwie
 * „Właściwości elementu". Szukamy po nazwie, bo to jest jedyna rzecz, którą
 * operator naprawdę widzi (pasek jest ikonami — kontrakt `builder-toolbars`).
 */
function openPropertiesFromToolbar(container: HTMLElement): HTMLElement {
  const bar = container.querySelector<HTMLElement>("[data-element-actions]");
  expect(bar, "pasek zaznaczonego elementu nie wyszedł").not.toBeNull();
  const entry = within(bar!).getByRole("button", { name: els.settings });
  fireEvent.click(entry);
  return screen.getByRole("dialog");
}

/** Treść ostatniego zapisu badanej sekcji. */
function lastSaved(): Record<string, unknown> | undefined {
  return actions.upsertSection.mock.calls
    .map(([arg]) => arg as { sectionId?: string; content?: Record<string, unknown> })
    .filter((arg) => arg.sectionId === SECTION_ID)
    .at(-1)?.content;
}

function firstElement(): Record<string, unknown> | undefined {
  return (lastSaved() as { elements?: Record<string, unknown>[] } | undefined)?.elements?.[0];
}

function flushAutosave() {
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: SECTION_ID });
  actions.reorderSections.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("zaznaczony przycisk: droga do etykiety i adresu", () => {
  it("pasek zaznaczonego elementu prowadzi do POLA ETYKIETY — i etykieta się zapisuje", () => {
    const { container } = renderBuilder([buttonSection()]);
    selectElement(container, BUTTON_ID);

    const dialog = openPropertiesFromToolbar(container);
    // Pole odnalezione PO ETYKIECIE: pole bez etykiety jest dla operatora
    // (i dla czytnika ekranu) polem bez nazwy, więc nie liczy się jako droga.
    const label = within(dialog).getByLabelText(canvasMsg.label) as HTMLInputElement;

    // Miejsce, nie sam byt: pole musi leżeć w OTWARTYM oknie i nie może być
    // ukryte — „jest w drzewie" przechodzi także dla gałęzi, której nikt nie widzi.
    expect(dialog.contains(label), "pole etykiety poza otwartą szufladą").toBe(true);
    expect(label.closest("[hidden]"), "pole etykiety w gałęzi ukrytej").toBeNull();
    expect(label.value).toBe("Przycisk");

    fireEvent.change(label, { target: { value: "Zarezerwuj termin" } });
    flushAutosave();

    expect(firstElement()?.label, "nowa etykieta nie doszła do zapisu").toBe("Zarezerwuj termin");
  });

  it("ta sama droga prowadzi do POLA ADRESU — i adres się zapisuje", () => {
    const { container } = renderBuilder([buttonSection()]);
    selectElement(container, BUTTON_ID);

    const dialog = openPropertiesFromToolbar(container);
    const href = within(dialog).getByLabelText(canvasMsg.href) as HTMLInputElement;
    expect(href.value).toBe("#");

    fireEvent.change(href, { target: { value: "/rezerwacja" } });
    flushAutosave();

    expect(firstElement()?.href, "nowy adres nie doszedł do zapisu").toBe("/rezerwacja");
  });

  it("DWUKLIK w przycisk otwiera właściwości — cisza jest niedopuszczalna", () => {
    // Do ADR-166 dwuklik w przycisk nie robił NIC: `onEdit` dostawał wyłącznie
    // tekst (edycja w miejscu) i zdjęcie (picker).
    const { container } = renderBuilder([buttonSection()]);
    const frame = selectElement(container, BUTTON_ID);
    fireEvent.doubleClick(frame);

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByLabelText(canvasMsg.label),
      "dwuklik w przycisk nie doprowadził do jego etykiety",
    ).toBeTruthy();
  });

  it("zmieniona etykieta wraca na PŁÓTNO, nie tylko do zapisu", () => {
    // Zapis bez odbicia w podglądzie byłby edycją na ślepo: operator zobaczyłby
    // stary napis i zmienił go drugi raz.
    const { container } = renderBuilder([buttonSection()]);
    selectElement(container, BUTTON_ID);
    const dialog = openPropertiesFromToolbar(container);

    fireEvent.change(within(dialog).getByLabelText(canvasMsg.label), {
      target: { value: "Zarezerwuj termin" },
    });

    const canvas = container.querySelector<HTMLElement>("[data-builder-canvas]")!;
    expect(canvas.textContent, "płótno pokazuje starą etykietę").toContain("Zarezerwuj termin");
  });
});

describe("adres przycisku przechodzi przez allowlistę schematów", () => {
  it("adres SPOZA allowlisty jest odrzucony KOMUNIKATEM i nie idzie do zapisu", () => {
    const { container } = renderBuilder([buttonSection()]);
    selectElement(container, BUTTON_ID);
    const dialog = openPropertiesFromToolbar(container);
    const href = within(dialog).getByLabelText(canvasMsg.href) as HTMLInputElement;

    fireEvent.change(href, { target: { value: "javascript:alert(1)" } });
    flushAutosave();

    const alert = within(dialog).getByRole("alert");
    expect(alert.textContent, "odmowa bez komunikatu przy polu").toBe(canvasMsg.hrefInvalid);
    // Komunikat MUSI stać w szufladzie: pasek błędu kreatora leży pod belką,
    // czyli pod modalną nakładką — odmowa niewidoczna jest nie do odróżnienia
    // od cichego zapisu.
    expect(dialog.contains(alert), "komunikat odmowy poza szufladą").toBe(true);
    expect(firstElement()?.href ?? "#", "adres spoza allowlisty poszedł do zapisu").toBe("#");
  });

  it("adres Z allowlisty przechodzi — kontrola pozytywna tej samej klasy", () => {
    // Bez niej „nic się nie zapisało" dowodziłoby wyłącznie tego, że pole jest
    // zepsute dla każdej wartości.
    const { container } = renderBuilder([buttonSection()]);
    selectElement(container, BUTTON_ID);
    const dialog = openPropertiesFromToolbar(container);

    fireEvent.change(within(dialog).getByLabelText(canvasMsg.href), {
      target: { value: "mailto:biuro@example.com" },
    });
    flushAutosave();

    expect(within(dialog).queryByRole("alert"), "poprawny adres dostał komunikat odmowy").toBeNull();
    expect(firstElement()?.href).toBe("mailto:biuro@example.com");
  });
});

describe("kształt ma co ustawiać", () => {
  it("droga prowadzi do rodzaju i wypełnienia kształtu, a zmiana się zapisuje", () => {
    const { container } = renderBuilder([shapeSection()]);
    selectElement(container, SHAPE_ID);
    const dialog = openPropertiesFromToolbar(container);

    expect(within(dialog).getByLabelText(canvasMsg.shape), "kształt bez pola rodzaju").toBeTruthy();
    const fill = within(dialog).getByLabelText(canvasMsg.fill);
    fireEvent.click(fill);
    fireEvent.click(screen.getByRole("option", { name: canvasMsg.fills.scrim }));
    flushAutosave();

    expect(firstElement()?.fill, "wypełnienie kształtu nie doszło do zapisu").toBe("scrim");
  });
});
