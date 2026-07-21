"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@avably/ui";

import { Link } from "@/i18n/navigation";

/**
 * Kolumna „Akcje" wiersza listy (sekcja 04 artefaktu: trigger `•••`).
 *
 * Menu prowadzi WYŁĄCZNIE tam, gdzie produkt naprawdę coś ma: szczegół
 * zamówienia i jego sekcja statusu. Żadnej pozycji-atrapy — ta sama reguła,
 * przez którą belka P3 nie dostała udawanej wyszukiwarki.
 */
export function OrderRowActions({
  orderId,
  labels,
}: {
  orderId: string;
  labels: { trigger: string; details: string; status: string };
}) {
  return (
    <DropdownMenu>
      {/* Trigger jest ikoniczny, więc etykieta idzie w aria-label z numerem
          zamówienia — inaczej czytnik ogłasza dwanaście identycznych „•••". */}
      <DropdownMenuTrigger
        aria-label={labels.trigger}
        className="text-muted-foreground hover:text-foreground cursor-pointer rounded-sm border border-transparent px-2 py-1 tracking-[0.06em] outline-none transition-[color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
      >
        <span aria-hidden="true">•••</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/zamowienia/${orderId}`}>{labels.details}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/zamowienia/${orderId}#status`}>{labels.status}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
