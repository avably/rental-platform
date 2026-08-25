// @vitest-environment jsdom

/**
 * KONTROLKA PŁÓTNA MA DAWAĆ SKUTEK (ADR-173; audyt kreatora W4, W7, W8).
 *
 * Trzy wady z audytu mają jeden mianownik: kontrolka istnieje, reaguje na
 * kliknięcie i NIE ROBI NIC. Zapis się udaje, historia rośnie, wskaźnik mówi
 * „Zapisano" — a na ekranie nie zmienia się ani jeden piksel. To jest ta sama
 * klasa, przez którą operator nie mógł edytować przycisku (ADR-166), i ta sama,
 * którą audyt nazwał odmianą 2: warunek żyje w rendererze, kontrolka o nim
 * nie wie.
 *
 * ============ CZEGO TEN PLIK DOWODZI, A CZEGO NIE ============
 *
 * Każdy test niżej mierzy SKUTEK, a nie czynność: gdzie element wylądował
 * w drzewie renderu, jaką wartość ma jego zmienna pudełka, jaka geometria
 * poszła do zapisu. ŻADEN nie sprawdza, że przycisk istnieje ani że handler
 * został wywołany — bo dokładnie tak wyglądały testy, które przepuściły te
 * trzy wady (audyt, odmiana 4: „testy pilnują wady zamiast jej zapobiegać").
 *
 * Czego nie dowodzi: że wynik jest ładny. Tego dowodzi pomiar w przeglądarce
 * (dziennik budowy), a nie jsdom, który nie liczy układu.
 */
import { DEFAULT_SITE_STYLE } from "@avably/core/site";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
const { mobileLayoutOf, paintsBehindContent, liftIntoContentBand, sizeOf } = await import(
  "@avably/core/site"
);

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const SECTION_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const builder = plMessages.site.builder;

/** Wysokość płótna testowego — wspólna dla wszystkich sekcji w tym pliku. */
const ROWS = 24;
/** Kolumny płótna i pas treści — te same liczby, którymi liczy rdzeń. */
const KOLUMNY = 144;
const PAS_X = 12;
const PAS_W = 120;
/** Jednostka siatki w pikselach: jsdom nie mierzy płótna, więc miara projektowa. */
const JEDNOSTKA_PX = 8;

type Element = Record<string, unknown>;

function plotno(elements: Element[]) {
  return { version: 2, rows: ROWS, background: "default", elements };
}

function sekcja(elements: Element[]) {
  return {
    id: SECTION_ID,
    type: "hero",
    position: 0,
    enabled: true,
    content: plotno(elements),
  } as unknown as Parameters<typeof SiteBuilder>[0]["sections"][number];
}

function zdjecie(id: string, box: { x: number; y: number; w: number; h: number; z: number }) {
  return { id, kind: "image", alt: "Zdjęcie tła", fit: "cover", layout: { desktop: box } };
}

function ksztalt(id: string, box: { x: number; y: number; w: number; h: number; z: number }) {
  return { id, kind: "shape", shape: "box", fill: "paper", layout: { desktop: box } };
}

/**
 * Nagłówek z pudełkiem OBEJMUJĄCYM TREŚĆ — tak, jak rodzi go paleta.
 * Tryb `hug` jest tu jawnie, bo brak pola `size` znaczy w rdzeniu wymiar JAWNY
 * (zgodność wstecz z treścią sprzed K4), a to jest właśnie ten tryb, w którym
 * uchwyt na telefonie milczał.
 */
function naglowek(id: string, box: { x: number; y: number; w: number; h: number; z: number }) {
  return {
    id,
    kind: "heading",
    text: "Wynajmij sprzęt na weekend",
    level: 1,
    align: "left",
    size: { w: "hug", h: "hug" },
    layout: { desktop: box },
  };
}

function renderBuilder(sections: Parameters<typeof SiteBuilder>[0]["sections"]) {
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

function pointer(node: globalThis.Element, type: string, init: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.assign(event, { pointerId: 1, isPrimary: true });
  act(() => {
    node.dispatchEvent(event);
  });
}

function nextFrame() {
  act(() => {
    vi.advanceTimersToNextFrame();
  });
}

/**
 * Pełne przeciągnięcie. `alt` zdejmuje przyciąganie do sąsiadów — mierzymy SAM
 * ruch krawędzi, a nie to, w co się po drodze wyrówna (od tego jest
 * `geometry.test.ts` w rdzeniu).
 */
function drag(node: globalThis.Element, { dx, dy }: { dx: number; dy: number }) {
  const startX = 400;
  const startY = 300;
  pointer(node, "pointerdown", { clientX: startX, clientY: startY, altKey: true });
  for (let step = 1; step <= 4; step += 1) {
    pointer(node, "pointermove", {
      clientX: startX + (dx * step) / 4,
      clientY: startY + (dy * step) / 4,
      altKey: true,
    });
    nextFrame();
  }
  pointer(node, "pointerup", { clientX: startX + dx, clientY: startY + dy, altKey: true });
}

async function flushAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(1_500);
  });
}

function lastSavedCanvas() {
  const call = actions.upsertSection.mock.calls.at(-1)?.[0] as
    | { content: { elements: { id: string; layout: { desktop: Record<string, number> } }[] } }
    | undefined;
  return call?.content;
}

function frameFor(container: HTMLElement, id: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-element-frame="${id}"]`);
  expect(node, `brak ramki elementu ${id}`).not.toBeNull();
  return node!;
}

/** Zaznaczenie DOMKNIĘTYM kliknięciem — samo wciśnięcie zostawia gest w toku. */
function zaznacz(container: HTMLElement, id: string): HTMLElement {
  const frame = frameFor(container, id);
  pointer(frame, "pointerdown", { clientX: 10, clientY: 10 });
  pointer(frame, "pointerup", { clientX: 10, clientY: 10 });
  return frameFor(container, id);
}

function switchToMobile() {
  fireEvent.click(screen.getByLabelText(builder.viewportMobile));
}

/** Pudełko TREŚCI elementu (nie ramka) — węzeł, który maluje renderer. */
function boxNode(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-canvas-grid] [data-element-id="${id}"]`);
}

/** Czy element maluje się w WARSTWIE TŁA — pytanie zadane RENDEROWI, nie kodowi. */
function wWarstwieTla(container: HTMLElement, id: string): boolean {
  return container.querySelector(`[data-canvas-bleed] [data-element-id="${id}"]`) !== null;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: SECTION_ID });
  actions.reorderSections.mockResolvedValue({ ok: true });
  actions.publishSite.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* ===================================================================== */

describe("W4 — element rozciągnięty do krawędzi daje się wyprowadzić na wierzch", () => {
  const TLO = "tlo";
  const NAPIS = "napis";

  /** Kafel dekoracyjny — punkt odniesienia dla „na wierzch" (patrz niżej). */
  const KAFEL = "kafel";

  /** Stan, W KTÓRY OPERATOR WPADA: zdjęcie rozciągnięte do obu krawędzi. */
  function hero() {
    return sekcja([
      zdjecie(TLO, { x: 0, y: 0, w: KOLUMNY, h: 12, z: 0 }),
      ksztalt(KAFEL, { x: 12, y: 2, w: 40, h: 8, z: 2 }),
      naglowek(NAPIS, { x: 12, y: 4, w: 60, h: 6, z: 1 }),
    ]);
  }

  it("KONTROLA POZYTYWNA: rozciągnięcie do krawędzi naprawdę wsadza element pod treść", () => {
    const { container } = renderBuilder([hero()]);
    // Bez tej asercji cały test niżej mógłby przechodzić nad pustym zbiorem:
    // element, który nigdy nie był w warstwie tła, „wychodzi" z niej za darmo.
    expect(wWarstwieTla(container, TLO), "zdjęcie pełnoekranowe nie trafiło do warstwy tła").toBe(
      true,
    );
    expect(boxNode(container, TLO), "pudełko tła stoi jednocześnie w siatce treści").toBeNull();
    expect(wWarstwieTla(container, NAPIS), "nagłówek wylądował w warstwie tła").toBe(false);
  });

  it("akcja NA WIERZCH wyprowadza zdjęcie z warstwy tła do siatki — i stawia je NAD tekstem", async () => {
    const { container } = renderBuilder([hero()]);
    zaznacz(container, TLO);

    const naWierzch = container.querySelector<HTMLElement>('[data-toolbar-action="element-front"]');
    expect(naWierzch, "pasek elementu nie ma akcji wynoszącej na wierzch").not.toBeNull();
    fireEvent.click(naWierzch!);

    // SKUTEK W RENDERZE: pudełko zmienia warstwę drzewa, a nie tylko liczbę `z`.
    expect(wWarstwieTla(container, TLO), "zdjęcie zostało w warstwie tła").toBe(false);
    const box = boxNode(container, TLO);
    expect(box, "zdjęcie nie weszło do siatki treści").not.toBeNull();
    expect(box!.getAttribute("data-element-kind")).toBe("image");

    /*
     * …i leży NAD DEKORACJĄ, czyli tak wysoko, jak zdjęcie leżeć może.
     *
     * ZMIANA WOBEC W4 (ADR-274). Do tej poprawki nogą była nierówność
     * „zdjęcie nad NAPISEM" — i to jest dokładnie ta arytmetyka, którą audyt
     * UX 2026-08-25 zastał na produkcji jako zdjęcie zasłaniające h1, lead
     * i CTA (`/audyt-c`). Od ADR-274 render ma dwa pasma: dekoracja maluje się
     * POD treścią czytelną niezależnie od zapisanego `z`, więc „na wierzch"
     * wynosi zdjęcie na szczyt DEKORACJI. Sens akcji zostaje ten sam i to on
     * jest tu mierzony: element wychodzi z warstwy tła i przestaje być pod
     * wszystkim, co na nim leży.
     */
    const zTla = Number(box!.style.getPropertyValue("--el-z"));
    const zKafla = Number(boxNode(container, KAFEL)!.style.getPropertyValue("--el-z"));
    const zNapisu = Number(boxNode(container, NAPIS)!.style.getPropertyValue("--el-z"));
    expect(zTla, "zdjęcie nie wyszło na szczyt dekoracji").toBeGreaterThan(zKafla);
    expect(zNapisu, "dekoracja przykryła napis — patrz ADR-274").toBeGreaterThan(zTla);

    // SKUTEK W MODELU: element wchodzi w pas treści, pion zostaje nietknięty.
    await flushAutosave();
    const zapisane = lastSavedCanvas()!.elements.find((element) => element.id === TLO)!;
    expect(zapisane.layout.desktop.x).toBe(PAS_X);
    expect(zapisane.layout.desktop.w).toBe(PAS_W);
    expect(zapisane.layout.desktop.y).toBe(0);
    expect(zapisane.layout.desktop.h).toBe(12);
  });

  it("akcja NA WIERZCH nie rusza geometrii elementu, który w warstwie tła nie stoi", async () => {
    // Kontrola negatywna: wyprowadzenie jest wyjściem awaryjnym z jednego stanu,
    // a nie skutkiem ubocznym każdego kliknięcia w tę samą ikonę.
    const { container } = renderBuilder([hero()]);
    zaznacz(container, NAPIS);
    fireEvent.click(container.querySelector<HTMLElement>('[data-toolbar-action="element-front"]')!);
    await flushAutosave();

    const zapisany = lastSavedCanvas()!.elements.find((element) => element.id === NAPIS)!;
    expect(zapisany.layout.desktop.x).toBe(12);
    expect(zapisany.layout.desktop.w).toBe(60);
  });

  it("akcja NA SPÓD po wyprowadzeniu odkłada zdjęcie z powrotem pod kafel", () => {
    // Odniesieniem jest DEKORACJA, nie napis: pod napisem zdjęcie leży od
    // ADR-274 zawsze, więc porównanie z nim przechodziłoby także wtedy, gdyby
    // „na spód" nie robiło nic (test pilnujący własnej awarii).
    const { container } = renderBuilder([hero()]);
    zaznacz(container, TLO);
    fireEvent.click(container.querySelector<HTMLElement>('[data-toolbar-action="element-front"]')!);
    const poWierzchu = Number(boxNode(container, TLO)!.style.getPropertyValue("--el-z"));
    expect(poWierzchu).toBeGreaterThan(
      Number(boxNode(container, KAFEL)!.style.getPropertyValue("--el-z")),
    );

    fireEvent.click(container.querySelector<HTMLElement>('[data-toolbar-action="element-back"]')!);
    const zTla = Number(boxNode(container, TLO)!.style.getPropertyValue("--el-z"));
    expect(zTla).toBeLessThan(Number(boxNode(container, KAFEL)!.style.getPropertyValue("--el-z")));
    expect(zTla).toBeLessThan(Number(boxNode(container, NAPIS)!.style.getPropertyValue("--el-z")));
  });
});

describe("W4 — reguła warstwy tła w rdzeniu mówi to samo, co renderer", () => {
  /*
   * KONTRAKT MIĘDZY PAKIETAMI BEZ PORÓWNYWANIA ŹRÓDEŁ.
   *
   * Reguła „co maluje się pod treścią" żyje w dwóch miejscach: w rdzeniu
   * (`paintsBehindContent` — bo to on rządzi warstwami) i w rendererze
   * (`bleedsToEdges` — bo to on buduje drzewo). Porównanie kodu obu nie
   * dowiodłoby niczego: liczy się, GDZIE element naprawdę ląduje. Pytamy więc
   * render — dokładnie tak, jak pyta go operator.
   */
  const PRZYPADKI: { id: string; element: Element; opis: string }[] = [
    { id: "foto-pelne", element: zdjecie("foto-pelne", { x: 0, y: 0, w: KOLUMNY, h: 6, z: 0 }), opis: "zdjęcie od krawędzi do krawędzi" },
    { id: "ksztalt-pelny", element: ksztalt("ksztalt-pelny", { x: 0, y: 6, w: KOLUMNY, h: 4, z: 1 }), opis: "kształt od krawędzi do krawędzi" },
    { id: "foto-waskie", element: zdjecie("foto-waskie", { x: 0, y: 10, w: KOLUMNY - 1, h: 4, z: 2 }), opis: "zdjęcie o jednostkę węższe" },
    { id: "foto-przesuniete", element: zdjecie("foto-przesuniete", { x: 1, y: 14, w: KOLUMNY - 1, h: 4, z: 3 }), opis: "zdjęcie odsunięte od lewej" },
    { id: "napis-pelny", element: naglowek("napis-pelny", { x: 0, y: 18, w: KOLUMNY, h: 4, z: 4 }), opis: "nagłówek na pełną szerokość" },
  ];

  it("dla KAŻDEGO przypadku rdzeń i render są zgodne", () => {
    const { container } = renderBuilder([sekcja(PRZYPADKI.map((p) => p.element))]);
    // Kontrola pozytywna: zbiór nie jest pusty i NIE jest jednorodny — inaczej
    // funkcja zwracająca stale `false` przechodziłaby ten test.
    const oczekiwane = PRZYPADKI.map((p) => paintsBehindContent(p.element as never));
    expect(new Set(oczekiwane).size, "wszystkie przypadki dają tę samą odpowiedź").toBe(2);

    for (const [index, { id, opis }] of PRZYPADKI.entries()) {
      expect(wWarstwieTla(container, id), `rozjazd rdzenia i renderu: ${opis}`).toBe(
        oczekiwane[index],
      );
    }
  });

  it("wyprowadzenie do pasa treści zdejmuje element z warstwy tła — w rdzeniu i w renderze", () => {
    const przed = zdjecie("foto", { x: 0, y: 0, w: KOLUMNY, h: 6, z: 0 });
    const po = liftIntoContentBand(przed as never);
    expect(paintsBehindContent(przed as never)).toBe(true);
    expect(paintsBehindContent(po)).toBe(false);

    const { container } = renderBuilder([sekcja([po as unknown as Element])]);
    expect(wWarstwieTla(container, "foto")).toBe(false);
    expect(boxNode(container, "foto")).not.toBeNull();
  });
});

/* ===================================================================== */

describe("W7 — uchwyt rozmiaru w widoku telefonu zmienia WYRENDEROWANE pudełko", () => {
  const NAPIS = "napis";

  function hero() {
    return sekcja([naglowek(NAPIS, { x: 12, y: 4, w: 60, h: 6, z: 0 })]);
  }

  /** Szerokość pudełka mobilnego, tak jak ją widzi arkusz. */
  function mobileWidth(container: HTMLElement): string {
    return boxNode(container, NAPIS)!.style.getPropertyValue("--el-mw");
  }

  it("uchwyt boczny odbiera szerokość treści i wpisuje tę, którą operator narysował", () => {
    const sekcjaHero = hero();
    const auto = mobileLayoutOf(sekcjaHero.content as never).boxes[NAPIS]!;

    const { container } = renderBuilder([sekcjaHero]);
    switchToMobile();

    // KONTROLA POZYTYWNA: to jest stan, w którym uchwyt milczał — pudełko
    // mobilne bierze wymiar z treści, więc narysowana szerokość nie ma jak wejść.
    expect(mobileWidth(container), "nagłówek nie startuje z wymiarem z treści").toBe("max-content");

    const frame = zaznacz(container, NAPIS);
    drag(frame.querySelector('[data-resize-handle="e"]')!, { dx: 10 * JEDNOSTKA_PX, dy: 0 });

    const oczekiwana = `${((auto.w + 10) / KOLUMNY) * 100}%`;
    expect(mobileWidth(container), "uchwyt na telefonie nie ruszył pudełka").toBe(oczekiwana);
    // Wysokości uchwyt boczny nie dotknął — więc dalej wynika z treści.
    expect(boxNode(container, NAPIS)!.style.getPropertyValue("--el-mh")).toBe("max-content");
  });

  it("klawiatura na telefonie daje ten sam skutek co uchwyt", () => {
    const sekcjaHero = hero();
    const auto = mobileLayoutOf(sekcjaHero.content as never).boxes[NAPIS]!;

    const { container } = renderBuilder([sekcjaHero]);
    switchToMobile();
    const frame = zaznacz(container, NAPIS);
    for (let krok = 0; krok < 10; krok += 1) {
      fireEvent.keyDown(frame, { key: "ArrowRight", ctrlKey: true });
    }

    expect(mobileWidth(container)).toBe(`${((auto.w + 10) / KOLUMNY) * 100}%`);
  });

  it("KONTROLA NEGATYWNA: sam ruch na telefonie NIE odbiera wymiaru z treści", async () => {
    const { container } = renderBuilder([hero()]);
    switchToMobile();
    drag(frameFor(container, NAPIS), { dx: 0, dy: 8 * JEDNOSTKA_PX });
    await flushAutosave();

    expect(mobileWidth(container)).toBe("max-content");
    const zapisany = lastSavedCanvas()!.elements.find((element) => element.id === NAPIS)!;
    expect(sizeOf(zapisany as never)).toEqual({ w: "hug", h: "hug" });
  });
});

/* ===================================================================== */

describe("W8 — rozmiar da się zmienić klawiaturą, i to tak samo jak myszą", () => {
  const NAPIS = "napis";
  const KROKI_W = 3;
  const KROKI_H = 2;

  function hero() {
    return sekcja([naglowek(NAPIS, { x: 12, y: 4, w: 40, h: 6, z: 0 })]);
  }

  it("mysz i klawiatura kończą DOKŁADNIE tym samym stanem płótna", async () => {
    // Jeden test na obie drogi, bo dwa osobne pozwoliłyby im się rozjechać:
    // klawiatura, która „prawie" robi to co uchwyt, jest drugą ścieżką rozmiaru.
    const { container: mysz } = renderBuilder([hero()]);
    const frameMyszy = zaznacz(mysz, NAPIS);
    drag(frameMyszy.querySelector('[data-resize-handle="se"]')!, {
      dx: KROKI_W * JEDNOSTKA_PX,
      dy: KROKI_H * JEDNOSTKA_PX,
    });
    await flushAutosave();
    const poMyszy = lastSavedCanvas();
    expect(poMyszy, "gest myszą nic nie zapisał").toBeDefined();

    cleanup();
    actions.upsertSection.mockClear();

    const { container: klawiatura } = renderBuilder([hero()]);
    const frameKlawiatury = zaznacz(klawiatura, NAPIS);
    for (let krok = 0; krok < KROKI_W; krok += 1) {
      fireEvent.keyDown(frameKlawiatury, { key: "ArrowRight", ctrlKey: true });
    }
    for (let krok = 0; krok < KROKI_H; krok += 1) {
      fireEvent.keyDown(frameKlawiatury, { key: "ArrowDown", ctrlKey: true });
    }
    await flushAutosave();
    const poKlawiaturze = lastSavedCanvas();

    // KONTROLA POZYTYWNA: obie drogi naprawdę COŚ zrobiły — porównanie dwóch
    // stanów nietkniętych też byłoby równością.
    expect(poMyszy!.elements[0]!.layout.desktop).not.toEqual({ x: 12, y: 4, w: 40, h: 6, z: 0 });
    expect(poKlawiaturze).toEqual(poMyszy);
  });

  it("strzałka z Ctrl zmienia ROZMIAR, a goła strzałka POZYCJĘ", async () => {
    const { container } = renderBuilder([hero()]);
    const frame = zaznacz(container, NAPIS);

    fireEvent.keyDown(frame, { key: "ArrowRight" });
    await flushAutosave();
    const poRuchu = lastSavedCanvas()!.elements[0]!.layout.desktop;
    expect(poRuchu).toEqual({ x: 13, y: 4, w: 40, h: 6, z: 0 });

    fireEvent.keyDown(frameFor(container, NAPIS), { key: "ArrowRight", ctrlKey: true });
    await flushAutosave();
    const poRozmiarze = lastSavedCanvas()!.elements[0]!.layout.desktop;
    expect(poRozmiarze).toEqual({ x: 13, y: 4, w: 41, h: 6, z: 0 });
  });

  it("Shift powiększa krok rozmiaru tak samo, jak powiększa krok ruchu", async () => {
    const { container } = renderBuilder([hero()]);
    fireEvent.keyDown(zaznacz(container, NAPIS), { key: "ArrowDown", ctrlKey: true, shiftKey: true });
    await flushAutosave();
    expect(lastSavedCanvas()!.elements[0]!.layout.desktop.h).toBe(16);
  });

  it("zmiana rozmiaru klawiaturą odbiera wymiar treści — tak samo jak uchwyt", async () => {
    const { container } = renderBuilder([hero()]);
    fireEvent.keyDown(zaznacz(container, NAPIS), { key: "ArrowRight", ctrlKey: true });
    await flushAutosave();
    const zapisany = lastSavedCanvas()!.elements[0]!;
    expect(sizeOf(zapisany as never)).toEqual({ w: "fixed", h: "hug" });
  });

  it("warstwa edycyjna nie ma ANI JEDNEJ fokusowalnej kontrolki bez skutku klawiaturowego", () => {
    const { container } = renderBuilder([hero()]);
    const frame = zaznacz(container, NAPIS);

    const uchwyty = [...frame.querySelectorAll<HTMLElement>("[data-resize-handle]")];
    // Kontrola pozytywna: uchwyty są w drzewie — skan po pustym zbiorze niczego
    // by nie bronił.
    expect(uchwyty).toHaveLength(8);
    for (const uchwyt of uchwyty) {
      expect(uchwyt.getAttribute("tabindex"), "uchwyt wraca do kolejności Tab").toBe("-1");
      expect(uchwyt.getAttribute("aria-hidden"), "uchwyt wraca do drzewa dostępności").toBe("true");
    }

    // Kontrolką klawiatury jest RAMKA — i ogłasza, co przyjmuje.
    expect(frame.getAttribute("tabindex")).toBe("0");
    expect(frame.getAttribute("aria-keyshortcuts")).toContain("Control+ArrowRight");
  });
});
