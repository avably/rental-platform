import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * KSZTAŁT KAFLA W SZUFLADZIE KREATORA (faza 1b, ADR-154).
 *
 * ==================== CO MA TU DOWÓD ====================
 *
 *   1. WSKAZANIE, NIE NAPIS. Podtytuł i cechy zapisują się do treści jako
 *      IDENTYFIKATORY definicji pól własnych. Zapisanie tam etykiety albo
 *      wartości byłoby drugim źródłem prawdy o sprzęcie — dokładnie tą klasą
 *      błędu, którą faza 1b ma zamknąć;
 *   2. LISTA WYBORU JEST BRAMKĄ. Szuflada pokazuje wyłącznie pola, które
 *      NAPRAWDĘ docierają do sklepu. Zbiór podaje host (trasa), a ten plik
 *      pilnuje, że szuflada nie dorabia do niego niczego z własnej strony;
 *   3. PUSTY ZBIÓR MÓWI, CO ZROBIĆ. Najemca bez ani jednego pola widocznego
 *      w zamawianiu dostaje ZDANIE zamiast pustej kontrolki, która wygląda
 *      jak awaria szuflady.
 *
 * Mierzymy WYWOŁANIE AKCJI ZAPISU, a nie stan DOM-u — jak w kontrakcie E7.
 */
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  Element.prototype.scrollTo = vi.fn() as unknown as Element["scrollTo"];
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
const { structuredPresetFor } = await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];
type Sprzet = {
  layout: string;
  source: string;
  limit: number;
  items: { productId: string }[];
  subtitleField?: string;
  featureFields?: string[];
  ctaLabel?: string;
};

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const SPRZET_ID = "11111111-2222-4222-8222-222222222222";

const struct = plMessages.site.structured;
const spr = struct.products;

const KATALOG = [
  {
    id: "aaaaaaaa-0001-4000-8000-000000000001",
    name: "Namiot 5 × 10 m",
    description: null,
    priceLabel: "od 100,00 zł / doba",
    imageUrl: null,
    imageAlt: "Namiot 5 × 10 m",
  },
];

/** Pola sprzętu WIDOCZNE W ZAMAWIANIU — dokładnie to, co podaje trasa. */
const POLA = [
  { value: "bbbbbbbb-0001-4000-8000-000000000001", label: "Rodzaj" },
  { value: "bbbbbbbb-0002-4000-8000-000000000002", label: "Zasięg" },
  { value: "bbbbbbbb-0003-4000-8000-000000000003", label: "Waga" },
];

function sekcja(id: string, type: string, content: unknown, position: number): Section {
  return { id, type, position, enabled: true, content } as unknown as Section;
}

function sprzetSection(patch: Partial<Sprzet> = {}): Section {
  const base = structuredPresetFor("products", "pl") as unknown as Sprzet;
  return sekcja(SPRZET_ID, "products", { ...base, ...patch }, 0);
}

function renderBuilder(sections: Section[], productFields: typeof POLA | [] = POLA) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={SITE_ID}
        siteName="Strona sklepu"
        style={STYL}
        sections={sections}
        products={KATALOG}
        money={{ currency: "PLN", locale: "pl" }}
        importSources={{
          catalogProducts: KATALOG.map((p) => ({ value: p.id, label: p.name })),
          productFields,
        }}
      />
    </NextIntlClientProvider>,
  );
}

const uzytkownik = () =>
  userEvent.setup({ pointerEventsCheck: 0, advanceTimers: vi.advanceTimersByTime });

/** Szuflada sprzętu, przełączona na zakładkę „Wygląd" (tam stoi kształt kafla). */
async function otworzWyglad(user: ReturnType<typeof uzytkownik>) {
  await user.click(screen.getAllByRole("button", { name: struct.openSettings })[0]!);
  const szuflada = screen.getByRole("dialog");
  await user.click(within(szuflada).getByRole("tab", { name: spr.tabs.appearance }));
  return szuflada;
}

function ostatniZapis(): Sprzet | undefined {
  return actions.upsertSection.mock.calls
    .map(([arg]) => arg as { sectionId?: string; content?: Sprzet })
    .filter((arg) => arg.sectionId === SPRZET_ID)
    .at(-1)?.content;
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
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("podtytuł kafla: operator wskazuje POLE, treść dostaje IDENTYFIKATOR", () => {
  it("wybór pola zapisuje jego identyfikator, a nie etykietę", async () => {
    const user = uzytkownik();
    renderBuilder([sprzetSection()]);
    const szuflada = await otworzWyglad(user);

    await user.click(within(szuflada).getByLabelText(spr.fields.subtitleField));
    await user.click(await screen.findByRole("option", { name: "Zasięg" }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    const zapis = ostatniZapis()!;
    expect(zapis.subtitleField).toBe(POLA[1]!.value);
    expect(
      JSON.stringify(zapis),
      "do treści sekcji poszła ETYKIETA pola — nazwa zmieniona w ustawieniach rozjechałaby stronę",
    ).not.toContain("Zasięg");
  });

  it("«Bez podtytułu» ZDEJMUJE pole z treści, a nie zapisuje pustego napisu", async () => {
    const user = uzytkownik();
    renderBuilder([sprzetSection({ subtitleField: POLA[0]!.value })]);
    const szuflada = await otworzWyglad(user);

    await user.click(within(szuflada).getByLabelText(spr.fields.subtitleField));
    await user.click(await screen.findByRole("option", { name: spr.fieldNone.subtitleField }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    expect(Object.keys(ostatniZapis()!)).not.toContain("subtitleField");
  });

  it("lista wyboru pokazuje DOKŁADNIE pola podane przez trasę", async () => {
    const user = uzytkownik();
    renderBuilder([sprzetSection()]);
    const szuflada = await otworzWyglad(user);

    await user.click(within(szuflada).getByLabelText(spr.fields.subtitleField));
    const opcje = await screen.findAllByRole("option");
    expect(opcje.map((option) => option.textContent)).toEqual([
      spr.fieldNone.subtitleField,
      "Rodzaj",
      "Zasięg",
      "Waga",
    ]);
  });
});

describe("cechy kafla: lista wskazań w kolejności OPERATORA", () => {
  it("zaznaczenie dwóch pól zapisuje DWA identyfikatory w kolejności klikania", async () => {
    const user = uzytkownik();
    renderBuilder([sprzetSection()]);
    const szuflada = await otworzWyglad(user);

    const lista = within(szuflada).getByRole("group", { name: spr.fields.featureFields });
    await user.click(within(lista).getByLabelText("Waga"));
    await user.click(within(lista).getByLabelText("Rodzaj"));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()?.featureFields?.length).toBe(2));
    expect(ostatniZapis()!.featureFields).toEqual([POLA[2]!.value, POLA[0]!.value]);
  });

  it("odznaczenie wyjmuje JEDNO wskazanie i nie rusza reszty", async () => {
    const user = uzytkownik();
    renderBuilder([
      sprzetSection({ featureFields: [POLA[0]!.value, POLA[1]!.value, POLA[2]!.value] }),
    ]);
    const szuflada = await otworzWyglad(user);

    const lista = within(szuflada).getByRole("group", { name: spr.fields.featureFields });
    await user.click(within(lista).getByLabelText("Zasięg"));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    expect(ostatniZapis()!.featureFields).toEqual([POLA[0]!.value, POLA[2]!.value]);
  });
});

describe("etykieta przycisku: jedyne pole będące NAPISEM", () => {
  it("wpisany napis jedzie do treści sekcji", async () => {
    const user = uzytkownik();
    renderBuilder([sprzetSection()]);
    const szuflada = await otworzWyglad(user);

    await user.type(within(szuflada).getByLabelText(spr.fields.ctaLabel), "Sprawdź termin");
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()?.ctaLabel).toBeDefined());
    expect(ostatniZapis()!.ctaLabel).toBe("Sprawdź termin");
  });
});

describe("najemca bez pól widocznych w zamawianiu", () => {
  it("zamiast pustej kontrolki dostaje ZDANIE, gdzie te pola założyć", async () => {
    const user = uzytkownik();
    renderBuilder([sprzetSection()], []);
    const szuflada = await otworzWyglad(user);

    // Kontrola pozytywna: zakładka „Wygląd" NAPRAWDĘ się otworzyła.
    expect(within(szuflada).getByLabelText(spr.fields.ctaLabel)).toBeTruthy();

    expect(within(szuflada).getByText(spr.fieldEmpty.subtitleField)).toBeTruthy();
    expect(
      within(szuflada).queryAllByRole("checkbox"),
      "pusta lista cech wygląda jak awaria szuflady",
    ).toHaveLength(0);
  });
});
