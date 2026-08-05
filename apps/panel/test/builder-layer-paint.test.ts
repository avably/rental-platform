/**
 * WARSTWA EDYCYJNA MUSI BYĆ MALOWANA (mutacja PM do PR #172).
 *
 * PM skasował regułę `[data-element-frame][data-element-selected="on"]`
 * z arkusza panelu i cała suita — 1442 testy — została zielona. To jest
 * dokładna definicja luki: zaznaczenie, uchwyty i obrys sekcji żyją WYŁĄCZNIE
 * w CSS, a testy komponentów sprawdzają markup i zachowanie, więc kasowanie
 * reguły jest dla nich niewidoczne. Operator dostałby kreator bez ani jednego
 * obrysu i nie wywaliłoby to niczego.
 *
 * Ten plik jest tą brakującą nogą. Sprawdza ARKUSZ, nie wygląd: każda rola
 * warstwy edycyjnej ma mieć regułę, a reguły zaznaczenia mają celować
 * w TOKEN warstwy edycyjnej (`--builder-selection`), a nie w akcent panelu
 * ani — tym bardziej — w motyw najemcy.
 *
 * Czego ten plik NIE dowodzi: że kolor jest ładny i czytelny. Czytelności
 * dowodzi pomiar w przeglądarce (dziennik budowy: kontrast obrysu do tła
 * sekcji per motyw), a nie skan tekstu.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const arkusz = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

/** Ciało reguły o podanym selektorze — `null`, gdy reguły nie ma wcale. */
function regula(selektor: string): string | null {
  const escaped = selektor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`).exec(arkusz);
  return found ? found[1]! : null;
}

describe("arkusz panelu maluje KAŻDĄ rolę warstwy edycyjnej", () => {
  it("kontrola po pustym zbiorze: arkusz istnieje i niesie token warstwy", () => {
    expect(arkusz.length).toBeGreaterThan(1_000);
    expect(arkusz).toContain("--builder-selection:");
    expect(arkusz).toContain("--builder-selection-halo:");
  });

  it("najechanie i focus rysują obrys tokenem warstwy edycyjnej", () => {
    const hover = regula("[data-element-frame]:hover");
    expect(hover, "brak reguły najechania na ramce elementu").not.toBeNull();
    expect(hover!).toContain("--builder-selection");
    expect(arkusz, "focus ramki nie jest malowany").toContain("[data-element-frame]:focus-visible");
  });

  it("ZAZNACZENIE ma obrys z tokenu i otoczkę — to jest reguła skasowana w mutacji PM", () => {
    const wybrane = regula('[data-element-frame][data-element-selected="on"]');
    expect(wybrane, "brak reguły zaznaczenia elementu").not.toBeNull();
    expect(wybrane!, "obrys zaznaczenia spoza tokenu warstwy").toMatch(
      /outline:[^;]*var\(--builder-selection\)/,
    );
    expect(wybrane!, "brak otoczki — obrys ginie na jednym z krańców jasności").toMatch(
      /box-shadow:[^;]*var\(--builder-selection-halo\)/,
    );
  });

  it("uchwyty rozmiaru są malowane tą samą parą kolorów", () => {
    const uchwyt = regula("[data-resize-handle]");
    expect(uchwyt, "brak reguły uchwytu rozmiaru").not.toBeNull();
    expect(uchwyt!).toContain("--builder-selection");
    expect(uchwyt!).toContain("--builder-selection-halo");
  });

  it("KAŻDY z trzech stanów obrysu sekcji ma WŁASNĄ regułę (E2)", () => {
    /*
     * Hierarchia zaznaczenia mówi trzy różne rzeczy tym samym miejscem na
     * ekranie (najechanie, zaznaczenie, sekcja-kontekst edytowanego elementu),
     * więc trzy reguły muszą naprawdę istnieć i naprawdę się różnić. Bez tej
     * asercji dwa stany mogłyby po cichu spaść do jednego wyglądu i cała
     * hierarchia przestałaby być widoczna, nie psując ani jednego testu DOM-u.
     */
    const stany = ["hover", "selected", "context"].map((stan) => ({
      stan,
      cialo: regula(`[data-section-outline="${stan}"]`),
    }));
    for (const { stan, cialo } of stany) {
      expect(cialo, `brak reguły obrysu sekcji dla stanu ${stan}`).not.toBeNull();
      expect(cialo!, `obrys ${stan} spoza tokenu warstwy`).toContain("--builder-selection");
    }
    const opisy = stany.map(({ cialo }) => cialo!.replace(/\s+/g, " ").trim());
    expect(new Set(opisy).size, "stany obrysu sekcji wyglądają identycznie").toBe(3);

    const edycja = regula("[data-inline-editor]");
    expect(edycja, "brak obrysu edycji w miejscu").not.toBeNull();
    expect(edycja!).toContain("--builder-selection");
  });

  it("BŁYSK świeżej sekcji jest malowany i widoczny TAKŻE bez animacji (E2)", () => {
    const blysk = regula('[data-canvas-section][data-section-flash="on"]');
    expect(blysk, "brak reguły błysku świeżej sekcji").not.toBeNull();
    expect(blysk!, "błysk spoza tokenu warstwy").toContain("--builder-selection");
    // Sygnał NIE może istnieć wyłącznie w animacji: operator z
    // `prefers-reduced-motion` dostałby wtedy brak odpowiedzi na „weszła?".
    expect(blysk!, "błysk niesiony wyłącznie ruchem").toMatch(/outline:/);
    expect(arkusz, "animacja błysku poza bramką preferencji ruchu").toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-canvas-section\]\[data-section-flash="on"\]/,
    );
  });

  it("WSKAZANIE SEKCJI-CELU przy przeciąganiu ELEMENTU jest malowane (K6, ADR-092)", () => {
    // Ta sama luka, co przy zaznaczeniu: obrys celu żyje WYŁĄCZNIE w CSS, więc
    // skasowanie reguły zostawia kreator, w którym przeciąganie działa, ale nic
    // nie pokazuje — a testy komponentów tego nie widzą.
    const cel = regula("[data-canvas-section][data-drop-target=\"on\"]");
    expect(cel, "brak obrysu sekcji przyjmującej element").not.toBeNull();
    expect(cel!, "obrys celu spoza tokenu warstwy").toContain("--builder-selection");
  });

  it("po belce wskazującej miejsce sekcji nie został ŚLAD (E2)", () => {
    // Sekcji nie przeciąga się z palety, więc nie ma czego zapowiadać. Reguła,
    // która by została, malowałaby znacznik, którego nikt już nie wystawia.
    expect(arkusz).not.toContain("data-insert-active");
    expect(arkusz).not.toContain("data-insert-target");
  });

  it("element odłączony na telefonie ma własny wariant obrysu", () => {
    expect(regula('[data-element-frame][data-element-detached="on"]')).not.toBeNull();
  });

  it("warstwa edycyjna NIE bierze koloru z motywu najemcy", () => {
    // Motyw tenanta zmienia się pod obrysem co chwilę — obrys, który by go brał,
    // znikałby na jednym motywie i krzyczał na drugim.
    for (const selektor of [
      "[data-element-frame]:hover",
      '[data-element-frame][data-element-selected="on"]',
      "[data-resize-handle]",
      '[data-section-outline="hover"]',
      '[data-section-outline="selected"]',
      '[data-section-outline="context"]',
      '[data-canvas-section][data-section-flash="on"]',
      "[data-inline-editor]",
      '[data-canvas-section][data-drop-target="on"]',
    ]) {
      expect(regula(selektor)!, `${selektor} sięga po zmienną motywu strony`).not.toMatch(
        /var\(--site-/,
      );
    }
  });
});

describe("reguła neutralizująca pudełko edycji jest KOMPLETNA", () => {
  it("zdejmuje pozycjonowanie ORAZ przywraca wymiar owijki", () => {
    // Sama `position: static` nie wystarcza: pudełko w środku niesie własną
    // szerokość i sufit `max-width` (z `hug`), więc bez ich zdjęcia tekst
    // zawijałby się w edycji inaczej niż w renderze — czyli wracałaby ta sama
    // wada, tylko subtelniejsza.
    const blok = regula("[data-element-editing] > .canvas-box");
    expect(blok, "brak reguły neutralizującej pudełko w owijce edycji").not.toBeNull();
    expect(blok!).toContain("position: static");
    expect(blok!).toMatch(/width:\s*100%/);
    expect(blok!).toMatch(/height:\s*100%/);
    expect(blok!).toMatch(/max-width:\s*none/);
  });
});
