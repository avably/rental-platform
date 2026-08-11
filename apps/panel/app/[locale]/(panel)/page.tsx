import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import {
  AuthError,
  getAuthContext,
  requireMemberWithClient,
  type AuthContext,
} from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { SUPERADMIN_HOME } from "@/lib/superadmin";

import { DashboardSections } from "./dashboard-sections";

/**
 * Strona główna panelu — dashboard operatora z PRAWDZIWYMI liczbami
 * (C1, ADR-109; wcześniej placeholder ADR-056).
 *
 * Reguła „BEZ zmyślonych KPI" zostaje w mocy — zmienia się jej realizacja:
 * liczby są liczone w bazie (funkcje `app.dashboard_*`, migracja 0054),
 * panel je wyłącznie prezentuje, a puste okna mówią wprost „brak danych".
 * Sekcje renderuje `DashboardSections` (osobna warstwa I/O) — ta strona
 * nadal nie wykonuje żadnego zapytania poza odczytem kontekstu sesji.
 *
 * Kontekst czytamy `getAuthContext` (nie rzuca: brak sesji to `null`), a NIE
 * `requireMemberPage` — strona musi zostać dostępna dla zalogowanego BEZ
 * organizacji, bo to ona kieruje go do zakładania firmy, a `requireMemberPage`
 * odsyła taką sesję właśnie tutaj (byłaby pętla przekierowań). Sesja bez
 * tenanta dostaje dotychczasową zapowiedź, nie dashboard — nie ma czego
 * liczyć bez organizacji.
 *
 * BRAMKA STATUSU TREŚCI (ADR-133). Gdy sesja MA organizację, o rendering
 * metryk pyta TEN SAM rdzeń co każda trasa tenancka (`requireMemberWithClient`,
 * ADR-107/127) — strona nie utrzymuje własnej listy statusów ani drugiego
 * zapytania. Status zamykający (`PANEL_CLOSED_STATUSES`) gasi WYŁĄCZNIE treść
 * pulpitu: trasa zostaje (patrz wyżej — pętla przekierowań), a zamiast liczb
 * operator dostaje komunikat o stanie konta. `past_due` renderuje dashboard
 * bez zmian — okno dunningowe to normalna praca operatora (presja przyjdzie
 * banerem w J2, nie blokadą treści). Cofnięte członkostwo kierujemy na
 * /dostep-cofniety (spójnie z member-page), a błąd odczytu rzuca (500) —
 * nigdy przepustka i nigdy fałszywy komunikat o zawieszeniu.
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

  const superadminEntry = ctx.superadmin ? (
    <p className="mt-8 text-sm">
      <Link className="font-medium underline" href={SUPERADMIN_HOME}>
        {tNav("superadminLink")}
      </Link>
    </p>
  ) : null;

  if (!ctx.tenantId) {
    return (
      <div>
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">
          {t("placeholderTitle")}
        </h2>
        <p className="text-muted-foreground mt-3 text-sm">{t("placeholderBody")}</p>
        <Link
          href="/zamowienia"
          className="bg-primary text-primary-foreground mt-6 inline-flex cursor-pointer items-center rounded-md border border-transparent px-4 py-2 text-sm font-semibold outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
        >
          {t("ordersCta")}
        </Link>
        {superadminEntry}
      </div>
    );
  }

  let memberCtx: AuthContext;
  try {
    memberCtx = await requireMemberWithClient(ctx.supabase);
  } catch (error) {
    if (error instanceof AuthError && error.code === "tenant_suspended") {
      // Treść gaśnie, trasa zostaje: zero metryk, zero RPC dashboardu.
      // Komunikat bez rozróżnienia suspended/cancelled/superadmin_locked
      // (decyzja 2 ADR-107) i bez CTA do tras, które i tak odmówią.
      return (
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.02em]">
            {t("suspendedTitle")}
          </h2>
          <p className="text-muted-foreground mt-3 text-sm">{t("suspendedBody")}</p>
          {superadminEntry}
        </div>
      );
    }
    if (error instanceof AuthError && error.code === "membership_revoked") {
      redirect(await localePath("/dostep-cofniety"));
    }
    // Pozostałe anomalie (w tym błąd odczytu członkostwa) — fail-closed: 500,
    // nigdy render metryk.
    throw error;
  }

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <p className="text-muted-foreground text-sm">{t("dashboardIntro")}</p>
        <Link
          href="/zamowienia"
          className="text-sm font-medium underline underline-offset-[3px]"
        >
          {t("ordersCta")}
        </Link>
      </div>
      <DashboardSections supabase={memberCtx.supabase} />
      {superadminEntry}
    </div>
  );
}
