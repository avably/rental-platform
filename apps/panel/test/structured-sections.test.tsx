import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * SEKCJE STRUKTURALNE W KREATORZE (E1, ADR-094) — kontrakt warstwy klienta.
 *
 * Model i jego granice dowodzi `@avably/core` bez DOM-u (structured.test.ts),
 * a dostępność renderu — `@avably/ui`. Tutaj pilnujemy tego, czego żadna
 * funkcja czysta nie zobaczy, bo dzieje się między paletą, płótnem, szufladą
 * i akcją zapisu:
 *
 *   1. sekcja typu strukturalnego RODZI SIĘ jako treść v3 — nie jako płótno;
 *   2. płótno renderuje ją TYM SAMYM komponentem, co sklep, a klik w nią
 *      otwiera szufladę (nie ma w środku elementów do zaznaczania);
 *   3. szuflada jest mini-CMS-em: dodanie wpisu, edycja pola, kolejność
 *      strzałkami, usunięcie za potwierdzeniem;
 *   4. przełącznik układu zmienia WYŁĄCZNIE `layout` — wpisy jadą bez zmian
 *      (kontrakt bezstratności widziany od strony interfejsu);
 *   5. każda z tych zmian ZAPISUJE treść v3 tym samym kanałem, co płótno;
 *   6. konwersja „Przełącz na sekcję 2.0" wstawia świeży preset POD starą
 *      sekcją i NICZEGO w niej nie rusza.
 *
 * Zapis jest opóźniony (autosave), więc zegar przewijamy jawnie.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  useRouter: () => ({ refresh }),
}));

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder");
const {
  STRUCTURED_SECTIONS,
  isStructuredSection,
  presetContentFor,
  sectionCanvasFrom,
  structuredPresetFor,
} = await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const FAQ_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const HERO_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const CTA_ID = "cccccccc-3333-4333-8333-333333333333";
const struct = plMessages.site.structured;

function faqSection(overrides: Partial<Section> = {}): Section {
  return {
    id: FAQ_ID,
    type: "faq",
    position: 1,
    enabled: true,
    content: structuredPresetFor("faq", "pl"),
    ...overrides,
  } as Section;
}

/** Sekcja FAQ w SPŁASZCZONEJ postaci v2 — tak wygląda strona sprzed ADR-094. */
function flatFaqSection(): Section {
  return {
    id: FAQ_ID,
    type: "faq",
    position: 1,
    enabled: true,
    content: sectionCanvasFrom("faq", presetContentFor("faq", "pl")),
  } as Section;
}

/** Sekcja STOJĄCA POD FAQ — dzięki niej „pod starą" ma czym się różnić od „na końcu". */
function ctaSection(): Section {
  return {
    id: CTA_ID,
    type: "cta",
    position: 2,
    enabled: true,
    content: sectionCanvasFrom("cta", presetContentFor("cta", "pl")),
  } as Section;
}

function heroSection(): Section {
  return {
    id: HERO_ID,
    type: "hero",
    position: 0,
    enabled: true,
    content: sectionCanvasFrom("hero", presetContentFor("hero", "pl")),
  } as Section;
}

function renderBuilder(sections: Section[]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder siteId={SITE_ID} siteName="Strona sklepu" style={STYL} sections={sections} products={[]} money={{ currency: "PLN", locale: "pl" }} />
    </NextIntlClientProvider>,
  );
}

/**
 * Dodanie sekcji PICKEREM (E2): otwarcie z palety („na końcu strony"), wybór
 * typu w lewej kolumnie i kliknięcie podglądu wariantu po prawej.
 */
function dodajPickerem(type: string, variant = "default") {
  fireEvent.click(document.querySelector<HTMLElement>("[data-palette-add-section]")!);
  const dialog = document.querySelector<HTMLElement>("[data-section-picker]");
  expect(dialog, "picker się nie otworzył").not.toBeNull();
  fireEvent.click(dialog!.querySelector<HTMLElement>(`[data-picker-type="${type}"]`)!);
  fireEvent.click(dialog!.querySelector<HTMLElement>(`[data-picker-add="${variant}"]`)!);
}

/** Otwarcie szuflady klikiem w sekcję strukturalną — jedyna droga edycji. */
function openDrawer(container: HTMLElement) {
  const opener = container.querySelector<HTMLElement>(`[data-cms-open="${FAQ_ID}"]`);
  expect(opener, "sekcja strukturalna nie ma powierzchni otwierającej szufladę").not.toBeNull();
  fireEvent.click(opener!);
  return screen.getByRole("dialog");
}

/** Treść ostatniego zapisu sekcji FAQ. */
function lastSavedFaq(): Record<string, unknown> | undefined {
  const call = actions.upsertSection.mock.calls
    .map(([arg]) => arg as { sectionId?: string; content?: Record<string, unknown> })
    .filter((arg) => arg.sectionId === FAQ_ID)
    .at(-1);
  return call?.content;
}

function flushAutosave() {
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: "nowa-sekcja" });
  actions.reorderSections.mockResolvedValue({ ok: true });
  refresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("nowa sekcja typu strukturalnego rodzi się jako v3", () => {
  it("dodanie FAQ z palety zapisuje treść z rejestru, a nie płótno", async () => {
    renderBuilder([heroSection()]);

    // Picker sekcji — jedyna droga dodania od E2: typ po lewej, podgląd po prawej.
    dodajPickerem("faq", "accordion");

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    const content = actions.upsertSection.mock.calls
      .map(([arg]) => arg as { type: string; content: Record<string, unknown> })
      .find((arg) => arg.type === "faq")?.content;

    expect(content, "sekcja FAQ nie została zapisana").toBeDefined();
    expect(isStructuredSection(content), "FAQ urodziło się jako płótno, nie jako sekcja 2.0").toBe(
      true,
    );
    expect(content).toEqual(structuredPresetFor("faq", "pl"));
    expect(
      (content as { items: unknown[] }).items.length,
      "preset FAQ ma nieść realne pary, nie pustą listę",
    ).toBe(3);
  });

  it("typ BEZ silnika strukturalnego dalej rodzi się jako płótno", async () => {
    renderBuilder([heroSection()]);
    /*
     * Rola „typu spoza rejestru" przechodzi z typu na typ, w miarę jak rejestr
     * rośnie (atuty pełniły ją do E7). Po E7 poza rejestrem zostają `hero`,
     * `freeform` i `footer` — zdanie testu dotyczy KAŻDEGO z nich.
     */
    dodajPickerem("freeform");

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    const content = actions.upsertSection.mock.calls
      .map(([arg]) => arg as { type: string; content: Record<string, unknown> })
      .find((arg) => arg.type === "freeform")?.content;
    expect(content?.version, "sekcja spoza rejestru zmieniła silnik").toBe(2);
  });
});

describe("płótno kreatora: ten sam render co sklep, klik otwiera szufladę", () => {
  it("sekcja renderuje się komponentem strukturalnym, bez ramek elementów", () => {
    const { container } = renderBuilder([heroSection(), faqSection()]);

    const section = container.querySelector<HTMLElement>('[data-structured-section="faq"]');
    expect(section, "płótno nie pokazało sekcji strukturalnej").not.toBeNull();
    expect(section?.getAttribute("data-structured-layout")).toBe("accordion");

    const canvasSection = container.querySelector<HTMLElement>(`[data-canvas-section="${FAQ_ID}"]`);
    expect(
      canvasSection?.querySelectorAll("[data-element-frame]").length,
      "sekcja strukturalna nie ma elementów do zaznaczania",
    ).toBe(0);
  });

  it("klik w sekcję otwiera szufladę z mini-CMS-em tego typu", () => {
    const { container } = renderBuilder([heroSection(), faqSection()]);
    const dialog = openDrawer(container);
    expect(within(dialog).getByText(struct.faq.itemsTitle)).toBeTruthy();
    expect(dialog.querySelector('[data-cms-form="faq"]')).not.toBeNull();
    // Ustawienia PŁÓTNA nie mają tu czego szukać — sekcja nie ma geometrii.
    expect(dialog.querySelector("[data-canvas-settings]")).toBeNull();
  });
});

describe("mini-CMS: lista wpisów", () => {
  it("dodanie wpisu zapisuje treść z JEDNĄ parą więcej", () => {
    const { container } = renderBuilder([heroSection(), faqSection()]);
    const dialog = openDrawer(container);
    const before = (faqSection().content as unknown as { items: unknown[] }).items.length;

    fireEvent.click(dialog.querySelector("[data-cms-add]")!);
    flushAutosave();

    const saved = lastSavedFaq();
    expect(isStructuredSection(saved)).toBe(true);
    expect((saved as { items: unknown[] }).items.length).toBe(before + 1);
  });

  it("edycja pola wpisu zapisuje NOWĄ treść tej pary", () => {
    const { container } = renderBuilder([heroSection(), faqSection()]);
    const dialog = openDrawer(container);

    const pierwszePytanie = dialog.querySelectorAll<HTMLInputElement>('[data-cms-field="q"]')[0]!;
    fireEvent.change(pierwszePytanie, { target: { value: "Czy dowozicie w soboty?" } });
    flushAutosave();

    const items = (lastSavedFaq() as { items: { q: string }[] }).items;
    expect(items[0]!.q).toBe("Czy dowozicie w soboty?");
    expect(items.length, "edycja pola nie może zmieniać liczby wpisów").toBe(3);
  });

  it("strzałka przestawia kolejność par", () => {
    const { container } = renderBuilder([heroSection(), faqSection()]);
    const dialog = openDrawer(container);
    const oryginalne = (faqSection().content as unknown as { items: { q: string }[] }).items;

    fireEvent.click(dialog.querySelector('[data-cms-move="down-0"]')!);
    flushAutosave();

    const items = (lastSavedFaq() as { items: { q: string }[] }).items;
    expect(items[0]!.q).toBe(oryginalne[1]!.q);
    expect(items[1]!.q).toBe(oryginalne[0]!.q);
  });

  it("usunięcie wpisu PYTA i dopiero potwierdzenie skraca listę", async () => {
    const { container } = renderBuilder([heroSection(), faqSection()]);
    const dialog = openDrawer(container);

    fireEvent.click(dialog.querySelector('[data-cms-remove="1"]')!);
    const confirm = await screen.findByText(struct.removeTitle);
    expect(confirm, "usunięcie wpisu nie zapytało o potwierdzenie").toBeTruthy();
    expect(lastSavedFaq(), "wpis zniknął zanim operator potwierdził").toBeUndefined();

    fireEvent.click(document.querySelector("[data-cms-remove-confirm]")!);
    flushAutosave();
    expect((lastSavedFaq() as { items: unknown[] }).items.length).toBe(2);
  });

  it("ostatniego wpisu usunąć się NIE DA — sekcja nie może zostać atrapą", () => {
    const jednaPara = {
      ...(structuredPresetFor("faq", "pl") as unknown as Record<string, unknown>),
      items: [{ q: "Jedyne pytanie?", a: "Jedyna odpowiedź." }],
    };
    const { container } = renderBuilder([
      heroSection(),
      faqSection({ content: jednaPara } as Partial<Section>),
    ]);
    const dialog = openDrawer(container);
    expect(dialog.querySelector<HTMLButtonElement>('[data-cms-remove="0"]')?.disabled).toBe(true);
  });
});

describe("przełącznik układu nie dotyka danych", () => {
  it("zmiana układu zapisuje TĘ SAMĄ treść z innym `layout`", () => {
    const { container } = renderBuilder([heroSection(), faqSection()]);
    const dialog = openDrawer(container);

    // `PanelSelect` stoi na prymitywie Radix — w jsdom sterujemy nim przez
    // natywny select, który komponent renderuje jako warstwę dostępności.
    const select = within(dialog).getByLabelText(struct.layout);
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: struct.faq.layouts["open-list"] }));
    flushAutosave();

    const saved = lastSavedFaq() as Record<string, unknown>;
    const before = faqSection().content as unknown as Record<string, unknown>;
    expect(saved.layout, "przełącznik nie zapisał układu").toBe("open-list");
    const { layout: _a, ...saveBezUkladu } = saved;
    const { layout: _b, ...bazaBezUkladu } = before;
    expect(saveBezUkladu, "przełączenie układu ruszyło dane sekcji").toEqual(bazaBezUkladu);
  });

  it("przełącznik oferuje DOKŁADNIE warianty z rejestru typu", () => {
    const { container } = renderBuilder([heroSection(), faqSection()]);
    const dialog = openDrawer(container);
    fireEvent.click(within(dialog).getByLabelText(struct.layout));

    const opcje = screen.getAllByRole("option").map((node) => node.textContent);
    expect(opcje.length).toBe(STRUCTURED_SECTIONS.faq.layouts.length);
    for (const layout of STRUCTURED_SECTIONS.faq.layouts) {
      expect(opcje).toContain(struct.faq.layouts[layout as keyof typeof struct.faq.layouts]);
    }
  });
});

describe("konwersja „Przełącz na sekcję 2.0”", () => {
  /** Szuflada sekcji PŁÓTNOWEJ otwiera się z paska narzędzi (po zaznaczeniu). */
  function openCanvasDrawer(container: HTMLElement) {
    fireEvent.pointerDown(container.querySelector<HTMLElement>(`[data-canvas-section="${FAQ_ID}"]`)!);
    const toolbar = container.querySelector<HTMLElement>(`[data-section-toolbar="${FAQ_ID}"]`)!;
    fireEvent.click(within(toolbar).getByRole("button", { name: plMessages.site.builder.settings }));
    return screen.getByRole("dialog");
  }

  it("spłaszczona sekcja FAQ dostaje akcję konwersji, opisaną bez obietnic", () => {
    const { container } = renderBuilder([heroSection(), flatFaqSection()]);
    const dialog = openCanvasDrawer(container);

    expect(dialog.querySelector('[data-cms-convert="faq"]'), "brak akcji konwersji").not.toBeNull();
    expect(within(dialog).getByText(struct.convertBody), "brak opisu skutku").toBeTruthy();
  });

  it("konwersja wstawia świeży preset POD starą sekcją i NIC w niej nie rusza", async () => {
    const { container } = renderBuilder([heroSection(), flatFaqSection(), ctaSection()]);
    const dialog = openCanvasDrawer(container);
    fireEvent.click(dialog.querySelector("[data-cms-convert-action]")!);

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    const dodana = actions.upsertSection.mock.calls
      .map(
        ([arg]) =>
          arg as { sectionId?: string; type: string; content: Record<string, unknown>; insertBefore?: string },
      )
      .find((arg) => !arg.sectionId);

    expect(dodana?.type).toBe("faq");
    expect(isStructuredSection(dodana?.content), "konwersja nie wstawiła sekcji 2.0").toBe(true);
    expect(dodana?.content, "treść ma być ŚWIEŻYM presetem — bez zgadywania").toEqual(
      structuredPresetFor("faq", "pl"),
    );

    // Stara sekcja zostaje nietknięta: żaden zapis nie celuje w jej id.
    expect(
      actions.upsertSection.mock.calls.some(([arg]) => (arg as { sectionId?: string }).sectionId === FAQ_ID),
      "konwersja ruszyła starą sekcję zamiast zostawić ją operatorowi",
    ).toBe(false);
    expect(actions.deleteSection).not.toHaveBeenCalled();

    // Miejsce: nowa sekcja ląduje BEZPOŚREDNIO pod starą, czyli NAD sekcją,
    // która stoi za nią. Strona ma następnik (CTA), więc „pod starą" różni się
    // od „na końcu" — bez tej trzeciej sekcji asercja przechodziłaby także dla
    // wstawki dopisanej gdziekolwiek dalej.
    expect(dodana?.insertBefore, "konwersja wskazała inne miejsce niż pod starą sekcją").toBe(CTA_ID);
    expect(actions.reorderSections, "konwersja poszła drugim krokiem u klienta").not.toHaveBeenCalled();
  });

  it("sekcja JUŻ strukturalna nie proponuje konwersji drugi raz", () => {
    const { container } = renderBuilder([heroSection(), faqSection()]);
    const dialog = openDrawer(container);
    expect(dialog.querySelector("[data-cms-convert]")).toBeNull();
  });
});
