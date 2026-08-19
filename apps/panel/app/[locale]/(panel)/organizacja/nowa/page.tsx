import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenSection } from "@/components/screens/screen-header";
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
    /*
      KARTA PANELU (uwaga właściciela 2026-08-19): formularz stał gołym
      blokiem na tle strony — jedyny taki ekran, bo wszystkie późniejsze
      używają białej karty (`ScreenSection`). Onboarding jest PIERWSZYM
      ekranem produktu, więc ma wyglądać jak jego natywny element, nie jak
      wyjątek. Szerokość niesie wspólna miara formularza (P8,
      `--form-line-measure`) — własne `max-w-*` zapala skan spójności
      (ADR-060) — a `mx-auto` centruje kartę w kolumnie treści.

      NAGŁÓWEK ekranu („Utwórz nową organizację") stoi W KARCIE jako tytuł
      sekcji; belka shella (jedyny `h1`, ADR-060) mówi krótkie „Nowa
      organizacja" z nawigacji — konspekt h1 → h2 bez duplikatu treści.
      Literały ekranu w i18n od ADR-153.
    */
    <FormMeasure className="mx-auto">
      <ScreenSection title={t("title")} description={t("intro")}>
        <CreateTenantForm
          terms={terms ? { versionId: terms.version_id, versionLabel: terms.version_label } : null}
        />
      </ScreenSection>
    </FormMeasure>
  );
}
