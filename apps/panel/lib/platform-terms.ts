/**
 * Regulamin platformy w panelu (0070, ADR-141) — dwie warstwy odczytu:
 *
 *   - `readCurrentPlatformTerms` — bieżąca OBOWIĄZUJĄCA wersja z
 *     `app.get_platform_terms` (SECURITY DEFINER; NULL = żadna wersja nie
 *     obowiązuje, czyli stan przed migracją-seedem z treścią od prawnika).
 *     Karmi checkbox onboardingu i bramkę przesłony.
 *   - `readPlatformTermsGate` — decyzja przesłony w layoucie `(panel)`:
 *     ŻYWY brak akceptacji bieżącej wersji przez organizację ownera.
 *
 * PRZESŁONA JEST TREŚCIĄ, NIE GUARDEM (wzorzec ADR-133: gasimy TREŚĆ, nie
 * trasę; zero redirectów = zero ryzyka pętli onboardingu). Guard
 * `requireMemberWithClient` zostaje nietknięty — akceptacja to zdarzenie
 * rzadkie (per wersja), a nie warunek każdego żądania. Dlatego odczyt jest
 * FAIL-SILENT jak `readTenantBillingState`: awaria transportu nie może
 * zgasić panelu wszystkim ownerom naraz; twardą bramką dowodu pozostaje
 * `app.create_tenant` / `app.accept_platform_terms` w bazie.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { AuthContext } from "./auth";

const currentTermsSchema = z.object({
  version_id: z.string().uuid(),
  version_no: z.number().int().min(0),
  version_label: z.string().min(1),
  title_pl: z.string().min(1),
  body_pl: z.string().min(1),
  title_en: z.string().min(1),
  body_en: z.string().min(1),
  sha256_pl: z.string().regex(/^[0-9a-f]{64}$/),
  sha256_en: z.string().regex(/^[0-9a-f]{64}$/),
  published_at: z.string().min(1),
  effective_from: z.string().min(1),
});

export type CurrentPlatformTerms = z.infer<typeof currentTermsSchema>;

/**
 * Bieżąca obowiązująca wersja regulaminu platformy albo null (fail-closed na
 * kształt: odpowiedź, której nie umiemy przeczytać, traktujemy jak brak
 * wersji — checkbox się nie renderuje, a prawdę i tak egzekwuje baza).
 */
export async function readCurrentPlatformTerms(
  supabase: SupabaseClient,
): Promise<CurrentPlatformTerms | null> {
  const { data, error } = await supabase.schema("app").rpc("get_platform_terms");
  if (error || data == null) return null;

  const parsed = currentTermsSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Dane przesłony akceptacji — obecne WYŁĄCZNIE, gdy przesłona ma się zapalić. */
export interface PlatformTermsGate {
  versionId: string;
  versionLabel: string;
  effectiveFrom: string;
}

/**
 * Czy layout `(panel)` ma przesłonić treść ekranem akceptacji regulaminu.
 *
 * Cztery warunki, każdy z osobna gasi przesłonę (fail-silent):
 *   1. sesja MA organizację (ctx.tenantId) — sesja bez organizacji idzie
 *      normalnie do /organizacja/nowa (regresja pętli onboardingu, ADR-133);
 *   2. claim roli mówi OWNER — personel jest przepuszczany bez pytania
 *      (akceptuje właściciel w imieniu organizacji, D4); zdegradowany owner
 *      z nieświeżym claimem przejdzie przez warunek 3 (patrz polityka SELECT
 *      w 0070 — odczyt członkowski, nie ownerowski);
 *   3. jakaś wersja regulaminu OBOWIĄZUJE (bez treści od prawnika NIC nie
 *      blokujemy — bramka (f) ADR-138 czeka na seed);
 *   4. organizacja NIE MA jeszcze dowodu akceptacji tej wersji (indeksowany
 *      lookup po unikacie (tenant_id, version_id) sesją użytkownika — RLS).
 */
export async function readPlatformTermsGate(
  supabase: SupabaseClient,
  ctx: AuthContext | null,
): Promise<PlatformTermsGate | null> {
  if (!ctx?.tenantId || ctx.role !== "owner") return null;

  const terms = await readCurrentPlatformTerms(supabase);
  if (!terms) return null;

  const { data, error } = await supabase
    .from("platform_terms_acceptances")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("version_id", terms.version_id)
    .limit(1);
  if (error) return null; // fail-silent: shell to informacja, nie guard
  if (data && data.length > 0) return null;

  return {
    versionId: terms.version_id,
    versionLabel: terms.version_label,
    effectiveFrom: terms.effective_from,
  };
}
