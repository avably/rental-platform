// @vitest-environment jsdom

/**
 * AUTOZAPIS KREATORA MÓWI PRAWDĘ (K3 z audytu 2026-08-13, ADR-169).
 *
 * Wada, którą ten plik pilnuje, jest JEDYNĄ z audytu, która NISZCZY pracę:
 * `flush()` czyścił kolejkę `dirty` PRZED wysyłką i nie dopisywał sekcji
 * z powrotem, gdy zapis padł. Sekcja wypadała z kolejki na zawsze, następny
 * autozapis jej nie ponawiał, a wskaźnik przy najbliższej UDANEJ akcji obok
 * wystawiał „Zapisano”. Operator dostawał potwierdzenie zapisu pracy, której
 * w bazie nie ma, i publikował w tym przekonaniu.
 *
 * Trzy osie kontraktu — każda odpowiada innemu krokowi tej zguby:
 *
 *   1. KOLEJKA. Nieudany zapis WRACA do `dirty`, a następny autozapis niesie
 *      go razem ze świeżą zmianą. Dowodzimy tego DWIEMA sekcjami: gdyby
 *      przywrócenia nie było, druga tura wysłałaby wyłącznie sekcję dotkniętą
 *      jako ostatnia — z jedną sekcją test przechodziłby dla obu światów.
 *   2. WSKAŹNIK. Dopóki jakaś sekcja nie weszła do bazy, stan brzmi
 *      „Nie zapisano” — także PO udanej akcji obok, bo to ona gasiła prawdę.
 *      Kontrola w drugą stronę: po zapisie udanym stan MUSI brzmieć
 *      „Zapisano”, inaczej ten plik chroniłby wskaźnik, który nigdy nic nie
 *      mówi.
 *   3. WIDOCZNOŚĆ. Komunikat musi być osiągalny przy OTWARTEJ szufladzie.
 *      Szuflada stoi na Radix Dialogu: jej nakładka kryje belkę kreatora
 *      obrazem (z-index) i `aria-hidden`-em dla czytnika, więc komunikat
 *      z belki był w tym stanie nie do zobaczenia i nie do usłyszenia.
 *      `getByRole` pomija poddrzewa `aria-hidden`, więc to zapytanie jest tu
 *      dowodem, a nie ozdobą; warstwę malowania domyka porównanie z-indeksu
 *      NAKŁADKI z z-indeksem warstwy komunikatu — obie odczytane z DOM-u.
 */
import { DEFAULT_SITE_STYLE } from "@avably/core/site";
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
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: () => {} }),
}));

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder");
const { sectionCanvasFrom, presetContentFor } = await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const A_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const B_ID = "bbbbbbbb-2222-4222-8222-222222222222";
/** Odmowa serwera w kształcie, w jakim wraca z akcji (`ok: false`). */
const ODMOWA = "Sekcja przekracza sufit 60 elementów.";

const builder = plMessages.site.builder;
const els = plMessages.site.elements;

/**
 * Sekcje w kształcie, który produkcja NAPRAWDĘ trzyma: `upsertSection`
 * dostaje z kreatora dokładnie `sectionCanvasFrom(typ, presetContentFor(...))`
 * przy każdym wstawieniu typu nie-strukturalnego (`site-builder.tsx`,
 * `addSection`). DWA RÓŻNE typy, bo identyfikatory elementów presetu są
 * deterministyczne (`typ-rodzaj-n`) — dwie sekcje tego samego typu dałyby
 * dwie ramki o tym samym identyfikatorze w jednym dokumencie.
 */
function sekcja(id: string, type: "hero" | "cta", position: number): Section {
  return {
    id,
    type,
    position,
    enabled: true,
    content: sectionCanvasFrom(type, presetContentFor(type, "pl")),
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

/** Pierwsza ramka elementu W TEJ sekcji — punkt zaczepienia edycji operatora. */
function firstFrame(container: HTMLElement, sectionId: string): HTMLElement {
  const section = container.querySelector<HTMLElement>(`[data-canvas-section="${sectionId}"]`);
  expect(section, `sekcja ${sectionId} nie wyszła na płótno`).not.toBeNull();
  const frame = section!.querySelector<HTMLElement>("[data-element-frame]");
  expect(frame, `sekcja ${sectionId} nie ma ani jednej ramki elementu`).not.toBeNull();
  return frame!;
}

/**
 * Jedna zmiana operatora w danej sekcji: zaznaczenie elementu i strzałka
 * w prawo (przesunięcie o jednostkę siatki). To jest najkrótsza droga do
 * WPISU W KOLEJCE `dirty` — dokładnie tego, co ginęło.
 */
function przesun(container: HTMLElement, sectionId: string): void {
  const frame = firstFrame(container, sectionId);
  fireEvent.pointerDown(frame);
  fireEvent.keyDown(frame, { key: "ArrowRight" });
}

/** Wymusza wysłanie odłożonego autozapisu (700 ms + zapas). */
async function autozapis() {
  await act(async () => {
    vi.advanceTimersByTime(1_500);
  });
}

/** Wszystkie zapisy, które poszły dla danej sekcji, w kolejności wysyłki. */
function zapisy(sectionId: string) {
  return actions.upsertSection.mock.calls
    .map(([arg]) => arg as { sectionId?: string; content?: { elements?: { id: string; layout: { desktop: { x: number } } }[] } })
    .filter((arg) => arg.sectionId === sectionId);
}

function stan(container: HTMLElement): string {
  return container.querySelector("[data-builder-save-state]")?.textContent ?? "";
}

/** z-index odczytany z klas Tailwinda danego węzła (`z-50`, `z-[70]`). */
function zIndeksu(node: Element): number {
  const match = /(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/.exec(node.className);
  expect(match, `węzeł bez klasy z-index: ${node.className}`).not.toBeNull();
  return Number(match![1]);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  for (const action of Object.values(actions)) {
    action.mockReset();
    action.mockResolvedValue({ ok: true });
  }
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: A_ID });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("kolejka autozapisu przeżywa porażkę", () => {
  it("nieudany zapis WRACA do kolejki, a następny autozapis niesie go razem ze świeżą zmianą", async () => {
    const a = sekcja(A_ID, "hero", 0);
    const b = sekcja(B_ID, "cta", 1);
    // Pierwszy zapis (sekcja A) odbity przez serwer; każdy następny przechodzi.
    actions.upsertSection.mockResolvedValueOnce({ ok: false, error: ODMOWA });

    const { container } = renderBuilder([a, b]);
    const przesuniety = firstFrame(container, A_ID).getAttribute("data-element-frame")!;
    const przedX = (a.content as unknown as { elements: { id: string; layout: { desktop: { x: number } } }[] })
      .elements.find((element) => element.id === przesuniety)!.layout.desktop.x;

    przesun(container, A_ID);
    await autozapis();
    expect(zapisy(A_ID), "pierwsza próba zapisu sekcji A w ogóle nie wyszła").toHaveLength(1);

    // Operator pracuje dalej — dotyka INNEJ sekcji. To jest ten moment: albo
    // sekcja A jedzie razem z B, albo została w kreatorze i nigdzie indziej.
    przesun(container, B_ID);
    await autozapis();

    expect(zapisy(B_ID), "świeża zmiana w sekcji B nie poszła").toHaveLength(1);
    expect(
      zapisy(A_ID),
      "sekcja A wypadła z kolejki po nieudanym zapisie — następny autozapis jej nie ponowił",
    ).toHaveLength(2);

    const ponowiony = zapisy(A_ID).at(-1)!.content!.elements!.find((element) => element.id === przesuniety);
    expect(ponowiony?.layout.desktop.x, "ponowienie poszło bez edycji operatora").toBe(przedX + 1);
  });

  it("„Zapisz ponownie” w komunikacie wysyła zaległą sekcję jeszcze raz", async () => {
    actions.upsertSection.mockResolvedValueOnce({ ok: false, error: ODMOWA });
    const { container } = renderBuilder([sekcja(A_ID, "hero", 0), sekcja(B_ID, "cta", 1)]);

    przesun(container, A_ID);
    await autozapis();
    expect(zapisy(A_ID)).toHaveLength(1);

    fireEvent.click(await screen.findByRole("button", { name: builder.saveAgain }));
    await waitFor(() => expect(zapisy(A_ID)).toHaveLength(2));
  });
});

describe("wskaźnik stanu nie kłamie", () => {
  it("po nieudanym autozapisie stan brzmi „Nie zapisano” — także PO udanej akcji obok", async () => {
    actions.upsertSection.mockResolvedValue({ ok: false, error: ODMOWA });
    const { container } = renderBuilder([sekcja(A_ID, "hero", 0), sekcja(B_ID, "cta", 1)]);

    przesun(container, A_ID);
    await autozapis();
    await waitFor(() => expect(stan(container)).toBe(builder.unsaved));

    // Udana akcja OBOK — dokładnie ta, która do dziś gasiła prawdę o sekcji,
    // której w bazie nie ma. Kanał `run` bez `quiet`, więc melduje „Zapisano”.
    const akcenty = container.querySelectorAll<HTMLElement>("[data-style-accent]");
    const inny = [...akcenty].find((node) => node.getAttribute("aria-pressed") !== "true")!;
    fireEvent.click(inny);
    await waitFor(() => expect(actions.updateStoreStyle).toHaveBeenCalled());

    expect(
      stan(container),
      "udana akcja obok wystawiła „Zapisano”, choć sekcja nie weszła do bazy",
    ).not.toBe(builder.saved);
    expect(stan(container)).toBe(builder.unsaved);
  });

  it("po UDANYM zapisie stan brzmi „Zapisano” — wskaźnik, który milczy zawsze, nie jest naprawą", async () => {
    const { container } = renderBuilder([sekcja(A_ID, "hero", 0), sekcja(B_ID, "cta", 1)]);

    przesun(container, A_ID);
    await autozapis();
    await waitFor(() => expect(stan(container)).toBe(builder.saved));
  });

  it("udany zapis SPRZĄTA stan „Nie zapisano” — inaczej kreator kłamałby w drugą stronę", async () => {
    actions.upsertSection.mockResolvedValueOnce({ ok: false, error: ODMOWA });
    const { container } = renderBuilder([sekcja(A_ID, "hero", 0), sekcja(B_ID, "cta", 1)]);

    przesun(container, A_ID);
    await autozapis();
    await waitFor(() => expect(stan(container)).toBe(builder.unsaved));

    przesun(container, B_ID);
    await autozapis();
    await waitFor(() => expect(stan(container)).toBe(builder.saved));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("komunikat przebija się przez otwartą szufladę", () => {
  it("„Nie zapisano” zostaje OSIĄGALNY, gdy szuflada ustawień zakłada modalną nakładkę", async () => {
    actions.upsertSection.mockResolvedValue({ ok: false, error: ODMOWA });
    const { container } = renderBuilder([sekcja(A_ID, "hero", 0), sekcja(B_ID, "cta", 1)]);

    przesun(container, A_ID);
    await autozapis();
    const przed = await screen.findByRole("alert");
    expect(przed.textContent).toContain(ODMOWA);

    // Droga operatora do szuflady: pasek zaznaczonego elementu (ADR-166).
    const bar = container.querySelector<HTMLElement>("[data-element-actions]");
    expect(bar, "pasek zaznaczonego elementu nie wyszedł").not.toBeNull();
    fireEvent.click(within(bar!).getByRole("button", { name: els.settings }));

    const overlay = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');
      expect(node, "szuflada nie założyła nakładki — test nie bada tego, co miał").not.toBeNull();
      return node!;
    });

    // Zapytanie ROLĄ, nie selektorem: `getByRole` pomija poddrzewa
    // `aria-hidden`, więc przechodzi wyłącznie wtedy, gdy komunikat naprawdę
    // został wystawiony ponad modalną nakładką.
    const po = screen.getByRole("alert");
    expect(po.textContent).toContain(ODMOWA);
    expect(po.textContent).toContain(builder.unsaved);

    // Malowanie: warstwa komunikatu stoi POZA drzewem kreatora i NAD nakładką.
    const warstwa = po.closest("[data-builder-alert-layer]");
    expect(warstwa, "komunikat nie ma własnej warstwy nad nakładkami").not.toBeNull();
    expect(warstwa!.parentElement, "warstwa komunikatu nie wisi na body").toBe(document.body);
    expect(container.contains(po), "komunikat siedzi w drzewie, które nakładka przykrywa").toBe(false);
    expect(zIndeksu(warstwa!), "nakładka szuflady maluje się NAD komunikatem").toBeGreaterThan(
      zIndeksu(overlay),
    );
  });
});
