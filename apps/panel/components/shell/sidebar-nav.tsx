"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import {
  CLOSING_NAV_HREFS,
  PANEL_NAV_GROUPS,
  PANEL_NAV_PLACEHOLDER,
  matchNavItem,
} from "@/lib/shell/nav";

import { NAV_ICONS, NAV_ICON_STROKE_WIDTH } from "./nav-icons";

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
 *  • ROZWINIĘTY — ikona + etykieta tekstowa (`data-nav-label`), nagłówki grup,
 *    badge zapowiedzi.
 *  • ZWINIĘTY — sam pasek ikon. Etykieta znika z przepływu, ale NIE
 *    z dostępności: nazwę niesie `aria-label` linku (stały, niezależny od
 *    stanu) oraz wizualny tooltip (`role="tooltip"`, `data-nav-tooltip`)
 *    pokazywany na hover i focus. Świadomie NIE `title=""` — natywny dymek nie
 *    odpala z klawiatury i bywa niewidoczny dla czytnika.
 * W OBU stanach aktywna pozycja niesie `aria-current="page"` i tło `bg-accent`
 * — „tu stoisz" nie może zniknąć razem z etykietą.
 *
 * JEDEN RENDER NA OBA STANY (naprawa M2, uwaga przeglądu 2026-07-24).
 * Poprzednio nagłówki grup, separatory, badge i tooltipy wybierała GAŁĄŹ
 * REACTA po `collapsed` z `localStorage`. Serwer tej wartości nie zna, więc
 * SSR rysował zawsze wariant rozwinięty — a skrypt startowy zdążył już zwęzić
 * pasek do 72 px. Efekt: nagłówki grup i badge malowały się wciśnięte w wąski
 * pasek i znikały dopiero po hydracji. To był SKOK przy ładowaniu.
 *
 * Dlatego markup jest TEN SAM w obu stanach, a o widoczności decyduje wariant
 * `rail-collapsed:` (`html[data-sidebar="collapsed"] [data-sidebar-rail] &`),
 * ustawiany przed pierwszym malowaniem. Komponent NIE czyta już stanu
 * zwinięcia — nie ma czego rozjechać między serwerem a klientem.
 *
 * Wariant jest zakotwiczony w pasku, nie w `<html>`, bo ta sama nawigacja
 * renderuje się w szufladzie mobilnej — a ta jest zawsze pełnej szerokości.
 *
 * Stany interakcji wg artefaktu: hover to WYŁĄCZNIE podkreślenie (żadnego
 * koloru ani tła), focus to obrys limonki. Aktywna pozycja dostaje SAMO tło
 * akcentu — bez krawędzi (decyzja właściciela 2026-07-21), `border-l-2
 * border-transparent` ZOSTAJE na wszystkich pozycjach dla stałej geometrii.
 * Zakazu krawędzi pilnuje `sidebar-active-contract.test.tsx`.
 */
export function SidebarNav({
  onNavigate,
  closing = false,
}: {
  onNavigate?: () => void;
  /**
   * Okno domykania (ADR-138): true = pokazujemy WYŁĄCZNIE pozycje
   * z CLOSING_NAV_HREFS. Bramką dostępu pozostaje guard (odmowa domyślna) —
   * filtr nie pokazuje drzwi, które są zamknięte. Grupy bez pozycji znikają.
   */
  closing?: boolean;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const active = matchNavItem(pathname);

  const PlaceholderIcon = NAV_ICONS[PANEL_NAV_PLACEHOLDER.id];
  const placeholderLabel = t(PANEL_NAV_PLACEHOLDER.labelKey);

  const groups = closing
    ? PANEL_NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => CLOSING_NAV_HREFS.includes(item.href)),
      })).filter((group) => group.items.length > 0)
    : PANEL_NAV_GROUPS;

  return (
    <nav
      id={PANEL_NAV_ID}
      data-panel-nav="true"
      aria-label={t("panelNavigation")}
      className="flex flex-col gap-0.5 p-3"
    >
      {/* Dashboard zapowiadamy, ale go NIE MA — więc nie jest linkiem.
          `span` zamiast wyłączonego `<a>`: element bez `href` i tak nie
          wchodzi w kolejność tabulacji, a czytnik nie obieca nawigacji,
          której nie da się wykonać. W stanie zwiniętym badge „Wkrótce"
          ustępuje (nie mieści się w pasku ikon), a zapowiedź zostaje samą
          ikoną z tooltipem — o wyborze decyduje CSS, nie render. */}
      <span
        data-nav-placeholder={PANEL_NAV_PLACEHOLDER.id}
        data-future="true"
        aria-disabled="true"
        aria-label={placeholderLabel}
        className="text-muted-foreground group relative flex min-h-10 items-center justify-between gap-2.5 rounded-md border-l-2 border-transparent px-3 py-2.5 text-sm font-medium rail-collapsed:justify-center"
      >
        <span className="flex items-center gap-2.5">
          <PlaceholderIcon
            aria-hidden="true"
            className="size-4 shrink-0"
            strokeWidth={NAV_ICON_STROKE_WIDTH}
          />
          <span data-nav-label className="rail-collapsed:hidden">
            {placeholderLabel}
          </span>
        </span>
        <span
          data-nav-badge
          className="border-border rounded-full border px-2 py-0.5 text-[11px] tracking-[0.04em] rail-collapsed:hidden"
        >
          {t(PANEL_NAV_PLACEHOLDER.badgeKey)}
        </span>
        <NavTooltip label={placeholderLabel} />
      </span>

      {groups.map((group, index) => (
        <div key={group.id} className="contents">
          {/* Zwinięty pasek nie ma miejsca na nagłówek grupy — grupowanie
              niesie wtedy cienka linia (poza pierwszą grupą, nad którą jest
              już zapowiedź). Dekoracyjna, więc `aria-hidden`. Oba warianty
              stoją w DOM, przełącza je atrybut paska. */}
          {index > 0 ? (
            <div
              role="separator"
              aria-hidden="true"
              data-nav-separator
              className="border-border mx-2 my-2 hidden border-t rail-collapsed:block"
            />
          ) : null}
          <p
            data-nav-group-label
            className="text-muted-foreground mt-4 mb-1 px-3 text-[11px] leading-[14px] font-semibold tracking-[0.08em] rail-collapsed:hidden"
          >
            {t(group.labelKey)}
          </p>
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
                // Nazwa dostępna STAŁA, niezależna od zwinięcia: w stanie
                // zwiniętym etykieta znika przez `display:none`, więc bez
                // `aria-label` link zostałby bez nazwy — i to już od
                // pierwszego malowania, na długo przed hydracją.
                aria-label={label}
                onClick={onNavigate}
                className={[
                  "group relative flex min-h-10 items-center gap-2.5 rounded-md border-l-2 px-3 py-2.5 text-sm font-medium",
                  "rail-collapsed:justify-center",
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
                <span data-nav-label className="rail-collapsed:hidden">
                  {label}
                </span>
                <NavTooltip label={label} />
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
 * źródła nazwy podwoiłyby komunikat czytnika. Widoczność w całości należy do
 * arkusza (`[data-nav-tooltip]` w `globals.css`): domyślnie `display:none`,
 * a pokazuje go zwinięty pasek pod kursorem lub fokusem. Dlatego dymek może
 * stać w DOM ZAWSZE — również w szufladzie mobilnej, gdzie nigdy się nie
 * pokaże. `pointer-events-none`, żeby nie łapał myszy nad sąsiadem.
 */
function NavTooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      data-nav-tooltip
      aria-hidden="true"
      className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-1/2 left-full z-10 ml-2 -translate-y-1/2 rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap"
    >
      {label}
    </span>
  );
}
