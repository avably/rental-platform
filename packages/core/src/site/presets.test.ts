/**
 * Presety treści sekcji (ADR-082). Testy pilnują trzech niezależnych osi:
 *   - KAŻDY preset (oba języki, każdy typ) spełnia schemat swojego typu —
 *     preset niosący niepoprawną treść wywaliłby edytor przy dodaniu sekcji;
 *   - PARYTET STRUKTURY PL↔EN: te same pola i te same długości tablic w obu
 *     językach (różni je wyłącznie tekst). To bramka z briefu A2 „parytet w CI":
 *     preset gubiący pole w jednym języku = czerwony;
 *   - presetContentFor zwraca GŁĘBOKĄ KOPIĘ (edytor mutuje wynik w stanie).
 */
import { describe, expect, it } from "vitest";

import {
  PRESET_LOCALES,
  SECTION_CONTENT_SCHEMAS,
  SECTION_TYPES,
  presetContentFor,
} from "./index";

/**
 * Zbiera ścieżki (klucze obiektów + indeksy tablic) w kształcie wartości,
 * IGNORUJĄC wartości-liście. Dwie wartości o identycznym zestawie ścieżek mają
 * te same pola i te same długości tablic — dokładnie definicja parytetu treści.
 */
function collectPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectPaths(item, `${prefix}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .flatMap((key) =>
        collectPaths((value as Record<string, unknown>)[key], `${prefix}.${key}`),
      );
  }
  return [prefix];
}

describe("presety treści sekcji", () => {
  it("każdy preset (oba języki) spełnia schemat swojego typu", () => {
    for (const locale of PRESET_LOCALES) {
      for (const type of SECTION_TYPES) {
        const content = presetContentFor(type, locale);
        const result = SECTION_CONTENT_SCHEMAS[type].safeParse(content);
        expect(
          result.success,
          `preset ${locale}/${type} nie spełnia schematu: ${JSON.stringify(result.error?.issues)}`,
        ).toBe(true);
      }
    }
  });

  it("parytet PL↔EN: ten sam kształt (pola + długości tablic) w obu językach", () => {
    for (const type of SECTION_TYPES) {
      const plPaths = collectPaths(presetContentFor(type, "pl"));
      const enPaths = collectPaths(presetContentFor(type, "en"));
      expect(enPaths, `preset "${type}" rozjeżdża się strukturą PL↔EN`).toEqual(plPaths);
    }
  });

  it("USP: ta sama lista ikon w obu językach (ikona to enum, nie tłumaczenie)", () => {
    const icons = (locale: string) =>
      (presetContentFor("usp", locale) as { items: { icon: string }[] }).items.map((i) => i.icon);
    expect(icons("en")).toEqual(icons("pl"));
  });

  it("presetContentFor zwraca głęboką kopię — mutacja wyniku nie skaża stałej", () => {
    const first = presetContentFor("hero", "pl") as { heading: string };
    first.heading = "ZMIENIONE";
    const second = presetContentFor("hero", "pl") as { heading: string };
    expect(second.heading).not.toBe("ZMIENIONE");
  });

  it("locale spoza allowlisty degraduje do PL", () => {
    expect(presetContentFor("hero", "de")).toEqual(presetContentFor("hero", "pl"));
  });
});
