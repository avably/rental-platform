/**
 * KOMPLETNOŚĆ REJESTRU RENDERU SEKCJI STRUKTURALNYCH (E1, ADR-094).
 *
 * Rejestr modelu (`STRUCTURED_SECTIONS` w @avably/core) i rejestr renderu
 * (`STRUCTURED_RENDERERS` tutaj) to dwa zbiory, które MUSZĄ być lustrami.
 * Rozjazd nie daje błędu ani w typach, ani w logu — daje PUSTĄ SEKCJĘ na
 * stronie klienta. Ten plik porównuje je w obie strony i, co ważniejsze,
 * MONTUJE każdy wariant: rejestr wskazujący komponent, który nic nie rysuje,
 * przeszedłby porównanie kluczy i nie przeszedł niczego więcej.
 *
 * Osłona anty-pusty-zbiór: pętla po pustym rejestrze jest zielona i nie broni
 * niczego, więc rozmiary zbiorów są tu osobnymi zdaniami.
 *
 * Druga bramka: ZERO HEKSÓW w komponentach strukturalnych. Kolor ma pochodzić
 * z ról motywu (ADR-090) — jeden zamrożony odcień w komponencie wypada spod
 * macierzy kontrastu i rozjeżdża się przy zmianie motywu przez operatora.
 */
import {
  STRUCTURED_SECTIONS,
  STRUCTURED_SECTION_TYPES,
  structuredPresetFor,
  withStructuredLayout,
} from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { SiteRenderer } from "./site-renderer";
import { STRUCTURED_RENDERERS, structuredRendererFor } from "./structured/registry";
import type { RenderSection } from "./types";

afterEach(cleanup);

/** Wszystkie pary (typ, układ) z rejestru MODELU — wejście macierzy niżej. */
const PAIRS = STRUCTURED_SECTION_TYPES.flatMap((type) =>
  STRUCTURED_SECTIONS[type].layouts.map((layout) => ({ type, layout })),
);

describe("rejestr renderu jest LUSTREM rejestru modelu", () => {
  it("oba zbiory są niepuste (kontrola po pustym zbiorze)", () => {
    expect(STRUCTURED_SECTION_TYPES.length).toBeGreaterThan(0);
    expect(PAIRS.length, "brak par (typ, układ) — macierz niżej nic nie sprawdza").toBeGreaterThan(0);
    expect(Object.keys(STRUCTURED_RENDERERS).length).toBeGreaterThan(0);
  });

  it("KAŻDA para (typ, układ) z modelu ma komponent renderu", () => {
    for (const { type, layout } of PAIRS) {
      expect(
        structuredRendererFor(type, layout),
        `brak komponentu dla ${type}/${layout} — sekcja wyrenderowałaby się jako pustka`,
      ).toBeTypeOf("function");
    }
  });

  it("rejestr renderu NIE ma nadmiarowych wpisów", () => {
    for (const [type, layouts] of Object.entries(STRUCTURED_RENDERERS)) {
      expect(
        STRUCTURED_SECTION_TYPES as readonly string[],
        `render dla typu "${type}", którego nie ma w modelu`,
      ).toContain(type);
      for (const layout of Object.keys(layouts)) {
        expect(
          STRUCTURED_SECTIONS[type as (typeof STRUCTURED_SECTION_TYPES)[number]].layouts as readonly string[],
          `render dla układu "${type}/${layout}", którego nie ma w modelu`,
        ).toContain(layout);
      }
    }
  });

  it("nieznana para nie wywraca strony — sekcja jest POMIJANA", () => {
    expect(structuredRendererFor("faq", "układ-z-przyszłości")).toBeUndefined();
    const content = { ...structuredPresetFor("faq", "pl"), layout: "układ-z-przyszłości" };
    const sections = [{ id: "s1", position: 0, type: "faq", content }] as unknown as RenderSection[];
    const { container } = render(<SiteRenderer sections={sections} />);
    expect(container.querySelector("[data-structured-section]")).toBeNull();
  });
});

describe("każdy wariant NAPRAWDĘ się rysuje", () => {
  it.each(PAIRS.map(({ type, layout }) => [`${type}/${layout}`, type, layout] as const))(
    "%s: preset renderuje treść, a nie pustą powłokę",
    (_label, type, layout) => {
      const content = withStructuredLayout(structuredPresetFor(type, "pl"), layout);
      const sections = [{ id: "s1", position: 0, type, content }] as unknown as RenderSection[];
      const { container } = render(<SiteRenderer sections={sections} />);

      const section = container.querySelector<HTMLElement>(`[data-structured-section="${type}"]`);
      expect(section, "sekcja w ogóle się nie zamontowała").not.toBeNull();
      expect(section?.getAttribute("data-structured-layout")).toBe(layout);
      expect(
        (section?.textContent ?? "").trim().length,
        "komponent zamontował się, ale nie narysował ani jednego znaku",
      ).toBeGreaterThan(20);
    },
  );
});

describe("komponenty strukturalne NIE ZNAJĄ ani jednego heksa (ADR-090)", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "structured");
  const files = readdirSync(dir).filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"));

  it("skan ma co czytać (kontrola po pustym zbiorze)", () => {
    expect(files.length, "katalog komponentów strukturalnych jest pusty").toBeGreaterThanOrEqual(
      PAIRS.length,
    );
    const bytes = files.reduce((sum, name) => sum + readFileSync(join(dir, name), "utf8").length, 0);
    expect(bytes, "pliki są puste — skan niżej niczego nie broni").toBeGreaterThan(1_000);
  });

  it.each(files)("%s: bez wartości kolorów zapisanych wprost", (name) => {
    const source = readFileSync(join(dir, name), "utf8");
    // Komentarze zostają w skanie świadomie: hex w komentarzu to instrukcja,
    // jak obejść regułę, a nie jej wyjaśnienie.
    expect(source, "wartość szesnastkowa koloru w komponencie").not.toMatch(
      /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/,
    );
    expect(source, "funkcja koloru CSS w komponencie").not.toMatch(/\b(?:rgba?|hsla?|oklch)\(/);
  });
});
