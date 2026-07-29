/**
 * SPIKE C0 — prezentacyjny render hero, WSPÓLNY dla obu prototypów i podglądu.
 *
 * Czysty komponent (bez stanu, bez klienta) — tak jak `HeroSection` z
 * `@avably/ui`. Renderuje się identycznie w:
 *   - podglądzie edytora własnego (dnd-kit),
 *   - funkcji `render` komponentu Puck,
 *   - RSC storefrontu (gdyby publikować) — bo nie ma tu ani jednego hooka.
 *
 * Dowód dla kryterium 7 (RSC): ten plik NIE ma "use client". Storefront
 * mógłby go serwerowo wyrenderować z opublikowanego jsonb bez zmiany znaku.
 *
 * Wygląd stoi WYŁĄCZNIE na tokenach design systemu (`bg-foreground`,
 * `text-background`, `text-primary`, `border-border`…) — kryterium 2.
 */
import { Button } from "@avably/ui";
import { Check } from "lucide-react";

import type { HeroAlignment, SpikeHeroContent } from "./spike-hero-schema";

const ALIGN_CLASS: Record<HeroAlignment, string> = {
  left: "items-start text-left",
  center: "items-center text-center",
  right: "items-end text-right",
};

export function SpikeHero({ content }: { content: SpikeHeroContent }) {
  const align = ALIGN_CLASS[content.align] ?? ALIGN_CLASS.left;
  return (
    <section className="bg-foreground text-background w-full px-8 py-16 sm:py-20">
      <div className={`mx-auto flex w-full max-w-3xl flex-col gap-6 ${align}`}>
        <h1 className="text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
          {content.heading}
        </h1>
        {content.subheading ? (
          <p className="max-w-2xl text-lg opacity-80">{content.subheading}</p>
        ) : null}

        {content.bullets.length > 0 ? (
          <ul
            className={`flex list-none flex-col gap-2 p-0 text-base ${
              content.align === "center" ? "items-center" : content.align === "right" ? "items-end" : "items-start"
            }`}
          >
            {content.bullets.map((bullet) => (
              <li key={bullet.id} className="flex items-center gap-2">
                <Check className="text-primary size-5 shrink-0" aria-hidden="true" />
                <span>{bullet.text}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {content.ctaText && content.ctaHref ? (
          <Button
            asChild
            className="bg-primary text-primary-foreground mt-2 hover:no-underline"
          >
            <a href={content.ctaHref}>{content.ctaText}</a>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
