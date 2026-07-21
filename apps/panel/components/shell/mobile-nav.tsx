"use client";

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@avably/ui";
import { MenuIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { NAV_ICON_STROKE_WIDTH } from "./nav-icons";
import { SidebarNav } from "./sidebar-nav";

/**
 * Nawigacja na wąskim ekranie (ADR-056): sidebar chowa się w szufladzie.
 *
 * Szuflada zamyka się po kliknięciu pozycji (`onNavigate`) — bez tego po
 * przejściu do innego ekranu nakładka zostałaby otwarta nad nową treścią,
 * bo nawigacja klientem nie odmontowuje shella.
 */
export function MobileNav() {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label={t("openNavigation")}
        className="border-border text-foreground flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border outline-none transition-[outline-color,border-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden dark:focus-visible:outline-ring"
      >
        <MenuIcon
          aria-hidden="true"
          className="size-4"
          strokeWidth={NAV_ICON_STROKE_WIDTH}
        />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="bg-sidebar w-72 gap-0 p-0 pt-12"
        aria-label={t("panelNavigation")}
      >
        {/* Radix wymaga tytułu dla nakładki dialogowej — trzymamy go dla
            czytników, bez dublowania nagłówka na ekranie. */}
        <SheetTitle className="sr-only">{t("panelNavigation")}</SheetTitle>
        <div className="overflow-y-auto">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
