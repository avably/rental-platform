/**
 * SPIKE C0 — kontrakt treści hero WSPÓLNY dla obu prototypów silnika edycji.
 *
 * To jest sedno kryterium 1 (mapowanie danych): OBA prototypy — własny
 * (dnd-kit) i Puck — muszą serializować swój stan edytora DOKŁADNIE do tego
 * kształtu. To jest `content_draft` (jsonb) tak, jak trzymałby go
 * `site_sections` — bez formatu pośredniego. Schemat jest świadomie
 * NADZBIOREM produkcyjnego `heroContentSchema` z `@avably/core/site`:
 *   - `heading` / `subheading` / `ctaText` / `ctaHref` — 1:1 z core (ADR-041),
 *   - `align`  — pole wariantu układu (etap C3, Zod enum per typ),
 *   - `bullets` — tablica bloków (etap C1, discriminated arrays w jsonb).
 *
 * W produkcji ten kształt wchodzi do core przy C1/C3 (rozszerzenie
 * heroContentSchema), NIE jako osobny plik. Tu stoi lokalnie, bo spike NIE
 * dotyka main ani core.
 *
 * Granice bezpieczeństwa są te same co w core: `ctaHref` przez allowlistę
 * schematów (żaden `javascript:`), teksty przycięte i ograniczone długością.
 */
import { z } from "zod";

const heading = z.string().trim().min(1).max(200);
const shortText = z.string().trim().min(1).max(500);

/** Cel CTA: http(s), ścieżka względna (/...) albo kotwica (#...). Allowlista, nie blocklista. */
const ctaHref = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine(
    (value) => {
      if (value.startsWith("/") || value.startsWith("#")) return true;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Dozwolone: http(s), ścieżka względna (/...) albo kotwica (#...)" },
  );

/** Wariant układu hero (C3) — wyrównanie treści. Enum = lustro CHECK-a przy produkcji. */
export const HERO_ALIGNMENTS = ["left", "center", "right"] as const;
export type HeroAlignment = (typeof HERO_ALIGNMENTS)[number];
export const heroAlignmentSchema = z.enum(HERO_ALIGNMENTS);

/** Blok „zaleta" (C1) — najmniejsza jednostka tablicy bloków w sekcji. */
export const heroBulletSchema = z
  .object({
    id: z.string().min(1),
    text: shortText,
  })
  .strict();
export type HeroBullet = z.infer<typeof heroBulletSchema>;

/**
 * Pełny kształt treści hero w wersji kreatora C. `.strict()` — nieznany klucz
 * jest błędem, nie balastem (jak w core): literówka nie ginie w jsonb do
 * chwili renderu.
 */
export const spikeHeroSchema = z
  .object({
    heading,
    subheading: shortText.optional(),
    ctaText: z.string().trim().min(1).max(80).optional(),
    ctaHref: ctaHref.optional(),
    align: heroAlignmentSchema.default("left"),
    bullets: z.array(heroBulletSchema).max(8).default([]),
  })
  .strict();

export type SpikeHeroContent = z.infer<typeof spikeHeroSchema>;

/** Treść startowa — spełnia schemat, wypełniona przykładem (preset, jak Shopify). */
export function defaultHeroContent(): SpikeHeroContent {
  return {
    heading: "Wypożyczalnia, która działa jak sklep",
    subheading:
      "Rezerwacje online, płatności i logistyka w jednym miejscu. Zacznij wypożyczać w kilka minut.",
    ctaText: "Zobacz sprzęt",
    ctaHref: "/sprzet",
    align: "left",
    bullets: [
      { id: "b1", text: "Rezerwacja 24/7 bez telefonu" },
      { id: "b2", text: "Kaucje i płatności automatycznie" },
      { id: "b3", text: "Dostawa i zwrot pod adres" },
    ],
  };
}
