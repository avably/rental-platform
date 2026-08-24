"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { registerDomainSafely, tenantSubdomainHost } from "@avably/core";

import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { readCurrentPlatformTerms } from "@/lib/platform-terms";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createTenantSchema, platformTermsFieldsSchema } from "@/lib/validation";

export interface CreateTenantState {
  error?: string;
}

/**
 * Kody błędów `app.create_tenant`, których treść jest NASZA — pisana po
 * polsku, pod wyświetlenie (patrz RAISE EXCEPTION w 0070/0066/0023):
 *   P0001 — adres e-mail niezweryfikowany,
 *   P0002 — limit 2 organizacji na użytkownika,
 *   P0003 — brak akceptacji obowiązującego regulaminu,
 *   22023 — slug zarezerwowany, wersja regulaminu inna niż obowiązująca, ZŁA
 *           SUMA KONTROLNA NIP albo NIP BEZ DOWODU WERYFIKACJI w
 *           app.nip_lookup_cache (0098, ADR-234) — świadomie ta sama klasa
 *           co reszta walidacji tej funkcji, nie osobny kod (patrz komentarz
 *           w migracji 0098_create_tenant_nip.sql: PostgREST maskuje custom
 *           SQLSTATE spoza P0001 jako 500 bez treści).
 * Te idą na ekran wprost. Wszystko poza tą listą to komunikat DOSTAWCY —
 * i tam była dziura N5a: kolizja sluga (23505) wracała surowym angielskim
 * „duplicate key value violates unique constraint …", jako jedyne miejsce
 * w panelu pokazujące człowiekowi wnętrzności Postgresa.
 */
const TENANT_ERROR_CODES_WITH_OWN_MESSAGE: readonly string[] = [
  "P0001",
  "P0002",
  "P0003",
  "22023",
];

/** Unikat naruszony — w tej transakcji realnie oznacza zajęty adres sklepu. */
const UNIQUE_VIOLATION = "23505";

/**
 * Komunikat dla błędu RPC zakładania organizacji (ADR-153, N5a).
 *
 * Wołane PO stronie serwera, więc surowa treść dostawcy ląduje w logu
 * (jedyne miejsce, gdzie wolno jej istnieć — ta sama zasada co ADR-051),
 * a na ekran idzie zdanie po polsku, mówiące co zrobić.
 */
async function createTenantErrorMessage(error: {
  code?: string | null;
  message?: string | null;
}): Promise<string> {
  const code = typeof error.code === "string" ? error.code : null;

  if (code && TENANT_ERROR_CODES_WITH_OWN_MESSAGE.includes(code)) {
    return error.message ?? "";
  }

  const t = await getTranslations("newOrganization");
  if (code === UNIQUE_VIOLATION) {
    return t("errorSlugTaken");
  }

  console.error(
    "[organizacja:nowa] nieznany błąd create_tenant",
    JSON.stringify({ code, message: error.message ?? null }),
  );
  return t("errorGeneric");
}

export async function createTenantAction(
  _prevState: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const parsed = createTenantSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    nip: formData.get("nip"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  const termsFields = platformTermsFieldsSchema.safeParse({
    termsAccepted: formData.get("termsAccepted"),
    termsVersionId: formData.get("termsVersionId"),
  });
  if (!termsFields.success) {
    return { error: "Nieprawidłowe wskazanie wersji regulaminu - odśwież stronę." };
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

  // ADR-234: p_nip idzie ZAWSZE — schemat wymaga go od momentu, w którym NIP
  // stał się wymaganym krokiem onboardingu. `app.create_tenant` (0098)
  // odrzuci go, jeśli suma kontrolna jest zła ALBO brak dowodu weryfikacji
  // w app.nip_lookup_cache (czyli user nie kliknął „Pobierz dane" — albo
  // zmienił NIP PO kliknięciu, patrz form.tsx: pole resetuje stan weryfikacji
  // przy każdej zmianie). Legal_name/regon NIE są przesyłane — RPC bierze je
  // WYŁĄCZNIE z cache'a, klient nie ma jak ich wstrzyknąć.
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
          p_nip: parsed.data.nip,
        }
      : { p_slug: parsed.data.slug, p_name: parsed.data.name, p_nip: parsed.data.nip },
  );
  if (error) {
    // NIE „error.message wprost" (stan sprzed ADR-153): wprost idą wyłącznie
    // komunikaty RAISE EXCEPTION z app.create_tenant, które są nasze i po
    // polsku. Reszta — w szczególności kolizja sluga (23505) — jest treścią
    // dostawcy i na ekran nie trafia.
    return { error: await createTenantErrorMessage(error) };
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

  // POTWIERDZENIE ZAMIAST NAGIEGO PRZEKIEROWANIA (ADR-153, N5c). W tej
  // sekundzie dzieją się DWIE najmocniejsze obietnice produktu — rusza
  // 14-dniowy okres próbny i rejestruje się publiczny adres sklepu — a do tej
  // naprawy obie spełniały się wyłącznie w bazie: człowiek lądował na pulpicie
  // i o żadnej się nie dowiadywał.
  redirect(await localePath("/organizacja/nowa/gotowe"));
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
