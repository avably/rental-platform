"use server";

/**
 * Akcje ekranu dokumentów prawnych (B4, ADR-129).
 *
 * Dwie czynności, dwa różne kształty — bo to dwie różne operacje:
 *   • ZAPIS SZKICU idzie formularzem (`useActionState`), więc zwraca
 *     `FormState` z błędami przy polach;
 *   • PUBLIKACJA jest czasownikiem bez formularza (dialog potwierdzenia),
 *     więc zwraca wynik z etykietą wersji — ekran musi umieć powiedzieć,
 *     KTÓRA wersja właśnie powstała, i że czasem nie powstała żadna.
 *
 * BEZPIECZEŃSTWO: bramką jest RLS 0063 (zapis wyłącznie właściciel) i jawna
 * bramka właściciela w `app.publish_legal_document`. Ten moduł odmowy
 * TŁUMACZY, nie ustanawia — schowanie przycisku w interfejsie nie jest
 * autoryzacją i nie zastępuje odmowy z bazy.
 *
 * NIE LOGUJEMY TREŚCI DOKUMENTÓW. To tekst najemcy przeznaczony na publiczną
 * stronę sklepu, ale zanim go opublikuje, jest jego roboczą własnością —
 * a `console.log` w akcji serwerowej trafia do logów platformy.
 */
import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { CONTRACT_DOCUMENT_SETTINGS_KEY } from "@/lib/contract-settings";
import { revalidateLaunchSignals } from "@/lib/onboarding/launch";
import type { FormState } from "@/lib/form-state";
import { zodErrorToState } from "@/lib/form-state";
import {
  LEGAL_DOCUMENT_MESSAGES,
  legalDocumentDraftInputFromFormData,
  legalDocumentDraftSchema,
  legalDocumentKindSchema,
  withMirroredTermsBody,
  type LegalPublishResult,
} from "@/lib/legal-documents";
import { requireMember } from "@/lib/supabase-server";

type MemberContext = Awaited<ReturnType<typeof requireMember>>;

/**
 * LUSTRO treści regulaminu do `tenant_settings.contract_document.terms_body`
 * (uzasadnienie kierunku: `lib/legal-documents.ts`).
 *
 * Zwraca `false` WYŁĄCZNIE wtedy, gdy lustro było możliwe i się nie udało.
 * Brak wiersza `contract_document` to nie awaria, tylko najemca, który nie
 * skonfigurował jeszcze umów — i wtedy wiersza NIE WOLNO zakładać: CHECK
 * z 0026 wymaga pięciu kluczy, a ten ekran zna jeden.
 */
async function mirrorTermsBodyToContractSettings(
  context: MemberContext,
  body: string,
): Promise<boolean> {
  const { data, error } = await context.supabase
    .from("tenant_settings")
    .select("value")
    .eq("tenant_id", context.tenantId)
    .eq("key", CONTRACT_DOCUMENT_SETTINGS_KEY)
    .maybeSingle();

  if (error) return false;

  const next = withMirroredTermsBody(data?.value, body);
  if (!next) return true;

  const { error: updateError } = await context.supabase
    .from("tenant_settings")
    .update({ value: next, updated_at: new Date().toISOString() })
    .eq("tenant_id", context.tenantId)
    .eq("key", CONTRACT_DOCUMENT_SETTINGS_KEY);

  if (updateError) return false;

  revalidatePath("/ustawienia-umow");
  return true;
}

export async function saveLegalDocumentDraftAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = legalDocumentDraftSchema.safeParse(
    legalDocumentDraftInputFromFormData(formData),
  );
  if (!parsed.success) return zodErrorToState(parsed.error);

  let context: MemberContext;
  try {
    context = await requireMember();
  } catch (error) {
    if (error instanceof AuthError) return { formError: error.message };
    throw error;
  }

  const { kind, title, body_draft, locale } = parsed.data;

  // `upsert` po (tenant_id, kind) — dokument jest jeden na rodzaj (unikat
  // 0063). Kolumny `current_version_id` NIE MA w payloadzie i to nie jest
  // przeoczenie: żywą wersję przestawia WYŁĄCZNIE publikacja, więc edycja
  // szkicu nie ma jak zmienić tego, co widzi klient.
  const { data, error } = await context.supabase
    .from("legal_documents")
    .upsert(
      {
        tenant_id: context.tenantId,
        kind,
        title,
        body_draft,
        locale,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,kind" },
    )
    .select("id");

  if (error) {
    if (error.code === "42501") return { formError: LEGAL_DOCUMENT_MESSAGES.ownerOnly };
    if (error.code === "23514") return { formError: LEGAL_DOCUMENT_MESSAGES.rejected };
    return { formError: error.message };
  }
  if (!data?.length) return { formError: LEGAL_DOCUMENT_MESSAGES.saveFailed };

  revalidatePath("/dokumenty-prawne");

  if (kind !== "terms") return { success: kind };

  // Awaria lustra NIE przewraca zapisu głównego: szkic jest już w bazie, a
  // udawanie porażki kazałoby operatorowi zapisywać go drugi raz.
  const mirrored = await mirrorTermsBodyToContractSettings(context, body_draft);
  return mirrored
    ? { success: kind }
    : { success: kind, notice: LEGAL_DOCUMENT_MESSAGES.mirrorFailed };
}

export async function publishLegalDocumentAction(kind: string): Promise<LegalPublishResult> {
  const parsed = legalDocumentKindSchema.safeParse(kind);
  if (!parsed.success) return { ok: false, error: LEGAL_DOCUMENT_MESSAGES.rejected };

  let context: MemberContext;
  try {
    context = await requireMember();
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }

  const { data, error } = await context.supabase
    .schema("app")
    .rpc("publish_legal_document", { p_kind: parsed.data });

  if (error) {
    // 42501 — odmowa właściciela (RLS albo jawna bramka w funkcji).
    if (error.code === "42501") return { ok: false, error: LEGAL_DOCUMENT_MESSAGES.ownerOnly };
    // 22023 — `legal_document_not_found`: nie ma czego publikować.
    if (error.code === "22023") return { ok: false, error: LEGAL_DOCUMENT_MESSAGES.notFound };
    return { ok: false, error: error.message };
  }

  const payload = data as { version_label?: unknown; created?: unknown } | null;
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: LEGAL_DOCUMENT_MESSAGES.publishFailed };
  }

  revalidatePath("/dokumenty-prawne");
  // Publikacja ustawia `current_version_id` — sygnał uruchomienia „legalia"
  // (bramka sprzedaży) mógł się właśnie zapalić; unieważnij cache huba TEGO
  // najemcy (ADR-261). Zapis SZKICU tego NIE robi (żywej wersji nie rusza),
  // więc `saveLegalDocumentDraftAction` świadomie nie inwaliduje.
  revalidateLaunchSignals(context.tenantId!);

  // `created:false` to POPRAWNY wynik, nie błąd: treść jest identyczna z żywą
  // wersją, więc rejestr nie dostał kolejnego wpisu o tej samej treści.
  return {
    ok: true,
    created: payload.created === true,
    versionLabel: typeof payload.version_label === "string" ? payload.version_label : "",
  };
}
