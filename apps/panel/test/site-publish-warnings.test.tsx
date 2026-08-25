// @vitest-environment jsdom

/**
 * OKNO PUBLIKACJI MÓWI, CO WYJEDZIE DO KLIENTÓW (K-13/K-14, audyt UX 2026-08-25).
 *
 * ===================== WADA, KTÓRĄ TEN PLIK ZAMYKA =====================
 *
 * Potwierdzenie publikacji opisywało wyłącznie ZASIĘG (kto zobaczy i pod jakim
 * adresem). O TREŚCI nie mówiło nic, więc strona z nietkniętym „Napisz kilka
 * zdań o swojej wypożyczalni…" i z kaflami zastępczymi zamiast zdjęć jechała do
 * sklepu tak samo cicho, jak strona dopracowana. Najemca dowiadywał się o tym
 * od klienta.
 *
 * ===================== CO JEST MIERZONE =====================
 *
 *   1. FUNKCJA CZYSTA (`publishWarnings`) — trzy wykrycia, każde osobno, plus
 *      KONTROLA NEGATYWNA: strona dopracowana nie generuje ani jednego
 *      ostrzeżenia. Bez niej „lista niepusta" dowodziłaby wyłącznie tego, że
 *      funkcja coś zwraca;
 *   2. OKNO — lista jest widoczna, niesie liczby, a przycisk potwierdzenia
 *      DALEJ DZIAŁA i zmienia napis na „Opublikuj mimo to". To jest dowód
 *      mutacyjny K-13: gdyby ostrzeżenia blokowały, publikacja przestałaby być
 *      możliwa; gdyby ich nie było, okno wyglądałoby jak przed poprawką.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

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

const { publishWarnings } = await import("@/lib/publish-warnings");
const { PublishDialog } = await import("@/components/publish-dialog");
const { presetContentFor, sectionCanvasFrom, createElement } = await import("@avably/core/site");

type Warned = Parameters<typeof publishWarnings>[0][number];

/** Sekcja freeform prosto z presetu — dokładnie to, czym rodzi ją szablon. */
function przykladowa(): Warned {
  return { type: "freeform", enabled: true, content: presetContentFor("freeform", "pl") };
}

/** Ta sama sekcja z treścią NAPISANĄ przez najemcę. */
function napisana(): Warned {
  return {
    type: "freeform",
    enabled: true,
    content: { heading: "Sprzęt budowlany w Rzeszowie", body: "Wynajmujemy od 2011 roku." },
  };
}

/** Płótno hero z podmienioną listą elementów — reszta kształtu z rdzenia. */
function ploto(elements: unknown[], rows = 60): Warned {
  const canvas = sectionCanvasFrom("hero", presetContentFor("hero", "pl")) as unknown as {
    rows: number;
    elements: unknown[];
  };
  return { type: "hero", enabled: true, content: { ...canvas, rows, elements } };
}

const box = (y: number, h = 10) => ({ desktop: { x: 0, y, w: 40, h, z: 0 } });

afterEach(() => cleanup());

describe("publishWarnings: trzy wykrycia, kontrola negatywna i jedno wykrycie ODRZUCONE", () => {
  it("KONTROLA NEGATYWNA: strona z własną treścią nie ostrzega o niczym", () => {
    expect(
      publishWarnings([
        napisana(),
        ploto([
          { id: "el-1", kind: "heading", text: "Koparki na dobę", level: 1, align: "left", layout: box(0) },
          {
            id: "el-2",
            kind: "image",
            alt: "Koparka na placu",
            fit: "cover",
            source: { kind: "storage", path: "tenant/hero.jpg" },
            layout: box(12, 20),
          },
        ]),
      ]),
    ).toEqual([]);
  });

  it("sekcja z treścią PRZYKŁADOWĄ jest policzona", () => {
    const wynik = publishWarnings([przykladowa(), napisana(), przykladowa()]);
    expect(wynik).toContainEqual({ code: "sampleSection", count: 2 });
  });

  it("preset w DRUGIM języku też jest przykładem", () => {
    // Sekcja dodana po angielsku i oglądana po polsku dalej jest nietknięta.
    const wynik = publishWarnings([
      { type: "freeform", enabled: true, content: presetContentFor("freeform", "en") },
    ]);
    expect(wynik).toContainEqual({ code: "sampleSection", count: 1 });
  });

  it("sekcja WYŁĄCZONA nie jest liczona — publikacja jej nie wypuszcza", () => {
    expect(publishWarnings([{ ...przykladowa(), enabled: false }])).toEqual([]);
  });

  it("obraz bez źródła jest policzony, obraz ZWIĄZANY ze sprzętem — nie", () => {
    const wynik = publishWarnings([
      ploto([
        { id: "el-1", kind: "image", alt: "Bez zdjęcia", fit: "cover", layout: box(0, 20) },
        {
          id: "el-2",
          kind: "image",
          alt: "Zdjęcie sprzętu",
          fit: "cover",
          bindings: { source: { record: "page", field: "image" } },
          layout: box(24, 20),
        },
      ]),
    ]);
    expect(wynik).toContainEqual({ code: "emptyImage", count: 1 });
  });

  it("element z treścią STARTOWĄ z palety jest policzony", () => {
    const swiezy = createElement("heading", "el-nowy", { x: 0, y: 0, w: 40, h: 10, z: 0 }, "pl");
    const wynik = publishWarnings([
      ploto([
        swiezy as unknown,
        { id: "el-2", kind: "text", text: "Nasza własna treść.", variant: "body", align: "left", layout: box(12) },
      ]),
    ]);
    expect(wynik).toContainEqual({ code: "placeholderElement", count: 1 });
  });

  it("ELEMENT POZA EKRANEM TELEFONU nie jest osobnym ostrzeżeniem — bo nie może zajść", async () => {
    // Podpunkt warunkowy findingu K-14, sprawdzony i odrzucony. `mobileLayoutOf`
    // PODNOSI wysokość płótna telefonu do najniższej ręcznej poprawki, a jego
    // sufit jest tą samą liczbą, co sufit geometrii w schemacie — więc pudełko,
    // które przeszło zapis, zawsze mieści się na płótnie, które pod nie urosło.
    // Ten test jest DOWODEM tej tezy, nie jej obejściem: gdyby przycięcie
    // kiedykolwiek stało się możliwe, `rows` przestałoby rosnąć i test upadnie.
    const { mobileLayoutOf, SECTION_MAX_ROWS_MOBILE, GEOMETRY_MAX_ROWS } =
      await import("@avably/core/site");
    expect(GEOMETRY_MAX_ROWS).toBe(SECTION_MAX_ROWS_MOBILE);

    const canvas = {
      rows: 60,
      elements: [
        {
          id: "el-1",
          kind: "text",
          text: "Poza telefonem",
          variant: "body",
          align: "left",
          layout: {
            desktop: { x: 0, y: 0, w: 40, h: 10, z: 0 },
            mobile: { x: 0, y: GEOMETRY_MAX_ROWS - 10, w: 40, h: 10, z: 0 },
          },
        },
      ],
    };
    const layout = mobileLayoutOf(canvas as never);
    const box = layout.boxes["el-1"]!;
    expect(box.y + box.h).toBeLessThanOrEqual(layout.rows);
  });
});

/* ============================== OKNO ============================== */

function renderDialog(warnings: ReturnType<typeof publishWarnings>, onConfirm = vi.fn()) {
  render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <PublishDialog
        disabled={false}
        live={false}
        name="Strona główna"
        address="/"
        warnings={warnings}
        onConfirm={onConfirm}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: plMessages.site.publish.publish }));
  return onConfirm;
}

describe("okno publikacji: ostrzeżenia widać, ale nie blokują", () => {
  it("bez ostrzeżeń okno wygląda jak przed poprawką", () => {
    renderDialog([]);
    expect(document.querySelector("[data-publish-warnings]")).toBeNull();
    expect(
      document.querySelector<HTMLElement>("[data-publish-site-confirm]")!.textContent,
    ).toBe(plMessages.site.publish.publish);
  });

  it("z ostrzeżeniami: lista z liczbami i przycisk „Opublikuj mimo to”", () => {
    const onConfirm = renderDialog([
      { code: "sampleSection", count: 3 },
      { code: "emptyImage", count: 1 },
    ]);

    const lista = document.querySelector<HTMLElement>("[data-publish-warnings]");
    expect(lista, "okno nie pokazało ostrzeżeń").not.toBeNull();
    expect(lista!.dataset.publishWarnings).toBe("2");
    expect(document.querySelector('[data-publish-warning="sampleSection"]')!.textContent).toContain("3");
    expect(document.querySelector('[data-publish-warning="emptyImage"]')).not.toBeNull();

    const potwierdz = document.querySelector<HTMLElement>("[data-publish-site-confirm]")!;
    expect(potwierdz.textContent).toBe(plMessages.site.publish.publishAnyway);
    expect(potwierdz.hasAttribute("disabled"), "ostrzeżenie zablokowało publikację").toBe(false);

    fireEvent.click(potwierdz);
    expect(onConfirm, "publikacja mimo ostrzeżeń nie doszła do skutku").toHaveBeenCalledTimes(1);
  });
});
