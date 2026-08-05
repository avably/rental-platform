import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * GALERIA W KREATORZE — DROGĄ OPERATORA (E3, aneks ADR-094).
 *
 * ==================== CZEGO PILNUJE TEN PLIK ====================
 *
 * Model galerii i jego granice dowodzi `@avably/core` bez DOM-u, dostępność
 * powiększenia — `@avably/ui`. Tutaj zostaje to, czego żadna funkcja czysta nie
 * zobaczy: czy KLIK OPERATORA naprawdę dojeżdża do akcji serwerowej z treścią,
 * którą operator zobaczył.
 *
 * ==================== LEKCJA E2, ZASTOSOWANA WPROST ====================
 *
 * Kontrolki znajdujemy po ROLI i DOSTĘPNEJ NAZWIE — nigdy po `data-*`. Powód
 * jest twardy: test klikający element znaleziony po znaczniku przechodzi TAKŻE
 * wtedy, gdy jedyna droga do funkcji jest niewidoczna albo nienazwana (dokładnie
 * to przepuściły kontrakty E2 przy wstawianiu sekcji). Klikamy `userEvent`-em
 * (pełna sekwencja wskaźnika) i mierzymy WYWOŁANIE AKCJI SERWEROWEJ — nie stan
 * optymistyczny i nie DOM.
 *
 * Wyjątkiem są kotwice STRUKTURY (`[data-cms-item]`, `[data-cms-form]`), po
 * których wyłącznie NAWIGUJEMY do miejsca w drzewie; ani jedno kliknięcie ani
 * jedna asercja skutku ich nie używa.
 *
 * Upload jedzie PRAWDZIWĄ orkiestracją biletu (ADR-082) — podmieniamy wyłącznie
 * akcje serwerowe i transfer bajtów, bo to jej właśnie ten plik dowodzi:
 * galeria nie ma własnego kanału wysyłki.
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
  updateSiteStyle: vi.fn(),
  applyStarterTemplate: vi.fn(),
  publishSite: vi.fn(),
}));
const uploads = vi.hoisted(() => ({
  prepareSiteImageUploadAction: vi.fn(),
  finalizeSiteImageUploadAction: vi.fn(),
}));

vi.mock("@/lib/actions/site", () => actions);
vi.mock("@/lib/actions/site-images", () => ({
  photoSearchAvailable: vi.fn(async () => false),
  searchPhotos: vi.fn(async () => ({ ok: true, photos: [] })),
  confirmPhotoChoice: vi.fn(async () => {}),
}));
vi.mock("@/app/[locale]/(panel)/strona/upload-actions", () => uploads);
vi.mock("@/app/[locale]/(panel)/strona/upload-flow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[locale]/(panel)/strona/upload-flow")>()),
  uploadSiteImageToSignedUrl: vi.fn(async () => ({ error: null })),
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
type Galeria = {
  layout: string;
  columns: number;
  gap: string;
  lightbox: boolean;
  heading?: string;
  items: Record<string, unknown>[];
};

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const GALERIA_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const HERO_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const CTA_ID = "cccccccc-3333-4333-8333-333333333333";

const struct = plMessages.site.structured;
const gal = struct.gallery;
const typy = plMessages.site.sectionTypes;
const picker = plMessages.site.sectionPicker;

/** Preset galerii wzbogacony o realną pracę operatora: odnośnik i pusty opis. */
function trescGalerii(): Galeria {
  const preset = structuredPresetFor("gallery", "pl") as unknown as Galeria;
  const [a, b, c] = preset.items;
  return {
    ...preset,
    /*
     * Ustawienia wyglądu ŚWIADOMIE różne od domyślnych (znalezisko własnego
     * dowodu mutacyjnego M6): na treści z wartościami domyślnymi kontrakt
     * bezstratności jest ślepy na przekształcenie, które te wartości USTAWIA
     * — a dokładnie tak wygląda najczęstsza wada przełącznika układu.
     */
    columns: 4,
    gap: "roomy",
    items: [
      { ...a!, link: "https://partner.przyklad.test/realizacja" },
      { ...b!, alt: "" },
      c!,
    ],
  };
}

function gallerySection(content: unknown = trescGalerii()): Section {
  return { id: GALERIA_ID, type: "gallery", position: 1, enabled: true, content } as Section;
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

/** Stara galeria PŁÓTNOWA (v2) — taka, jaką ma strona sprzed ADR-094. */
function plotnowaGaleria(): Section {
  return {
    id: GALERIA_ID,
    type: "gallery",
    position: 1,
    enabled: true,
    content: {
      version: 2,
      rows: 40,
      background: "default",
      elements: [
        {
          id: "drugie",
          kind: "image",
          alt: "Drugi kadr",
          fit: "cover",
          source: { kind: "storage", path: "tenant-a/site/drugi.jpg" },
          layout: { desktop: { x: 60, y: 8, w: 40, h: 12, z: 0 } },
        },
        {
          id: "pierwsze",
          kind: "image",
          alt: "Pierwszy kadr",
          fit: "cover",
          source: { kind: "storage", path: "tenant-a/site/pierwszy.jpg" },
          layout: { desktop: { x: 12, y: 8, w: 40, h: 12, z: 1 } },
        },
        {
          id: "tytul",
          kind: "heading",
          text: "Realizacje",
          level: 2,
          align: "left",
          layout: { desktop: { x: 12, y: 0, w: 60, h: 4, z: 2 } },
        },
      ],
    },
  } as unknown as Section;
}

function ctaSection(): Section {
  return {
    id: CTA_ID,
    type: "cta",
    position: 2,
    enabled: true,
    content: sectionCanvasFrom("cta", presetContentFor("cta", "pl")),
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
      />
    </NextIntlClientProvider>,
  );
}

/**
 * Radix wiesza `pointer-events: none` na `body` przy otwartym oknie modalnym;
 * w jsdom dziedziczy to zawartość okna, więc kontrola wskaźnika odrzucałaby
 * kliknięcia, które w przeglądarce dochodzą. Wyłączamy WYŁĄCZNIE tę kontrolę —
 * sekwencja zdarzeń zostaje pełna.
 */
const uzytkownik = () =>
  userEvent.setup({ pointerEventsCheck: 0, advanceTimers: vi.advanceTimersByTime });

/** Otwarcie szuflady sekcji — kontrolką, którą operator widzi i słyszy. */
async function otworzSzuflade(user: ReturnType<typeof uzytkownik>) {
  await user.click(screen.getAllByRole("button", { name: struct.openSettings })[0]!);
  return screen.getByRole("dialog");
}

async function przejdzDo(
  user: ReturnType<typeof uzytkownik>,
  szuflada: HTMLElement,
  zakladka: string,
) {
  await user.click(within(szuflada).getByRole("tab", { name: zakladka }));
}

/** Treść OSTATNIEGO zapisu tej sekcji — dowód, że klik dojechał do serwera. */
function ostatniZapis(): Galeria | undefined {
  return actions.upsertSection.mock.calls
    .map(([arg]) => arg as { sectionId?: string; content?: Galeria })
    .filter((arg) => arg.sectionId === GALERIA_ID)
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
  for (const upload of Object.values(uploads)) upload.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: "nowa-sekcja" });
  actions.reorderSections.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("picker: galeria ma PO JEDNYM podglądzie na układ", () => {
  it("trzy warianty, a kliknięty ląduje w zapisanej treści", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection()]);
    await user.click(screen.getByRole("button", { name: plMessages.site.sections.add }));
    const okno = await screen.findByRole("dialog");
    await user.click(within(okno).getByRole("radio", { name: typy.gallery }));

    for (const layout of ["grid", "masonry", "carousel"] as const) {
      expect(
        within(okno).getByRole("button", {
          name: picker.addLayoutAria
            .replace("{type}", typy.gallery)
            .replace("{layout}", gal.layouts[layout]),
        }),
        `brak podglądu układu „${layout}”`,
      ).toBeTruthy();
    }

    await user.click(
      within(okno).getByRole("button", {
        name: picker.addLayoutAria
          .replace("{type}", typy.gallery)
          .replace("{layout}", gal.layouts.masonry),
      }),
    );

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    const zapis = actions.upsertSection.mock.calls
      .map(([arg]) => arg as { type: string; content: Galeria })
      .find((arg) => arg.type === "gallery")!.content;
    expect(isStructuredSection(zapis), "galeria urodziła się jako płótno").toBe(true);
    expect(zapis.layout).toBe("masonry");
    expect(zapis.items.length, "preset bez zdjęć").toBe(3);
  });
});

describe("szuflada jest DWUDZIELNA i mówi to nazwami zakładek", () => {
  it("„Zarządzaj zdjęciami” trzyma zdjęcia, „Wygląd” — ustawienia", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), gallerySection()]);
    const szuflada = await otworzSzuflade(user);

    const zakladki = within(szuflada).getAllByRole("tab");
    expect(zakladki.map((tab) => tab.textContent)).toEqual([gal.tabs.items, gal.tabs.appearance]);

    // Zakładka zdjęć: pole wgrywania i pola opisu — bez ustawień wyglądu.
    expect(within(szuflada).getByLabelText(struct.upload.label)).toBeTruthy();
    expect(within(szuflada).getAllByLabelText(gal.fields.alt).length).toBe(3);
    expect(
      within(szuflada).queryByLabelText(struct.layout),
      "ustawienie układu wyciekło do zakładki ze zdjęciami",
    ).toBeNull();

    await przejdzDo(user, szuflada, gal.tabs.appearance);
    expect(within(szuflada).getByLabelText(struct.layout)).toBeTruthy();
    expect(within(szuflada).getByLabelText(gal.choices.columns)).toBeTruthy();
    expect(within(szuflada).getByLabelText(gal.choices.gap)).toBeTruthy();
    expect(
      within(szuflada).queryByLabelText(struct.upload.label),
      "wgrywanie zdjęć wyciekło do zakładki wyglądu",
    ).toBeNull();
  });

  it("„liczba w rzędzie” ZNIKA przy karuzeli — kontrolka bez skutku nie istnieje", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), gallerySection({ ...trescGalerii(), layout: "carousel" })]);
    const szuflada = await otworzSzuflade(user);
    await przejdzDo(user, szuflada, gal.tabs.appearance);

    expect(within(szuflada).queryByLabelText(gal.choices.columns)).toBeNull();
    expect(within(szuflada).getByLabelText(gal.choices.gap), "odstęp działa w każdym układzie").toBeTruthy();
  });

  it("galeria NIE MA przycisku „dodaj wpis” — kafel rodzi się z pliku", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), gallerySection()]);
    const szuflada = await otworzSzuflade(user);
    // Pusty kafel bez zdjęcia nie przeszedłby schematu, więc przycisk
    // obiecywałby operację kończącą się błędem.
    expect(within(szuflada).queryByRole("button", { name: /dodaj/i })).toBeNull();
  });
});

describe("zdjęcia: wgranie, kolejność, kosz — każde dojeżdża do akcji serwerowej", () => {
  it("MULTI-UPLOAD jedzie torem biletów i dokłada tyle kafli, ile plików", async () => {
    uploads.prepareSiteImageUploadAction
      .mockResolvedValueOnce({
        ok: true,
        upload: { path: "tenant-a/site/nowe-1.jpg", token: "t1", uploadId: "up-1" },
      })
      .mockResolvedValueOnce({
        ok: true,
        upload: { path: "tenant-a/site/nowe-2.jpg", token: "t2", uploadId: "up-2" },
      });
    uploads.finalizeSiteImageUploadAction
      .mockResolvedValueOnce({ ok: true, path: "tenant-a/site/nowe-1.jpg" })
      .mockResolvedValueOnce({ ok: true, path: "tenant-a/site/nowe-2.jpg" });

    const user = uzytkownik();
    renderBuilder([heroSection(), gallerySection()]);
    const szuflada = await otworzSzuflade(user);

    const pole = within(szuflada).getByLabelText(struct.upload.label) as HTMLInputElement;
    Object.defineProperty(pole, "files", {
      configurable: true,
      value: [
        new File(["a"], "realizacja-1.jpg", { type: "image/jpeg" }),
        new File(["b"], "realizacja-2.jpg", { type: "image/jpeg" }),
      ],
    });
    await user.click(pole);
    act(() => {
      pole.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitFor(() => expect(uploads.finalizeSiteImageUploadAction).toHaveBeenCalledTimes(2));
    // Bilet jest wystawiany DLA TEJ strony — bez `siteId` upload trafiłby donikąd.
    expect(uploads.prepareSiteImageUploadAction.mock.calls[0]![0]).toBe(SITE_ID);

    flushAutosave();
    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    const zapis = ostatniZapis()!;
    expect(zapis.items.length, "kafle nie doszły do treści").toBe(5);
    expect(zapis.items.at(-2)!.image).toEqual({ kind: "storage", path: "tenant-a/site/nowe-1.jpg" });
    expect(zapis.items.at(-1)!.image).toEqual({ kind: "storage", path: "tenant-a/site/nowe-2.jpg" });
    // Świeży kafel dostaje PUSTY opis — nazwa pliku w czytniku ekranu brzmi
    // gorzej niż jej brak, a `alt=""` znaczy „zdjęcie dekoracyjne".
    expect(zapis.items.at(-1)!.alt).toBe("");
  });

  it("STRZAŁKA ↑ przestawia kolejność (klik-alternatywa dla przeciągania, WCAG 2.5.7)", async () => {
    const user = uzytkownik();
    const przed = trescGalerii();
    renderBuilder([heroSection(), gallerySection(przed)]);
    const szuflada = await otworzSzuflade(user);

    // Druga pozycja w górę — „Przenieś wyżej" pierwszej pozycji jest wyłączone.
    await user.click(within(szuflada).getAllByRole("button", { name: struct.moveUp })[1]!);
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    const po = ostatniZapis()!;
    expect(po.items[0], "kolejność nie drgnęła").toEqual(przed.items[1]);
    expect(po.items[1]).toEqual(przed.items[0]);
    expect(po.items.length).toBe(3);
  });

  it("KOSZ pyta i dopiero potwierdzenie skraca listę", async () => {
    const user = uzytkownik();
    const przed = trescGalerii();
    renderBuilder([heroSection(), gallerySection(przed)]);
    const szuflada = await otworzSzuflade(user);

    await user.click(within(szuflada).getAllByRole("button", { name: struct.removeItem })[1]!);
    flushAutosave();
    expect(ostatniZapis(), "kliknięcie w kosz skasowało zdjęcie BEZ pytania").toBeUndefined();

    const pytanie = await screen.findByRole("alertdialog").catch(() => null);
    const okno = pytanie ?? screen.getAllByRole("dialog").at(-1)!;
    await user.click(within(okno).getByRole("button", { name: struct.removeConfirm }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    const po = ostatniZapis()!;
    expect(po.items.length).toBe(2);
    expect(po.items).toEqual([przed.items[0], przed.items[2]]);
  });

  it("PUSTY OPIS zostaje w treści, PUSTY PODPIS zdejmuje pole", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), gallerySection()]);
    const szuflada = await otworzSzuflade(user);

    await user.clear(within(szuflada).getAllByLabelText(gal.fields.alt)[0]!);
    flushAutosave();
    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    expect(
      Object.hasOwn(ostatniZapis()!.items[0]!, "alt"),
      "pustka znacząca (zdjęcie dekoracyjne) nie została zapisana",
    ).toBe(true);
    expect(ostatniZapis()!.items[0]!.alt).toBe("");

    await user.clear(within(szuflada).getAllByLabelText(gal.fields.caption)[0]!);
    flushAutosave();
    await waitFor(() =>
      expect(Object.hasOwn(ostatniZapis()!.items[0]!, "caption"), "pole opcjonalne zostało pustym napisem").toBe(
        false,
      ),
    );
  });
});

describe("wygląd: układ i powiększenie", () => {
  it("PRZEŁĄCZENIE UKŁADU zapisuje TĘ SAMĄ treść z innym `layout`", async () => {
    const user = uzytkownik();
    const przed = trescGalerii();
    renderBuilder([heroSection(), gallerySection(przed)]);
    const szuflada = await otworzSzuflade(user);
    await przejdzDo(user, szuflada, gal.tabs.appearance);

    await user.click(within(szuflada).getByLabelText(struct.layout));
    await user.click(await screen.findByRole("option", { name: gal.layouts.carousel }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    const po = ostatniZapis()!;
    expect(po.layout).toBe("carousel");
    // Bezstratność widziana od strony interfejsu, na REALNEJ treści: odnośnik
    // i pusty opis alternatywny mają przeżyć zmianę wyglądu.
    expect({ ...po, layout: przed.layout }).toEqual(przed);
  });

  it("TOGGLE POWIĘKSZENIA zapisuje `lightbox: false`", async () => {
    const user = uzytkownik();
    const przed = trescGalerii();
    renderBuilder([heroSection(), gallerySection(przed)]);
    const szuflada = await otworzSzuflade(user);
    await przejdzDo(user, szuflada, gal.tabs.appearance);

    const przelacznik = within(szuflada).getByRole("checkbox", { name: gal.toggles.lightbox });
    expect((przelacznik as HTMLInputElement).checked, "powiększenie nie jest domyślnie włączone").toBe(true);
    await user.click(przelacznik);
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    expect(ostatniZapis()!.lightbox).toBe(false);
    expect({ ...ostatniZapis()!, lightbox: true }).toEqual(przed);
  });

  it("LICZBA W RZĘDZIE wraca do treści jako LICZBA, nie jako napis", async () => {
    const user = uzytkownik();
    renderBuilder([heroSection(), gallerySection()]);
    const szuflada = await otworzSzuflade(user);
    await przejdzDo(user, szuflada, gal.tabs.appearance);

    await user.click(within(szuflada).getByLabelText(gal.choices.columns));
    await user.click(await screen.findByRole("option", { name: gal.choiceValues.columns["2"] }));
    flushAutosave();

    await waitFor(() => expect(ostatniZapis()).toBeDefined());
    expect(ostatniZapis()!.columns, "wybór zapisał się napisem — schemat go odrzuci").toBe(2);
  });
});

describe("konwersja „Przełącz na sekcję 2.0” PRZENOSI zdjęcia", () => {
  it("stara galeria płótnowa oddaje kadry w kolejności czytania, nic nie ginie", async () => {
    const user = uzytkownik();
    const { container } = renderBuilder([heroSection(), plotnowaGaleria(), ctaSection()]);

    /*
     * Sekcja PŁÓTNOWA nie ma powierzchni „Otwórz ustawienia sekcji" (ta należy
     * do sekcji strukturalnych) — jej szuflada otwiera się z paska narzędzi po
     * zaznaczeniu. Kotwice `data-*` służą tu wyłącznie do WSKAZANIA sekcji
     * w drzewie; klikane kontrolki dalej znajdujemy po roli i nazwie.
     */
    await user.pointer({
      target: container.querySelector<HTMLElement>(`[data-canvas-section="${GALERIA_ID}"]`)!,
      keys: "[MouseLeft>]",
    });
    const pasek = container.querySelector<HTMLElement>(`[data-section-toolbar="${GALERIA_ID}"]`)!;
    await user.click(within(pasek).getByRole("button", { name: plMessages.site.builder.settings }));

    const szuflada = screen.getByRole("dialog");
    await user.click(within(szuflada).getByRole("button", { name: struct.convertAction }));

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalled());
    const nowa = actions.upsertSection.mock.calls
      .map(([arg]) => arg as { sectionId?: string; type: string; content: Galeria })
      .find((arg) => !arg.sectionId)!;

    expect(nowa.type).toBe("gallery");
    expect(isStructuredSection(nowa.content)).toBe(true);
    expect(
      nowa.content.items.map((item) => (item.image as { path: string }).path),
      "kadry weszły w kolejności DODAWANIA zamiast kolejności czytania",
    ).toEqual(["tenant-a/site/pierwszy.jpg", "tenant-a/site/drugi.jpg"]);
    expect(nowa.content.items.map((item) => item.alt)).toEqual(["Pierwszy kadr", "Drugi kadr"]);

    // Stara sekcja zostaje NIETKNIĘTA — operator sam ją usunie, gdy skończy.
    const ruszonaStara = actions.upsertSection.mock.calls
      .map(([arg]) => arg as { sectionId?: string })
      .some((arg) => arg.sectionId === GALERIA_ID);
    expect(ruszonaStara, "konwersja ruszyła starą sekcję").toBe(false);
  });
});
