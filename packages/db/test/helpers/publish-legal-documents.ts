import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Komplet OPUBLIKOWANYCH dokumentów prawnych najemcy (0063) — wprost
 * service_rolem: szkic + wiersz rejestru wersji + wskaźnik żywej wersji.
 *
 * Od 0086 (ADR-191) `app.public_checkout` odmawia najemcy bez opublikowanego
 * regulaminu I polityki prywatności, więc KAŻDY seed tenanta, który ma
 * cokolwiek sprzedać w testach, woła ten helper. Etykieta żywej wersji to
 * "v1" — suity deklarujące `p_terms_version: "v1"` przechodzą gałęzią (b)
 * (przypięcie wiersza), a deklarujące własną stałą (np. "1.0") gałęzią (d)
 * (zapis napisu bez przypięcia — dług integracji ADR-129).
 *
 * `sha256` jest atrapą poprawną kształtem — nadpisze go trigger stemplowy
 * `legal_document_versions_stamp` (wzorzec fabryki w seed-tenants.ts).
 * Przepływ publikacji PRZEZ RPC (`app.publish_legal_document`) bada
 * legal-documents.test.ts — ten helper go nie zastępuje, tylko omija tam,
 * gdzie przedmiotem testu jest co innego niż publikacja.
 */
export async function publishLegalDocuments(
  admin: SupabaseClient,
  tenantId: string,
  kinds: readonly ("terms" | "privacy")[] = ["terms", "privacy"],
): Promise<{ termsVersionId: string | null }> {
  let termsVersionId: string | null = null;
  for (const kind of kinds) {
    const title = kind === "terms" ? "Regulamin" : "Polityka prywatności";
    const body = `Treść (${kind}) opublikowana przez seed testowy.`;
    const { data: doc, error } = await admin
      .from("legal_documents")
      .insert({ tenant_id: tenantId, kind, title, body_draft: body, locale: "pl" })
      .select("id")
      .single();
    if (error || !doc) {
      throw new Error(`publishLegalDocuments(${kind}/szkic): ${error?.message}`);
    }
    const { data: version, error: versionError } = await admin
      .from("legal_document_versions")
      .insert({
        tenant_id: tenantId,
        document_id: doc.id,
        kind,
        version_no: 1,
        version_label: "v1",
        title,
        body,
        sha256: "0".repeat(64),
        locale: "pl",
        published_by: randomUUID(),
      })
      .select("id")
      .single();
    if (versionError || !version) {
      throw new Error(`publishLegalDocuments(${kind}/wersja): ${versionError?.message}`);
    }
    const { error: pointerError } = await admin
      .from("legal_documents")
      .update({ current_version_id: version.id })
      .eq("tenant_id", tenantId)
      .eq("id", doc.id);
    if (pointerError) {
      throw new Error(`publishLegalDocuments(${kind}/wskaźnik): ${pointerError.message}`);
    }
    if (kind === "terms") termsVersionId = version.id as string;
  }
  return { termsVersionId };
}
