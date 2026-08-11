"use client";

import { useTranslations } from "next-intl";

import { usePathname } from "@/i18n/navigation";
import { logoutAction } from "@/lib/actions/logout";
import { panelTitleKey } from "@/lib/shell/nav";

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
 * języka było dotąd ręczne przepisanie adresu).
 *
 * P7 (ADR-060) upraszcza wariant mobilny do hamburgera, H1 i motywu.
 * Język, e-mail i wylogowanie są wtedy dostępne w tej samej szufladzie.
 */
export function PanelTopbar({
  userEmail,
  closing = false,
}: {
  userEmail: string;
  /** Okno domykania (ADR-138) — schodzi do nawigacji mobilnej. */
  closing?: boolean;
}) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();

  return (
    <header className="border-border bg-background flex min-h-14 items-center gap-3 border-b px-4 md:px-6">
      <MobileNav userEmail={userEmail} closing={closing} />
      <h1 className="min-w-0 truncate text-sm font-semibold md:text-base">
        {t(panelTitleKey(pathname))}
      </h1>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <span className="text-muted-foreground hidden truncate text-sm lg:inline">
          {userEmail}
        </span>
        <div className="hidden md:block">
          <LocaleSwitcher />
        </div>
        <ThemeToggle />
        {/* Wylogowanie zmienia stan — musi być POST-em (server action),
            nigdy linkiem GET, który router mógłby prefetchować. */}
        <form action={logoutAction} className="hidden md:block">
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
