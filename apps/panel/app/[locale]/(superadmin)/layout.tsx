import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { logoutAction } from "@/lib/actions/logout";
import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Powłoka panelu superadmina. Guard nie siedzi tutaj (layouty w App Routerze
 * nie chronią route handlerów ani nie są przeliczane przy każdej nawigacji) —
 * każda strona i akcja woła `requireSuperadminPage()` u siebie, bliżej danych.
 *
 * Kontekst czytamy tu WYŁĄCZNIE po to, żeby pokazać, kto jest zalogowany.
 * `getAuthContext` nie rzuca (brak sesji → `null`), więc layout nie zaczyna
 * dublować guarda ani zmieniać jego przekierowań — o dostępie nadal decyduje
 * strona.
 */
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("nav");
  const tCommon = await getTranslations("common");
  const ctx = await getAuthContext(await createSupabaseServerClient());

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4 text-sm">
          <span className="font-semibold">{t("superadmin")}</span>
          <Link className="text-gray-600 hover:text-gray-900" href="/admin/tenants">
            {t("tenants")}
          </Link>
          <Link className="text-gray-600 hover:text-gray-900" href="/admin/audit">
            {t("auditLog")}
          </Link>
          <div className="ml-auto flex items-center gap-4">
            {ctx?.user.email ? <span className="text-gray-600">{ctx.user.email}</span> : null}
            {/* Wylogowanie zmienia stan — POST (server action), nie link GET. */}
            <form action={logoutAction}>
              <button type="submit" className="text-gray-600 underline hover:text-gray-900">
                {tCommon("logout")}
              </button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
