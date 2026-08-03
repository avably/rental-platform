/**
 * Mapowanie wierszy szkicu na sekcje edytora (`toEditorSections`).
 *
 * Sedno po K5a (ADR-091): sekcja USUNIĘTA W SZKICU ZOSTAJE na liście. To nie
 * jest szczegół prezentacji — filtr w tym miejscu psułby trzy rzeczy naraz:
 *   1. operator traciłby z oczu sekcję, którą klient WCIĄŻ WIDZI (i nie miałby
 *      czym jej przywrócić),
 *   2. `reorderSections` odmawiałby każdej zmiany kolejności, bo `reorderPlan`
 *      wymaga PERMUTACJI kompletu sekcji strony — lista bez nagrobka nim nie
 *      jest,
 *   3. licznik `MAX_SECTIONS` liczyłby co innego niż baza.
 *
 * Dlatego ten kontrakt ma własny test, a nie tylko asercje w teście płótna:
 * płótno dostaje sekcje z propsów i nigdy nie zobaczyłoby filtra założonego
 * o poziom niżej (dowód mutacyjny #5 znalazł dokładnie tę lukę).
 */
import { describe, expect, it } from "vitest";

import { toEditorSections } from "@/app/[locale]/(panel)/strona/content";
import type { SiteSection } from "@avably/db";

function row(overrides: Partial<SiteSection> & Pick<SiteSection, "id">): SiteSection {
  return {
    tenant_id: "11111111-1111-4111-8111-111111111111",
    site_id: "22222222-2222-4222-8222-222222222222",
    type: "hero",
    position: 0,
    enabled: true,
    content_draft: { heading: "H" },
    content_published: null,
    position_published: null,
    enabled_published: null,
    deleted_in_draft: false,
    updated_at: "2026-08-03T10:00:00.000Z",
    ...overrides,
  } as SiteSection;
}

describe("toEditorSections — co edytor dostaje z bazy", () => {
  it("sekcja usunięta w szkicu ZOSTAJE na liście, oznaczona znacznikiem", () => {
    const sections = toEditorSections([
      row({ id: "a", position: 0 }),
      row({
        id: "b",
        position: 1,
        type: "pricing",
        content_published: { heading: "H" },
        position_published: 1,
        enabled_published: true,
        deleted_in_draft: true,
      }),
      row({ id: "c", position: 2, type: "faq" }),
    ]);

    expect(sections.map((s) => s.id), "nagrobek wypadł z listy edytora").toEqual(["a", "b", "c"]);
    expect(sections.map((s) => s.deletedInDraft)).toEqual([false, true, false]);
  });

  it("`published` mówi, czy sekcja stoi na żywej stronie — po content_published, nie po enabled", () => {
    const sections = toEditorSections([
      row({ id: "a", enabled: false, content_published: null }),
      row({
        id: "b",
        enabled: true,
        content_published: { heading: "H" },
        position_published: 0,
        enabled_published: true,
      }),
    ]);
    expect(sections.map((s) => s.published)).toEqual([false, true]);
  });

  it("kolejność bierze się ze SZKICU (position, id) — także dla nagrobków", () => {
    const sections = toEditorSections([
      row({ id: "c", position: 5 }),
      row({
        id: "a",
        position: 1,
        content_published: { heading: "H" },
        position_published: 9,
        enabled_published: true,
        deleted_in_draft: true,
      }),
      row({ id: "b", position: 1 }),
    ]);
    // `a` przed `b` mimo position_published = 9: edytor pokazuje SZKIC,
    // a remis (position 1) rozstrzyga id.
    expect(sections.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});
