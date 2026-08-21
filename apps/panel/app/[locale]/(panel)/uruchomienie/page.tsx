import { redirect } from "next/navigation";

import { requireMemberPage } from "@/lib/member-page";
import { localePath } from "@/lib/navigation";
import { fetchLaunchSignals } from "@/lib/onboarding/launch";

import { LaunchHub } from "./launch-hub";

/**
 * Config-first hub „Uruchomienie" (wariant C, ADR-228).
 *
 * Ekran NIEBLOKUJĄCY: cała nawigacja i wszystkie trasy zostają dostępne — hub
 * PROWADZI operatora (firma/zgodność → dostawa → oferta → publikacja), nie
 * zamyka go w wizardzie. Stan każdego kroku liczy się z danych
 * (`fetchLaunchSignals`), zero odhaczania ręcznie.
 *
 * Guard jak każda trasa tenancka (`requireMemberPage`): anonim → logowanie,
 * sesja bez organizacji → strona główna (tam wejście do zakładania firmy).
 * Po guardzie `tenantId` jest gwarantowany — narzucenie tego TS-owi jawnym
 * zawróceniem, nie `!`.
 */
export default async function LaunchPage() {
  const { supabase, tenantId } = await requireMemberPage("/uruchomienie");
  if (!tenantId) redirect(await localePath("/"));

  const signals = await fetchLaunchSignals(supabase, tenantId);

  return <LaunchHub signals={signals} />;
}
