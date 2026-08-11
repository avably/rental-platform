"use server";

import { redirect } from "next/navigation";

import { registerDomainSafely, tenantSubdomainHost } from "@avably/core";

import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { readCurrentPlatformTerms } from "@/lib/platform-terms";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createTenantSchema, platformTermsFieldsSchema } from "@/lib/validation";

export interface CreateTenantState {
  error?: string;
}

export async function createTenantAction(
  _prevState: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const parsed = createTenantSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  const termsFields = platformTermsFieldsSchema.safeParse({
    termsAccepted: formData.get("termsAccepted"),
    termsVersionId: formData.get("termsVersionId"),
  });
  if (!termsFields.success) {
    return { error: "Nieprawidłowe wskazanie wersji regulaminu — odśwież stronę." };
  }

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) {
    redirect(await localePath("/login"));
  }

  // WALIDACJA SERWEROWA AKCEPTACJI (0070, ADR-141). Gdy jakakolwiek wersja
  // OBOWIĄZUJE, żądanie bez zaznaczonego checkboxa i wskazanej wersji kończy
  // się TUTAJ — bez wywołania RPC (atrybut `required` w przeglądarce to
  // uprzejmość, nie bramka). Twarde wymuszenie i tak stoi w app.create_tenant
  // (D5): payload z wersją inną niż obowiązująca odbije się od bazy.
  const currentTerms = await readCurrentPlatformTerms(supabase);
  if (currentTerms && (!termsFields.data.termsAccepted || !termsFields.data.termsVersionId)) {
    return { error: "Do założenia organizacji wymagana jest akceptacja regulaminu." };
  }

  const { error } = await supabase.schema("app").rpc(
    "create_tenant",
    currentTerms && termsFields.data.termsVersionId
      ? {
          p_slug: parsed.data.slug,
          p_name: parsed.data.name,
          // Wersja, którą użytkownik WIDZIAŁ (ukryte pole formularza) — nie
          // „aktualna w chwili submitu": jeśli między renderem a submitem
          // weszła nowa wersja, baza odmówi 22023 i user przeczyta nową.
          p_terms_version_id: termsFields.data.termsVersionId,
        }
      : { p_slug: parsed.data.slug, p_name: parsed.data.name },
  );
  if (error) {
    // Komunikaty RAISE EXCEPTION z app.create_tenant (0003_auth.sql) są już
    // po polsku i bezpieczne do pokazania userowi wprost.
    return { error: error.message };
  }

  // JWT bieżącej sesji nie ma jeszcze świeżego claimu tenant_id (hook
  // wstrzykuje go dopiero przy WYSTAWIENIU tokenu) — wymuszamy nowy token.
  // Musi się to stać PRZED zapisem stanu domeny niżej: RLS domains wymaga
  // `tenant_id = app.tenant_id()`, a bez odświeżenia claim jest pusty.
  await supabase.auth.refreshSession();

  // AUTOMATYCZNA SUBDOMENA (Zadanie 2.6, ADR-046). Sam WIERSZ w public.domains
  // powstał już w TEJ SAMEJ transakcji co tenant (app.create_tenant, 0022) —
  // niezmiennik „tenant istnieje ⇒ ma host" nie zależy od niczego poniżej.
  // Tu zostaje wyłącznie rejestracja hosta U DOSTAWCY i jest ona BEST-EFFORT:
  // `registerDomainSafely` NIE RZUCA NIGDY (ADR-033/036), więc awaria cudzego
  // API nie może wywrócić zakładania organizacji. Porażka nie znika po cichu —
  // ląduje w `domains.last_error` i na ekranie ustawień domeny, z przyciskiem
  // ponowienia.
  await registerSubdomainBestEffort(supabase, parsed.data.slug);

  redirect(await localePath("/"));
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Rejestracja subdomeny u dostawcy + zapis jej wyniku. Niewywracalna z
 * założenia: ani odmowa dostawcy, ani nieudany zapis stanu nie przerywają
 * onboardingu. Zapis stanu jest ODTWARZALNY — ekran domen czyta stan u
 * dostawcy i pozwala ponowić, więc jego porażka kosztuje jedno kliknięcie,
 * podczas gdy wyjątek kosztowałby założoną organizację.
 */
async function registerSubdomainBestEffort(supabase: ServerClient, slug: string): Promise<void> {
  const host = tenantSubdomainHost(slug);
  const result = await registerDomainSafely(host);

  await supabase
    .from("domains")
    .update({ provider_domain_id: result.providerDomainId, last_error: result.error })
    .eq("domain", host);
}
