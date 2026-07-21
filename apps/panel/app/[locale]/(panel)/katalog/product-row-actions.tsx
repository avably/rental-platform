"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@avably/ui";

import { Link } from "@/i18n/navigation";

/**
 * Kolumna „Akcje" wiersza katalogu — trigger `•••` z sekcji 04 artefaktu,
 * wzorzec przeniesiony z listy zamówień (ADR-057 D4).
 *
 * Menu prowadzi WYŁĄCZNIE do ekranów, które produkt naprawdę ma: edycja,
 * egzemplarze, progi cenowe i zdjęcia. Żadnej pozycji-atrapy.
 */
export function ProductRowActions({
  productId,
  labels,
}: {
  productId: string;
  labels: { trigger: string; edit: string; units: string; tiers: string; images: string };
}) {
  return (
    <DropdownMenu>
      {/* Trigger jest ikoniczny, więc etykieta idzie w aria-label z nazwą
          produktu — inaczej czytnik ogłasza kilkanaście identycznych „•••". */}
      <DropdownMenuTrigger
        aria-label={labels.trigger}
        className="text-muted-foreground hover:text-foreground cursor-pointer rounded-sm border border-transparent px-2 py-1 tracking-[0.06em] outline-none transition-[color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
      >
        <span aria-hidden="true">•••</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/katalog/${productId}`}>{labels.edit}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/katalog/${productId}/egzemplarze`}>{labels.units}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/katalog/${productId}/progi`}>{labels.tiers}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/katalog/${productId}/zdjecia`}>{labels.images}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
