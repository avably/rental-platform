"use client";

import { useTranslations } from "next-intl";

import { usePathname } from "@/i18n/navigation";
import { logoutAction } from "@/lib/actions/logout";
import { PANEL_NAV_PLACEHOLDER, matchNavItem } from "@/lib/shell/nav";

import { BrandSymbol } from "./brand-mark";
import { LocaleSwitcher } from "./locale-switcher";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";

/**
 * Górna belka shella (ADR-056).
 *
 * CELOWO minimalna: nazwa bieżącej sekcji, tożsamość sesji i wylogowanie.
 * Bez wyszukiwarki i bez dzwonka powiadomień — takich funkcji w produkcie
 * NIE MA, a atrapa łamałaby tę samą regułę, przez którą dashboard jest
 * uczciwym placeholderem zamiast udawanej analityki.
 *
 * P6 (ADR-059) dokłada DWIE kontrolki, obie stojące za realną funkcją:
 * przełącznik motywu (tokeny `.dark` czekały w arkuszu od P1) i przełącznik
 * języka (produkt jest dwujęzyczny od ADR-013, a jedynym sposobem zmiany
 * języka było dotąd ręczne przepisanie adresu). Sygnet marki pojawia się
 * WYŁĄCZNIE na wąskim ekranie — tam, gdzie sidebar z pełnym logo jest
 * schowany w szufladzie.
 */
export function PanelTopbar({ userEmail }: { userEmail: string }) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();

  const active = matchNavItem(pathname);
  // `/` to ekran dashboardu (na razie placeholder) — stąd etykieta z pozycji
  // zapowiadanej. Trasy spoza nawigacji (np. historia e-maili) niosą własny
  // nagłówek w treści, więc belka zostaje przy nazwie produktu.
  const sectionKey = active
    ? active.labelKey
    : pathname === "/"
      ? PANEL_NAV_PLACEHOLDER.labelKey
      : null;

  return (
    <header className="border-border bg-background flex min-h-14 items-center gap-3 border-b px-4 md:px-6">
      <MobileNav />
      {/* Sygnet wg reguł sekcji 02: minimum 24 px. Na szerokim ekranie znak
          niesie już sidebar, więc powtarzanie go w belce byłoby szumem. */}
      <BrandSymbol className="size-6 shrink-0 md:hidden" />
      <p className="truncate text-sm font-semibold">
        {sectionKey ? t(sectionKey) : t("panelNavigation")}
      </p>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <span className="text-muted-foreground hidden truncate text-sm lg:inline">
          {userEmail}
        </span>
        <LocaleSwitcher />
        <ThemeToggle />
        {/* Wylogowanie zmienia stan — musi być POST-em (server action),
            nigdy linkiem GET, który router mógłby prefetchować. */}
        <form action={logoutAction}>
          <button
            type="submit"
            className="border-border text-foreground cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium outline-none transition-[outline-color,border-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
          >
            {tCommon("logout")}
          </button>
        </form>
      </div>
    </header>
  );
}
