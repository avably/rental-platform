/**
 * Powłoka strony sklepu poza katalogiem (produkt/koszyk/checkout) — nakłada tło
 * i typografię wybranego SZABLONU site'u (classic/bold), żeby podstrony leżały
 * wizualnie spójnie z katalogiem renderowanym przez SiteRenderer. Komponent
 * serwerowy: tokeny szablonu z @avably/ui, treść wstrzyknięta jako children.
 */
import { cn, getTemplateStyles, type SiteTemplate } from "@avably/ui";
import type { ReactNode } from "react";

export function PageShell({
  template,
  children,
  className,
}: {
  template: SiteTemplate;
  children: ReactNode;
  className?: string;
}) {
  const styles = getTemplateStyles(template);
  return (
    <div className={cn(styles.page, "min-h-[60vh]")}>
      <main className={cn("mx-auto w-full max-w-5xl px-6 py-10", className)}>{children}</main>
    </div>
  );
}
