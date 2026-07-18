/**
 * Pomocnicy treści edytora strony (Zadanie 2.3b) — czyste, testowalne bez DOM.
 *
 * Kształt i walidację treści dostarcza WYŁĄCZNIE `@avably/core/site` (2.3a).
 * Tu tylko: treść startowa nowej sekcji, bezpieczne parsowanie `content_draft`
 * (jsonb → typ) i mapowanie sekcji draftu na sekcje renderu podglądu.
 */
import {
  SECTION_CONTENT_SCHEMAS,
  type SectionContent,
  type SectionType,
} from "@avably/core/site";
import type { SiteSection } from "@avably/db";
import type { RenderSection } from "@avably/ui";

/** Treść startowa nowej sekcji danego typu (spełnia schemat core). */
export function defaultContentFor(type: SectionType): SectionContent {
  switch (type) {
    case "hero":
      return { heading: "Twoja wypożyczalnia" };
    case "products":
      return { heading: "Nasz sprzęt" };
    case "pricing":
      return { heading: "Jak rozliczamy najem" };
    case "faq":
      return { heading: "Najczęstsze pytania", items: [] };
    case "contact":
      return { heading: "Kontakt" };
    case "freeform":
      return { heading: "Sekcja", body: "Napisz coś o swojej wypożyczalni." };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/**
 * Parsuje `content_draft` (jsonb) schematem typu. Zwraca typowaną treść albo
 * `null`, gdy draft jest w nieznanym kształcie (np. sprzed zmiany schematu) —
 * wołający podstawia treść startową, żeby edytor się nie wywrócił.
 */
export function parseDraftContent(type: SectionType, raw: unknown): SectionContent | null {
  const parsed = SECTION_CONTENT_SCHEMAS[type].safeParse(raw);
  return parsed.success ? (parsed.data as SectionContent) : null;
}

/** Sekcja edytora: draft z treścią już przetworzoną na typ (fallback = startowa). */
export interface EditorSection {
  id: string;
  type: SectionType;
  position: number;
  enabled: boolean;
  content: SectionContent;
}

/** Mapuje wiersze draftu na sekcje edytora, sortując po (position, id). */
export function toEditorSections(sections: SiteSection[]): EditorSection[] {
  return sections
    .slice()
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((section) => ({
      id: section.id,
      type: section.type,
      position: section.position,
      enabled: section.enabled,
      content: parseDraftContent(section.type, section.content_draft) ?? defaultContentFor(section.type),
    }));
}

/**
 * Sekcje do PODGLĄDU: tylko włączone, w kolejności — dokładnie to, co zobaczy
 * anon po publikacji. `EditorSection` jest strukturalnie zgodna z `RenderSection`
 * (id, position, type, content), więc idzie wprost do `SiteRenderer`.
 */
export function previewSections(sections: EditorSection[]): RenderSection[] {
  return sections.filter((section) => section.enabled) as RenderSection[];
}
