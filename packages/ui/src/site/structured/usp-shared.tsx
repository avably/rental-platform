import type { UspStructuredItem } from "@avably/core/site";

import { cn } from "../../lib/cn";
import { siteIconComponent } from "../site-icons";
import type { TemplateStyles } from "../template";

/**
 * WSPÓLNA TREŚĆ KAFLA ATUTU (E7, aneks ADR-094).
 *
 * Oba układy różnią się WYŁĄCZNIE obudową kafla (karta z obrysem albo jej
 * brak). Znak, tytuł i zdanie są w obu takie same i mają jedną kopię — bo to
 * jest trójka, która w płótnie rozjeżdżała się na trzy niezależne pudełka
 * (patrz uzasadnienie przy `items` schematu atutów).
 *
 * IKONA MALUJE SIĘ ROLAMI MOTYWU: kafelek bierze wypełnienie akcentu z alfą
 * (`site-icon-tile`), a sam znak — akcentowy tekst (`site-text-accent`). Obie
 * pary mają policzony kontrast w macierzy, kafelek nawet jako MIESZANINA
 * z pasem pod spodem. Zero heksów, zero kolorów z palety utylitarnej.
 */
export function UspEntry({
  item,
  index,
  styles,
  className,
}: {
  item: UspStructuredItem;
  index: number;
  styles: TemplateStyles;
  className?: string;
}) {
  const Icon = siteIconComponent(item.icon);
  return (
    <li data-usp-item={index} className={cn("flex flex-col gap-3", className)}>
      {/*
        Znak jest DEKORACYJNY: znaczenie niesie tytuł obok, a czytnik ekranu,
        który przeczytałby „ikona ciężarówki" przed „Dowóz i odbiór pod adres",
        powiedziałby to samo dwa razy — raz nieprecyzyjnie.
      */}
      <span data-usp-icon={item.icon} className={cn(styles.iconTile, "shrink-0")}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      {/*
        `h3`, a nie `span`: atut jest podrozdziałem sekcji, więc czytnik ekranu
        ma go zapowiedzieć w spisie nagłówków. Poziom trzeci, bo nagłówek sekcji
        (`h2`) niesie powłoka.
      */}
      <h3 data-usp-title className={styles.cardTitle}>
        {item.title}
      </h3>
      <p data-usp-text className="site-text-muted text-sm">
        {item.text}
      </p>
    </li>
  );
}
