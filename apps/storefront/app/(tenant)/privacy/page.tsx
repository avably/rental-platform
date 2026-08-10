/**
 * Alias angielski polityki prywatności (B4, decyzja właściciela: kanon polski + aliasy
 * EN). Przekierowanie 308, a nie druga kopia strony — dokument ma JEDEN adres
 * kanoniczny, inaczej wyszukiwarka i klient widzą dwa różne regulaminy.
 */
import { permanentRedirect } from "next/navigation";

import { LEGAL_DOCUMENT_PATHS } from "@/lib/legal/published";

export const dynamic = "force-dynamic";

export default function TenantPrivacyAlias(): never {
  permanentRedirect(LEGAL_DOCUMENT_PATHS.privacy);
}
