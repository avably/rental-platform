import { redirect } from "next/navigation";

import { localePath } from "@/lib/navigation";
import { SUPERADMIN_HOME, requireSuperadminPage } from "@/lib/superadmin";

/**
 * Indeks `/admin` (ADR-059) — PRZEKIEROWANIE, nie ekran.
 *
 * Wejście superadmina w sidebarze prowadzi na `/admin`, a bez tego pliku był
 * to 404. Wybrano przekierowanie zamiast rozdroża „Najemcy / Audyt": rozdroże
 * z dwiema pozycjami dublowałoby belkę, która i tak stoi nad każdym ekranem
 * tej grupy — powstałby ekran istniejący wyłącznie po to, żeby z niego wyjść.
 *
 * GUARD JEST TUTAJ, mimo że strona nie czyta danych. Pierwsza wersja go nie
 * miała („cel i tak się broni") i wywróciła `protected-routes.test.ts`:
 * anonim dostawał przekierowanie na `/admin/tenants` zamiast na logowanie,
 * czyli trasa chroniona odsyłała gdzie indziej niż cała reszta. Klasyfikacja
 * ochrony patrzy na KAŻDĄ trasę osobno i ma rację — dwa skoki zamiast jednego
 * to nie jest szczegół, tylko inna odpowiedź na to samo pytanie. Przy okazji
 * obcy dostaje tu 404 (maskowanie z lib/superadmin.ts), a nie wycieczkę pod
 * adres, którego istnienia nie miał poznać.
 *
 * `localePath` dokłada prefiks locale — `redirect("/admin/tenants")` wprost
 * wyrzuciłby użytkownika z `/pl` na wykryty domyślny język.
 */
export default async function AdminIndexPage() {
  await requireSuperadminPage(SUPERADMIN_HOME);
  redirect(await localePath(SUPERADMIN_HOME));
}
