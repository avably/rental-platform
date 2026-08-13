import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * ŹRÓDŁO WARTOŚCI ELEMENTU W KREATORZE (faza 3, ADR-163) — kontrakt warstwy
 * klienta.
 *
 * Model i render dowodzą swojego w `@avably/core` i `@avably/ui`. TU pilnujemy
 * tego, czego funkcja czysta nie widzi, a co decyduje o tym, czy operator jest
 * w stanie zbudować wiązanie niepoprawne albo zepsuć sobie stronę:
 *
 *   1. LISTA PÓL JEST ZAWĘŻONA TYPEM — przy napisie nie ma zdjęcia, przy
 *      zdjęciu nie ma ceny. Interfejs nie proponuje niczego, czego schemat
 *      odmówi;
 *   2. WARTOŚĆ ZASTĘPCZA POJAWIA SIĘ TYLKO PRZY POLU, KTÓRE BYWA PUSTE — przy
 *      cenie nie ma jej w ogóle, więc nie ma gdzie wpisać „45 zł";
 *   3. POLE ZWIĄZANE JEST NIEEDYTOWALNE — ani w szufladzie, ani w miejscu na
 *      płótnie. To jest ta mina, którą narzędzia rynkowe ratują ostrzeżeniem
 *      w dokumentacji;
 *   4. ZAPIS WIĄZANIA nie zostawia po sobie pustej struktury w treści.
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

const drawerModule = await import(
  "@/app/[locale]/(kreator)/strona/[siteId]/kreator/section-settings-drawer"
);
const { SectionSettingsDrawer, withBinding } = drawerModule;
const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder");
const { sectionCanvasFrom, presetContentFor, paintOrder } = await import("@avably/core/site");

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const SECTION_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const POZYCJA = "11111111-1111-4111-8111-111111111111";
const bindings = plMessages.site.canvas.bindings;

const KATALOG = [
  { value: POZYCJA, label: "Terminal satelitarny" },
  { value: "33333333-3333-4333-8333-333333333333", label: "Zestaw zasilania" },
];

const LAYOUT = { desktop: { x: 0, y: 0, w: 48, h: 6, z: 0 } };

function wiazanie(field: string, extra: Record<string, unknown> = {}) {
  return { record: { kind: "product", productId: POZYCJA }, field, whenEmpty: "hide", ...extra };
}

function naglowek(bindingsValue?: unknown) {
  return {
    id: "napis",
    kind: "heading",
    text: "Napis wpisany w kreatorze",
    level: 2,
    align: "left",
    layout: LAYOUT,
    ...(bindingsValue ? { bindings: bindingsValue } : {}),
  };
}

function zdjecie(bindingsValue?: unknown) {
  return {
    id: "foto",
    kind: "image",
    alt: "Opis wpisany w kreatorze",
    fit: "cover",
    layout: LAYOUT,
    ...(bindingsValue ? { bindings: bindingsValue } : {}),
  };
}

function plotno(elements: unknown[]) {
  return { version: 2, rows: 24, background: "default", elements };
}

/** Szuflada dla JEDNEGO zaznaczonego elementu — bez skorupy kreatora. */
function renderujSzuflade(element: unknown, katalog = KATALOG) {
  const canvas = plotno([element]) as never;
  const onCanvasChange = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SectionSettingsDrawer
        siteId={SITE_ID}
        currency="PLN"
        importSources={{ catalogProducts: katalog }}
        section={{ id: SECTION_ID, type: "hero", position: 0, enabled: true, content: canvas } as never}
        canvas={canvas}
        selectedElementId={(element as { id: string }).id}
        onCanvasChange={onCanvasChange}
        onStructuredChange={vi.fn()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onCanvasChange };
}

/**
 * ETYKIETY OPCJI, KTÓRE KONTROLKA NAPRAWDĘ ODDAJE.
 *
 * `PanelSelect` stoi na prymitywie Radiksa, a lista opcji żyje w portalu
 * otwieranym kliknięciem — czytamy ją więc tak samo, jak reszta kontraktów
 * szuflady (`structured-sections.test.tsx`).
 */
function opcje(blok: HTMLElement, label: string): string[] {
  fireEvent.click(within(blok).getByLabelText(label));
  const lista = screen.getAllByRole("option").map((node) => node.textContent ?? "");
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  return lista;
}

function blokWiazania(container: HTMLElement, attribute: string): HTMLElement {
  const node = container.ownerDocument.body.querySelector<HTMLElement>(
    `[data-element-binding="${attribute}"]`,
  );
  expect(node, `brak bloku wiązania ${attribute}`).not.toBeNull();
  return node!;
}

afterEach(cleanup);

// -----------------------------------------------------------------------
// 1. Lista pól zawężona typem
// -----------------------------------------------------------------------

describe("szuflada proponuje wyłącznie pola zgodne typem", () => {
  it("napis dostaje pola tekstowe i ANI JEDNEGO obrazowego", () => {
    const { container } = renderujSzuflade(naglowek({ text: wiazanie("price") }));
    const blok = blokWiazania(container, "text");
    expect(opcje(blok, bindings.field)).toEqual([
      bindings.fields.name,
      bindings.fields.price,
      bindings.fields.description,
    ]);
  });

  it("zdjęcie dostaje WYŁĄCZNIE pole obrazowe", () => {
    const { container } = renderujSzuflade(zdjecie({ source: wiazanie("image") }));
    const blok = blokWiazania(container, "source");
    expect(opcje(blok, bindings.field)).toEqual([bindings.fields.image]);
  });

  it("element bez wiązalnych atrybutów nie dostaje bloku źródła", () => {
    const ikona = { id: "ic", kind: "icon", name: "truck", tone: "accent", layout: LAYOUT };
    renderujSzuflade(ikona);
    expect(document.body.querySelector("[data-element-binding]")).toBeNull();
  });

  it("bez ani jednej pozycji w katalogu szuflada mówi zdanie ZAMIAST kontrolki", () => {
    renderujSzuflade(naglowek(), []);
    expect(document.body.querySelector("[data-binding-empty]")?.textContent).toBe(
      bindings.noProducts,
    );
  });
});

// -----------------------------------------------------------------------
// 2. Wartość zastępcza tylko tam, gdzie pole bywa puste
// -----------------------------------------------------------------------

describe("wartość zastępcza jest bramką, nie ozdobą", () => {
  it("przy CENIE nie ma ani wyboru zachowania, ani pola tekstu zastępczego", () => {
    const { container } = renderujSzuflade(naglowek({ text: wiazanie("price") }));
    const blok = blokWiazania(container, "text");
    expect(within(blok).queryByText(bindings.whenEmpty)).toBeNull();
    expect(within(blok).queryByText(bindings.fallback)).toBeNull();
  });

  it("przy OPISIE jest wybór zachowania, a tekst zastępczy pojawia się z nim", () => {
    const { container } = renderujSzuflade(naglowek({ text: wiazanie("description") }));
    const blok = blokWiazania(container, "text");
    expect(within(blok).getByText(bindings.whenEmpty)).toBeTruthy();
    expect(within(blok).queryByText(bindings.fallback)).toBeNull();

    cleanup();
    const drugi = renderujSzuflade(
      naglowek({ text: wiazanie("description", { whenEmpty: "fallback", fallback: "—" }) }),
    );
    expect(
      within(blokWiazania(drugi.container, "text")).getByText(bindings.fallback),
    ).toBeTruthy();
  });

  it("zdjęcie nie zna wartości zastępczej w ogóle", () => {
    const { container } = renderujSzuflade(zdjecie({ source: wiazanie("image") }));
    const blok = blokWiazania(container, "source");
    expect(within(blok).queryByText(bindings.whenEmpty)).toBeNull();
  });
});

// -----------------------------------------------------------------------
// 3. Pole związane jest nieedytowalne
// -----------------------------------------------------------------------

describe("wartość z katalogu nie daje się nadpisać w kreatorze", () => {
  it("pole treści w szufladzie jest zablokowane, gdy napis jest związany", () => {
    renderujSzuflade(naglowek({ text: wiazanie("name") }));
    const pole = screen.getByLabelText(plMessages.site.canvas.text) as HTMLTextAreaElement;
    expect(pole.disabled).toBe(true);
  });

  it("kontrola pozytywna: bez wiązania to samo pole jest edytowalne", () => {
    renderujSzuflade(naglowek());
    const pole = screen.getByLabelText(plMessages.site.canvas.text) as HTMLTextAreaElement;
    expect(pole.disabled).toBe(false);
  });

  it("opis zdjęcia jest zablokowany razem ze źródłem, a podmiana zdjęcia znika", () => {
    renderujSzuflade(zdjecie({ source: wiazanie("image") }));
    const pole = screen.getByLabelText(plMessages.site.canvas.alt) as HTMLInputElement;
    expect(pole.disabled).toBe(true);
    expect(document.body.querySelector("[data-element-image-pick]")).toBeNull();
  });

  /**
   * MINA Z §3 DOKUMENTU ARCHITEKTONICZNEGO: jedno płótno, na którym da się
   * edytować i szablon, i dane oglądanej pozycji. Rozstrzygamy ją zachowaniem,
   * a nie ostrzeżeniem — dwuklik w związany napis NIE otwiera edytora.
   */
  it("dwuklik w związany napis NIE otwiera edycji w miejscu", () => {
    const section = heroZWiazanym();
    const { container } = renderBuilder([section]);
    fireEvent.doubleClick(frameFor(container, "napis"));
    expect(container.querySelector("[data-inline-editor]")).toBeNull();
  });

  it("kontrola pozytywna: ten sam napis BEZ wiązania otwiera edycję", () => {
    const section = heroZWiazanym(false);
    const { container } = renderBuilder([section]);
    fireEvent.doubleClick(frameFor(container, "napis"));
    expect(container.querySelector("[data-inline-editor]")).not.toBeNull();
  });
});

// -----------------------------------------------------------------------
// 4. Zapis wiązania w treści
// -----------------------------------------------------------------------

describe("zapis wiązania w elemencie", () => {
  it("dopisuje wiązanie pod kluczem atrybutu", () => {
    const next = withBinding(naglowek() as never, "text", wiazanie("price") as never) as {
      bindings?: Record<string, unknown>;
    };
    expect(next.bindings?.text).toEqual(wiazanie("price"));
  });

  it("zdjęcie wiązania ZDEJMUJE całą mapę, zamiast zostawiać pusty obiekt", () => {
    const zwiazany = naglowek({ text: wiazanie("price") }) as never;
    const next = withBinding(zwiazany, "text", undefined) as { bindings?: unknown };
    expect(next.bindings).toBeUndefined();
    // Treść po serializacji jest bajt w bajt tym, czym była przed wiązaniem.
    expect(JSON.parse(JSON.stringify(next))).toEqual(JSON.parse(JSON.stringify(naglowek())));
  });

  it("nie mutuje elementu wejściowego", () => {
    const element = naglowek() as never;
    withBinding(element, "text", wiazanie("name") as never);
    expect((element as { bindings?: unknown }).bindings).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// Skorupa kreatora — do dowodu edycji w miejscu
// -----------------------------------------------------------------------

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

/**
 * Sekcja hero z presetu, w której PIERWSZY nagłówek dostaje nasze `id`
 * i (opcjonalnie) wiązanie. Reszta płótna zostaje presetowa, więc test biegnie
 * po tej samej treści, co reszta kontraktów kreatora.
 */
function heroZWiazanym(zWiazaniem = true): Section {
  const canvas = sectionCanvasFrom("hero", presetContentFor("hero", "pl")) as unknown as {
    elements: { id: string; kind: string }[];
  };
  const naglowekPresetu = paintOrder(canvas.elements as never).find(
    (item) => (item as { kind: string }).kind === "heading",
  ) as unknown as { id: string; bindings?: unknown };
  naglowekPresetu.id = "napis";
  if (zWiazaniem) naglowekPresetu.bindings = { text: wiazanie("name") };
  return {
    id: SECTION_ID,
    type: "hero",
    position: 0,
    enabled: true,
    content: canvas,
  } as Section;
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

function frameFor(container: HTMLElement, id: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-element-frame="${id}"]`);
  expect(node, `brak ramki elementu ${id}`).not.toBeNull();
  return node!;
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: SECTION_ID });
});
