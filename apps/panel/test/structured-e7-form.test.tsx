import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * SPRZĘT, DOSTAWA I WEZWANIE W KREATORZE (E7, aneks ADR-094).
 *
 * Model i konwersję dowodzi `@avably/core` bez DOM-u, render — `@avably/ui`.
 * Tutaj zostaje to, czego żadna funkcja czysta nie zobaczy: co NAPRAWDĘ trafia
 * do akcji zapisu, gdy operator wskaże pozycję katalogu, wyczyści cenę dostawy
 * albo przełączy wariant wezwania.
 *
 * ==================== TRZY ZDANIA, KTÓRE MAJĄ TU DOWÓD ====================
 *
 *   1. WSKAZANIE, NIE KOPIA. Do treści sekcji sprzętu ma pójść SAM
 *      identyfikator. Zapisanie obok niego nazwy albo ceny byłoby drugim
 *      źródłem prawdy o ofercie — i objawiłoby się dopiero wtedy, gdy najemca
 *      zmieni cenę w katalogu, a strona główna zostanie przy starej;
 *   2. KONTROLKA BEZ SKUTKU NIE ISTNIEJE. Przy źródle „katalog” wybór pozycji
 *      niczego nie zmienia, więc szuflada pokazuje w tym miejscu ZDANIE, a nie
 *      listę, której klikanie nic nie robi;
 *   3. PUSTA CENA ZDEJMUJE POLE. Cennik (E6) ma cenę wymaganą, więc pustka jest
 *      tam stanem przejściowym pod klawiaturą. Dostawa ma ją opcjonalną —
 *      i wyczyszczenie pola musi ZNIKNĄĆ z treści, a nie zapisać zero.
 *
 * Kontrolki znajdujemy po ROLI i DOSTĘPNEJ NAZWIE (etykieta z i18n), klikamy
 * i piszemy `userEvent`-em, a mierzymy WYWOŁANIE AKCJI — nie stan DOM-u.
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
type Sprzet = { layout: string; source: string; limit: number; items: { productId: string }[] };
type Dostawa = { items: { title: string; text: string; price_grosze?: number }[] };
type Wezwanie = { variant: string; items: { label: string; href: string }[] };

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const SPRZET_ID = "11111111-2222-4222-8222-222222222222";
const DOSTAWA_ID = "33333333-4444-4444-8444-444444444444";
const CTA_ID = "55555555-6666-4666-8666-666666666666";

const struct = plMessages.site.structured;
const spr = struct.products;
const dos = struct.delivery;
const cta = struct.cta;

/** Katalog o rozróżnialnych nazwach — bez tego „wskazano pozycję” nic nie znaczy. */
const KATALOG = [
  { id: "aaaaaaaa-0001-4000-8000-000000000001", name: "Namiot 5 × 10 m" },
  { id: "aaaaaaaa-0002-4000-8000-000000000002", name: "Nagłośnienie" },
  { id: "aaaaaaaa-0003-4000-8000-000000000003", name: "Parkiet taneczny" },
].map((row) => ({
  ...row,
  description: null,
  priceLabel: "od 100,00 zł / doba",
  imageUrl: null,
  imageAlt: row.name,
}));

const WPISY_KATALOGU = KATALOG.map((product) => ({ value: product.id, label: product.name }));

function sekcja(id: string, type: string, content: unknown, position: number): Section {
  return { id, type, position, enabled: true, content } as unknown as Section;
}

function renderBuilder(sections: Section[]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={SITE_ID}
        siteName="Strona sklepu"
        style={STYL}
        sections={sections}
        products={KATALOG}
        money={{ currency: "PLN", locale: "pl" }}
        importSources={{ catalogProducts: WPISY_KATALOGU }}
      />
    </NextIntlClientProvider>,
  );
}

const uzytkownik = () =>
  userEvent.setup({ pointerEventsCheck: 0, advanceTimers: vi.advanceTimersByTime });

async function otworzSzuflade(user: ReturnType<typeof uzytkownik>, index = 0) {
  await user.click(screen.getAllByRole("button", { name: struct.openSettings })[index]!);
  return screen.getByRole("dialog");
}

function ostatniZapis<T>(sectionId: string): T | undefined {
  return actions.upsertSection.mock.calls
    .map(([arg]) => arg as { sectionId?: string; content?: T })
    .filter((arg) => arg.sectionId === sectionId)
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

// -----------------------------------------------------------------------
// SPRZĘT
// -----------------------------------------------------------------------

function sprzetSection(patch: Partial<Sprzet> = {}): Section {
  const base = structuredPresetFor("products", "pl") as unknown as Sprzet;
  return sekcja(SPRZET_ID, "products", { ...base, source: "picked", ...patch }, 0);
}

describe("sekcja sprzętu: WSKAZANIE pozycji, nie kopia jej danych", () => {
  it("wybór pozycji z listy zapisuje SAM identyfikator", async () => {
    const user = uzytkownik();
    renderBuilder([sprzetSection()]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getByLabelText(spr.pick.label));
    await user.click(await screen.findByRole("option", { name: "Nagłośnienie" }));
    await user.click(within(szuflada).getByRole("button", { name: spr.pick.action }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Sprzet>(SPRZET_ID)).toBeDefined());
    const zapis = ostatniZapis<Sprzet>(SPRZET_ID)!;
    expect(zapis.items).toEqual([{ productId: KATALOG[1]!.id }]);
    expect(
      Object.keys(zapis.items[0]!),
      "do treści poszła KOPIA nazwy albo ceny — strona pokazywałaby ofertę, której najemca już nie składa",
    ).toEqual(["productId"]);
  });

  it("wskazana pozycja znika z listy do wyboru, a jej NAZWA staje w wierszu", async () => {
    const user = uzytkownik();
    renderBuilder([sprzetSection({ items: [{ productId: KATALOG[0]!.id }] })]);
    const szuflada = await otworzSzuflade(user);

    // Wiersz pokazuje nazwę, a nie identyfikator: uuid jest szczegółem
    // technicznym, którego operator nie ma po co widzieć ani móc zepsuć.
    expect(within(szuflada).getByText("Namiot 5 × 10 m")).toBeTruthy();

    await user.click(within(szuflada).getByLabelText(spr.pick.label));
    const opcje = await screen.findAllByRole("option");
    expect(
      opcje.map((option) => option.textContent),
      "pozycja już wskazana została na liście — sekcja pokazałaby dwa identyczne kafle",
    ).toEqual(["Nagłośnienie", "Parkiet taneczny"]);
  });

  it("wskazanie BEZ produktu mówi wprost, że pozycja zniknęła z katalogu", async () => {
    const user = uzytkownik();
    renderBuilder([sprzetSection({ items: [{ productId: "aaaaaaaa-9999-4000-8000-000000009999" }] })]);
    const szuflada = await otworzSzuflade(user);
    expect(
      within(szuflada).getByText(spr.pick.missing),
      "osierocone wskazanie daje pusty wiersz — operator nie ma jak zgadnąć, czy to awaria kreatora",
    ).toBeTruthy();
  });

  it("przy źródle „katalog” lista i selektor USTĘPUJĄ MIEJSCA zdaniu", async () => {
    const user = uzytkownik();
    renderBuilder([sprzetSection({ source: "catalog", items: [{ productId: KATALOG[0]!.id }] })]);
    const szuflada = await otworzSzuflade(user);

    expect(within(szuflada).getByText(spr.itemsIdle)).toBeTruthy();
    expect(
      within(szuflada).queryByLabelText(spr.pick.label),
      "selektor bez skutku uczy operatora, że ustawienia sekcji bywają ozdobą",
    ).toBeNull();
    expect(within(szuflada).queryByText("Namiot 5 × 10 m")).toBeNull();
  });

  it("przełączenie źródła na „wybrane” przywraca listę i NIE rusza wskazań", async () => {
    const user = uzytkownik();
    renderBuilder([sprzetSection({ source: "catalog", items: [{ productId: KATALOG[2]!.id }] })]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getByRole("tab", { name: spr.tabs.appearance }));
    await user.click(within(szuflada).getByLabelText(spr.choices.source));
    await user.click(await screen.findByRole("option", { name: spr.choiceValues.source.picked }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Sprzet>(SPRZET_ID)?.source).toBe("picked"));
    expect(
      ostatniZapis<Sprzet>(SPRZET_ID)!.items,
      "przełącznik źródła skasował wybór operatora",
    ).toEqual([{ productId: KATALOG[2]!.id }]);

    await user.click(within(szuflada).getByRole("tab", { name: spr.tabs.items }));
    expect(within(szuflada).getByText("Parkiet taneczny")).toBeTruthy();
  });

  it("sufit liczby pokazanych pozycji zapisuje się jako LICZBA", async () => {
    const user = uzytkownik();
    renderBuilder([sprzetSection()]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getByRole("tab", { name: spr.tabs.appearance }));
    await user.click(within(szuflada).getByLabelText(spr.choices.limit));
    await user.click(await screen.findByRole("option", { name: spr.choiceValues.limit["12"] }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Sprzet>(SPRZET_ID)?.limit).toBe(12));
    expect(
      typeof ostatniZapis<Sprzet>(SPRZET_ID)!.limit,
      "sufit poszedł do treści jako NAPIS — schemat go nie przyjmie",
    ).toBe("number");
  });
});

// -----------------------------------------------------------------------
// DOSTAWA
// -----------------------------------------------------------------------

function dostawaSection(): Section {
  const base = structuredPresetFor("delivery", "pl") as unknown as Dostawa;
  return sekcja(
    DOSTAWA_ID,
    "delivery",
    {
      ...base,
      items: [
        { title: "Dowóz w mieście", text: "Pod wskazany adres.", price_grosze: 12_000 },
        { title: "Odbiór osobisty", text: "W magazynie." },
      ],
    },
    0,
  );
}

describe("sekcja dostawy: pusta cena ZDEJMUJE pole", () => {
  it("wyczyszczenie ceny usuwa ją z treści, zamiast zapisać zero", async () => {
    const user = uzytkownik();
    renderBuilder([dostawaSection()]);
    const szuflada = await otworzSzuflade(user);

    const pole = within(szuflada).getAllByLabelText(dos.fields.price_grosze)[0]!;
    await user.clear(pole);
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Dostawa>(DOSTAWA_ID)).toBeDefined());
    const zapis = ostatniZapis<Dostawa>(DOSTAWA_ID)!;
    expect(
      "price_grosze" in zapis.items[0]!,
      "wyczyszczona cena została zapisana jako zero — „za darmo” to nie to samo, co „bez ceny”",
    ).toBe(false);
    expect(zapis.items[0]!.title, "czyszczenie ceny ruszyło inne pola wpisu").toBe("Dowóz w mieście");
  });

  it("wariant bez ceny ma pole PUSTE, a nie wypełnione zerem", async () => {
    const user = uzytkownik();
    renderBuilder([dostawaSection()]);
    const szuflada = await otworzSzuflade(user);

    const pola = within(szuflada).getAllByLabelText(dos.fields.price_grosze);
    expect((pola[0] as HTMLInputElement).value).toBe("120,00");
    expect(
      (pola[1] as HTMLInputElement).value,
      "wariant bez ceny pokazuje 0,00 — operator zapisze zero, myśląc, że tak było",
    ).toBe("");
  });

  it("wpisanie kwoty w pustym polu zapisuje LICZBĘ groszy", async () => {
    const user = uzytkownik();
    renderBuilder([dostawaSection()]);
    const szuflada = await otworzSzuflade(user);

    const pole = within(szuflada).getAllByLabelText(dos.fields.price_grosze)[1]!;
    await user.type(pole, "49,90");
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Dostawa>(DOSTAWA_ID)?.items[1]?.price_grosze).toBe(4_990));
    expect(typeof ostatniZapis<Dostawa>(DOSTAWA_ID)!.items[1]!.price_grosze).toBe("number");
  });
});

// -----------------------------------------------------------------------
// WEZWANIE
// -----------------------------------------------------------------------

describe("sekcja wezwania: wariant powierzchni jest DECYZJĄ operatora", () => {
  it("wybór wariantu akcentowego zapisuje się w treści i nie rusza przycisków", async () => {
    const user = uzytkownik();
    const base = structuredPresetFor("cta", "pl") as unknown as Wezwanie;
    renderBuilder([sekcja(CTA_ID, "cta", { ...base, variant: "plain" }, 0)]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getByLabelText(cta.choices.variant));
    await user.click(await screen.findByRole("option", { name: cta.choiceValues.variant.accent }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Wezwanie>(CTA_ID)?.variant).toBe("accent"));
    expect(ostatniZapis<Wezwanie>(CTA_ID)!.items).toEqual(base.items);
  });

  it("drugi przycisk daje się dodać, a sufit dwóch trzyma", async () => {
    const user = uzytkownik();
    const base = structuredPresetFor("cta", "pl") as unknown as Wezwanie;
    renderBuilder([sekcja(CTA_ID, "cta", base, 0)]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getByRole("button", { name: cta.addItem }));
    flushAutosave();
    await waitFor(() => expect(ostatniZapis<Wezwanie>(CTA_ID)?.items).toHaveLength(2));

    expect(
      (within(szuflada).getByRole("button", { name: cta.addItem }) as HTMLButtonElement).disabled,
      "trzeci przycisk w banerze to już menu, a nie wezwanie",
    ).toBe(true);
  });
});
