/**
 * SPIKE C0 — adapter Puck.Data <-> nasz jsonb. TO JEST powierzchnia lock-inu
 * z kryterium 1: Puck trzyma stan jako `{ root, content:[{type,props}], zones }`,
 * a my musimy z tego wyjąć/wsadzić nasz `SpikeHeroContent` w OBIE strony.
 *
 * Póki mamy 1 sekcję = 1 komponent, adapter jest krótki. Ale rośnie z każdym
 * typem sekcji i każdym polem — i musi być utrzymywany dwukierunkowo przy KAŻDEJ
 * zmianie schematu treści. Własny silnik tego kodu nie ma (stan = jsonb).
 */
import type { Data } from "@puckeditor/core";

import { spikeHeroSchema, type SpikeHeroContent } from "../spike-hero-schema";

/** Nasz jsonb → Data Pucka (do zasilenia edytora). */
export function heroToPuckData(content: SpikeHeroContent): Data {
  return {
    root: {},
    content: [
      {
        type: "Hero",
        props: {
          id: "hero-1", // Puck wymaga unikalnego id per komponent — nasz model go nie ma.
          heading: content.heading,
          subheading: content.subheading ?? "",
          ctaText: content.ctaText ?? "",
          ctaHref: content.ctaHref ?? "",
          align: content.align,
          bullets: content.bullets.map((b) => ({ text: b.text })),
        },
      },
    ],
    zones: {},
  } as Data;
}

export type HeroExtract =
  | { ok: true; value: SpikeHeroContent }
  | { ok: false; error: string };

/** Data Pucka → nasz jsonb (do zapisu w content_draft). Waliduje Zodem, fail-closed. */
export function puckDataToHero(data: Data): HeroExtract {
  const props = data.content?.[0]?.props as Record<string, unknown> | undefined;
  if (!props) return { ok: false, error: "Brak komponentu Hero w Data" };

  const bullets = Array.isArray(props.bullets)
    ? (props.bullets as { text?: string }[]).map((b, i) => ({ id: `b${i}`, text: String(b?.text ?? "") }))
    : [];

  // Odrzucamy puste opcjonalne pola i klucz `id` Pucka — nasz schemat ich nie zna.
  const candidate = {
    heading: String(props.heading ?? ""),
    subheading: props.subheading ? String(props.subheading) : undefined,
    ctaText: props.ctaText ? String(props.ctaText) : undefined,
    ctaHref: props.ctaHref ? String(props.ctaHref) : undefined,
    align: props.align,
    bullets: bullets.filter((b) => b.text.trim() !== ""),
  };

  const parsed = spikeHeroSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, value: parsed.data };
}
