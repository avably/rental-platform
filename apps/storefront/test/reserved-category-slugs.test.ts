/**
 * Lista slugów zarezerwowanych vs DRZEWO TRAS sklepu (ADR-155).
 *
 * PO CO TO ISTNIEJE. `RESERVED_CATEGORY_SLUGS` broni najemcę przed nazwaniem
 * kategorii tak, jak nazywa się trasa systemowa sklepu (`/checkout`, `/cart`,
 * `/product`). Lista pisana ręcznie chroni wyłącznie to, co ktoś pamiętał na
 * nią wpisać — a trasy sklepu dochodzą co paczkę. Bez tej bramki nowa trasa
 * `/rezerwacja` weszłaby do repo w piątek, a w poniedziałek najemca założyłby
 * kategorię o tym slugu i dostał adres, którego routing nigdy nie otworzy.
 *
 * Test czyta drzewo katalogów `app/(tenant)` (czyli źródło prawdy o trasach
 * sklepu) i sprawdza, że KAŻDY statyczny segment pierwszego poziomu jest na
 * liście. Nie porównuje w drugą stronę: lista wolno ma mieć wpisy z zapasem
 * (`kategoria`, `category` pod Fazę 7, locale osi marketingowej), bo nadmiar
 * niczego nie psuje, a niedomiar oddaje ścieżkę systemową.
 *
 * Zgodności listy z BAZĄ pilnuje osobno `packages/db/test/catalog-categories.test.ts`
 * (app.reserved_store_paths ↔ ta sama stała) — dwa różne rozjazdy, dwie bramki.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RESERVED_CATEGORY_SLUGS } from "@avably/core";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

/**
 * Statyczne segmenty pierwszego poziomu w podanym katalogu tras.
 * Odpadają: grupy `(nazwa)` (nie tworzą segmentu URL), segmenty dynamiczne
 * `[param]`, katalogi prywatne `_nazwa` i pliki (route.ts/page.tsx).
 */
function staticSegments(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("(") && !name.startsWith("[") && !name.startsWith("_"));
}

describe("slugi zarezerwowane vs drzewo tras sklepu (ADR-155)", () => {
  const tenantSegments = staticSegments(join(APP_DIR, "(tenant)"));

  it("czujnik działa: grupa (tenant) ma trasy, więc jest czego pilnować", () => {
    // Bez tego asercja niżej przechodzi także wtedy, gdy ścieżka do katalogu
    // się rozjedzie i lista wyjdzie pusta — „nic do sprawdzenia" wyglądałoby
    // jak „wszystko zarezerwowane".
    expect(tenantSegments.length, "nie znalazłem tras w app/(tenant)").toBeGreaterThan(4);
    expect(tenantSegments, "drzewo tras nie zawiera /checkout — zła ścieżka?").toContain("checkout");
  });

  it("każdy segment sklepu najemcy jest slugiem zarezerwowanym", () => {
    const missing = tenantSegments.filter((segment) => !RESERVED_CATEGORY_SLUGS.includes(segment));
    expect(
      missing,
      `trasy sklepu bez wpisu w RESERVED_CATEGORY_SLUGS (packages/core/src/catalog/categories.ts): ` +
        `${missing.join(", ")} — kategoria o takim slugu przejęłaby ścieżkę systemową`,
    ).toEqual([]);
  });

  it("segmenty platformowe stojące w korzeniu każdego hosta też są zarezerwowane", () => {
    // `api` i `embed` nie leżą w grupie (tenant), ale odpowiadają na TYM SAMYM
    // hoście — pierwszy segment ścieżki jest jeden dla obu osi.
    const rootSegments = staticSegments(APP_DIR).filter((segment) =>
      ["api", "embed"].includes(segment),
    );
    expect(rootSegments.sort(), "zniknęły trasy platformowe /api lub /embed").toEqual([
      "api",
      "embed",
    ]);
    expect(rootSegments.filter((segment) => !RESERVED_CATEGORY_SLUGS.includes(segment))).toEqual([]);
  });
});
