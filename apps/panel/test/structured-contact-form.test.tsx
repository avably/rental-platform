import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * KONTAKT W KREATORZE — DROGĄ OPERATORA (E4, ADR-095).
 *
 * Model kontaktu i konwersję starej treści dowodzi `@avably/core` bez DOM-u,
 * render i formularz — `@avably/ui`. Tutaj zostaje to, czego żadna funkcja
 * czysta nie zobaczy: czy KLIK OPERATORA dojeżdża do akcji serwerowej z treścią,
 * którą operator zobaczył na ekranie.
 *
 * Kontrolki znajdujemy po ROLI i DOSTĘPNEJ NAZWIE, klikamy `userEvent`-em
 * i mierzymy WYWOŁANIE AKCJI — nie stan optymistyczny i nie DOM (lekcja E2).
 * Kotwice `data-cms-*` służą wyłącznie do NAWIGACJI po drzewie.
 *
 * Kontakt jest pierwszym typem, który wniósł do frameworku szuflady dwie
 * rzeczy: LISTĘ O ZAMKNIĘTYM ZBIORZE w polu wpisu (rodzaj danych) i POLE CAŁEJ
 * SEKCJI (odnośnik do polityki prywatności). Obie mają tu własne zdania, bo
 * obie są rozszerzeniem frameworku, a nie kodem jednego typu.
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
const { sectionCanvasFrom, presetContentFor, structuredPresetFor, isStructuredSection } =
  await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];
type Kontakt = {
  layout: string;
  heading?: string;
  showForm: boolean;
  askPhone: boolean;
  privacyHref?: string;
  items: { kind: string; value: string }[];
};

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const KONTAKT_ID = "dddddddd-4444-4444-8444-444444444444";
const HERO_ID = "aaaaaaaa-1111-4111-8111-111111111111";

const struct = plMessages.site.structured;
const kon = struct.contact;
const typy = plMessages.site.sectionTypes;
const picker = plMessages.site.sectionPicker;

/** Treść kontaktu z REALNĄ pracą operatora, nie presetowa. */
function trescKontaktu(): Kontakt {
  const preset = structuredPresetFor("contact", "pl") as unknown as Kontakt;
  return {
    ...preset,
    // Ustawienia świadomie różne od domyślnych (lekcja M6 z E3): na treści
    // z wartościami domyślnymi kontrakt bezstratności jest ślepy na
    // przekształcenie, które te wartości USTAWIA.
    askPhone: true,
    privacyHref: "/polityka-prywatnosci",
    items: [
      { kind: "email", value: "biuro@wypozyczalnia.test" },
      { kind: "phone", value: "+48 512 345 678" },
      { kind: "hours", value: "pon.–pt. 9–17" },
    ],
  };
}

function contactSection(content: unknown = trescKontaktu()): Section {
  return { id: KONTAKT_ID, type: "contact", position: 1, enabled: true, content } as Section;
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

/** Kontakt SPRZED sekcji strukturalnych — treść v1, jaką ma strona zastana. */
function starySekcjaKontakt(): Section {
  return {
    id: KONTAKT_ID,
    type: "contact",
    position: 1,
    enabled: true,
    content: {
      heading: "Skontaktuj się z nami",
      email: "biuro@wypozyczalnia.test",
      phone: "+48 512 345 678",
      address: "ul. Polna 12, 30-001 Kraków",
    },
  } as unknown as Section;
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

const uzytkownik = () =>
  userEvent.setup({ pointerEventsCheck: 0, advanceTimers: vi.advanceTimersByTime });

async function otworzSzuflade(user: ReturnType<typeof uzytkownik>) {
  await user.click(screen.getAllByRole("button", { name: struct.openSettings })[0]!);
  return screen.getByRole("dialog");
}

/** Treść OSTATNIEGO zapisu tej sekcji — dowód, że klik dojechał do serwera. */
function ostatniZapis(): Kontakt | undefined {
  return actions.upsertSection.mock.calls
    .map(([arg]) => arg as { sectionId?: string; content?: Kontakt })
    .filter((arg) => arg.sectionId === KONTAKT_ID)
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

describe("picker: kontakt ma PO JEDNYM podglądzie na układ", () => {
  it("dwa warianty, a kliknięty ląduje w zapisanej treści jako v3", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection()]);
    await user.click(screen.getByRole("button", { name: plMessages.site.sections.add }));
    const okno = await screen.findByRole("dialog");
    await user.click(within(okno).getByRole("radio", { name: typy.contact }));

    for (const layout of ["stacked", "split"] as const) {
      expect(
        within(okno).getByRole("button", {
          name: picker.addLayoutAria
            .replace("{type}", typy.contact)
            .replace("{layout}", kon.layouts[layout]),
        }),
        `brak podglądu układu „${layout}”`,
      ).toBeTruthy();
    }

    await user.click(
      within(okno).getByRole("button", {
        name: picker.addLayoutAria
          .replace("{type}", typy.contact)
          .replace("{layout}", kon.layouts.split),
      }),
    );

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    const zapis = actions.upsertSection.mock.calls
      .map(([arg]) => arg as { type: string; content: Kontakt })
      .find((arg) => arg.type === "contact")!.content;
    expect(isStructuredSection(zapis), "kontakt urodził się jako płótno").toBe(true);
    expect(zapis.layout).toBe("split");
    expect(zapis.showForm, "świeża sekcja bez formularza — przełącznik ma być domyślnie ON").toBe(true);
  });
});

describe("szuflada kontaktu jest JEDNOKOLUMNOWA", () => {
  it("nie ma zakładek — trzy ustawienia i lista wpisów mieszczą się razem", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), contactSection()]);
    const szuflada = await otworzSzuflade(user);

    expect(within(szuflada).queryAllByRole("tab"), "kontakt dostał zakładki bez powodu").toHaveLength(0);
    expect(within(szuflada).getByLabelText(struct.layout)).toBeTruthy();
    expect(within(szuflada).getByRole("checkbox", { name: kon.toggles.showForm })).toBeTruthy();
    expect(within(szuflada).getAllByLabelText(kon.fields.value).length).toBe(3);
  });
});

describe("rodzaj wpisu jest LISTĄ o zamkniętym zbiorze (rozszerzenie frameworku)", () => {
  it("lista pokazuje WSZYSTKIE rodzaje z rejestru, po polsku", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), contactSection()]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getAllByLabelText(kon.fields.kind)[0]!);
    const opcje = await screen.findAllByRole("option");
    expect(opcje.map((option) => option.textContent)).toEqual([
      kon.fieldValues.kind.email,
      kon.fieldValues.kind.phone,
      kon.fieldValues.kind.address,
      kon.fieldValues.kind.hours,
      kon.fieldValues.kind.map,
    ]);
  });

  it("zmiana rodzaju ląduje w zapisanej treści i NIE rusza wartości wpisu", async () => {
    const user = uzytkownik();
    const przed = trescKontaktu();
    renderBuilder([heroSection(), contactSection(przed)]);
    const szuflada = await otworzSzuflade(user);

    // Trzeci wpis (godziny) staje się adresem — operator poprawia rodzaj,
    // a nie treść.
    await user.click(within(szuflada).getAllByLabelText(kon.fields.kind)[2]!);
    await user.click(await screen.findByRole("option", { name: kon.fieldValues.kind.address }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    const po = ostatniZapis()!;
    expect(po.items[2]).toEqual({ kind: "address", value: "pon.–pt. 9–17" });
    // Reszta treści nietknięta — zmiana rodzaju to zmiana JEDNEGO pola.
    expect(po.items.slice(0, 2)).toEqual(przed.items.slice(0, 2));
  });
});

describe("pole CAŁEJ SEKCJI: odnośnik do polityki prywatności", () => {
  it("wpisany adres ląduje w treści sekcji, a nie we wpisie listy", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), contactSection({ ...trescKontaktu(), privacyHref: undefined })]);
    const szuflada = await otworzSzuflade(user);

    await user.type(within(szuflada).getByLabelText(kon.fields.privacyHref), "/prywatnosc");
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    expect(ostatniZapis()!.privacyHref).toBe("/prywatnosc");
    for (const item of ostatniZapis()!.items) {
      expect(Object.keys(item).sort()).toEqual(["kind", "value"]);
    }
  });

  it("skasowanie adresu ZDEJMUJE pole, a nie zapisuje pustego napisu", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), contactSection()]);
    const szuflada = await otworzSzuflade(user);

    await user.clear(within(szuflada).getByLabelText(kon.fields.privacyHref));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    // Pusty napis nie przeszedłby schematu odnośnika — operator musi móc
    // usunąć pole, więc pustka je ZDEJMUJE.
    expect(ostatniZapis()).not.toHaveProperty("privacyHref");
  });
});

describe("przełączniki formularza", () => {
  it("„pokaż formularz” zapisuje `showForm: false` i nie rusza reszty", async () => {
    const user = uzytkownik();
    const przed = trescKontaktu();
    renderBuilder([heroSection(), contactSection(przed)]);
    const szuflada = await otworzSzuflade(user);

    const przelacznik = within(szuflada).getByRole("checkbox", { name: kon.toggles.showForm });
    expect((przelacznik as HTMLInputElement).checked, "formularz nie jest domyślnie włączony").toBe(true);
    await user.click(przelacznik);
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    expect(ostatniZapis()!.showForm).toBe(false);
    expect({ ...ostatniZapis()!, showForm: true }).toEqual(przed);
  });

  it("„pytaj o telefon” jest osobnym przełącznikiem, nie skutkiem ubocznym", async () => {
    const user = uzytkownik();
    const przed = { ...trescKontaktu(), askPhone: false };
    renderBuilder([heroSection(), contactSection(przed)]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getByRole("checkbox", { name: kon.toggles.askPhone }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    expect(ostatniZapis()!.askPhone).toBe(true);
    expect(ostatniZapis()!.showForm, "pytanie o telefon zgasiło formularz").toBe(true);
  });
});

describe("przełącznik układu nie rusza danych", () => {
  it("zmiana wariantu zostawia wpisy i ustawienia co do klucza", async () => {
    const user = uzytkownik();
    const przed = trescKontaktu();
    renderBuilder([heroSection(), contactSection(przed)]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getByLabelText(struct.layout));
    await user.click(await screen.findByRole("option", { name: kon.layouts.split }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    const po = ostatniZapis()!;
    expect(po.layout).toBe("split");
    expect({ ...po, layout: przed.layout }).toEqual(przed);
  });
});

describe("konwersja „Przełącz na sekcję 2.0” PRZENOSI dane kontaktowe", () => {
  it("stara sekcja oddaje adres, numer i adres pocztowy z właściwymi rodzajami", async () => {
    const user = uzytkownik();
    const { container } = renderBuilder([heroSection(), starySekcjaKontakt()]);

    /*
     * Sekcja ZASTANA nie ma powierzchni „Otwórz ustawienia sekcji" (ta należy
     * do sekcji strukturalnych) — jej szuflada otwiera się z paska narzędzi po
     * zaznaczeniu. Kotwice `data-*` wskazują tu wyłącznie MIEJSCE w drzewie;
     * klikane kontrolki dalej znajdujemy po roli i nazwie.
     */
    await user.pointer({
      target: container.querySelector<HTMLElement>(`[data-canvas-section="${KONTAKT_ID}"]`)!,
      keys: "[MouseLeft>]",
    });
    const pasek = container.querySelector<HTMLElement>(`[data-section-toolbar="${KONTAKT_ID}"]`)!;
    await user.click(within(pasek).getByRole("button", { name: plMessages.site.builder.settings }));

    const szuflada = screen.getByRole("dialog");
    await user.click(within(szuflada).getByRole("button", { name: struct.convertAction }));

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    const wpis = actions.upsertSection.mock.calls
      .map(([arg]) => arg as { sectionId?: string; type: string; content: Kontakt })
      .find((arg) => !arg.sectionId)!;
    const nowa = wpis.content;

    expect(wpis.type).toBe("contact");
    expect(isStructuredSection(nowa)).toBe(true);
    expect(nowa.items).toEqual([
      { kind: "email", value: "biuro@wypozyczalnia.test" },
      { kind: "phone", value: "+48 512 345 678" },
      { kind: "address", value: "ul. Polna 12, 30-001 Kraków" },
    ]);
    expect(nowa.heading).toBe("Skontaktuj się z nami");
    // Wynik MUSI pochodzić ze starej treści, nie z presetu (lekcja M5 z E3):
    // preset ma cztery wpisy o innych wartościach.
    expect(nowa.items).not.toEqual((structuredPresetFor("contact", "pl") as unknown as Kontakt).items);

    // Stara sekcja zostaje NIETKNIĘTA — operator sam ją usunie, gdy skończy.
    const ruszonaStara = actions.upsertSection.mock.calls
      .map(([arg]) => arg as { sectionId?: string })
      .some((arg) => arg.sectionId === KONTAKT_ID);
    expect(ruszonaStara, "konwersja ruszyła starą sekcję").toBe(false);
  });
});
