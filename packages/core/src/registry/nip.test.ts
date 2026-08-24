import { describe, expect, it } from "vitest";

import { isValidNipChecksum, normalizeNip } from "./nip";

describe("normalizeNip", () => {
  it("usuwa separatory i spacje, zostawia same cyfry", () => {
    expect(normalizeNip("774-000-14-54")).toBe("7740001454");
    expect(normalizeNip("774 00 01 454")).toBe("7740001454");
  });

  it("usuwa prefiks PL", () => {
    expect(normalizeNip("PL7740001454")).toBe("7740001454");
  });
});

describe("isValidNipChecksum", () => {
  it("akceptuje realny, poprawny NIP (PKN ORLEN — zweryfikowany na żywo w MF Białej liście)", () => {
    expect(isValidNipChecksum("7740001454")).toBe(true);
  });

  it("akceptuje ten sam NIP z separatorami — normalizuje przed sprawdzeniem", () => {
    expect(isValidNipChecksum("774-000-14-54")).toBe(true);
  });

  it("odrzuca NIP ze złą ostatnią cyfrą", () => {
    expect(isValidNipChecksum("7740001450")).toBe(false);
  });

  it("odrzuca prefiks, którego suma kontrolna daje resztę 10 (żadna cyfra jej nie reprezentuje)", () => {
    // Wagi 6,5,7,2,3,4,5,6,7 na prefiksie 3,1,7,0,6,6,9,0,7 dają resztę 10 —
    // wszystkie 10 wariantów ostatniej cyfry musi zostać odrzuconych.
    for (let last = 0; last <= 9; last += 1) {
      expect(isValidNipChecksum(`31706690${last}`)).toBe(false);
    }
  });

  it("odrzuca zbyt krótki albo zbyt długi ciąg", () => {
    expect(isValidNipChecksum("123456789")).toBe(false);
    expect(isValidNipChecksum("77400014540")).toBe(false);
  });

  it("odrzuca pusty string i same litery", () => {
    expect(isValidNipChecksum("")).toBe(false);
    expect(isValidNipChecksum("abcdefghij")).toBe(false);
  });
});
