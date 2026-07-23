"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import {
  PANEL_NAV_GROUPS,
  PANEL_NAV_PLACEHOLDER,
  matchNavItem,
} from "@/lib/shell/nav";

import { NAV_ICONS, NAV_ICON_STROKE_WIDTH } from "./nav-icons";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";

/** Id nawigacji — kotwica dla `aria-controls` przełącznika zwijania. */
export const PANEL_NAV_ID = "panel-nav";

/**
 * Nawigacja panelu — malowanie wg artefaktu Fazy 2, sekcja 04 (ADR-056),
 * rozszerzona o stan ZWINIĘTY (uwaga przeglądu 2026-07-23).
 *
 * Klient, bo `aria-current` musi wynikać z bieżącej ścieżki. `usePathname`
 * z `@/i18n/navigation` zwraca ścieżkę BEZ prefiksu locale, więc porównanie
 * z `href` z definicji jest wprost (patrz `matchNavItem`).
 *
 * DWA STANY (uwaga przeglądu 2026-07-23):
 *  • ROZWINIĘTY — jak dotąd: ikona + etykieta tekstowa (`data-nav-label`).
 *  • ZWINIĘTY — sam pasek ikon. Etykieta znika z przepływu, ale NIE z
 *    dostępności: ląduje w `aria-label` linku (nazwa dostępna z klawiatury
 *    i czytnika) oraz w wizualnym tooltipie (`role="tooltip"`,
 *    `data-nav-tooltip`), który pokazuje się na hover i focus. Świadomie NIE
 *    `title=""` — natywny dymek nie odpala z klawiatury i bywa niewidoczny
 *    dla czytnika.
 * W OBU stanach aktywna pozycja niesie `aria-current="page"` i tło `bg-accent`
 * — „tu stoisz" nie może zniknąć razem z etykietą.
 *
 * `collapsed` można podać PROPEM (komponent sterowany, renderowalny w teście
 * bez `document`); pominięty — czyta stan zewnętrzny hookiem. Layout pomija
 * prop i zostaje przy magazynie `<html data-sidebar>`.
 *
 * Stany interakcji wg artefaktu: hover to WYŁĄCZNIE podkreślenie (żadnego
 * koloru ani tła), focus to obrys limonki. Aktywna pozycja dostaje SAMO tło
 * akcentu — bez krawędzi (decyzja właściciela 2026-07-21), `border-l-2
 * border-transparent` ZOSTAJE na wszystkich pozycjach dla stałej geometrii.
 * Zakazu krawędzi pilnuje `sidebar-active-contract.test.tsx`.
 */
export function SidebarNav({
  onNavigate,
  collapsed: collapsedProp,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const stored = useSidebarCollapsed();
  const collapsed = collapsedProp ?? stored;
  const active = matchNavItem(pathname);

  const PlaceholderIcon = NAV_ICONS[PANEL_NAV_PLACEHOLDER.id];

  return (
    <nav
      id={PANEL_NAV_ID}
      data-panel-nav="true"
      data-collapsed={collapsed ? "true" : undefined}
      aria-label={t("panelNavigation")}
      className="flex flex-col gap-0.5 p-3"
    >
      {/* Dashboard zapowiadamy, ale go NIE MA — więc nie jest linkiem.
          `span` zamiast wyłączonego `<a>`: element bez `href` i tak nie
          wchodzi w kolejność tabulacji, a czytnik nie obieca nawigacji,
          której nie da się wykonać. W stanie zwiniętym badge „Wkrótce"
          znika (nie mieści się w pasku ikon), a zapowiedź zostaje samą ikoną
          z tooltipem. */}
      <span
        data-nav-placeholder={PANEL_NAV_PLACEHOLDER.id}
        data-future="true"
        aria-disabled="true"
        aria-label={collapsed ? t(PANEL_NAV_PLACEHOLDER.labelKey) : undefined}
        className={[
          "text-muted-foreground group relative flex min-h-10 items-center gap-2.5 rounded-md border-l-2 border-transparent px-3 py-2.5 text-sm font-medium",
          collapsed ? "justify-center" : "justify-between",
        ].join(" ")}
      >
        <span className="flex items-center gap-2.5">
          <PlaceholderIcon
            aria-hidden="true"
            className="size-4 shrink-0"
            strokeWidth={NAV_ICON_STROKE_WIDTH}
          />
          {collapsed ? null : (
            <span data-nav-label>{t(PANEL_NAV_PLACEHOLDER.labelKey)}</span>
          )}
        </span>
        {collapsed ? (
          <NavTooltip label={t(PANEL_NAV_PLACEHOLDER.labelKey)} />
        ) : (
          <span className="border-border rounded-full border px-2 py-0.5 text-[11px] tracking-[0.04em]">
            {t(PANEL_NAV_PLACEHOLDER.badgeKey)}
          </span>
        )}
      </span>

      {PANEL_NAV_GROUPS.map((group, index) => (
        <div key={group.id} className="contents">
          {collapsed ? (
            // Zwinięty pasek nie ma miejsca na nagłówek grupy — grupowanie
            // niesie cienka linia (poza pierwszą grupą, nad którą jest już
            // zapowiedź). Dekoracyjna, więc `aria-hidden`.
            index > 0 ? (
              <div
                role="separator"
                aria-hidden="true"
                className="border-border mx-2 my-2 border-t"
              />
            ) : null
          ) : (
            <p className="text-muted-foreground mt-4 mb-1 px-3 text-[11px] leading-[14px] font-semibold tracking-[0.08em]">
              {t(group.labelKey)}
            </p>
          )}
          {group.items.map((item) => {
            const Icon = NAV_ICONS[item.id];
            const isActive = active?.id === item.id;
            const label = t(item.labelKey);
            return (
              <Link
                key={item.id}
                href={item.href}
                data-nav-item={item.id}
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? label : undefined}
                onClick={onNavigate}
                className={[
                  "group relative flex min-h-10 items-center gap-2.5 rounded-md border-l-2 px-3 py-2.5 text-sm font-medium",
                  collapsed ? "justify-center" : "",
                  "text-sidebar-foreground border-transparent",
                  "outline-none transition-[background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]",
                  "hover:underline hover:underline-offset-[3px]",
                  "focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring",
                  isActive ? "bg-accent text-foreground dark:text-accent-foreground" : "",
                ].join(" ")}
              >
                <Icon
                  aria-hidden="true"
                  className="size-4 shrink-0"
                  strokeWidth={NAV_ICON_STROKE_WIDTH}
                />
                {collapsed ? (
                  <NavTooltip label={label} />
                ) : (
                  <span data-nav-label>{label}</span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * Wizualny dymek etykiety dla stanu zwiniętego.
 *
 * `aria-hidden`, bo nazwę dostępną niesie już `aria-label` na linku — dwa
 * źródła nazwy podwoiłyby komunikat czytnika. Pokazuje się na `group-hover`
 * ORAZ `group-focus-within` (link jest ogniskowalny), więc dymek odpala też
 * z klawiatury. `pointer-events-none`, żeby nie łapał myszy nad sąsiadem.
 */
function NavTooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      data-nav-tooltip
      aria-hidden="true"
      className="bg-popover text-popover-foreground border-border pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium group-hover:block group-focus-within:block"
    >
      {label}
    </span>
  );
}
