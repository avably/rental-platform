"use client";

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@avably/ui";
import { MenuIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Link, usePathname } from "@/i18n/navigation";
import { logoutAction } from "@/lib/actions/logout";
import { PANEL_BOTTOM_NAV_HOME, PANEL_BOTTOM_NAV_ITEMS, matchNavItem } from "@/lib/shell/nav";

import { LocaleSwitcher } from "./locale-switcher";
import { NAV_ICONS, NAV_ICON_STROKE_WIDTH } from "./nav-icons";
import { SidebarNav } from "./sidebar-nav";

/**
 * Nawigacja na wąskim ekranie (ADR-056): sidebar chowa się w szufladzie.
 *
 * Szuflada zamyka się po kliknięciu pozycji (`onNavigate`) — bez tego po
 * przejściu do innego ekranu nakładka zostałaby otwarta nad nową treścią,
 * bo nawigacja klientem nie odmontowuje shella.
 */
const BOTTOM_ITEM_CLASS =
  "text-muted-foreground flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium outline-none transition-[color,background-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-accent dark:focus-visible:outline-ring";

export function MobileNav({ userEmail }: { userEmail: string }) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = matchNavItem(pathname);
  const newOrderActive =
    pathname === "/zamowienia/nowe" || pathname.startsWith("/zamowienia/nowe/");

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
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
        <div className="border-border flex flex-col gap-3 border-t p-4">
          <span className="text-muted-foreground truncate text-xs">{userEmail}</span>
          <LocaleSwitcher />
          <form action={logoutAction}>
            <button
              type="submit"
              className="border-border text-foreground w-full cursor-pointer rounded-md border px-3 py-2 text-sm font-medium outline-none hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
            >
              {tCommon("logout")}
            </button>
          </form>
        </div>
      </SheetContent>

      <nav
        data-mobile-bottom-nav="true"
        aria-label={t("mobileNavigation")}
        className="border-border bg-background fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {[PANEL_BOTTOM_NAV_HOME, ...PANEL_BOTTOM_NAV_ITEMS].map((item) => {
          const Icon = NAV_ICONS[item.id];
          // Dashboard nie przechodzi przez `matchNavItem` (nie jest pozycją
          // nawigacji), więc bieżącość liczy się dla niego z DOKŁADNEJ ścieżki
          // — prefiks „/" pasowałby do każdego ekranu panelu.
          const current =
            item.id === PANEL_BOTTOM_NAV_HOME.id
              ? pathname === "/"
              : active?.id === item.id && !(item.id === "orders" && newOrderActive);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={`${BOTTOM_ITEM_CLASS} ${current ? "bg-accent text-accent-foreground" : ""}`}
            >
              <Icon aria-hidden="true" className="size-5" strokeWidth={NAV_ICON_STROKE_WIDTH} />
              <span className="w-full truncate text-center">{t(item.labelKey)}</span>
            </Link>
          );
        })}
        {/*
          CTA jest obrysem, nie plamą (decyzja właściciela 2026-07-22):
          limonkowe wypełnienie na pasku niesie JEDNĄ informację — gdzie
          jesteś. Dwa wypełnienia obok siebie kasowały tę różnicę. Gdy CTA
          samo staje się bieżącą trasą, dostaje tę samą limonkę co reszta.
        */}
        <Link
          href="/zamowienia/nowe"
          aria-label={t("newOrder")}
          aria-current={newOrderActive ? "page" : undefined}
          className={`${BOTTOM_ITEM_CLASS} m-1 min-h-14 rounded-md px-0 py-1 ${
            newOrderActive ? "bg-accent text-accent-foreground" : "border-border border"
          }`}
        >
          <PlusIcon aria-hidden="true" className="size-5" strokeWidth={NAV_ICON_STROKE_WIDTH} />
          {/*
            Skrócona etykieta wyłącznie na pasku: przy PIĘCIU kolumnach na
            390 px komórka ma 70 px, a „Nowe zamówienie" mierzy 93 px i
            wychodziło poza swoje pole na sąsiadów. Pełna nazwa zostaje
            w `aria-label`, więc czytnik dalej słyszy całość.
          */}
          <span className="w-full truncate text-center">{t("newOrderShort")}</span>
        </Link>
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
