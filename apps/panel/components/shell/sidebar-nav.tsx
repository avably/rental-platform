"use client";

import { RocketIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import {
  CLOSING_NAV_HREFS,
  PANEL_NAV_GROUPS,
  PANEL_NAV_LAUNCH,
  PANEL_NAV_PLACEHOLDER,
  matchNavItem,
  type PanelNavGroup,
} from "@/lib/shell/nav";

import { NAV_ICONS, NAV_ICON_STROKE_WIDTH } from "./nav-icons";

/** Postęp huba „Uruchomienie" dla badge (np. 4/7) — `null` = pozycji nie ma. */
export type LaunchNavState = { done: number; total: number } | null;

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
 *  • ROZWINIĘTY — ikona + etykieta tekstowa (`data-nav-label`), nagłówki grup.
 *  • ZWINIĘTY — sam pasek ikon. Etykieta znika z przepływu, ale NIE
 *    z dostępności: nazwę niesie `aria-label` linku (stały, niezależny od
 *    stanu) oraz wizualny tooltip (`role="tooltip"`, `data-nav-tooltip`)
 *    pokazywany na hover i focus. Świadomie NIE `title=""` — natywny dymek nie
 *    odpala z klawiatury i bywa niewidoczny dla czytnika.
 * W OBU stanach aktywna pozycja niesie `aria-current="page"`. Od ADR-177
 * jasny panel pokazuje ją neutralną powierzchnią i małą limonkową kropką —
 * limonka nazywa kontekst, ale nie zalewa całego wiersza. W dark zostaje
 * dotychczasowe wypełnienie `bg-accent`, bo tam daje właściwy kontrast.
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
 * Stany interakcji: hover to WYŁĄCZNIE podkreślenie (żadnego koloru ani tła),
 * focus to obrys limonki. Aktywna pozycja nadal nie dostaje krawędzi (decyzja
 * właściciela 2026-07-21), `border-l-2 border-transparent` ZOSTAJE na
 * wszystkich pozycjach dla stałej geometrii. Zakazu krawędzi i nowego
 * znacznika pilnuje `sidebar-active-contract.test.tsx`.
 */
export function SidebarNav({
  onNavigate,
  closing = false,
  onboarding = false,
  isOwner = false,
  launch = null,
}: {
  onNavigate?: () => void;
  /**
   * Pozycja warunkowa „Uruchomienie" (ADR-228): postęp huba z shella, gdy
   * onboarding nieukończony. `null` (domyślnie) = pozycji nie ma — po komplecie
   * wymaganych kroków, w oknie domykania i dla sesji bez organizacji. Jak
   * `closing`/`onboarding`: to filtr WIDOKU, nie bramka — trasa `/uruchomienie`
   * i tak trzyma własny `requireMemberPage`.
   */
  launch?: LaunchNavState;
  /**
   * Okno domykania (ADR-138): true = pokazujemy WYŁĄCZNIE pozycje
   * z CLOSING_NAV_HREFS. Bramką dostępu pozostaje guard (odmowa domyślna) —
   * filtr nie pokazuje drzwi, które są zamknięte. Grupy bez pozycji znikają.
   */
  closing?: boolean;
  /**
   * Sesja BEZ organizacji (ADR-153, N4): KAŻDA pozycja grup prowadzi na
   * trasę tenancką, a `requireMemberPage` odsyła taką sesję z powrotem na
   * pulpit — czyli pełne menu było listą dziesięciu linków robiących to samo
   * kółko. Zostaje sam pulpit, bo tylko on niesie wejście do zakładania
   * organizacji. Jak przy `closing`: to filtr WIDOKU, bramką pozostaje guard.
   */
  onboarding?: boolean;
  /**
   * Rola sesji z layoutu (M-UX-02, ADR-193): pozycje `ownerOnly` (dziś
   * „Zespół" → /zaproszenia) renderują się WYŁĄCZNIE ownerowi — staff widział
   * link, który serwer i tak zawsze kończył odmową. Domyślna FAŁSZ (odmowa
   * domyślna jak w guardach): zapomniane okablowanie CHOWA pozycję, zamiast
   * pokazać ją wszystkim. Jak `closing`/`onboarding` — filtr WIDOKU, bramką
   * pozostaje `requireMember("owner")` na ekranie i akcjach.
   */
  isOwner?: boolean;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const active = matchNavItem(pathname);

  const PlaceholderIcon = NAV_ICONS[PANEL_NAV_PLACEHOLDER.id];
  const placeholderLabel = t(PANEL_NAV_PLACEHOLDER.labelKey);

  // Filtr uprawnień idzie PRZED filtrem okna domykania: obie redukcje mają
  // działać niezależnie, a grupy bez pozycji znikają po złożeniu obu.
  const permitted: readonly PanelNavGroup[] = PANEL_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.ownerOnly || isOwner),
  })).filter((group) => group.items.length > 0);

  const groups: readonly PanelNavGroup[] = onboarding
    ? []
    : closing
      ? permitted
          .map((group) => ({
            ...group,
            items: group.items.filter((item) => CLOSING_NAV_HREFS.includes(item.href)),
          }))
          .filter((group) => group.items.length > 0)
      : permitted;

  return (
    <nav
      id={PANEL_NAV_ID}
      data-panel-nav="true"
      aria-label={t("panelNavigation")}
      className="flex flex-col gap-0.5 p-3"
    >
      {/* Dashboard ISTNIEJE i jest stroną startową (UX1, ADR-140) — pozycja
          jest linkiem do `/`, bez badge „Wkrótce". Stoi poza grupami (jak w
          artefakcie po zgodnej edycji) i poza matchNavItem: dopasowanie
          prefiksowe na `/` łapałoby każdą trasę, więc stan aktywny to
          RÓWNOŚĆ ścieżki. W oknie domykania pozycja ZOSTAJE — spójnie z
          dolnym paskiem mobilnym (PANEL_BOTTOM_NAV_HOME w trybie closing):
          trasa `/` istnieje i pokazuje wejście do huba domykania. */}
      <Link
        href="/"
        data-nav-placeholder={PANEL_NAV_PLACEHOLDER.id}
        aria-current={pathname === "/" ? "page" : undefined}
        aria-label={placeholderLabel}
        onClick={onNavigate}
        className={[
          "group relative flex min-h-10 items-center gap-2.5 rounded-md border-l-2 px-3 py-2.5 text-sm font-medium",
          "rail-collapsed:justify-center",
          "text-sidebar-foreground border-transparent",
          "outline-none transition-[background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]",
          "hover:underline hover:underline-offset-[3px]",
          "focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring",
          pathname === "/"
            ? "bg-muted/60 text-foreground before:absolute before:left-1.5 before:size-1.5 before:rounded-full before:bg-accent before:content-[''] rail-collapsed:before:hidden dark:bg-accent dark:text-accent-foreground dark:before:bg-accent-foreground"
            : "",
        ].join(" ")}
      >
        <PlaceholderIcon
          aria-hidden="true"
          className="size-4 shrink-0"
          strokeWidth={NAV_ICON_STROKE_WIDTH}
        />
        <span data-nav-label className="rail-collapsed:hidden">
          {placeholderLabel}
        </span>
        <NavTooltip label={placeholderLabel} />
      </Link>

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
          {/* Pozycja warunkowa „Uruchomienie" na GÓRZE grupy SPRZEDAŻ (ADR-228)
              — wchodzi tylko, gdy shell poda postęp (onboarding nieukończony). */}
          {group.id === "sales" && launch ? (
            <LaunchNavLink
              launch={launch}
              active={pathname === PANEL_NAV_LAUNCH.href}
              label={t(PANEL_NAV_LAUNCH.labelKey)}
              onNavigate={onNavigate}
            />
          ) : null}
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
                  isActive
                    ? "bg-muted/60 text-foreground before:absolute before:left-1.5 before:size-1.5 before:rounded-full before:bg-accent before:content-[''] rail-collapsed:before:hidden dark:bg-accent dark:text-accent-foreground dark:before:bg-accent-foreground"
                    : "",
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
 * Pozycja „Uruchomienie" z badge postępu (ADR-228). Ma WŁASNY atrybut
 * `data-nav-launch` (nie `data-nav-item`), bo nie jest pozycją kontraktu
 * struktury — skanery `data-nav-item` (np. kontrola kompletu pozycji grup)
 * nie mają jej liczyć. Badge chowa się w stanie zwiniętym razem z etykietą;
 * nazwę i tak niesie `aria-label`, a dymek `NavTooltip`.
 */
function LaunchNavLink({
  launch,
  active,
  label,
  onNavigate,
}: {
  launch: { done: number; total: number };
  active: boolean;
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={PANEL_NAV_LAUNCH.href}
      data-nav-launch="true"
      aria-current={active ? "page" : undefined}
      aria-label={label}
      onClick={onNavigate}
      className={[
        "group relative flex min-h-10 items-center gap-2.5 rounded-md border-l-2 px-3 py-2.5 text-sm font-medium",
        "rail-collapsed:justify-center",
        "text-sidebar-foreground border-transparent",
        "outline-none transition-[background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]",
        "hover:underline hover:underline-offset-[3px]",
        "focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring",
        active
          ? "bg-muted/60 text-foreground before:absolute before:left-1.5 before:size-1.5 before:rounded-full before:bg-accent before:content-[''] rail-collapsed:before:hidden dark:bg-accent dark:text-accent-foreground dark:before:bg-accent-foreground"
          : "",
      ].join(" ")}
    >
      <RocketIcon
        aria-hidden="true"
        className="size-4 shrink-0"
        strokeWidth={NAV_ICON_STROKE_WIDTH}
      />
      <span data-nav-label className="rail-collapsed:hidden">
        {label}
      </span>
      <span
        data-nav-launch-badge
        className="bg-primary text-primary-foreground ml-auto inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums rail-collapsed:hidden"
      >
        {launch.done}/{launch.total}
      </span>
      <NavTooltip label={label} />
    </Link>
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
