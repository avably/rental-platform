"use client";

import { ChevronDown, RocketIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Link, usePathname } from "@/i18n/navigation";
import {
  branchContainsPath,
  branchSelfItem,
  CLOSING_NAV_HREFS,
  matchNavItem,
  PANEL_NAV_LAUNCH,
  PANEL_NAV_PLACEHOLDER,
  PANEL_NAV_TREE,
  type PanelNavBranch,
  type PanelNavItem,
  type PanelNavNode,
} from "@/lib/shell/nav";
import { persistExpandedBranches } from "@/lib/shell/nav-tree-collapse";

import { NAV_ICONS, NAV_ICON_STROKE_WIDTH } from "./nav-icons";

/** Postęp huba „Uruchomienie" dla badge (np. 4/7) — `null` = pozycji nie ma. */
export type LaunchNavState = { done: number; total: number } | null;

/** Id nawigacji — kotwica dla `aria-controls` przełącznika zwijania. */
export const PANEL_NAV_ID = "panel-nav";

/** Id kontenera dzieci gałęzi — kotwica `aria-controls` przełącznika akordeonu. */
function branchChildrenId(branchId: string): string {
  return `${PANEL_NAV_ID}-${branchId}`;
}

// Wspólne klasy wiersza (link/przycisk) — jeden wygląd pozycji i gałęzi.
const ROW_BASE =
  "group relative flex min-h-10 items-center gap-2.5 rounded-md border-l-2 py-2.5 text-sm font-medium rail-collapsed:justify-center text-sidebar-foreground border-transparent outline-none transition-[background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring";
const ROW_PAD_TOP = "px-3";
// Dziecko akordeonu jest WCIĘTE (pl-9 ≈ ikona rodzica + odstęp); w zwiniętym
// pasku wcięcie znika (rail-collapsed:px-3), bo tam wiersz to sama ikona.
const ROW_PAD_CHILD = "pr-3 pl-9 rail-collapsed:px-3";
const ROW_ACTIVE =
  "bg-muted/60 text-foreground before:absolute before:left-1.5 before:size-1.5 before:rounded-full before:bg-accent before:content-[''] rail-collapsed:before:hidden dark:bg-accent dark:text-accent-foreground dark:before:bg-accent-foreground";

function rowClass(active: boolean, child: boolean): string {
  return [ROW_BASE, child ? ROW_PAD_CHILD : ROW_PAD_TOP, active ? ROW_ACTIVE : ""].join(" ");
}

/**
 * Nawigacja panelu — DRZEWO zagnieżdżone (akordeon, ADR-231; wcześniej trzy
 * płaskie grupy z ADR-056). Malowanie wg przepisanego artefaktu Fazy 2,
 * sekcja 04.
 *
 * Klient, bo `aria-current` i stan rozwinięcia gałęzi zależą od bieżącej
 * ścieżki. `usePathname` z `@/i18n/navigation` zwraca ścieżkę BEZ prefiksu
 * locale, więc porównanie z `href` z definicji jest wprost (patrz `matchNavItem`).
 *
 * AKORDEON (ADR-231):
 *  • Gałąź NAWIGOWALNA (Strona sklepu → /strona, Organizacja → /organizacja):
 *    wiersz-etykieta jest LINKIEM (klik NAWIGUJE), a osobny chevron rozwija
 *    dzieci — klik w chevron NIE zjada nawigacji (to dwa rodzeństwa, nie
 *    przycisk w linku).
 *  • Gałąź-GRUPA (Ustawienia — bez ekranu): cały wiersz jest przyciskiem
 *    rozwijającym dzieci.
 *  • Stan rozwinięcia jest SSR-SPÓJNY: layout czyta ciasteczko i podaje
 *    `expanded`, a gałąź z trasą aktywną rozwija się ZAWSZE (operator widzi,
 *    gdzie stoi) — render serwera od razu poprawny, zero flash-a. Klik zapisuje
 *    ciasteczko, więc następna nawigacja oddaje ten sam stan.
 *
 * DWA STANY PASKA (uwaga przeglądu 2026-07-23, zachowane w ADR-231):
 *  • ROZWINIĘTY — ikona + etykieta (`data-nav-label`), akordeon działa.
 *  • ZWINIĘTY (rail 72 px) — sam pasek ikon. Etykiety chowa `rail-collapsed:`,
 *    nazwę niesie `aria-label` linku i dymek (`data-nav-tooltip`). W railu
 *    akordeon jest SPŁASZCZONY: chevrony znikają, a dzieci są zawsze widoczne
 *    jako ikony (kontener dzieci `rail-collapsed:flex`), więc pasek ikon zachowuje
 *    pełny zasięg — z railu da się dojść wszędzie bez rozwijania paska.
 *
 * JEDEN RENDER NA OBA STANY (naprawa M2): markup jest TEN SAM, o widoczności
 * decyduje wariant `rail-collapsed:` ustawiony przed pierwszym malowaniem.
 * Komponent NIE czyta stanu zwinięcia PASKA — nie ma czego rozjechać między
 * serwerem a klientem (stan AKORDEONU to osobna rzecz, SSR-spójna z ciasteczka).
 */
export function SidebarNav({
  onNavigate,
  closing = false,
  onboarding = false,
  isOwner = false,
  launch = null,
  expanded = [],
}: {
  onNavigate?: () => void;
  /**
   * Pozycja warunkowa „Uruchomienie" (ADR-228): postęp huba z shella, gdy
   * onboarding nieukończony. `null` (domyślnie) = pozycji nie ma. Filtr WIDOKU,
   * nie bramka — trasa `/uruchomienie` trzyma własny `requireMemberPage`.
   */
  launch?: LaunchNavState;
  /**
   * Okno domykania (ADR-138): true = pokazujemy WYŁĄCZNIE pozycje
   * z CLOSING_NAV_HREFS. Bramką dostępu pozostaje guard (odmowa domyślna) —
   * filtr nie pokazuje drzwi, które są zamknięte. Gałęzie bez dzieci znikają.
   */
  closing?: boolean;
  /**
   * Sesja BEZ organizacji (ADR-153, N4): KAŻDA pozycja drzewa prowadzi na
   * trasę tenancką, z której `requireMemberPage` zawraca na pulpit. Zostaje sam
   * pulpit — jedyne wejście do zakładania organizacji. Filtr WIDOKU, bramką
   * pozostaje guard.
   */
  onboarding?: boolean;
  /**
   * Rola sesji z layoutu (M-UX-02, ADR-193): pozycje `ownerOnly` (dziś
   * „Zespół" → /zaproszenia) renderują się WYŁĄCZNIE ownerowi. Domyślna FAŁSZ
   * (odmowa domyślna jak w guardach). Filtr WIDOKU, bramką pozostaje
   * `requireMember("owner")`.
   */
  isOwner?: boolean;
  /**
   * Gałęzie rozwinięte z ciasteczka (ADR-231), SSR-spójnie z layoutu. Gałąź
   * z trasą aktywną rozwija się mimo braku na tej liście.
   */
  expanded?: readonly string[];
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const active = matchNavItem(pathname);

  const initialExpanded = new Set(expanded);
  // Nadpisania użytkownika (klik chevronu). Przed pierwszym klikiem `undefined`
  // → stan = ciasteczko LUB gałąź zawiera trasę aktywną (SSR-spójne). Po kliku
  // wybór użytkownika wygrywa, więc chevron zawsze reaguje.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const PlaceholderIcon = NAV_ICONS[PANEL_NAV_PLACEHOLDER.id];
  const placeholderLabel = t(PANEL_NAV_PLACEHOLDER.labelKey);

  const nodes = filterTree(PANEL_NAV_TREE, { onboarding, closing, isOwner });
  const branchesShown = nodes.flatMap((node) => (node.kind === "branch" ? [node.branch] : []));

  function isOpen(branch: PanelNavBranch): boolean {
    const override = overrides[branch.id];
    if (override !== undefined) return override;
    return initialExpanded.has(branch.id) || branchContainsPath(branch, pathname);
  }

  function toggleBranch(branch: PanelNavBranch) {
    const next = !isOpen(branch);
    const nextOverrides = { ...overrides, [branch.id]: next };
    setOverrides(nextOverrides);
    // Zapisz zbiór gałęzi OTWARTYCH po zmianie — layout czyta go przy renderze
    // serwera, więc następna nawigacja oddaje od razu ten sam stan (zero flash-a).
    const openIds = branchesShown
      .filter((candidate) =>
        candidate.id === branch.id
          ? next
          : nextOverrides[candidate.id] ??
            (initialExpanded.has(candidate.id) || branchContainsPath(candidate, pathname)),
      )
      .map((candidate) => candidate.id);
    persistExpandedBranches(openIds);
  }

  return (
    <nav
      id={PANEL_NAV_ID}
      data-panel-nav="true"
      aria-label={t("panelNavigation")}
      className="flex flex-col gap-0.5 p-3"
    >
      {/* Dashboard ISTNIEJE i jest stroną startową (UX1, ADR-140) — link do `/`,
          bez badge „Wkrótce". Stoi poza drzewem (jak w artefakcie) i poza
          matchNavItem: dopasowanie prefiksowe na `/` łapałoby każdą trasę, więc
          stan aktywny to RÓWNOŚĆ ścieżki. W oknie domykania pozycja ZOSTAJE. */}
      <Link
        href="/"
        data-nav-placeholder={PANEL_NAV_PLACEHOLDER.id}
        aria-current={pathname === "/" ? "page" : undefined}
        aria-label={placeholderLabel}
        onClick={onNavigate}
        className={rowClass(pathname === "/", false)}
      >
        <PlaceholderIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={NAV_ICON_STROKE_WIDTH} />
        <span data-nav-label className="rail-collapsed:hidden">
          {placeholderLabel}
        </span>
        <NavTooltip label={placeholderLabel} />
      </Link>

      {/* Pozycja warunkowa „Uruchomienie" (ADR-228) na GÓRZE drzewa — wchodzi
          tylko, gdy shell poda postęp (onboarding nieukończony). */}
      {launch ? (
        <LaunchNavLink
          launch={launch}
          active={pathname === PANEL_NAV_LAUNCH.href}
          label={t(PANEL_NAV_LAUNCH.labelKey)}
          onNavigate={onNavigate}
        />
      ) : null}

      {nodes.map((node) =>
        node.kind === "item" ? (
          <NavLeaf
            key={node.item.id}
            item={node.item}
            active={active?.id === node.item.id}
            label={t(node.item.labelKey)}
            onNavigate={onNavigate}
          />
        ) : (
          <NavBranch
            key={node.branch.id}
            branch={node.branch}
            open={isOpen(node.branch)}
            active={active}
            onToggle={() => toggleBranch(node.branch)}
            onNavigate={onNavigate}
            t={t}
          />
        ),
      )}
    </nav>
  );
}

/** Filtr uprawnień/okna domykania/onboardingu na DRZEWIE (ADR-231). */
function filterTree(
  nodes: readonly PanelNavNode[],
  { onboarding, closing, isOwner }: { onboarding: boolean; closing: boolean; isOwner: boolean },
): PanelNavNode[] {
  if (onboarding) return [];
  return nodes.flatMap((node): PanelNavNode[] => {
    if (node.kind === "item") {
      if (closing && !CLOSING_NAV_HREFS.includes(node.item.href)) return [];
      return [node];
    }
    const branch = node.branch;
    let children = branch.children.filter((child) => !child.ownerOnly || isOwner);
    if (closing) children = children.filter((child) => CLOSING_NAV_HREFS.includes(child.href));
    const branchNavigableInClosing = branch.href ? CLOSING_NAV_HREFS.includes(branch.href) : false;
    const keep = children.length > 0 || (Boolean(branch.href) && (!closing || branchNavigableInClosing));
    if (!keep) return [];
    return [{ kind: "branch", branch: { ...branch, children } }];
  });
}

/** Liść drzewa (pozycja klikalna) — top-level albo dziecko akordeonu. */
function NavLeaf({
  item,
  active,
  label,
  onNavigate,
  child = false,
}: {
  item: PanelNavItem;
  active: boolean;
  label: string;
  onNavigate?: () => void;
  child?: boolean;
}) {
  const Icon = NAV_ICONS[item.id];
  return (
    <Link
      href={item.href}
      data-nav-item={item.id}
      aria-current={active ? "page" : undefined}
      // Nazwa dostępna STAŁA, niezależna od zwinięcia paska: w railu etykieta
      // znika przez `display:none`, więc bez `aria-label` link zostałby bez nazwy.
      aria-label={label}
      onClick={onNavigate}
      className={rowClass(active, child)}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={NAV_ICON_STROKE_WIDTH} />
      ) : null}
      <span data-nav-label className="rail-collapsed:hidden">
        {label}
      </span>
      <NavTooltip label={label} />
    </Link>
  );
}

/**
 * Gałąź akordeonu (ADR-231). Nawigowalna → wiersz-link + osobny chevron;
 * grupa-toggle → cały wiersz to przycisk. Dzieci w `role="group"`. W railu
 * chevron znika, a dzieci są zawsze widoczne jako ikony.
 */
function NavBranch({
  branch,
  open,
  active,
  onToggle,
  onNavigate,
  t,
}: {
  branch: PanelNavBranch;
  open: boolean;
  active: PanelNavItem | undefined;
  onToggle: () => void;
  onNavigate?: () => void;
  t: (key: string, values?: Record<string, string>) => string;
}) {
  const ParentIcon = NAV_ICONS[branch.id];
  const label = t(branch.labelKey);
  const childrenId = branchChildrenId(branch.id);
  const selfItem = branchSelfItem(branch);
  const selfActive = selfItem ? active?.id === selfItem.id : false;
  const containsActive =
    selfActive || branch.children.some((child) => active?.id === child.id);

  const chevron = (
    <ChevronDown
      aria-hidden="true"
      className={`size-4 shrink-0 transition-transform [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] rail-collapsed:hidden ${open ? "" : "-rotate-90"}`}
      strokeWidth={NAV_ICON_STROKE_WIDTH}
    />
  );

  return (
    <div data-nav-branch={branch.id} className="contents">
      {branch.href ? (
        // NAWIGOWALNA: link (nawiguje) + osobny chevron (toggluje). Dwa
        // rodzeństwa, nie przycisk w linku — klik w chevron nie zjada nawigacji.
        <div className="relative flex items-center">
          <Link
            href={branch.href}
            data-nav-item={selfItem?.id}
            data-nav-branch-link={branch.id}
            aria-current={selfActive ? "page" : undefined}
            aria-label={label}
            onClick={onNavigate}
            className={`${rowClass(containsActive, false)} min-w-0 flex-1 pr-9`}
          >
            {ParentIcon ? (
              <ParentIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={NAV_ICON_STROKE_WIDTH} />
            ) : null}
            <span data-nav-label className="truncate rail-collapsed:hidden">
              {label}
            </span>
            <NavTooltip label={label} />
          </Link>
          <button
            type="button"
            data-nav-branch-toggle={branch.id}
            aria-expanded={open}
            aria-controls={childrenId}
            aria-label={t(open ? "collapseSection" : "expandSection", { section: label })}
            onClick={onToggle}
            className="absolute right-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-muted/60 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent rail-collapsed:hidden dark:focus-visible:outline-ring"
          >
            {chevron}
          </button>
        </div>
      ) : (
        // GRUPA-TOGGLE (bez ekranu): cały wiersz przełącza rozwinięcie.
        <button
          type="button"
          data-nav-branch-toggle={branch.id}
          aria-expanded={open}
          aria-controls={childrenId}
          aria-label={label}
          onClick={onToggle}
          className={`${rowClass(containsActive, false)} w-full cursor-pointer text-left`}
        >
          {ParentIcon ? (
            <ParentIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={NAV_ICON_STROKE_WIDTH} />
          ) : null}
          <span data-nav-label className="rail-collapsed:hidden">
            {label}
          </span>
          <span className="ml-auto rail-collapsed:hidden">{chevron}</span>
          <NavTooltip label={label} />
        </button>
      )}

      {/* Dzieci: ukryte przy zwiniętej gałęzi (SSR-spójnie), ale ZAWSZE widoczne
          w railu (`rail-collapsed:flex`), gdzie akordeon jest spłaszczony do ikon. */}
      <div
        id={childrenId}
        role="group"
        aria-label={label}
        data-nav-branch-children={branch.id}
        className={`flex flex-col gap-0.5 ${open ? "" : "hidden"} rail-collapsed:flex`}
      >
        {branch.children.map((child) => (
          <NavLeaf
            key={child.id}
            item={child}
            active={active?.id === child.id}
            label={t(child.labelKey)}
            onNavigate={onNavigate}
            child
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Pozycja „Uruchomienie" z badge postępu (ADR-228). Ma WŁASNY atrybut
 * `data-nav-launch` (nie `data-nav-item`), bo nie jest pozycją kontraktu
 * struktury — skanery `data-nav-item` nie mają jej liczyć.
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
      className={rowClass(active, false)}
    >
      <RocketIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={NAV_ICON_STROKE_WIDTH} />
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
 * Wizualny dymek etykiety dla stanu zwiniętego paska.
 *
 * `aria-hidden`, bo nazwę dostępną niesie już `aria-label` na linku. Widoczność
 * należy do arkusza (`[data-nav-tooltip]` w `globals.css`): domyślnie
 * `display:none`, pokazuje go zwinięty pasek pod kursorem lub fokusem. Dlatego
 * dymek może stać w DOM ZAWSZE. `pointer-events-none`, żeby nie łapał myszy.
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
