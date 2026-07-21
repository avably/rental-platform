import { ShieldIcon } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { SUPERADMIN_HOME } from "@/lib/superadmin";

import { NAV_ICON_STROKE_WIDTH } from "./nav-icons";

/**
 * Wejście do panelu superadmina (ADR-059).
 *
 * POZA `<nav data-panel-nav>` — ŚWIADOMIE. Struktura tamtej nawigacji jest
 * kontraktem z artefaktem Fazy 2 (ADR-056 D1: 1 zapowiedź + 9 pozycji + 3
 * grupy, porównywane co do kolejności i identyfikatorów). Superadmina w
 * artefakcie NIE MA, bo to nie jest funkcja najemcy, tylko wejście operatora
 * platformy. Dołożenie pozycji do tamtej listy wywróciłoby kontrakt; osobny
 * blok na dole sidebara zostawia go zielonym i uczciwie oddziela dwie różne
 * role.
 *
 * WIDOCZNOŚĆ decyduje ISTNIEJĄCY mechanizm ról: claim `superadmin` z JWT,
 * czytany przez `getAuthContext` (ADR-007). Komponent nie jest bramką —
 * ukrycie linku to wygoda, nie zabezpieczenie: `/admin` broni się sam
 * (`requireSuperadminPage` → 404 dla obcych, lib/superadmin.ts), a pod spodem
 * RLS `app.is_superadmin()`. Dlatego renderujemy go WYŁĄCZNIE dla superadmina,
 * ale nie zakładamy, że to wystarcza.
 *
 * Etykieta przychodzi PROPEM (wzorzec `OrderRowActions` z P4) — komponent jest
 * wtedy czysty i renderowalny w teście bez serwera Next.js.
 */
export function SuperadminEntry({
  superadmin,
  label,
}: {
  superadmin: boolean;
  label: string;
}) {
  if (!superadmin) return null;

  return (
    <div data-superadmin-entry className="border-border mt-auto border-t p-3">
      <Link
        href={SUPERADMIN_HOME}
        className="text-sidebar-foreground flex min-h-10 items-center gap-2.5 rounded-md border-l-2 border-transparent px-3 py-2.5 text-sm font-medium no-underline outline-none transition-[background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
      >
        <ShieldIcon
          aria-hidden="true"
          className="size-4 shrink-0"
          strokeWidth={NAV_ICON_STROKE_WIDTH}
        />
        {label}
      </Link>
    </div>
  );
}
