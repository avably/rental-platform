/**
 * POWŁOKA PODSTRON SKLEPU (produkt, koszyk, checkout) — TEN SAM ŚWIAT, CO
 * KATALOG (K5 v2, ADR-090).
 *
 * Do K5 powłoka nakładała klasy „szablonu graficznego" (classic/bold), więc
 * podstrony dziedziczyły tło i typografię z motywu APLIKACJI. Od ADR-090 strona
 * najemcy ma własny świat wizualny — i podstrony muszą w nim stać, inaczej
 * klient przechodzi z ciemnego, luksusowego katalogu na białą stronę produktu
 * i ma wrażenie, że wyszedł ze sklepu.
 *
 * Powłoka wystawia więc DOKŁADNIE ten sam korzeń, co `SiteRenderer`: klasę
 * `site-root`, komplet zmiennych motywu i atrybut wypełnienia przycisku.
 * Jedno źródło tokenów dla całego sklepu, niezależnie od tego, która trasa
 * je renderuje.
 */
import { styleTokensFor, themeTokens, type ResolvedSiteStyle } from "@avably/core/site";
import { cn, siteStyles } from "@avably/ui";
import type { CSSProperties, ReactNode } from "react";

export function PageShell({
  style,
  children,
  className,
}: {
  style: ResolvedSiteStyle;
  children: ReactNode;
  className?: string;
}) {
  const styles = siteStyles();
  return (
    <div
      className={cn("@container/site site-root", styles.page, "min-h-[60vh]")}
      data-site-theme={style.theme}
      data-site-button={themeTokens(style.theme).shape.buttonFill}
      style={{ ...styleTokensFor(style) } as CSSProperties}
    >
      <main className={cn("mx-auto w-full max-w-5xl px-6 py-10", className)}>{children}</main>
    </div>
  );
}
