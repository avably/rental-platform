// @vitest-environment jsdom

/**
 * SZABLON STRONY PRODUKTU W PANELU (faza 5, ADR-178).
 *
 * Trzy powierzchnie, każda z własnym sposobem zepsucia:
 *
 *   1. SZUFLADA. Wiązanie do POZYCJI, NA KTÓREJ STOI STRONA, ma się pojawiać
 *      WYŁĄCZNIE na szablonie. Wariant `pageProduct` istnieje w rdzeniu od
 *      fazy 3 i był tam świadomie bez kontrolki — bo na stronie bez rekordu
 *      wycina węzeł przy każdym renderze, czyli jest ustawieniem bez skutku.
 *      Obie połowy są mierzone: jest tam, gdzie ma być, i NIE MA go tam,
 *      gdzie go być nie powinno.
 *
 *   2. EKRAN STRON. Szablon nie ma adresu, więc nie wolno mu pokazać ścieżki.
 *      `pagePathFromSlug("")` dałoby `/` — adres STRONY GŁÓWNEJ, pod którym
 *      szablonu nie ma i być nie może.
 *
 *   3. REGUŁY WEJŚCIA. Pusty slug szablonu nie może udawać strony głównej:
 *      najemca z szablonem i bez strony głównej ma dalej widzieć „sklep nie ma
 *      strony głównej" i móc ją założyć (inaczej ADR-168 wraca innymi drzwiami).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
  document.execCommand = vi.fn(() => true);
});

const actions = vi.hoisted(() => ({
  createSite: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true, siteId: "nowa" })),
  deleteSite: vi.fn(async () => ({ ok: true })),
  publishSite: vi.fn(async () => ({ ok: true })),
  renameSite: vi.fn(async () => ({ ok: true })),
  unpublishSite: vi.fn(async () => ({ ok: true })),
  upsertSection: vi.fn(),
  reorderSections: vi.fn(),
  toggleSection: vi.fn(),
  duplicateSection: vi.fn(),
  deleteSection: vi.fn(),
  updateSiteStyle: vi.fn(),
  applyStarterTemplate: vi.fn(),
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

const { SectionSettingsDrawer } = await import(
  "@/app/[locale]/(kreator)/strona/[siteId]/kreator/section-settings-drawer"
);
const { SitePages } = await import("@/app/[locale]/(panel)/strona/site-pages");
const { hasHomePage, hasProductTemplate, productTemplateSlugIssue } = await import(
  "@/lib/site-validation"
);

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const SECTION_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const POZYCJA = "11111111-1111-4111-8111-111111111111";
const bindings = plMessages.site.canvas.bindings;
const pages = plMessages.site.pages;

const KATALOG = [
  { value: POZYCJA, label: "Terminal satelitarny" },
  { value: "33333333-3333-4333-8333-333333333333", label: "Zestaw zasilania" },
];

/** Rekord strony w kształcie `StorefrontProduct` — tak podaje go trasa. */
const REKORD = {
  id: POZYCJA,
  name: "Terminal satelitarny",
  description: "Opis z katalogu",
  priceLabel: "od 120,00 zł / doba",
  imageUrl: null,
  imageAlt: "Terminal satelitarny",
};

const LAYOUT = { desktop: { x: 0, y: 0, w: 48, h: 6, z: 0 } };

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

/** Szuflada dla JEDNEGO zaznaczonego elementu — bez skorupy kreatora. */
function renderujSzuflade(element: unknown, options: { pageRecord?: unknown } = {}) {
  const canvas = { version: 2, rows: 24, background: "default", elements: [element] } as never;
  const onCanvasChange = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SectionSettingsDrawer
        siteId={SITE_ID}
        currency="PLN"
        importSources={{ catalogProducts: KATALOG }}
        section={
          { id: SECTION_ID, type: "hero", position: 0, enabled: true, content: canvas } as never
        }
        canvas={canvas}
        selectedElementId={(element as { id: string }).id}
        pageRecord={options.pageRecord as never}
        onCanvasChange={onCanvasChange}
        onStructuredChange={vi.fn()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onCanvasChange };
}

function blokWiazania(container: HTMLElement, attribute: string): HTMLElement {
  const node = container.ownerDocument.body.querySelector<HTMLElement>(
    `[data-element-binding="${attribute}"]`,
  );
  expect(node, `brak bloku wiązania ${attribute}`).not.toBeNull();
  return node!;
}

/** Etykiety opcji, które kontrolka NAPRAWDĘ oddaje (lista żyje w portalu). */
function opcje(blok: HTMLElement, label: string): string[] {
  fireEvent.click(within(blok).getByLabelText(label));
  const lista = screen.getAllByRole("option").map((node) => node.textContent ?? "");
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  return lista;
}

type Row = Parameters<typeof SitePages>[0]["rows"][number];

const STRONA_GLOWNA: Row = {
  id: "site-home",
  name: "Strona główna",
  live: true,
  kind: "page",
  slug: "",
  slugPublished: "",
  redirectOldSlug: true,
  redirectedFrom: [],
  publishedAtLabel: "14.08.2026, 08:00",
  createdAtLabel: "01.08.2026, 08:00",
};

const SZABLON: Row = {
  id: "site-template",
  name: "Strona sprzętu",
  live: false,
  kind: "product",
  slug: "",
  slugPublished: null,
  redirectOldSlug: true,
  redirectedFrom: [],
  publishedAtLabel: null,
  createdAtLabel: "02.08.2026, 08:00",
};

function renderujListe(rows: Row[]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SitePages rows={rows} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------
// 1. Kontrolka wiązania do rekordu strony
// -----------------------------------------------------------------------
describe("wiązanie do pozycji, na której stoi strona", () => {
  it("NA SZABLONIE kontrolka oferuje wariant „pozycja tej strony”", () => {
    const { container } = renderujSzuflade(naglowek(), { pageRecord: REKORD });
    const blok = blokWiazania(container, "text");

    expect(opcje(blok, bindings.source)).toEqual([
      bindings.sources.static,
      bindings.sources.pageProduct,
      bindings.sources.product,
    ]);
  });

  it("NA ZWYKŁEJ STRONIE tego wariantu NIE MA — ani wygaszonego, ani żadnego", () => {
    // Druga połowa dowodu. Bez niej „kontrolka istnieje" byłoby spełnione
    // także przez wersję, która pokazuje ją wszędzie — czyli przez ustawienie
    // wycinające węzeł na każdej stronie treściowej.
    const { container } = renderujSzuflade(naglowek());
    const blok = blokWiazania(container, "text");

    const lista = opcje(blok, bindings.source);
    expect(lista).toEqual([bindings.sources.static, bindings.sources.product]);
    expect(lista).not.toContain(bindings.sources.pageProduct);
  });

  it("wybór wariantu zapisuje wskazanie BEZ identyfikatora sprzętu", () => {
    /*
      To jest cała różnica między fazą 3 a fazą 5 w treści strony: szablon
      obsługuje CAŁY katalog, więc nie ma prawa nieść w sobie ani jednego
      uuid-a pozycji. Gdyby niósł, jedna strona sprzętu pokazywałaby dane
      innego.
    */
    const { container, onCanvasChange } = renderujSzuflade(naglowek(), { pageRecord: REKORD });
    const blok = blokWiazania(container, "text");

    fireEvent.click(within(blok).getByLabelText(bindings.source));
    fireEvent.click(screen.getByRole("option", { name: bindings.sources.pageProduct }));

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const update = onCanvasChange.mock.calls[0]![0] as (c: unknown) => {
      elements: { bindings?: Record<string, unknown> }[];
    };
    const zapisane = update({ version: 2, rows: 24, background: "default", elements: [naglowek()] });
    const zapis = zapisane.elements[0]!.bindings!.text as Record<string, unknown>;

    expect(zapis.record).toEqual({ kind: "pageProduct" });
    expect(JSON.stringify(zapis), "wskazanie niesie identyfikator pozycji").not.toContain(POZYCJA);
  });

  it("przy wiązaniu do rekordu strony NIE MA listy wyboru sprzętu", () => {
    // Lista zostawiona „na wszelki wypadek" zapisywałaby do treści
    // identyfikator, którego render przy tym rodzaju wskazania nigdy nie czyta.
    const { container } = renderujSzuflade(
      naglowek({ text: { record: { kind: "pageProduct" }, field: "name", whenEmpty: "hide" } }),
      { pageRecord: REKORD },
    );
    const blok = blokWiazania(container, "text");

    expect(within(blok).queryByLabelText(bindings.product)).toBeNull();
    // KONTROLA POZYTYWNA: reszta kontrolek wiązania stoi — blok nie zniknął.
    expect(within(blok).getByLabelText(bindings.field)).toBeTruthy();
  });

  it("przy wiązaniu do KONKRETNEJ pozycji lista wyboru sprzętu ZOSTAJE", () => {
    const { container } = renderujSzuflade(
      naglowek({
        text: { record: { kind: "product", productId: POZYCJA }, field: "name", whenEmpty: "hide" },
      }),
      { pageRecord: REKORD },
    );
    expect(within(blokWiazania(container, "text")).getByLabelText(bindings.product)).toBeTruthy();
  });
});

// -----------------------------------------------------------------------
// 2. Ekran stron — szablon nie udaje strony z adresem
// -----------------------------------------------------------------------
describe("ekran stron nie pokazuje szablonowi adresu, którego nie ma", () => {
  it("wiersz szablonu ma znacznik roli i zdanie o zasięgu ZAMIAST ścieżki", () => {
    const { container } = renderujListe([STRONA_GLOWNA, SZABLON]);

    const wiersz = container.querySelector<HTMLElement>(`[data-site-page="${SZABLON.id}"]`)!;
    expect(wiersz).toBeTruthy();
    expect(wiersz.querySelector("[data-site-page-template]")).not.toBeNull();
    expect(wiersz.textContent).toContain(pages.templateBadge);
    expect(wiersz.textContent).toContain(pages.templateAddress);
    // Znacznik strony GŁÓWNEJ nie ma prawa stanąć przy szablonie: oba mają
    // pusty slug, więc to jest dokładnie miejsce, w którym łatwo je pomylić.
    expect(wiersz.querySelector("[data-site-page-home]")).toBeNull();
  });

  it("KONTROLA POZYTYWNA: wiersz strony głównej DALEJ pokazuje `/` i swój znacznik", () => {
    const { container } = renderujListe([STRONA_GLOWNA, SZABLON]);

    const wiersz = container.querySelector<HTMLElement>(`[data-site-page="${STRONA_GLOWNA.id}"]`)!;
    expect(wiersz.querySelector("[data-site-page-home]")).not.toBeNull();
    expect(wiersz.querySelector("[data-site-page-template]")).toBeNull();
    expect(wiersz.textContent).toContain(pages.homeBadge);
  });

  it("bez szablonu ekran proponuje osobny czasownik, a akcja dostaje ROLĘ", () => {
    const { container } = renderujListe([STRONA_GLOWNA]);
    expect(container.querySelector("[data-site-template-missing]")).not.toBeNull();

    fireEvent.click(screen.getByText(pages.newTemplate));
    fireEvent.click(screen.getByText(pages.newTemplateConfirm));

    expect(actions.createSite).toHaveBeenCalledTimes(1);
    const wywolanie = actions.createSite.mock.calls[0]![0];
    expect(wywolanie.kind).toBe("product");
    // ADRES NIE JEDZIE W WYWOŁANIU W OGÓLE — pusty adres byłby dla akcji
    // intencją „strona główna", a nie „szablon".
    expect(wywolanie).not.toHaveProperty("slug");
  });

  it("z szablonem karta zachęty znika", () => {
    const { container } = renderujListe([STRONA_GLOWNA, SZABLON]);
    expect(container.querySelector("[data-site-template-missing]")).toBeNull();
  });
});

// -----------------------------------------------------------------------
// 3. Reguły wejścia — pusty slug szablonu nie udaje strony głównej
// -----------------------------------------------------------------------
describe("pusty slug szablonu nie jest adresem strony głównej", () => {
  it("hasHomePage NIE liczy szablonu jako strony głównej", () => {
    // Bez tego członu ADR-168 wraca innymi drzwiami: najemca z szablonem
    // i bez strony głównej dostawałby „strona główna jest" i odmowę przy
    // próbie jej założenia — a pod `/` klienci mieliby pustkę.
    expect(hasHomePage([{ slug: "", slugPublished: null, kind: "product" }])).toBe(false);
  });

  it("KONTROLA POZYTYWNA: ten sam wiersz w roli `page` JEST stroną główną", () => {
    expect(hasHomePage([{ slug: "", slugPublished: null, kind: "page" }])).toBe(true);
  });

  it("wiersz BEZ podanej roli liczy się jak strona (wartość zastana kolumny)", () => {
    expect(hasHomePage([{ slug: "", slugPublished: null }])).toBe(true);
  });

  it("ekran z SAMYM szablonem dalej mówi „sklep nie ma strony głównej”", () => {
    const { container } = renderujListe([SZABLON]);
    expect(container.querySelector("[data-site-home-missing]")).not.toBeNull();
  });

  it("hasProductTemplate widzi szablon także w SZKICU", () => {
    // Unikat w bazie pilnuje wyłącznie ŻYWEGO szablonu, więc pytanie panelu
    // musi obejmować wszystkie wiersze roli — inaczej operator zbuduje drugi
    // i dowie się o kolizji dopiero przy publikacji, po całej pracy.
    expect(hasProductTemplate([{ kind: "product" }])).toBe(true);
    expect(hasProductTemplate([{ kind: "page" }])).toBe(false);
  });

  it("szablon z podanym adresem dostaje odmowę ZDANIEM, a nie surowym 23514", () => {
    expect(productTemplateSlugIssue({ kind: "product", slug: "sprzet" })).toContain("adresu");
    expect(productTemplateSlugIssue({ kind: "product" })).toBeNull();
    // KONTROLA POZYTYWNA: reguła nie dotyczy zwykłych stron.
    expect(productTemplateSlugIssue({ kind: "page", slug: "sprzet" })).toBeNull();
  });
});
