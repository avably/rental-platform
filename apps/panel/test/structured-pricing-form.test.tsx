import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * CENNIK I OPINIE W KREATORZE (E6, aneks ADR-094).
 *
 * Model i konwersję dowodzi `@avably/core` bez DOM-u, render — `@avably/ui`.
 * Tutaj zostaje to, czego żadna funkcja czysta nie zobaczy: co NAPRAWDĘ trafia
 * do akcji zapisu, gdy operator wpisze kwotę, wybierze jednostkę i przestawi
 * kolejność pozycji.
 *
 * ==================== DLACZEGO TO JEST OSOBNY KONTRAKT ====================
 *
 * Cennik jest pierwszym typem, którego pole ma w treści wartość LICZBOWĄ.
 * Cała reszta szuflady zapisuje napisy, więc droga „napis z `<input>` prosto
 * do `jsonb`" była dotąd poprawna. Przy cenie ta sama droga zapisałaby
 * `"120"` — kształt, którego schemat nie przyjmie, a którego odrzucenie
 * operator zobaczyłby dopiero jako sekcję, która przestała się zapisywać.
 * Dlatego mierzymy TYP wartości w zapisie, a nie sam fakt zapisu.
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
const { sectionCanvasFrom, presetContentFor, structuredPresetFor } = await import(
  "@avably/core/site"
);

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];
type Pozycja = {
  name: string;
  price_grosze: number;
  unit: string;
  mode: string;
  note?: string;
};
type Cennik = { layout: string; heading?: string; footnote?: string; items: Pozycja[] };
type Opinie = { layout: string; items: { quote: string; author: string; role?: string }[] };

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const CENNIK_ID = "cccccccc-6666-4666-8666-666666666666";
const OPINIE_ID = "bbbbbbbb-7777-4777-8777-777777777777";
const HERO_ID = "aaaaaaaa-1111-4111-8111-111111111111";

const struct = plMessages.site.structured;
const cen = struct.pricing;
const opi = struct.testimonials;

/** Cennik o DWÓCH rozróżnialnych pozycjach — bez tego kolejność jest niewidoczna. */
function trescCennika(): Cennik {
  return {
    ...(structuredPresetFor("pricing", "pl") as unknown as Cennik),
    heading: "Cennik sprzętu",
    footnote: "Ceny netto.",
    items: [
      { name: "Namiot 5 × 10 m", price_grosze: 90_000, unit: "day", mode: "from" },
      { name: "Krzesło bankietowe", price_grosze: 800, unit: "piece", mode: "exact" },
    ],
  };
}

function cennikSection(content: unknown = trescCennika()): Section {
  return { id: CENNIK_ID, type: "pricing", position: 1, enabled: true, content } as Section;
}

function opinieSection(): Section {
  return {
    id: OPINIE_ID,
    type: "testimonials",
    position: 2,
    enabled: true,
    content: structuredPresetFor("testimonials", "pl"),
  } as unknown as Section;
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

function renderBuilder(sections: Section[], currency: "PLN" | "EUR" = "PLN") {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={SITE_ID}
        siteName="Strona sklepu"
        style={STYL}
        sections={sections}
        products={[]}
        money={{ currency, locale: "pl" }}
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

/** Treść OSTATNIEGO zapisu danej sekcji — dowód, że klik dojechał do serwera. */
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

describe("CENA zapisuje się jako LICZBA groszy, a nie jako napis", () => {
  it("wpisanie „120,50” zapisuje 12050 typu number", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), cennikSection()]);
    const szuflada = await otworzSzuflade(user);

    const pole = within(szuflada).getAllByLabelText(cen.fields.price_grosze)[0]!;
    await user.clear(pole);
    await user.type(pole, "120,50");
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Cennik>(CENNIK_ID)).toBeDefined());
    const zapis = ostatniZapis<Cennik>(CENNIK_ID)!;
    expect(
      zapis.items[0]!.price_grosze,
      "cena zapisana inaczej niż w groszach — kanon pieniędzy projektu",
    ).toBe(12_050);
    expect(
      typeof zapis.items[0]!.price_grosze,
      "cena poszła do treści jako NAPIS — schemat jej nie przyjmie",
    ).toBe("number");
  });

  it("kropka dziesiętna działa tak samo jak przecinek", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), cennikSection()]);
    const szuflada = await otworzSzuflade(user);

    const pole = within(szuflada).getAllByLabelText(cen.fields.price_grosze)[0]!;
    await user.clear(pole);
    await user.type(pole, "99.99");
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Cennik>(CENNIK_ID)?.items[0]!.price_grosze).toBe(9_999));
  });

  it("pole pokazuje kwotę ZASTANĄ, a nie surowe grosze z treści", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), cennikSection()]);
    const szuflada = await otworzSzuflade(user);

    const pole = within(szuflada).getAllByLabelText(cen.fields.price_grosze)[0]! as HTMLInputElement;
    // 90 000 groszy to „900,00", a nie „90000". Pokazanie groszy wprost byłoby
    // zaproszeniem do wpisania obok nich kwoty w złotych.
    expect(pole.value).toBe("900,00");
  });

  it("WEJŚCIE, KTÓRE NIE JEST KWOTĄ, nie psuje zapisanej ceny", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), cennikSection()]);
    const szuflada = await otworzSzuflade(user);

    const pole = within(szuflada).getAllByLabelText(cen.fields.price_grosze)[0]!;
    await user.clear(pole);
    await user.type(pole, "sto złotych");
    flushAutosave();

    /*
     * Sedno: pustka i śmieci NIE ZAPISUJĄ NIC — ta sama reguła, co przy pustym
     * polu tekstowym. Gdyby pole zapisywało `NaN` albo zero, skasowanie kwoty
     * w drodze do jej poprawienia wystawiałoby sprzęt za darmo.
     */
    const zapis = ostatniZapis<Cennik>(CENNIK_ID);
    if (zapis) expect(zapis.items[0]!.price_grosze).toBe(90_000);
  });

  it("podpowiedź o formacie stoi przy polu (jedyne miejsce, w którym da się pomylić)", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), cennikSection()]);
    const szuflada = await otworzSzuflade(user);
    expect(within(szuflada).getAllByText(cen.hints.price_grosze).length).toBeGreaterThan(0);
  });
});

describe("JEDNOSTKA i RODZAJ CENY idą ze słownika, nie z pola tekstowego", () => {
  it("lista jednostek pokazuje ETYKIETY, a wybór wraca do treści jako klucz", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), cennikSection()]);
    const szuflada = await otworzSzuflade(user);

    const lista = within(szuflada).getAllByLabelText(cen.fields.unit)[0]!;
    await user.click(lista);
    await user.click(await screen.findByRole("option", { name: cen.fieldValues.unit.week }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Cennik>(CENNIK_ID)).toBeDefined());
    expect(
      ostatniZapis<Cennik>(CENNIK_ID)!.items[0]!.unit,
      "do treści poszła ETYKIETA zamiast klucza słownika — render nie zna takiej jednostki",
    ).toBe("week");
  });

  it("rodzaj ceny przestawia się na „od” i wraca jako klucz", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), cennikSection()]);
    const szuflada = await otworzSzuflade(user);

    const lista = within(szuflada).getAllByLabelText(cen.fields.mode)[1]!;
    await user.click(lista);
    await user.click(await screen.findByRole("option", { name: cen.fieldValues.mode.from }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Cennik>(CENNIK_ID)?.items[1]!.mode).toBe("from"));
  });
});

describe("KOLEJNOŚĆ POZYCJI to decyzja operatora i musi dojechać do zapisu", () => {
  it("strzałka „w dół” przestawia pozycję, a nie tylko przerysowuje listę", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), cennikSection()]);
    const szuflada = await otworzSzuflade(user);

    // PIERWSZA pozycja w dół — każdy wpis ma własną strzałkę, więc bierzemy tę
    // z wpisu, o którym mówi asercja, a nie „jakąś".
    await user.click(within(szuflada).getAllByRole("button", { name: struct.moveDown })[0]!);
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Cennik>(CENNIK_ID)).toBeDefined());
    expect(
      ostatniZapis<Cennik>(CENNIK_ID)!.items.map((item) => item.name),
      "kolejność w zapisie ta sama, co przed kliknięciem — przestawienie nie dojechało",
    ).toEqual(["Krzesło bankietowe", "Namiot 5 × 10 m"]);
  });

  it("przestawienie NIE RUSZA cen — jadą razem ze swoimi pozycjami", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), cennikSection()]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getAllByRole("button", { name: struct.moveDown })[0]!);
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Cennik>(CENNIK_ID)).toBeDefined());
    expect(
      ostatniZapis<Cennik>(CENNIK_ID)!.items.map((item) => [item.name, item.price_grosze]),
      "cena została przy POZYCJI, a nie przy miejscu na liście",
    ).toEqual([
      ["Krzesło bankietowe", 800],
      ["Namiot 5 × 10 m", 90_000],
    ]);
  });
});

describe("PRZEŁĄCZNIK UKŁADU zapisuje wariant i nie rusza pozycji", () => {
  it("wybór „Karty” zapisuje layout i tę samą listę pozycji", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), cennikSection()]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getByLabelText(struct.layout));
    await user.click(await screen.findByRole("option", { name: cen.layouts.cards }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Cennik>(CENNIK_ID)?.layout).toBe("cards"));
    expect(ostatniZapis<Cennik>(CENNIK_ID)!.items).toEqual(trescCennika().items);
    expect(ostatniZapis<Cennik>(CENNIK_ID)!.footnote).toBe("Ceny netto.");
  });
});

describe("OPINIE: dodanie wpisu i edycja cytatu dojeżdżają do zapisu", () => {
  it("„Dodaj opinię” dopisuje wpis na koniec listy", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), opinieSection()]);
    const szuflada = await otworzSzuflade(user, 0);

    const przed = (structuredPresetFor("testimonials", "pl") as unknown as Opinie).items.length;
    await user.click(within(szuflada).getByRole("button", { name: opi.addItem }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis<Opinie>(OPINIE_ID)).toBeDefined());
    expect(ostatniZapis<Opinie>(OPINIE_ID)!.items).toHaveLength(przed + 1);
  });

  it("edycja cytatu zapisuje TREŚĆ, a nie tylko zaznacza zmianę", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), opinieSection()]);
    const szuflada = await otworzSzuflade(user, 0);

    /*
     * ZAZNACZ WSZYSTKO I PISZ — a nie `clear()` + `type()`. Framework szuflady
     * NIE ZAPISUJE pustki (pytanie bez treści nie jest pytaniem, E1), więc po
     * `clear()` treść zostaje stara i pole wraca do poprzedniej wartości —
     * a doklejony tekst dawałby zapis, którego operator nigdy nie zobaczył.
     * Zaznaczenie i nadpisanie to zarazem gest, którym robi to człowiek.
     */
    const pole = within(szuflada).getAllByLabelText(opi.fields.quote)[0]! as HTMLTextAreaElement;
    await user.type(pole, "Sprzęt dojechał na czas.", {
      initialSelectionStart: 0,
      initialSelectionEnd: pole.value.length,
    });
    flushAutosave();

    await waitFor(() =>
      expect(ostatniZapis<Opinie>(OPINIE_ID)?.items[0]!.quote).toBe("Sprzęt dojechał na czas."),
    );
  });
});
