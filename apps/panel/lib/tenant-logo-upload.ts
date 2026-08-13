/**
 * Orkiestracja podpisanego uploadu LOGO najemcy (ADR-160) — czysta, testowalna
 * z wstrzykiwanymi zależnościami.
 *
 * NIE JEST to drugi mechanizm wgrywania: bilet, podpis, bramka Storage
 * i domknięcie to ta sama droga, co przy zdjęciu sekcji (0043). Domknięcie
 * (`finalizeSiteImageUpload`) jest wręcz TĄ SAMĄ funkcją — z ostrzejszym
 * sufitem. Osobne jest wyłącznie WYSTAWIENIE biletu, bo bilet logo nie ma
 * strony-rodzica, a ścieżkę liczy z tenanta wołającego, nie z argumentu.
 */
import { MAX_SITE_LOGO_BYTES } from "@avably/core/site";

import { checkTenantLogoMetadata, type TenantLogoMime } from "@/lib/tenant-logo";
import type { PrepareSiteImageUploadResult } from "@/lib/site-image-upload";

export interface PrepareTenantLogoUploadDependencies {
  issue: (input: {
    mime: TenantLogoMime;
    size: number;
  }) => Promise<{ uploadId: string; storagePath: string }>;
  sign: (path: string) => Promise<{ token: string }>;
}

export { MAX_SITE_LOGO_BYTES };

/** Wynik czasowników znaku (zapis szkicu, publikacja, zdjęcie znaku). */
export type TenantLogoActionResult = { ok: true } | { ok: false; error: string };

export async function prepareTenantLogoUpload(
  input: { mime: string; size: number },
  deps: PrepareTenantLogoUploadDependencies,
): Promise<PrepareSiteImageUploadResult> {
  const problem = checkTenantLogoMetadata({ size: input.size, type: input.mime });
  if (problem) return { ok: false, error: problem };

  let intent: { uploadId: string; storagePath: string };
  try {
    intent = await deps.issue({ mime: input.mime as TenantLogoMime, size: input.size });
  } catch {
    return { ok: false, error: "denied" };
  }

  try {
    const signed = await deps.sign(intent.storagePath);
    return {
      ok: true,
      upload: { uploadId: intent.uploadId, path: intent.storagePath, token: signed.token },
    };
  } catch {
    return { ok: false, error: "sign" };
  }
}
