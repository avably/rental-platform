"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase-server";

export interface AcceptPlatformTermsState {
  error?: string;
}

const inputSchema = z.object({ versionId: z.string().uuid() });

/**
 * Akceptacja regulaminu platformy z przesłony w layoucie `(panel)`
 * (0070, ADR-141, konta istniejące — context `terms_update`).
 *
 * Cienka warstwa nad `app.accept_platform_terms`: WSZYSTKIE bramki (żywy
 * owner, wersja opublikowana i nie starsza niż obowiązująca, idempotencja)
 * egzekwuje funkcja DEFINER w bazie — akcja tylko przekazuje wskazaną wersję
 * i odświeża layout, żeby przesłona zgasła w tym samym żądaniu.
 */
export async function acceptPlatformTermsAction(
  _prevState: AcceptPlatformTermsState,
  formData: FormData,
): Promise<AcceptPlatformTermsState> {
  const parsed = inputSchema.safeParse({ versionId: formData.get("versionId") });
  if (!parsed.success) {
    return { error: "Nieprawidłowe wskazanie wersji regulaminu — odśwież stronę." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.schema("app").rpc("accept_platform_terms", {
    p_version_id: parsed.data.versionId,
  });
  if (error) {
    // Komunikaty RAISE EXCEPTION z app.accept_platform_terms są po polsku
    // i bezpieczne do pokazania wprost (konwencja app.create_tenant).
    return { error: error.message };
  }

  // Bramka przesłony żyje w layoucie — odświeżamy CAŁE drzewo, żeby treść
  // wróciła bez nawigacji (gasimy przesłonę tak samo, jak ją zapaliliśmy:
  // renderem, nie redirectem — ADR-133).
  revalidatePath("/", "layout");
  return {};
}
