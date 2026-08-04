/**
 * POWŁOKA PODSTRON SKLEPU (produkt, koszyk, checkout) — TEN SAM ŚWIAT, CO
 * KATALOG (K5 v2, ADR-090; korzeń wydzielony w K6, ADR-092).
 *
 * Do K5 powłoka nakładała klasy „szablonu graficznego" (classic/bold), więc
 * podstrony dziedziczyły tło i typografię z motywu APLIKACJI. Od ADR-090 strona
 * najemcy ma własny świat wizualny — i podstrony muszą w nim stać, inaczej
 * klient przechodzi z ciemnego, luksusowego katalogu na białą stronę produktu
 * i ma wrażenie, że wyszedł ze sklepu.
 *
 * Od K6 powłoka nie buduje korzenia sama — bierze go z `StoreChrome`, wspólnego
 * dla WSZYSTKICH tras sklepu, i przez to renderuje też NAGŁÓWEK. Wcześniej
 * nagłówek wołała każda trasa osobno, obok powłoki, czyli poza korzeniem:
 * jedyne miejsce w sklepie, do którego motyw nie sięgał. Trasa, która chce
 * nagłówek pod motywem, nie ma już czego zrobić źle — dostaje go z powłoki.
 */
import type { ResolvedSiteStyle } from "@avably/core/site";
import { cn } from "@avably/ui";
import type { ReactNode } from "react";

import { StoreChrome } from "@/components/storefront/store-chrome";
import type { StorefrontCopy } from "@/lib/storefront/copy";

export function PageShell({
  style,
  copy,
  storeName,
  children,
  className,
}: {
  style: ResolvedSiteStyle;
  copy: StorefrontCopy;
  storeName: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <StoreChrome style={style} copy={copy} storeName={storeName}>
      <main className={cn("mx-auto w-full max-w-5xl px-6 py-10", className)}>{children}</main>
    </StoreChrome>
  );
}
