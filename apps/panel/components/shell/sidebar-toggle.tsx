"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslations } from "next-intl";

import { NAV_ICON_STROKE_WIDTH } from "./nav-icons";
import { PANEL_NAV_ID } from "./sidebar-nav";
import { setSidebarCollapsed, useSidebarCollapsed } from "./use-sidebar-collapsed";

/**
 * Przełącznik zwinięcia sidebara (uwaga przeglądu 2026-07-23).
 *
 * Stałe miejsce powłoki: górny róg paska, obok znaku marki — widoczny w obu
 * stanach, na desktopie, bo zwijanie dotyczy WYŁĄCZNIE sidebara desktopowego
 * (dolna nawigacja mobilna zostaje nietknięta).
 *
 * DOSTĘPNOŚĆ: przycisk ikoniczny, więc etykieta idzie w `aria-label`
 * (ADR-056 D3). `aria-expanded` ogłasza, czy nawigacja jest ROZWINIĘTA, a
 * `aria-controls` wiąże przycisk z `<nav data-panel-nav>` — sama zamiana ikony
 * nie jest stanem, który czytnik potrafi ogłosić.
 *
 * `collapsed` można podać PROPEM (wtedy komponent jest sterowany i renderowalny
 * w teście bez `document`); pominięty — czyta stan zewnętrzny hookiem. Layout
 * pomija prop i zostaje przy magazynie.
 */
export function SidebarToggle({ collapsed: collapsedProp }: { collapsed?: boolean }) {
  const t = useTranslations("nav");
  const stored = useSidebarCollapsed();
  const collapsed = collapsedProp ?? stored;

  return (
    <button
      type="button"
      onClick={() => setSidebarCollapsed(!collapsed)}
      data-sidebar-toggle
      aria-label={collapsed ? t("sidebarExpand") : t("sidebarCollapse")}
      aria-expanded={!collapsed}
      aria-controls={PANEL_NAV_ID}
      className="border-border text-foreground flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
    >
      {/* OBIE ikony w DOM, wybór CSS-em (naprawa M2): serwer nie zna stanu
          z `localStorage`, więc gałąź Reacta narysowałaby ikonę „zwiń" nad
          już zwężonym paskiem i podmieniła ją dopiero po hydracji.
          `aria-expanded` i `aria-label` zostają przy Reakcie — atrybutu CSS
          nie ustawi, a ich korekta po hydracji nic nie przesuwa na ekranie. */}
      <PanelLeftClose
        aria-hidden="true"
        className="size-4 rail-collapsed:hidden"
        strokeWidth={NAV_ICON_STROKE_WIDTH}
      />
      <PanelLeftOpen
        aria-hidden="true"
        className="hidden size-4 rail-collapsed:block"
        strokeWidth={NAV_ICON_STROKE_WIDTH}
      />
    </button>
  );
}
