"use client";

import { useTranslations } from "next-intl";

import { usePathname } from "@/i18n/navigation";
import type { PanelOrganization } from "@/lib/organizations";
import { panelTitleKey } from "@/lib/shell/nav";

import { AccountMenu } from "./account-menu";
import { MobileNav } from "./mobile-nav";
import { OrganizationSwitcher } from "./organization-switcher";

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
 *
 * U11a (ADR-144) zbiera cztery kontrolki prawej strony — martwy adres
 * e-mail, język, motyw i wyróżniony przycisk „Wyloguj" — w JEDNO menu konta.
 * Belka zostaje z tym, po co istnieje: hamburger (mobile), nazwa sekcji
 * i jedno wejście do spraw konta. Menu jest to samo na każdej szerokości,
 * więc szuflada mobilna nie trzyma już drugiej kopii tych pozycji.
 */
export function PanelTopbar({
  userEmail,
  closing = false,
  onboarding = false,
  isOwner = false,
  organizations = [],
  currentTenantId = null,
}: {
  userEmail: string;
  /** Okno domykania (ADR-138) — schodzi do nawigacji mobilnej. */
  closing?: boolean;
  /** Sesja bez organizacji (ADR-153) — schodzi do nawigacji mobilnej. */
  onboarding?: boolean;
  /** Rola sesji (M-UX-02, ADR-193) — schodzi do szuflady mobilnej. */
  isOwner?: boolean;
  /** Organizacje użytkownika (L7, ADR-224) — picker tylko przy >1. */
  organizations?: PanelOrganization[];
  /** Aktywna organizacja z claimu — zaznaczona w pickerze. */
  currentTenantId?: string | null;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  // PICKER tylko przy >1 członkostwie (L7, ADR-224): jedna organizacja =
  // brak przełącznika (bez szumu), zgodnie z briefem.
  const showOrgSwitcher = organizations.length > 1;

  return (
    <header className="border-border bg-card flex min-h-14 items-center gap-3 border-b px-4 md:px-6">
      <MobileNav closing={closing} onboarding={onboarding} isOwner={isOwner} />
      <h1 className="min-w-0 truncate text-sm font-semibold md:text-base">
        {t(panelTitleKey(pathname))}
      </h1>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {showOrgSwitcher ? (
          <OrganizationSwitcher organizations={organizations} currentTenantId={currentTenantId} />
        ) : null}
        <AccountMenu userEmail={userEmail} />
      </div>
    </header>
  );
}
