// @vitest-environment jsdom

/**
 * WYJŚCIE Z KREATORA NIE GUBI PRACY PO CICHU (ADR-174, resztka po ADR-169).
 *
 * ADR-169 nauczył kolejkę autozapisu przeżywać porażkę, wskaźnik — mówić
 * „Nie zapisano", a komunikat — przebijać się przez modalną nakładkę. Została
 * JEDNA ścieżka, której żaden z jego siedmiu przypadków nie dotykał: wyjście
 * „← Panel". Link odpalał `editor.flush()` i nawigował w tej samej instrukcji,
 * a `flush()` nie zwracał obietnicy — nie było na co czekać. Kreator
 * odmontowywał się w trakcie wysyłki, `settle(id, false)` zapalał licznik
 * w komponencie, którego już nie ma, i cała maszyneria ADR-169 meldowała
 * odmowę do pustego pokoju. Operator wychodził przekonany, że zapisał.
 *
 * Trzy zdania, które psują się osobno:
 *
 *   1. ODMOWA ZATRZYMUJE WYJŚCIE. Klik jest ZATRZYMANY (`preventDefault`),
 *      nawigacja NIE rusza, a operator zostaje na płótnie z komunikatem
 *      i przyciskiem „Zapisz ponownie".
 *   2. CZYSTA KOLEJKA WYPUSZCZA — i to jest kontrola w drugą stronę: bramka,
 *      która nie przepuszcza nigdy, nie jest naprawą, tylko drugą wadą.
 *      Ten sam przypadek dowodzi, że zaległa zmiana JEDZIE przy wyjściu:
 *      zapis wychodzi przed nawigacją, choć zegar autozapisu jeszcze nie minął.
 *   3. ZAMKNIĘCIE KARTY OSTRZEGA — ale WYŁĄCZNIE po odmowie serwera. Przy
 *      pracy, która idzie dobrze, nasłuchu nie ma w ogóle (decyzja ADR-174:
 *      bramka na `dirty` pytałaby po każdym geście i nauczyłaby operatora
 *      klikać „Opuść" odruchowo).
 */
import { DEFAULT_SITE_STYLE } from "@avably/core/site";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/**
 * Router z `push` — bo od ADR-174 to ON wyprowadza z kreatora, a nie domyślne
 * zachowanie linku. Atrapa `Link` przekazuje `onClick` i znaczniki `data-*`
 * dalej, więc klik w teście idzie tą samą drogą, co klik operatora.
 */
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

vi.mock("@/lib/actions/site", () => actions);
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => router,
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

function firstFrame(container: HTMLElement, sectionId: string): HTMLElement {
  const section = container.querySelector<HTMLElement>(`[data-canvas-section="${sectionId}"]`);
  expect(section, `sekcja ${sectionId} nie wyszła na płótno`).not.toBeNull();
  const frame = section!.querySelector<HTMLElement>("[data-element-frame]");
  expect(frame, `sekcja ${sectionId} nie ma ani jednej ramki elementu`).not.toBeNull();
  return frame!;
}

/** Jedna zmiana operatora — najkrótsza droga do wpisu w kolejce `dirty`. */
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

function powrot(container: HTMLElement): HTMLElement {
  const link = container.querySelector<HTMLElement>("[data-builder-back]");
  expect(link, "pasek kreatora nie ma wyjścia „← Panel”").not.toBeNull();
  return link!;
}

/**
 * Klika wyjście i oddaje odpowiedź na pytanie, czy NAWIGACJA ZOSTAŁA
 * ZATRZYMANA. `fireEvent` zwraca `false`, gdy handler wywołał `preventDefault` —
 * czyli dokładnie wtedy, gdy przeglądarka NIE opuści kreatora. To jest ta
 * różnica, której stara wersja (`onClick={() => editor.flush()}`) nie robiła:
 * tam klik szedł dalej i strona znikała razem z komunikatem.
 */
async function klikWyjscie(container: HTMLElement, init?: MouseEventInit): Promise<boolean> {
  let poszedlDalej = true;
  await act(async () => {
    poszedlDalej = fireEvent.click(powrot(container), init);
  });
  return !poszedlDalej;
}

function stan(container: HTMLElement): string {
  return container.querySelector("[data-builder-save-state]")?.textContent ?? "";
}

function stanWyjscia(container: HTMLElement): string | null {
  return powrot(container).getAttribute("data-builder-back-state");
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  router.refresh.mockReset();
  router.push.mockReset();
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

describe("wyjście „← Panel” przy odrzuconym zapisie", () => {
  it("NIE wyprowadza z kreatora, gdy zapis padł — operator zostaje przy komunikacie", async () => {
    actions.upsertSection.mockResolvedValue({ ok: false, error: ODMOWA });
    const { container } = renderBuilder([sekcja(A_ID, "hero", 0), sekcja(B_ID, "cta", 1)]);

    przesun(container, A_ID);
    await autozapis();
    await waitFor(() => expect(stan(container)).toBe(builder.unsaved));

    const zatrzymane = await klikWyjscie(container);

    expect(
      zatrzymane,
      "wyjście z kreatora poszło dalej mimo niezapisanej pracy — komunikat odmowy zniknie razem z kreatorem",
    ).toBe(true);
    expect(
      router.push,
      "kreator nawigował na listę stron, choć sekcja nie weszła do bazy",
    ).not.toHaveBeenCalled();
    expect(stanWyjscia(container)).toBe("blocked");

    // Operator zostaje z pełnym wyposażeniem ADR-169: komunikat z przyczyną
    // i jawne ponowienie. To jest cała różnica wobec cichego wyjścia.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(builder.unsaved);
    expect(alert.textContent).toContain(ODMOWA);
    expect(screen.getByRole("button", { name: builder.saveAgain })).toBeTruthy();
  });

  it("PONAWIA zaległą sekcję przy każdej próbie wyjścia — i wypuszcza, gdy serwer wreszcie przyjmie", async () => {
    actions.upsertSection.mockResolvedValueOnce({ ok: false, error: ODMOWA });
    const { container } = renderBuilder([sekcja(A_ID, "hero", 0), sekcja(B_ID, "cta", 1)]);

    przesun(container, A_ID);
    await autozapis();
    await waitFor(() => expect(stan(container)).toBe(builder.unsaved));
    expect(actions.upsertSection).toHaveBeenCalledTimes(1);

    // Druga próba wyjścia niesie zaległą sekcję jeszcze raz — tym razem serwer
    // ją przyjmuje, więc wyjście przestaje mieć powód, żeby zatrzymywać.
    await klikWyjscie(container);
    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/strona"));
    expect(stan(container), "wskaźnik został na „Nie zapisano” mimo udanego ponowienia").toBe(
      builder.saved,
    );
  });
});

describe("wyjście przy zdrowym zapisie — kontrola w drugą stronę", () => {
  it("WYPUSZCZA i po drodze zapisuje zmianę, której zegar autozapisu jeszcze nie wysłał", async () => {
    const { container } = renderBuilder([sekcja(A_ID, "hero", 0), sekcja(B_ID, "cta", 1)]);

    // Zmiana jest W KOLEJCE, ale 700 ms jeszcze nie minęło — dokładnie ten stan,
    // w którym operator klika „← Panel”, bo skończył pracę.
    przesun(container, A_ID);
    expect(actions.upsertSection, "autozapis wyszedł przed czasem — test nie bada tego, co miał").not.toHaveBeenCalled();

    await klikWyjscie(container);

    await waitFor(() => expect(actions.upsertSection).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/strona"));
    expect(stanWyjscia(container)).toBe("idle");
  });

  it("klik z modyfikatorem (nowa karta) zostaje przeglądarce — kreator nie znika, więc nie ma czego domykać", async () => {
    const { container } = renderBuilder([sekcja(A_ID, "hero", 0), sekcja(B_ID, "cta", 1)]);

    const zatrzymane = await klikWyjscie(container, { metaKey: true });

    expect(zatrzymane, "przejęliśmy otwarcie panelu w nowej karcie").toBe(false);
    expect(router.push, "klik z modyfikatorem nawigował BIEŻĄCĄ kartę").not.toHaveBeenCalled();
  });
});

describe("zamknięcie karty ostrzega dopiero po odmowie serwera", () => {
  /** Zamknięcie karty: `true` znaczy „przeglądarka zapyta, czy na pewno”. */
  function zamknijKarte(): boolean {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it("po odrzuconym zapisie przeglądarka pyta, zanim wypuści", async () => {
    actions.upsertSection.mockResolvedValue({ ok: false, error: ODMOWA });
    const { container } = renderBuilder([sekcja(A_ID, "hero", 0), sekcja(B_ID, "cta", 1)]);

    przesun(container, A_ID);
    await autozapis();
    await waitFor(() => expect(stan(container)).toBe(builder.unsaved));

    expect(
      zamknijKarte(),
      "karta zamyka się bez słowa nad pracą, którą serwer odrzucił",
    ).toBe(true);
  });

  it("przy pracy, która idzie dobrze, NIE pyta o nic — inaczej operator nauczyłby się klikać „Opuść”", async () => {
    const { container } = renderBuilder([sekcja(A_ID, "hero", 0), sekcja(B_ID, "cta", 1)]);

    // Stan spoczynku.
    expect(zamknijKarte(), "ostrzeżenie wisi na czystym kreatorze").toBe(false);

    // Zmiana w kolejce (700 ms zwłoki) też NIE pyta — to jest świadoma granica
    // decyzji ADR-174: `dirty` jest niepuste po każdym poprawnym geście.
    przesun(container, A_ID);
    expect(zamknijKarte(), "ostrzeżenie wchodzi na zwykłej zwłoce autozapisu").toBe(false);

    // I po udanym zapisie dalej cisza.
    await autozapis();
    await waitFor(() => expect(stan(container)).toBe(builder.saved));
    expect(zamknijKarte(), "ostrzeżenie zostało po UDANYM zapisie").toBe(false);
  });

  it("ostrzeżenie ZNIKA, gdy ponowienie wreszcie przejdzie", async () => {
    actions.upsertSection.mockResolvedValueOnce({ ok: false, error: ODMOWA });
    const { container } = renderBuilder([sekcja(A_ID, "hero", 0), sekcja(B_ID, "cta", 1)]);

    przesun(container, A_ID);
    await autozapis();
    await waitFor(() => expect(stan(container)).toBe(builder.unsaved));
    expect(zamknijKarte()).toBe(true);

    przesun(container, B_ID);
    await autozapis();
    await waitFor(() => expect(stan(container)).toBe(builder.saved));
    expect(zamknijKarte(), "ostrzeżenie zostaje po sprzątnięciu niezapisanej pracy").toBe(false);
  });
});
