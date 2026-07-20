import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { logoutAction } from "@/lib/actions/logout";
import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { SUPERADMIN_HOME } from "@/lib/superadmin";

/**
 * Strona główna panelu.
 *
 * Kontekst czytamy `getAuthContext` (nie rzuca: brak sesji to `null`), a NIE
 * `requireMemberPage` — strona musi zostać dostępna dla zalogowanego BEZ
 * organizacji, bo to ona kieruje go do zakładania firmy, a `requireMemberPage`
 * odsyła taką sesję właśnie tutaj (byłaby pętla przekierowań).
 *
 * ANONIM idzie jednak na logowanie (1.5.7). Wcześniej strona nie miała żadnego
 * guarda i niezalogowany dostawał listę linków nawigacyjnych zamiast ekranu
 * logowania — nie wyciek (zero danych, wejście do /admin zależy od claimu), ale
 * zła powierzchnia pierwszego ekranu panelu na produkcji. Przekierowanie idzie
 * przez `localePath`: gołe `redirect("/login")` zgubiłoby prefiks języka
 * i wyrzuciło polskiego użytkownika na /en/login (ADR-034, lib/navigation.ts).
 *
 * Wejście do /admin pokazujemy WYŁĄCZNIE sesji, która ma już claim superadmin
 * — dla wszystkich innych link nie istnieje w HTML-u, więc maskowanie 404
 * (lib/superadmin.ts) zostaje szczelne. Link wolno pokazać już na aal1:
 * kliknięcie trafia w guarda, który przeprowadzi przez wyzwanie MFA — i to
 * jest dokładnie droga wejścia foundera (logowanie → MFA → /admin/tenants).
 */
export default async function Home() {
  const ctx = await getAuthContext(await createSupabaseServerClient());
  if (!ctx) redirect(await localePath("/login"));

  const t = await getTranslations("home");
  const tCommon = await getTranslations("common");
  const tNav = await getTranslations("nav");

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
        <Link className="underline" href="/strona">
          {t("siteLink")}
        </Link>
        <Link className="underline" href="/katalog/punkty-odbioru">
          {t("locationsLink")}
        </Link>
        <Link className="underline" href="/zaproszenia">
          {t("invitationsLink")}
        </Link>
        <Link className="underline" href="/ustawienia-emaili">
          {t("emailSettingsLink")}
        </Link>
        <Link className="underline" href="/historia-emaili">
          {t("emailLogLink")}
        </Link>
        <Link className="underline" href="/ustawienia-domen">
          {t("domainSettingsLink")}
        </Link>
        {ctx.superadmin ? (
          <Link className="font-medium underline" href={SUPERADMIN_HOME}>
            {tNav("superadminLink")}
          </Link>
        ) : null}
      </nav>
      {/* Sesja jest tu pewna (anonim został przekierowany wyżej), więc blok
          nie musi już być warunkowy. */}
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
    </div>
  );
}
