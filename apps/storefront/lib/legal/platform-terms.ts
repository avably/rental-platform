/**
 * Publiczny odczyt REGULAMINU PLATFORMY (0070, ADR-141) dla osi
 * marketingowej LP — lustro `lib/legal/published.ts` (dokumenty najemców),
 * ale bez tenanta: umowa jest jedna dla całej platformy.
 *
 * Jedyną drogą są funkcje `SECURITY DEFINER` `app.get_platform_terms` /
 * `app.get_platform_terms_version` — anonimowy odwiedzający nie ma i nie
 * może mieć grantów na `platform_terms_versions`. Funkcje oddają WYŁĄCZNIE
 * wersje opublikowane (effective_from NOT NULL); SZKIC (placeholder v0
 * z seedu 0070) nie występuje w żadnym z tych zapytań, więc nie ma go jak
 * wyprowadzić.
 *
 * FAIL-CLOSED: błąd transportu, brak wiersza i kształt, którego nie umiemy
 * przeczytać, są dla odwiedzającego tym samym — regulaminu nie ma, strona
 * odpowiada 404. Dokładnie ten stan obowiązuje do migracji-seedu z treścią
 * od prawnika.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase-server";

const platformTermsSchema = z.object({
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

const platformTermsVersionSchema = platformTermsSchema.extend({
  current: z.boolean(),
});

export type PlatformTermsDocument = z.infer<typeof platformTermsSchema>;
export type PlatformTermsVersionDocument = z.infer<typeof platformTermsVersionSchema>;

async function client(injected?: SupabaseClient): Promise<SupabaseClient> {
  return injected ?? (await createSupabaseServerClient());
}

/** ŻYWA (obowiązująca) wersja regulaminu platformy albo null (fail-closed). */
export async function getPlatformTerms(
  injected?: SupabaseClient,
): Promise<PlatformTermsDocument | null> {
  const supabase = await client(injected);
  const { data, error } = await supabase.schema("app").rpc("get_platform_terms");

  if (error || data == null) return null;

  const parsed = platformTermsSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * Konkretna wersja regulaminu platformy (permalink `/terms/w/<n>`). Numer
 * wersji, nie uuid — adres ma dać się przepisać. Numer spoza zakresu liczb
 * naturalnych i szkic dają jednakowo null.
 */
export async function getPlatformTermsVersion(
  versionNo: number,
  injected?: SupabaseClient,
): Promise<PlatformTermsVersionDocument | null> {
  if (!Number.isInteger(versionNo) || versionNo < 1) return null;

  const supabase = await client(injected);
  const { data, error } = await supabase
    .schema("app")
    .rpc("get_platform_terms_version", { p_version_no: versionNo });

  if (error || data == null) return null;

  const parsed = platformTermsVersionSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Treść we wskazanym języku strony; PL pozostaje wersją wiążącą (§15 ust. 3). */
export function platformTermsLocalized(
  document: PlatformTermsDocument,
  locale: string,
): { title: string; body: string; sha256: string } {
  if (locale === "en") {
    return { title: document.title_en, body: document.body_en, sha256: document.sha256_en };
  }
  return { title: document.title_pl, body: document.body_pl, sha256: document.sha256_pl };
}
