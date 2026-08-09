/**
 * Root layout OSI EMBEDU (M3, ADR-120) — trzeci root obok marketingu
 * (`app/[locale]/layout.tsx`) i sklepu (`app/(tenant)/layout.tsx`).
 *
 * Osobny, bo dokument embedu żyje w cudzej ramce i ma inne wymagania niż
 * strona sklepu: żadnej nawigacji, żadnej powłoki marketingowej, żadnego
 * overlaya przeglądu, przezroczyste tło (kolor daje strona gospodarza przez
 * wybrany motyw) i minimum bajtów. Dziedziczenie któregokolwiek z tamtych
 * layoutów wciągałoby do ramki rzeczy, których na cudzej stronie być nie
 * powinno.
 *
 * `robots: noindex` — ramka nie jest stroną do indeksowania; wyszukiwarka ma
 * widzieć sklep najemcy, nie goły widget bez kontekstu.
 */
import type { ReactNode } from "react";
import type { Metadata } from "next";

import { fontVariables } from "@/app/fonts";
import { loadEmbedContext } from "@/lib/embed/context";

import "./embed.css";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function EmbedLayout({ children }: { children: ReactNode }) {
  const ctx = await loadEmbedContext();

  return (
    <html lang={ctx?.locale ?? "pl"} className={`${fontVariables} antialiased`}>
      <body className="bg-transparent">{children}</body>
    </html>
  );
}
