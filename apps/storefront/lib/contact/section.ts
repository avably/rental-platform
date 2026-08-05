import {
  contactStructuredSchema,
  isStructuredSection,
  type ContactStructuredContent,
} from "@avably/core/site";

import type { PublishedSite } from "@/lib/site/published";

/**
 * SEKCJA KONTAKTU Z OPUBLIKOWANEJ STRONY (E4, ADR-095) — jedyne źródło
 * adresata wiadomości.
 *
 * Czytamy z tego samego stanu, który widzi odwiedzający: gdyby akcja sięgała
 * do SZKICU, wiadomość szłaby na adres, którego na stronie jeszcze nie ma
 * (albo już nie ma). Sekcja skasowana po wyrenderowaniu formularza znika
 * stąd razem z adresatem — i to jest poprawne: zgłoszenie z nieaktualnej
 * karty nie ma dokąd trafić.
 *
 * Treść przechodzi jeszcze raz przez SCHEMAT, mimo że koperta publikacji jest
 * już parsowana: między jednym a drugim odczytem stoi rzutowanie unii treści
 * po typie sekcji, a od poprawności TEJ treści zależy, komu wyślemy pocztę.
 * Drugie parsowanie kosztuje mikrosekundy i zamienia „prawie na pewno" w „na
 * pewno".
 */
export function contactSectionOf(
  site: PublishedSite | null,
  sectionId: string,
): ContactStructuredContent | null {
  const section = site?.sections.find((candidate) => candidate.id === sectionId);
  if (!section || section.type !== "contact") return null;
  if (!isStructuredSection(section.content)) return null;
  const parsed = contactStructuredSchema.safeParse(section.content);
  return parsed.success ? parsed.data : null;
}
