import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * DOJAZD W KREATORZE — „WSTAW Z PUNKTÓW ODBIORU" (E5, ADR-096).
 *
 * Model dojazdu i konwersję starej treści dowodzi `@avably/core` bez DOM-u,
 * mapę za kliknięciem — `@avably/ui`. Tutaj zostaje to, czego żadna funkcja
 * czysta nie zobaczy: czy KLIK OPERATORA w przycisk kopiowania dojeżdża do
 * akcji serwerowej z treścią, którą operator zobaczył na ekranie — i czy
 * przycisk, gdy nic nie da się wstawić, MÓWI DLACZEGO.
 *
 * Kontrolki znajdujemy po ROLI i DOSTĘPNEJ NAZWIE, klikamy `userEvent`-em
 * i mierzymy WYWOŁANIE AKCJI zapisu, a nie stan DOM-u (lekcja E2).
 *
 * Dojazd jest pierwszym typem, który wniósł do frameworku szuflady KOPIOWANIE
 * WPISÓW Z INNEGO MODUŁU (`itemsImport` w rejestrze) — dlatego kontrakt pilnuje
 * też tego, że przycisk bierze się z REJESTRU, a nie z nazwy typu.
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
type Dojazd = {
  layout: string;
  heading?: string;
  items: { label?: string; address: string; hours?: string }[];
};

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const DOJAZD_ID = "eeeeeeee-5555-4555-8555-555555555555";
const HERO_ID = "aaaaaaaa-1111-4111-8111-111111111111";

const struct = plMessages.site.structured;
const doj = struct.directions;

/** Punkty odbioru w kształcie, w jakim podaje je TRASA kreatora (nie wiersz bazy). */
const PUNKTY = [
  { label: "Magazyn główny", address: "ul. Polna 12, 30-001 Kraków" },
  { label: "Punkt odbioru — centrum", address: "al. Wiosenna 3, 31-002 Kraków" },
];

/** Treść dojazdu z JEDNYM punktem operatora — kopiowanie ma ją UZUPEŁNIĆ, nie zastąpić. */
function trescDojazdu(): Dojazd {
  const preset = structuredPresetFor("directions", "pl") as unknown as Dojazd;
  return {
    ...preset,
    heading: "Jak do nas dojechać",
    items: [{ label: "Serwis", address: "ul. Warsztatowa 8, 30-003 Kraków", hours: "sob. 9–13" }],
  };
}

function directionsSection(content: unknown = trescDojazdu()): Section {
  return { id: DOJAZD_ID, type: "directions", position: 1, enabled: true, content } as Section;
}

function contactSection(): Section {
  return {
    id: "dddddddd-4444-4444-8444-444444444444",
    type: "contact",
    position: 2,
    enabled: true,
    content: structuredPresetFor("contact", "pl"),
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

function renderBuilder(
  sections: Section[],
  importSources: Record<string, readonly unknown[]> = { pickupLocations: PUNKTY },
) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={SITE_ID}
        siteName="Strona sklepu"
        style={STYL}
        sections={sections}
        products={[]}
        money={{ currency: "PLN", locale: "pl" }}
        importSources={importSources}
      />
    </NextIntlClientProvider>,
  );
}

const uzytkownik = () =>
  userEvent.setup({ pointerEventsCheck: 0, advanceTimers: vi.advanceTimersByTime });

/** Szuflada sekcji o zadanym indeksie w kolejności płótna (tylko sekcje v3 mają przycisk). */
async function otworzSzuflade(user: ReturnType<typeof uzytkownik>, index = 0) {
  await user.click(screen.getAllByRole("button", { name: struct.openSettings })[index]!);
  return screen.getByRole("dialog");
}

/** Treść OSTATNIEGO zapisu sekcji dojazdu — dowód, że klik dojechał do serwera. */
function ostatniZapis(): Dojazd | undefined {
  return actions.upsertSection.mock.calls
    .map(([arg]) => arg as { sectionId?: string; content?: Dojazd })
    .filter((arg) => arg.sectionId === DOJAZD_ID)
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

describe("„Wstaw z punktów odbioru” KOPIUJE dane do treści sekcji", () => {
  it("klik dopisuje wszystkie punkty POD wpisami operatora i zapisuje treść", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), directionsSection()]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getByRole("button", { name: doj.import.action }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    const zapis = ostatniZapis()!;
    expect(zapis.items.map((item) => item.address)).toEqual([
      // Wpis operatora zostaje PIERWSZY — kopiowanie dokłada, a nie zastępuje.
      "ul. Warsztatowa 8, 30-003 Kraków",
      PUNKTY[0]!.address,
      PUNKTY[1]!.address,
    ]);
    expect(zapis.items[1]!.label).toBe("Magazyn główny");
  });

  it("wstawione wpisy są KOPIĄ — w treści nie ma odnośnika do punktu w Dostawach", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), directionsSection()]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getByRole("button", { name: doj.import.action }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    /*
     * SPRZĘŻENIA NIE MA i to jest cała decyzja (ADR-096): w treści siedzą
     * NAPISY, a nie identyfikator wiersza, więc zmiana punktu w Dostawach nie
     * ma jak przestawić opublikowanej strony. Gdyby wpis niósł `id`/`ref`,
     * pytanie „co widzi klient" przestałoby mieć odpowiedź w treści sekcji.
     */
    for (const item of ostatniZapis()!.items) {
      expect(Object.keys(item).sort()).not.toContain("id");
      expect(Object.keys(item).sort()).not.toContain("pickupLocationId");
    }
    expect(ostatniZapis()!.items[1]).toEqual({
      label: "Magazyn główny",
      address: "ul. Polna 12, 30-001 Kraków",
    });
  });

  it("drugie kliknięcie nie dubluje punktów — przycisk gaśnie z wyjaśnieniem", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), directionsSection()]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getByRole("button", { name: doj.import.action }));
    flushAutosave();
    await waitFor(() => expect(ostatniZapis()?.items).toHaveLength(3));

    const przycisk = within(szuflada).getByRole("button", { name: doj.import.action });
    expect((przycisk as HTMLButtonElement).disabled).toBe(true);
    expect(within(szuflada).getByText(doj.import.nothingNew)).toBeTruthy();
    // Treść nie urosła po tym, jak wszystkie punkty już w niej są.
    expect(ostatniZapis()!.items).toHaveLength(3);
  });
});

describe("wyłączony przycisk MÓWI, czego brakuje", () => {
  it("bez punktów odbioru: powód odsyła do modułu Dostaw", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), directionsSection()], { pickupLocations: [] });
    const szuflada = await otworzSzuflade(user);

    const przycisk = within(szuflada).getByRole("button", { name: doj.import.action });
    expect((przycisk as HTMLButtonElement).disabled).toBe(true);
    expect(within(szuflada).getByText(doj.import.empty)).toBeTruthy();
    // Powód jest powiązany z przyciskiem, a nie tylko postawiony obok.
    const opisId = przycisk.getAttribute("aria-describedby");
    expect(opisId, "powód stoi obok przycisku, ale nic go z nim nie wiąże").toBeTruthy();
    expect(document.getElementById(opisId!)?.textContent).toBe(doj.import.empty);
  });

  it("sekcja pełna: powód mówi o USUNIĘCIU, a nie o braku punktów", async () => {
    const user = uzytkownik();
    const pelna = trescDojazdu();
    pelna.items = Array.from({ length: 6 }, (_, index) => ({
      label: `Punkt ${index + 1}`,
      address: `ul. Testowa ${index + 1}, 30-00${index + 1} Kraków`,
    }));
    renderBuilder([heroSection(), directionsSection(pelna)]);
    const szuflada = await otworzSzuflade(user);

    expect(
      (within(szuflada).getByRole("button", { name: doj.import.action }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(within(szuflada).getByText(doj.import.full)).toBeTruthy();
  });
});

describe("przycisk bierze się z REJESTRU, nie z nazwy typu", () => {
  it("kontakt (bez `itemsImport`) nie dostaje przycisku kopiowania", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), directionsSection(), contactSection()]);

    const szufladaDojazdu = await otworzSzuflade(user, 0);
    expect(
      within(szufladaDojazdu).queryByRole("button", { name: doj.import.action }),
      "dojazd zadeklarował źródło, a przycisku nie ma",
    ).toBeTruthy();
    await user.keyboard("{Escape}");

    const szufladaKontaktu = await otworzSzuflade(user, 1);
    expect(
      within(szufladaKontaktu).queryByText(doj.import.action),
      "typ bez deklaracji dostał cudzy przycisk",
    ).toBeNull();
  });
});

describe("szuflada dojazdu: trzy pola wpisu, bez zakładek i bez ustawień wyglądu", () => {
  it("nazwa, adres i godziny — oraz sam przełącznik układu", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), directionsSection()]);
    const szuflada = await otworzSzuflade(user);

    expect(within(szuflada).queryAllByRole("tab"), "dojazd dostał zakładki bez powodu").toHaveLength(0);
    expect(within(szuflada).getByLabelText(struct.layout)).toBeTruthy();
    expect(within(szuflada).getByLabelText(doj.fields.label)).toBeTruthy();
    expect(within(szuflada).getByLabelText(doj.fields.address)).toBeTruthy();
    expect(within(szuflada).getByLabelText(doj.fields.hours)).toBeTruthy();
    // Zero przełączników: mapa jest za kliknięciem ZAWSZE (ADR-096).
    expect(within(szuflada).queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("edycja nazwy punktu zapisuje treść z NOWĄ nazwą i nietkniętym adresem", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), directionsSection()]);
    const szuflada = await otworzSzuflade(user);

    await user.clear(within(szuflada).getByLabelText(doj.fields.label));
    await user.type(within(szuflada).getByLabelText(doj.fields.label), "Serwis i wydawka");
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()?.items[0]?.label).toBe("Serwis i wydawka"));
    expect(ostatniZapis()!.items[0]!.address).toBe("ul. Warsztatowa 8, 30-003 Kraków");
  });
});
