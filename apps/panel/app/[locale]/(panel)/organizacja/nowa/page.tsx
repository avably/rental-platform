import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { readCurrentPlatformTerms } from "@/lib/platform-terms";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import { CreateTenantForm } from "./form";

/**
 * Onboarding organizacji — ekran WYŁĄCZNIE dla sesji BEZ organizacji
 * (C1 UI-only, UX1/ADR-140).
 *
 * Sesja, która JUŻ MA organizację, jest odsyłana na `/` — lustrzanie do
 * guardu logowania (login/actions.ts): sesja bez tenanta idzie TUTAJ, sesja
 * z tenantem NA PULPIT. Powód: hook tokenów wybiera najstarsze członkostwo,
 * więc druga organizacja byłaby po utworzeniu NIEOSIĄGALNA (przełącznika nie
 * ma w UI ani w schemacie — audyt IA-4); ekran zapraszający do jej założenia
 * to pułapka, nie funkcja. C2/C3 (wybór organizacji / przełącznik) dopiero
 * przy realnym popycie.
 *
 * REGULAMIN PLATFORMY (0070, ADR-141): serwer rozwiązuje bieżącą
 * OBOWIĄZUJĄCĄ wersję i podaje ją formularzowi — checkbox renderuje się
 * WYŁĄCZNIE, gdy jakaś wersja faktycznie obowiązuje (D2: umowa zawiera się
 * przy zakładaniu organizacji; przed treścią od prawnika formularz wygląda
 * i działa jak dotychczas). Twarde wymuszenie i tak siedzi w
 * `app.create_tenant` (D5) — ten ekran tylko zbiera świadomy klik.
 */
export default async function NewTenantPage() {
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login"));
  if (ctx.tenantId) redirect(await localePath("/"));

  const terms = await readCurrentPlatformTerms(supabase);
  const t = await getTranslations("newOrganization");

  return (
    <div className="flex flex-col justify-center gap-4">
      {/* Literał polski przeniesiony do i18n razem z resztą ekranu (ADR-153):
          onboarding jest pierwszym ekranem produktu, a był jedynym miejscem
          tej ścieżki, które nie mówiło po angielsku. */}
      <p className="text-muted-foreground text-sm">{t("intro")}</p>
      <CreateTenantForm
        terms={terms ? { versionId: terms.version_id, versionLabel: terms.version_label } : null}
      />
    </div>
  );
}
