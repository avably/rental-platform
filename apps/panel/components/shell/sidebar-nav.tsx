"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import {
  PANEL_NAV_GROUPS,
  PANEL_NAV_PLACEHOLDER,
  matchNavItem,
} from "@/lib/shell/nav";

import { NAV_ICONS, NAV_ICON_STROKE_WIDTH } from "./nav-icons";

/**
 * Nawigacja panelu — malowanie wg artefaktu Fazy 2, sekcja 04 (ADR-056).
 *
 * Klient, bo `aria-current` musi wynikać z bieżącej ścieżki. `usePathname`
 * z `@/i18n/navigation` zwraca ścieżkę BEZ prefiksu locale, więc porównanie
 * z `href` z definicji jest wprost (patrz `matchNavItem`).
 *
 * Stany wg artefaktu: hover to WYŁĄCZNIE podkreślenie (żadnego koloru ani
 * tła — „pseudo-states: geometry / cursor / decoration only"), focus to obrys
 * limonki z nośnikiem, aktywna pozycja dostaje tło akcentu i lewą krawędź.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const active = matchNavItem(pathname);

  const PlaceholderIcon = NAV_ICONS[PANEL_NAV_PLACEHOLDER.id];

  return (
    <nav
      data-panel-nav="true"
      aria-label={t("panelNavigation")}
      className="flex flex-col gap-0.5 p-3"
    >
      {/* Dashboard zapowiadamy, ale go NIE MA — więc nie jest linkiem.
          `span` zamiast wyłączonego `<a>`: element bez `href` i tak nie
          wchodzi w kolejność tabulacji, a czytnik nie obieca nawigacji,
          której nie da się wykonać. */}
      <span
        data-nav-placeholder={PANEL_NAV_PLACEHOLDER.id}
        data-future="true"
        aria-disabled="true"
        className="text-muted-foreground flex min-h-10 items-center justify-between gap-2 rounded-md border-l-2 border-transparent px-3 py-2.5 text-sm font-medium"
      >
        <span className="flex items-center gap-2.5">
          <PlaceholderIcon
            aria-hidden="true"
            className="size-4 shrink-0"
            strokeWidth={NAV_ICON_STROKE_WIDTH}
          />
          {t(PANEL_NAV_PLACEHOLDER.labelKey)}
        </span>
        <span className="border-border rounded-full border px-2 py-0.5 text-[11px] tracking-[0.04em]">
          {t(PANEL_NAV_PLACEHOLDER.badgeKey)}
        </span>
      </span>

      {PANEL_NAV_GROUPS.map((group) => (
        <div key={group.id} className="contents">
          <p className="text-muted-foreground mt-4 mb-1 px-3 text-[11px] leading-[14px] font-semibold tracking-[0.08em]">
            {t(group.labelKey)}
          </p>
          {group.items.map((item) => {
            const Icon = NAV_ICONS[item.id];
            const isActive = active?.id === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                data-nav-item={item.id}
                aria-current={isActive ? "page" : undefined}
                onClick={onNavigate}
                className={[
                  "flex min-h-10 items-center gap-2.5 rounded-md border-l-2 px-3 py-2.5 text-sm font-medium",
                  "text-sidebar-foreground border-transparent",
                  "outline-none transition-[background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]",
                  "hover:underline hover:underline-offset-[3px]",
                  "focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring",
                  isActive
                    ? "bg-accent text-foreground border-l-signal-strong dark:text-accent-foreground dark:border-l-accent-foreground"
                    : "",
                ].join(" ")}
              >
                <Icon
                  aria-hidden="true"
                  className="size-4 shrink-0"
                  strokeWidth={NAV_ICON_STROKE_WIDTH}
                />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
