/**
 * Kontrakt listy ekranów i walidacji uwag (ADR-071): mapowanie tras na
 * etykiety, kolejność sortowania, lustrzaność Zod wobec CHECK-ów 0033.
 */
import { describe, expect, it } from "vitest";

import { createCommentSchema, patchCommentSchema } from "../src/schema";
import { REVIEW_SCREENS, screenFor, screenOrder, stripLocale } from "../src/screens";

describe("lista ekranów przeglądu", () => {
  it("ma dokładnie 39 pozycji z unikatowymi, sortowalnymi etykietami", () => {
    expect(REVIEW_SCREENS).toHaveLength(39);
    const labels = REVIEW_SCREENS.map((screen) => screen.label);
    expect(new Set(labels).size).toBe(39);
    // Prefiksy 01..39 bez dziur — prefiks jest kluczem sortowania widoku PM.
    expect(labels.map(screenOrder).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 39 }, (_, index) => index + 1),
    );
  });

  it.each([
    ["panel", "/", "01 Dashboard"],
    ["panel", "/zamowienia", "02 Zamówienia — lista"],
    ["panel", "/zamowienia/nowe", "03 Zamówienie — nowe"],
    ["panel", "/zamowienia/6a4b", "04 Zamówienie — szczegół"],
    ["panel", "/ustawienia-dostaw/punkty-odbioru/nowy", "08 Punkt odbioru — nowy"],
    // Kolejność wpisów jest tu ZNACZĄCA: gdyby „25 Ustawienia dostaw" stało
    // przed punktami odbioru, przejęłoby ich trasy i pinezka trafiłaby na
    // niewłaściwy ekran. Ta para asercji pilnuje obu stron rozstrzygnięcia.
    ["panel", "/ustawienia-dostaw", "25 Ustawienia dostaw"],
    ["panel", "/katalog/6a4b/progi", "11 Katalog — progi cenowe"],
    ["panel", "/katalog/6a4b", "13 Katalog — produkt"],
    ["panel", "/ustawienia-platnosci", "28 Ustawienia płatności"],
    ["panel", "/admin/tenants", "39 Admin platformy"],
    ["storefront", "/store", "30 Sklep — katalog"],
    ["storefront", "/checkout/platnosc", "33 Checkout — płatność"],
    ["marketing", "/", "35 Landing"],
    ["marketing", "/pricing", "36 Cennik"],
  ] as const)("%s %s → %s", (surface, route, label) => {
    expect(screenFor(surface, route)).toBe(label);
  });

  it("trasa nierozpoznana dostaje etykietę awaryjną 99 (sortuje się na końcu)", () => {
    const label = screenFor("marketing", "/stories");
    expect(label.startsWith("99 ")).toBe(true);
    expect(screenOrder(label)).toBe(99);
  });

  it("stripLocale zdejmuje wyłącznie prefiks locale", () => {
    expect(stripLocale("/pl/zamowienia")).toBe("/zamowienia");
    expect(stripLocale("/en")).toBe("/");
    expect(stripLocale("/store")).toBe("/store");
    expect(stripLocale("/pluton")).toBe("/pluton");
  });
});

describe("walidacja uwag (lustro CHECK-ów 0033)", () => {
  const base = {
    surface: "panel",
    screen: "01 Dashboard",
    route: "/",
    kind: "point",
    pos_x: 0.5,
    pos_y: 0.5,
    body: "uwaga",
  } as const;

  it("punkt przechodzi, domyślny priorytet 3", () => {
    const parsed = createCommentSchema.parse(base);
    expect(parsed.priority).toBe(3);
    expect(parsed.scroll_y).toBe(0);
  });

  it.each([0, 6, 2.5])("priorytet %s odbity", (priority) => {
    expect(createCommentSchema.safeParse({ ...base, priority }).success).toBe(false);
  });

  it("area bez wymiarów i punkt z wymiarami odbite", () => {
    expect(createCommentSchema.safeParse({ ...base, kind: "area" }).success).toBe(false);
    expect(
      createCommentSchema.safeParse({ ...base, area_w: 0.1, area_h: 0.1 }).success,
    ).toBe(false);
    expect(
      createCommentSchema.safeParse({ ...base, kind: "area", area_w: 0.1, area_h: 0.1 }).success,
    ).toBe(true);
  });

  it("współrzędne poza 0..1 odbite", () => {
    expect(createCommentSchema.safeParse({ ...base, pos_x: 1.2 }).success).toBe(false);
  });

  it("patch: pusta zmiana odbita, status spoza open/done odbity", () => {
    expect(patchCommentSchema.safeParse({}).success).toBe(false);
    expect(patchCommentSchema.safeParse({ status: "wontfix" }).success).toBe(false);
    expect(patchCommentSchema.safeParse({ status: "done" }).success).toBe(true);
  });
});
