"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { acceptInvitationSchema } from "@/lib/validation";

export interface AcceptInvitationState {
  error?: string;
}

/**
 * Akceptacja zaproszenia (ADR-190; komunikaty odmowy: ADR-193).
 *
 * ODMOWY `app.accept_invitation` (P0003–P0007: nieistniejące / zużyte /
 * wygasłe / odwołane / inny adres) NIE dojeżdżają do klienta: stack zwraca
 * dla nich gołe HTTP 500 z ciałem dosłownie `Something went wrong` — bez
 * JSON-a, bez kodu, bez treści RAISE (sonda na żywym stacku 2026-08-18;
 * to samo dokumentują nagłówki migracji 0007/0011/0051). Do tej naprawy ten
 * surowy tekst szedł 1:1 na ekran zapraszanego.
 *
 * Zamiast niego wraca PRZETŁUMACZONY, ludzki komunikat (`invitationAccept.*`,
 * PL/EN wg locale trasy), który nazywa możliwe powody i mówi, co zrobić
 * (nowy link od właściciela; logowanie adresem, na który przyszło
 * zaproszenie). Świadomie JEDEN komunikat dla wszystkich odmów — rozbicie na
 * stany (zużyte/wygasłe/odwołane/nieistniejące) wymaga ODCZYTU wiersza
 * zaproszenia, a tego sesja zapraszanego nie ma prawa zrobić: polityka
 * `tenant_select` na `invitations` (0001/0060) widzi wiersz wyłącznie
 * członkom tenanta, klient service-role jest w ścieżkach żądań zakazany
 * (kwarantanna ADR-099: ESLint + scripts/audit-service-role.sh), a zmiany
 * SQL są poza zakresem zadania. Klasyfikacja per-stan czeka na rozstrzygnięcie
 * PM (czytelny RPC stanu albo poświadczony wyjątek kwarantanny) — patrz
 * ADR-193.
 *
 * ZERO `console.*` na całej ścieżce (ADR-190): token nie ma prawa trafić do
 * żadnego dziennika; komunikaty są STAŁYMI tłumaczeń i nie niosą ani tokenu,
 * ani adresów e-mail.
 */
export async function acceptInvitationAction(
  _prevState: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  const t = await getTranslations("invitationAccept");

  const parsed = acceptInvitationSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) {
    // Token przychodzi z ukrytego pola formularza — zniekształcony oznacza
    // uszkodzony link, nie błąd wypełniania; komunikat mówi dokładnie to.
    return { error: t("invalidLink") };
  }

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) {
    redirect(await localePath("/login", { next: `/zaproszenie/${parsed.data.token}` }));
  }

  const { error } = await supabase.schema("app").rpc("accept_invitation", {
    p_token: parsed.data.token,
  });
  if (error) {
    return { error: t("denied") };
  }

  // Jak przy create_tenant: JWT bieżącej sesji nie ma jeszcze świeżego
  // claimu tenant_id/role, więc wymuszamy nowy token przed przekierowaniem.
  await supabase.auth.refreshSession();

  redirect(await localePath("/"));
}
