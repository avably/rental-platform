"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getAuthContext } from "@/lib/auth";
import { INVITATION_STATE_MESSAGE_KEY, readInvitationState } from "@/lib/invitation-state";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { acceptInvitationSchema } from "@/lib/validation";

export interface AcceptInvitationState {
  error?: string;
}

/**
 * Akceptacja zaproszenia (ADR-190; komunikaty odmowy: ADR-193 → ADR-196).
 *
 * ODMOWY `app.accept_invitation` (P0003–P0007: nieistniejące / zużyte /
 * wygasłe / odwołane / inny adres) NIE dojeżdżają do klienta: stack zwraca
 * dla nich gołe HTTP 500 z ciałem dosłownie `Something went wrong` — bez
 * JSON-a, bez kodu, bez treści RAISE (sonda na żywym stacku 2026-08-18;
 * to samo dokumentują nagłówki migracji 0007/0011/0051). ADR-193 dała w to
 * miejsce ludzki, ale JEDEN komunikat dla wszystkich odmów.
 *
 * Od ADR-196 stan klasyfikujemy PO ODCZYCIE: po odmowie akceptu akcja pyta
 * `app.invitation_state(p_token)` (migracja 0087 — SECURITY DEFINER,
 * token = uprawnienie, zero danych ponad etykietę z zamkniętego zbioru)
 * i mapuje stan na PRZETŁUMACZONY komunikat per stan (`invitationAccept.state*`,
 * PL/EN wg locale trasy): „wygasło" i „wystawione na inny adres" to dwie
 * różne instrukcje dla człowieka. FAIL-CLOSED: etykieta spoza zbioru albo
 * błąd odczytu → dzisiejszy ogólny `denied`. Kwarantanna ADR-099 nietknięta:
 * odczyt idzie sesją zapraszanego (authenticated), zero service_role.
 *
 * ZERO `console.*` na całej ścieżce (ADR-190): token nie ma prawa trafić do
 * żadnego dziennika; komunikaty są STAŁYMI tłumaczeń i nie niosą ani tokenu,
 * ani adresów e-mail (ADR-181: odmowa nie jest nośnikiem danych).
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
    // Klasyfikacja PO ODCZYCIE (ADR-196): dopiero po odmowie akceptu — na
    // ścieżce sukcesu zero dodatkowych podróży. Stan `open` przy odmowie
    // znaczy „akcept padł z powodu przejściowego" → komunikat „spróbuj
    // ponownie", nie zgadywanie powodu.
    const state = await readInvitationState(supabase, parsed.data.token);
    return { error: state ? t(INVITATION_STATE_MESSAGE_KEY[state]) : t("denied") };
  }

  // Jak przy create_tenant: JWT bieżącej sesji nie ma jeszcze świeżego
  // claimu tenant_id/role, więc wymuszamy nowy token przed przekierowaniem.
  await supabase.auth.refreshSession();

  redirect(await localePath("/"));
}
