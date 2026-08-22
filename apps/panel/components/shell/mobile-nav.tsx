"use client";

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@avably/ui";
import { MenuIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Link, usePathname } from "@/i18n/navigation";
import { PANEL_BOTTOM_NAV_HOME, PANEL_BOTTOM_NAV_ITEMS, matchNavItem } from "@/lib/shell/nav";

import { BrandLogo } from "./brand-mark";
import { NAV_ICONS, NAV_ICON_STROKE_WIDTH } from "./nav-icons";
import { SidebarNav, type LaunchNavState } from "./sidebar-nav";

/**
 * Nawigacja na wąskim ekranie (ADR-056): sidebar chowa się w szufladzie.
 *
 * Szuflada zamyka się po kliknięciu pozycji (`onNavigate`) — bez tego po
 * przejściu do innego ekranu nakładka zostałaby otwarta nad nową treścią,
 * bo nawigacja klientem nie odmontowuje shella.
 *
 * U11a (ADR-144) zdjął ze stopki szuflady adres e-mail, przełącznik języka
 * i „Wyloguj": te pozycje mieszkają dziś w MENU KONTA, które stoi w belce na
 * KAŻDEJ szerokości. Trzymanie ich w obu miejscach dawało na telefonie dwa
 * wylogowania i dwa przełączniki języka — czyli dokładnie ten rozjazd, który
 * audyt UX wytyka w części o spójności akcji. Szuflada zostaje tym, czym
 * jest: nawigacją.
 */
/**
 * CTA paska jako zwykła pozycja (decyzja właściciela 2026-07-22: bez
 * wyróżnienia). Nie jest pozycją nawigacji — stąd lokalna stała, nie wpis
 * w `PANEL_NAV_ITEMS`; ikona plusa dobierana jest w renderze.
 */
const NEW_ORDER_BAR_ITEM = {
  id: "new-order",
  href: "/zamowienia/nowe",
  labelKey: "newOrderShort",
} as const;

const BOTTOM_ITEM_CLASS =
  "text-muted-foreground flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium outline-none transition-[color,background-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-accent dark:focus-visible:outline-ring";

export function MobileNav({
  closing = false,
  onboarding = false,
  isOwner = false,
  launch = null,
  navExpanded = [],
}: {
  /** Okno domykania (ADR-138) — filtruje szufladę i dolny pasek (jak sidebar). */
  closing?: boolean;
  /**
   * Sesja bez organizacji (ADR-153, N4) — filtruje szufladę i dolny pasek
   * tak samo jak sidebar. Bez tego pętla „pulpit ↔ zamówienia" żyłaby dalej
   * na telefonie, gdzie pasek dolny jest główną nawigacją.
   */
  onboarding?: boolean;
  /**
   * Rola sesji (M-UX-02, ADR-193) — filtruje pozycje `ownerOnly` w szufladzie
   * tak samo jak sidebar (to ten sam `SidebarNav`). Dolny pasek nie ma takich
   * pozycji, więc filtr dotyczy wyłącznie szuflady.
   */
  isOwner?: boolean;
  /**
   * Pozycja warunkowa „Uruchomienie" (ADR-228) — schodzi do szuflady (ten sam
   * `SidebarNav`). Dolny pasek jej nie niesie (ma stały skład kciukowy).
   */
  launch?: LaunchNavState;
  /**
   * Rozwinięte gałęzie drzewa nawigacji (ADR-231) — schodzą do szuflady (ten
   * sam `SidebarNav`). Dolny pasek jest płaski, więc go nie dotyczą.
   */
  navExpanded?: readonly string[];
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = matchNavItem(pathname);
  const newOrderActive =
    pathname === "/zamowienia/nowe" || pathname.startsWith("/zamowienia/nowe/");

  // Bez organizacji dolny pasek to pulpit i menu — reszta pozycji jest
  // trasami tenanckimi, z których guard i tak zawróciłby na pulpit.
  // W oknie domykania pasek traci katalog i CTA nowego zamówienia —
  // zostaje strona główna, zamówienia i menu (guard i tak by odmówił).
  const bottomItems = onboarding
    ? [PANEL_BOTTOM_NAV_HOME]
    : closing
      ? [PANEL_BOTTOM_NAV_HOME, PANEL_BOTTOM_NAV_ITEMS[0]]
      : [PANEL_BOTTOM_NAV_HOME, PANEL_BOTTOM_NAV_ITEMS[0], NEW_ORDER_BAR_ITEM, PANEL_BOTTOM_NAV_ITEMS[1]];

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
        className="bg-sidebar flex h-full w-72 flex-col gap-0 p-0 pt-12"
        aria-label={t("panelNavigation")}
      >
        {/* Radix wymaga tytułu dla nakładki dialogowej — trzymamy go dla
            czytników, bez dublowania nagłówka na ekranie. */}
        <SheetTitle className="sr-only">{t("panelNavigation")}</SheetTitle>
        {/* Znak Avably w nagłówku szuflady mobilnej (ADR-233) — spójnie z pełną
            wersją (pełne logo na górze sidebara desktopu). Link do pulpitu,
            szuflada zamyka się po nawigacji jak przy pozycjach menu. Na wąskim
            ekranie belka panelu nie niesie znaku, więc dopiero tu operator widzi
            markę wewnątrz aplikacji. */}
        <div className="flex items-center px-3 pb-3">
          <Link
            href="/"
            aria-label="Avably"
            onClick={() => setOpen(false)}
            className="inline-flex rounded-md outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
          >
            <BrandLogo className="h-auto w-[120px]" />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav
            onNavigate={() => setOpen(false)}
            closing={closing}
            onboarding={onboarding}
            isOwner={isOwner}
            launch={launch}
            expanded={navExpanded}
          />
        </div>
      </SheetContent>

      <nav
        data-mobile-bottom-nav="true"
        aria-label={t("mobileNavigation")}
        className={`border-border bg-background fixed inset-x-0 bottom-0 z-40 grid border-t pb-[env(safe-area-inset-bottom)] md:hidden ${onboarding ? "grid-cols-2" : closing ? "grid-cols-3" : "grid-cols-5"}`}
      >
        {/*
          Kolejność: Dashboard · Zamówienia · Nowe · Katalog · Menu (decyzja
          właściciela 2026-07-22) — „Nowe" stoi na środku, pod kciukiem,
          i wygląda jak każda inna pozycja: bez obrysu i bez wyróżnienia.
          Limonkowe wypełnienie niesie na pasku JEDNĄ informację — gdzie
          jesteś — więc CTA dostaje je wyłącznie na własnej trasie.
          W oknie domykania (ADR-138) pasek ma trzy komórki — patrz bottomItems.
        */}
        {bottomItems.map((item) => {
          const Icon = NAV_ICONS[item.id] ?? PlusIcon;
          // Dashboard i CTA nie przechodzą przez `matchNavItem` (nie są
          // pozycjami nawigacji), więc bieżącość liczy się dla nich
          // z DOKŁADNEJ ścieżki — prefiks „/" pasowałby do każdego ekranu.
          const current =
            item.id === PANEL_BOTTOM_NAV_HOME.id
              ? pathname === "/"
              : item.id === NEW_ORDER_BAR_ITEM.id
                ? newOrderActive
                : active?.id === item.id && !(item.id === "orders" && newOrderActive);
          return (
            <Link
              key={item.id}
              href={item.href}
              // Skrócona etykieta CTA mieści się w komórce 70 px („Nowe
              // zamówienie" mierzy 93 px); pełna nazwa zostaje w aria-label.
              aria-label={item.id === NEW_ORDER_BAR_ITEM.id ? t("newOrder") : undefined}
              aria-current={current ? "page" : undefined}
              className={`${BOTTOM_ITEM_CLASS} ${current ? "bg-accent text-accent-foreground" : ""}`}
            >
              <Icon aria-hidden="true" className="size-5" strokeWidth={NAV_ICON_STROKE_WIDTH} />
              <span className="w-full truncate text-center">{t(item.labelKey)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-label={t("mobileMenu")}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className={BOTTOM_ITEM_CLASS}
        >
          <MenuIcon aria-hidden="true" className="size-5" strokeWidth={NAV_ICON_STROKE_WIDTH} />
          <span className="truncate">{t("mobileMenu")}</span>
        </button>
      </nav>
    </Sheet>
  );
}
