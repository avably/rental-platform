import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { SUPERADMIN_HOME } from "@/lib/superadmin";

/**
 * Strona główna panelu — placeholder dashboardu (ADR-056, artefakt sekcja 03).
 *
 * Reguła twarda artefaktu: BEZ KPI, bez trendów, bez zmyślonych liczb.
 * Dashboard nie ma danych, więc mówi to wprost i kieruje tam, gdzie praca
 * faktycznie się dzieje, zamiast udawać analitykę wykresami z powietrza.
 * Lista linków nawigacyjnych zniknęła stąd — od P3 trzyma ją sidebar shella.
 *
 * Kontekst czytamy `getAuthContext` (nie rzuca: brak sesji to `null`), a NIE
 * `requireMemberPage` — strona musi zostać dostępna dla zalogowanego BEZ
 * organizacji, bo to ona kieruje go do zakładania firmy, a `requireMemberPage`
 * odsyła taką sesję właśnie tutaj (byłaby pętla przekierowań).
 *
 * ANONIM idzie na logowanie (1.5.7), przez `localePath` — gołe
 * `redirect("/login")` zgubiłoby prefiks języka i wyrzuciło polskiego
 * użytkownika na /en/login (ADR-034, lib/navigation.ts).
 *
 * Wejście do /admin pokazujemy WYŁĄCZNIE sesji, która ma już claim superadmin
 * — dla wszystkich innych link nie istnieje w HTML-u, więc maskowanie 404
 * (lib/superadmin.ts) zostaje szczelne. To jedyna droga wejścia foundera do
 * panelu superadmina, więc NIE wolno jej zgubić przy restylingu: sidebar
 * shella jest kontraktem z artefaktem i pozycji superadmina w nim nie ma.
 *
 * Wylogowanie przeniosło się do belki shella — nie dublujemy go tutaj.
 */
export default async function Home() {
  const ctx = await getAuthContext(await createSupabaseServerClient());
  if (!ctx) redirect(await localePath("/login"));

  const t = await getTranslations("home");
  const tNav = await getTranslations("nav");

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-[-0.02em]">
        {t("placeholderTitle")}
      </h2>
      <p className="text-muted-foreground mt-3 text-sm">
        {t("placeholderBody")}
      </p>
      <Link
        href="/zamowienia"
        className="bg-primary text-primary-foreground mt-6 inline-flex cursor-pointer items-center rounded-md border border-transparent px-4 py-2 text-sm font-semibold outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
      >
        {t("ordersCta")}
      </Link>
      {ctx.superadmin ? (
        <p className="mt-8 text-sm">
          <Link className="font-medium underline" href={SUPERADMIN_HOME}>
            {tNav("superadminLink")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
