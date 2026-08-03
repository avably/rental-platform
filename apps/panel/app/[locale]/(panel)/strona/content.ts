/**
 * Pomocnicy treści edytora strony (Zadanie 2.3b) — czyste, testowalne bez DOM.
 *
 * Kształt i walidację treści dostarcza WYŁĄCZNIE `@avably/core/site` (2.3a).
 * Tu tylko: treść startowa nowej sekcji, bezpieczne parsowanie `content_draft`
 * (jsonb → typ) i mapowanie wierszy draftu na sekcje edytora.
 *
 * K1 zdjął stąd `previewSections` (filtr „tylko włączone"): płótno kreatora
 * pokazuje RÓWNIEŻ sekcje wyłączone, jawnie oznaczone — bo jest edytorem, a nie
 * podglądem. Gwarancję „klient tego nie zobaczy" niesie `app.get_published_site`
 * (0019), która oddaje anonowi wyłącznie sekcje `enabled`.
 */
import {
  SECTION_DRAFT_SCHEMAS,
  presetContentFor,
  type SectionContent,
  type SectionType,
} from "@avably/core/site";
import type { SiteSection } from "@avably/db";

/**
 * Treść startowa nowej sekcji danego typu (kreator A2, ADR-082) — PRESET z
 * @avably/core/site, wypełniony sensownym przykładem w języku operatora
 * (`locale`, domyślnie PL). Spełnia schemat core dla każdego z typów; służy też
 * jako fallback, gdy content_draft nie sparsuje się schematem (edytor nie może
 * zostać z pustką).
 */
export function defaultContentFor(type: SectionType, locale = "pl"): SectionContent {
  return presetContentFor(type, locale);
}

/**
 * Parsuje `content_draft` (jsonb) schematem typu — W OBU GENERACJACH treści.
 * Zwraca typowaną treść albo `null`, gdy draft jest w nieznanym kształcie (np.
 * sprzed zmiany schematu); wołający podstawia treść startową, żeby edytor się
 * nie wywrócił.
 *
 * NAPRAWA (K4, ADR-088; wada obecna od K2): schemat był tu WYŁĄCZNIE v1, więc
 * płótno v2 odpadało na walidacji i w jego miejsce wchodził preset typu. Zapis
 * działał, odczyt nie — a że preset wygląda jak świeżo dodana sekcja, objawem
 * nie był błąd, tylko układ cofający się do stanu startowego przy każdym
 * przeładowaniu kreatora. Schematem odczytu jest odtąd `SECTION_DRAFT_SCHEMAS`,
 * czyli ta sama unia, którą zna zapis i odczyt publiczny.
 */
export function parseDraftContent(type: SectionType, raw: unknown): SectionContent | null {
  const parsed = SECTION_DRAFT_SCHEMAS[type].safeParse(raw);
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
