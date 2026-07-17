import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { logoutAction } from "@/lib/actions/logout";
import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { SUPERADMIN_HOME } from "@/lib/superadmin";

/**
 * Strona główna panelu. Świadomie BEZ guarda — kontekst czytamy
 * `getAuthContext`, bo ono nie rzuca: brak sesji to `null`, a nie 401.
 * Dzięki temu strona nie zaczyna nagle przekierowywać anonimów, a linki i tak
 * prowadzą do stron, które mają własne guardy.
 *
 * Wejście do /admin pokazujemy WYŁĄCZNIE sesji, która ma już claim superadmin
 * — dla wszystkich innych link nie istnieje w HTML-u, więc maskowanie 404
 * (lib/superadmin.ts) zostaje szczelne. Link wolno pokazać już na aal1:
 * kliknięcie trafia w guarda, który przeprowadzi przez wyzwanie MFA — i to
 * jest dokładnie droga wejścia foundera (logowanie → MFA → /admin/tenants).
 */
export default async function Home() {
  const t = await getTranslations("home");
  const tCommon = await getTranslations("common");
  const tNav = await getTranslations("nav");

  const ctx = await getAuthContext(await createSupabaseServerClient());

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <nav className="flex flex-col items-center gap-2 text-sm">
        <Link className="underline" href="/zamowienia">
          {t("ordersLink")}
        </Link>
        <Link className="underline" href="/katalog">
          {t("catalogLink")}
        </Link>
        <Link className="underline" href="/katalog/punkty-odbioru">
          {t("locationsLink")}
        </Link>
        <Link className="underline" href="/zaproszenia">
          {t("invitationsLink")}
        </Link>
        {ctx?.superadmin ? (
          <Link className="font-medium underline" href={SUPERADMIN_HOME}>
            {tNav("superadminLink")}
          </Link>
        ) : null}
      </nav>
      {ctx ? (
        <div className="flex flex-col items-center gap-2 text-sm">
          <span className="text-gray-600">{ctx.user.email}</span>
          {/* Wylogowanie zmienia stan — musi być POST-em (server action),
              nigdy linkiem GET, który router mógłby prefetchować. */}
          <form action={logoutAction}>
            <button type="submit" className="underline">
              {tCommon("logout")}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
