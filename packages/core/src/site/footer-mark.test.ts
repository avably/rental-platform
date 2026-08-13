/**
 * REGUŁA „CZY ZNAK WEJDZIE DO TEJ STOPKI" (ADR-167).
 *
 * Reguła jest jedna, a czyta ją render sklepu i ekran panelu — więc jej testy
 * stoją w rdzeniu, przy niej, a nie w którymś z wołających. Test w wołającym
 * pilnowałby JEGO kopii przekonania, a to jest dokładnie ten kształt wady,
 * który ten ADR naprawia.
 */
import { describe, expect, it } from "vitest";

import { footerAcceptsMark } from "./footer-mark";
import { presetContentFor } from "./presets";
import { sectionCanvasFrom } from "./canvas-presets";
import type { CanvasElement } from "./elements";

const V1 = presetContentFor("footer", "pl");
const PLOTNO = sectionCanvasFrom("footer", V1);

const OBRAZ = {
  id: "footer-image-1",
  kind: "image",
  source: { kind: "storage", path: "t/s/x.png" },
  alt: "Obraz operatora",
  fit: "contain",
  layout: { desktop: { x: 0, y: 0, w: 20, h: 8, z: 0 } },
} as CanvasElement;

describe("footerAcceptsMark", () => {
  it("stopka v1 przyjmuje znak — ma dla niego miejsce z projektu", () => {
    expect(footerAcceptsMark(V1)).toBe(true);
  });

  it("stopka z kreatora (płótno v2 bez obrazu) przyjmuje znak", () => {
    // To jest kształt, który najemcy MAJĄ — i jedyny, jaki produkuje kreator.
    expect(PLOTNO.version).toBe(2);
    expect(footerAcceptsMark(PLOTNO)).toBe(true);
  });

  it("płótno z WŁASNYM obrazem znaku NIE przyjmuje", () => {
    expect(footerAcceptsMark({ ...PLOTNO, elements: [...PLOTNO.elements, OBRAZ] })).toBe(false);
  });

  it("obraz rozstrzyga po RODZAJU elementu, a nie po ich liczbie", () => {
    // Płótno stopki z presetu ma kreskę, nagłówek, teksty i przyciski — i mimo
    // to znak przyjmuje. Gdyby regułą było „płótno z elementami", nie wchodziłby
    // nigdzie, czyli naprawa nie naprawiałaby niczego.
    expect(PLOTNO.elements.length).toBeGreaterThan(3);
    expect(footerAcceptsMark(PLOTNO)).toBe(true);
    expect(footerAcceptsMark({ ...PLOTNO, elements: [OBRAZ] })).toBe(false);
  });

  it("treść w kształcie nierozpoznanym przyjmuje znak (degradacja jak przy stylu)", () => {
    // Panel czyta treść wprost z kolumny jsonb, bez schematu. Kształt sprzed
    // zmiany modelu ma dać odpowiedź „znak wejdzie", a nie wywrócić ekran ani
    // po cichu zgasić przełącznika.
    expect(footerAcceptsMark(null)).toBe(true);
    expect(footerAcceptsMark({ version: 2 })).toBe(true);
    expect(footerAcceptsMark({ version: 2, elements: "nie tablica" })).toBe(true);
    expect(footerAcceptsMark({ version: 2, elements: [null, 7, "x"] })).toBe(true);
  });
});
