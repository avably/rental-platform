"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { localePath } from "@/lib/navigation";
import { readMyOrganizations } from "@/lib/organizations";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export interface SwitchOrganizationState {
  error?: string;
}

/**
 * Przełącznik aktywnej organizacji (L7, ADR-224).
 *
 * Bramka członkostwa NIE siedzi tutaj, tylko w `app.set_active_tenant`
 * (SECURITY DEFINER, 0092): preferencja zmieni się WYŁĄCZNIE, gdy wołający ma
 * żywe członkostwo w docelowej org (odczyt `public.members` po `auth.uid()`);
 * inaczej P0015 i preferencja zostaje nietknięta. Nigdy nie ufamy samemu
 * `tenantId` z formularza — to druga bramka tej samej osi izolacji co JOIN
 * w hooku.
 *
 * Sam zapis preferencji NIE zmienia claimu `tenant_id` — hook przelicza go
 * dopiero przy WYSTAWIENIU tokenu. Dlatego po sukcesie wymuszamy
 * `refreshSession()` (jak `createTenantAction` po `create_tenant`), a potem
 * lądujemy na pulpicie NOWEJ org: bieżąca trasa mogła być szczegółem zasobu
 * poprzedniego tenanta, którego nowy claim już nie widzi.
 */
export async function switchOrganizationAction(
  _prevState: SwitchOrganizationState,
  formData: FormData,
): Promise<SwitchOrganizationState> {
  const t = await getTranslations("orgSwitcher");

  const targetTenantId = formData.get("tenantId");
  if (typeof targetTenantId !== "string" || targetTenantId.length === 0) {
    return { error: t("switchError") };
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(await localePath("/login"));
  }

  // CZYTELNA ODMOWA (brief: „nie 'coś poszło nie tak'"). Pre-check przez
  // members-gated RPC `my_organizations` daje DETERMINISTYCZNY komunikat dla
  // org nieczłonkowskiej, niezależnie od tego, jak PostgREST ubierze wyjątek
  // 42501 z bazy. Twardą bramką pozostaje `set_active_tenant` (odmawia u
  // źródła) — to jest defense in depth, nie zaufanie do samego inputu.
  const organizations = await readMyOrganizations(supabase);
  if (!organizations.some((org) => org.tenantId === targetTenantId)) {
    return { error: t("switchDenied") };
  }

  const { error } = await supabase
    .schema("app")
    .rpc("set_active_tenant", { p_tenant_id: targetTenantId });

  if (error) {
    // Doszło tu mimo pre-checku (np. członkostwo cofnięte w międzyczasie albo
    // awaria infrastruktury) — surowa treść dostawcy do logu, na ekran zdanie
    // ogólne (ADR-153: wnętrzności Postgresa nie trafiają do interfejsu).
    console.error(
      "[organizacja:przelacz] set_active_tenant",
      JSON.stringify({ code: error.code ?? null, message: error.message ?? null }),
    );
    return { error: t("switchError") };
  }

  await supabase.auth.refreshSession();

  redirect(await localePath("/"));
}
