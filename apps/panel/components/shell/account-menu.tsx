"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@avably/ui";
import { UserRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { logoutAction } from "@/lib/actions/logout";

import { LocaleSwitcher } from "./locale-switcher";
import { NAV_ICON_STROKE_WIDTH } from "./nav-icons";
import { ThemeToggle } from "./theme-toggle";

/**
 * Menu konta w górnym pasku (U11a, ADR-144).
 *
 * Belka miała dotąd cztery rzeczy po prawej: adres e-mail jako MARTWY TEKST,
 * przełącznik języka, przełącznik motywu i obramowany przycisk „Wyloguj" —
 * czyli akcję wykonywaną raz dziennie obok przełącznika używanego raz w życiu
 * konta (audyt UX 2026-08-08, W6; audyt nazywa ten przycisk „wyróżnionym",
 * co jest nieścisłością — wyróżnienia nie miał, miejsce zajmował). Wszystkie
 * cztery schodzą tutaj, a belka odzyskuje miejsce na to, po co istnieje:
 * nazwę sekcji.
 *
 * ADRES E-MAIL JEST NAGŁÓWKIEM MENU, nie pozycją: to tożsamość zalogowanego
 * konta („czyje to menu"), a nie rzecz, w którą się klika. Dlatego
 * `DropdownMenuLabel`, nie `DropdownMenuItem` — czytnik ekranu ogłosi go jako
 * etykietę grupy, a nie jako martwą, niedziałającą pozycję.
 *
 * JĘZYK I MOTYW ZOSTAJĄ TYMI SAMYMI KOMPONENTAMI co dotąd (`LocaleSwitcher`,
 * `ThemeToggle`) i siedzą w wierszach opisanych etykietą, a nie w pozycjach
 * menu. Powód jest jeden: to PRZEŁĄCZNIKI STANU (który język, który motyw),
 * a pozycja menu jest poleceniem — przepisanie ich na pozycje wymagałoby
 * drugiej implementacji tej samej logiki, a wtedy przełącznik w szufladzie
 * mobilnej i ten w menu rozjechałyby się w pierwszym szczególe, którego nikt
 * nie pilnuje. Klawiatura ich nie gubi: strzałki chodzą po pozycjach menu,
 * a Tab po wszystkim, co skupialne w otwartej nakładce.
 */
export function AccountMenu({ userEmail }: { userEmail: string }) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");

  return (
    <DropdownMenu>
      {/* Trigger jest ikoniczny, więc etykieta idzie w aria-label (ADR-056 D3).
          Geometria i stany jak w przełączniku motywu — to rodzeństwo w belce. */}
      <DropdownMenuTrigger
        aria-label={tCommon("accountMenu")}
        data-account-menu-trigger
        className="border-border text-foreground flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
      >
        <UserRoundIcon aria-hidden="true" className="size-4" strokeWidth={NAV_ICON_STROKE_WIDTH} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" data-account-menu>
        <DropdownMenuLabel className="text-muted-foreground truncate px-2 py-1.5 text-xs font-normal">
          {userEmail}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border -mx-1 my-1 h-px" />

        <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
          <span className="text-muted-foreground">{tCommon("language")}</span>
          <LocaleSwitcher />
        </div>
        <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
          <span className="text-muted-foreground">{tCommon("theme")}</span>
          <ThemeToggle />
        </div>

        <DropdownMenuSeparator className="bg-border -mx-1 my-1 h-px" />
        <DropdownMenuItem asChild>
          <Link href="/bezpieczenstwo" className="no-underline">
            {t("security")}
          </Link>
        </DropdownMenuItem>
        {/* Wylogowanie zmienia stan — musi być POST-em (server action),
            nigdy linkiem GET, który router mógłby prefetchować. */}
        <form action={logoutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full cursor-pointer text-left">
              {tCommon("logout")}
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
