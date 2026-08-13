"use client";

import { useEffect } from "react";

import { podepnijDostepnoscMenu } from "@/lib/marketing/nav-a11y";

/**
 * Spięcie dostępności menu z cyklem życia Reacta (ADR-162).
 *
 * Cała logika siedzi w `lib/marketing/nav-a11y.ts` i przyjmuje dokument —
 * komponent jest tu wyłącznie po to, żeby ją podpiąć po hydratacji (belkę
 * buduje biblioteka szablonu, więc wcześniej nie ma czego obsługiwać) i zdjąć
 * przy nawigacji klienckiej.
 */
export function MarketingNavA11y({ etykietaMenu }: { etykietaMenu: string }) {
  useEffect(() => podepnijDostepnoscMenu(document, { etykietaMenu }), [etykietaMenu]);
  return null;
}
