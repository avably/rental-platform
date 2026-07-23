import { ReviewOverlayGate } from "@avably/review/overlay";
import { getTranslations } from "next-intl/server";

import { BrandSymbol } from "@/components/shell/brand-mark";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shell/skip-link";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Link } from "@/i18n/navigation";
import { logoutAction } from "@/lib/actions/logout";
import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Powłoka panelu superadmina (ADR-056 D2, restylowana w ADR-059).
 *
 * Guard nie siedzi tutaj (layouty w App Routerze nie chronią route handlerów
 * ani nie są przeliczane przy każdej nawigacji) — każda strona i akcja woła
 * `requireSuperadminPage()` u siebie, bliżej danych. Kontekst czytamy
 * WYŁĄCZNIE po to, żeby pokazać, kto jest zalogowany; `getAuthContext` nie
 * rzuca (brak sesji → `null`), więc layout nie dubluje guarda.
 *
 * BEZ SHELLA TENANTA — świadomie. Sidebar z ADR-056 jest kontraktem z
 * artefaktem i prowadzi do ekranów NAJEMCY, których guardy i tak nie wpuszczą
 * operatora platformy bez organizacji. Stąd własna, minimalna belka: sygnet,
 * nazwa roli, dwa realne wejścia i wylogowanie. Grupa `(superadmin)` jest
 * rodzeństwem `(panel)`, więc ten rozdział jest STRUKTURALNY, nie warunkiem
 * w kodzie.
 */
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("nav");
  const tCommon = await getTranslations("common");
  const ctx = await getAuthContext(await createSupabaseServerClient());

  const linkClass =
    "text-muted-foreground hover:text-foreground rounded-sm no-underline outline-none transition-[color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring";

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <SkipLink label={t("skipToContent")} />
      <header className="border-border bg-background border-b">
        <nav
          aria-label={t("superadmin")}
          className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 text-sm md:px-6"
        >
          <BrandSymbol className="size-6 shrink-0" />
          <span className="font-semibold">{t("superadmin")}</span>
          <Link className={linkClass} href="/admin/tenants">
            {t("tenants")}
          </Link>
          <Link className={linkClass} href="/admin/audit">
            {t("auditLog")}
          </Link>
          {process.env.REVIEW_MODE === "1" ? (
            // Wejście widoczne tylko w trybie przeglądu (ADR-071) — poza nim
            // trasa i tak odpowiada 404.
            <Link className={linkClass} href="/admin/przeglad-uwagi">
              Przegląd uwag
            </Link>
          ) : null}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {ctx?.user.email ? (
              <span className="text-muted-foreground hidden truncate lg:inline">
                {ctx.user.email}
              </span>
            ) : null}
            <LocaleSwitcher />
            <ThemeToggle />
            {/* Wylogowanie zmienia stan — POST (server action), nie link GET. */}
            <form action={logoutAction}>
              <button
                type="submit"
                className="border-border text-foreground cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium outline-none transition-[outline-color,border-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
              >
                {tCommon("logout")}
              </button>
            </form>
          </div>
        </nav>
      </header>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-6 md:py-8"
      >
        {children}
      </main>
      {/* Nakładka przeglądu (ADR-071) — oś admina to też ekrany przeglądu
          (pozycja 39 listy). Warunki jak w (panel): REVIEW_MODE + superadmin
          + ?review=1 po stronie klienta. */}
      {process.env.REVIEW_MODE === "1" && ctx?.superadmin ? (
        <ReviewOverlayGate surface="panel" />
      ) : null}
    </div>
  );
}
