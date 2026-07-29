"use client";

/**
 * SPIKE C0 — wariant A: konfiguracja Puck (@puckeditor/core).
 *
 * Jeden komponent „Hero" z polami odwzorowującymi nasze `SpikeHeroContent`.
 * `render` deleguje do WSPÓLNEGO `SpikeHero` — czyli Puck maluje canvas tym
 * samym komponentem co storefront (uczciwe porównanie: różni się silnik
 * edycji, nie render).
 *
 * Uwaga do kryterium 1: Puck NIE trzyma naszego kształtu. Trzyma własny
 * `Data = { root, content: [{ type, props }], zones }`. Pola poniżej to
 * `props` komponentu — nasz jsonb wyciągamy z nich adapterem (puck-data.ts).
 */
import type { Config } from "@puckeditor/core";

import type { HeroAlignment } from "../spike-hero-schema";
import { SpikeHero } from "../spike-hero-view";

export type HeroProps = {
  heading: string;
  subheading: string;
  ctaText: string;
  ctaHref: string;
  align: HeroAlignment;
  bullets: { text: string }[];
};

export type PuckProps = { Hero: HeroProps };

export const puckConfig: Config<PuckProps> = {
  components: {
    Hero: {
      label: "Hero",
      // `contentEditable: true` = edycja tekstu wprost na canvasie (Puck 0.22
      // realizuje ją przez TipTap — stąd ~25 pakietów @tiptap w drzewie zależności).
      fields: {
        heading: { type: "text", label: "Nagłówek", contentEditable: true },
        subheading: { type: "textarea", label: "Podtytuł", contentEditable: true },
        ctaText: { type: "text", label: "Tekst przycisku", contentEditable: true },
        ctaHref: { type: "text", label: "Adres przycisku" },
        align: {
          type: "radio",
          label: "Wyrównanie",
          options: [
            { label: "Lewo", value: "left" },
            { label: "Środek", value: "center" },
            { label: "Prawo", value: "right" },
          ],
        },
        bullets: {
          type: "array",
          label: "Bloki zalet",
          arrayFields: { text: { type: "text", label: "Treść" } },
          defaultItemProps: { text: "Nowa zaleta" },
          getItemSummary: (item) => item.text || "Zaleta",
        },
      },
      defaultProps: {
        heading: "Wypożyczalnia, która działa jak sklep",
        subheading: "Rezerwacje online, płatności i logistyka w jednym miejscu.",
        ctaText: "Zobacz sprzęt",
        ctaHref: "/sprzet",
        align: "left",
        bullets: [{ text: "Rezerwacja 24/7 bez telefonu" }],
      },
      render: ({ heading, subheading, ctaText, ctaHref, align, bullets }) => (
        <SpikeHero
          content={{
            heading: heading || "Nagłówek",
            subheading: subheading || undefined,
            ctaText: ctaText || undefined,
            ctaHref: ctaHref || undefined,
            align,
            // Puck nie nadaje id pozycjom tablicy — syntetyzujemy z indeksu na render.
            bullets: (bullets ?? []).map((b, i) => ({ id: `b${i}`, text: b.text })),
          }}
        />
      ),
    },
  },
};
