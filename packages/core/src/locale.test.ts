/**
 * KONTRAKT WYBORU FORMY LICZEBNIKA (F11).
 *
 * Reguła mieszka w rdzeniu, bo pytają o nią dwa pakiety — trasy sklepu
 * (licznik pozycji, koszyk) i renderer kafla z pakietu UI (chip niedoboru).
 * Test pilnuje dokładnie tego, po co ją tam przeniesiono: polski ma TRZY formy
 * i drabinka `if` po końcówkach myli się na 12–14 oraz na setkach.
 */
import { describe, expect, it } from "vitest";

import { pluralFormOf } from "./locale";

const SZTUKI = { one: "sztuka", few: "sztuki", many: "sztuk" };

describe("pluralFormOf — polski ma trzy formy", () => {
  it.each([
    [1, "sztuka"],
    [2, "sztuki"],
    [3, "sztuki"],
    [4, "sztuki"],
    [5, "sztuk"],
    [11, "sztuk"],
    // Pułapka, na której wykłada się porównywanie ostatniej cyfry: 12–14 mają
    // formę `many`, choć kończą się na 2, 3 i 4.
    [12, "sztuk"],
    [13, "sztuk"],
    [14, "sztuk"],
    [22, "sztuki"],
    [25, "sztuk"],
    // Setki: 102 to `few`, 112 to `many` — ta sama pułapka o rząd wyżej.
    [102, "sztuki"],
    [112, "sztuk"],
  ])("%i → %s", (liczba, forma) => {
    expect(pluralFormOf(liczba, "pl", SZTUKI)).toBe(forma);
  });

  it("zero bierze formę `many` („0 sztuk”)", () => {
    expect(pluralFormOf(0, "pl", SZTUKI)).toBe("sztuk");
  });
});

describe("pluralFormOf — angielski ma dwie", () => {
  const ITEMS = { one: "item", few: "items", many: "items" };

  it.each([
    [1, "item"],
    [0, "items"],
    [2, "items"],
    [5, "items"],
    [12, "items"],
  ])("%i → %s", (liczba, forma) => {
    expect(pluralFormOf(liczba, "en", ITEMS)).toBe(forma);
  });

  it("kategoria `other` schodzi na `many`, a nie na `few` (kontrola negatywna)", () => {
    // Gdyby `other` schodziło na `few`, angielski dostawałby formę, której
    // słownik EN nie różnicuje — i wada byłaby niema aż do pierwszego języka
    // z trzema formami.
    expect(pluralFormOf(7, "en", { one: "a", few: "b", many: "c" })).toBe("c");
  });
});
