import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenBackLink } from "@/components/screens/screen-header";
import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import { ChangePasswordForm } from "../password-form";

/**
 * Podstrona zmiany hasła (uwaga właściciela: „to jest do schowania pod link").
 *
 * Formularz zmiany hasła zszedł z głównego ekranu `/bezpieczenstwo` tutaj —
 * główny ekran ma być czytelny (konto + 2FA), a zmiana hasła dostępna spod
 * linku. Sam formularz i jego akcja (`changePasswordAction`) są NIETKNIĘTE:
 * cała bramka reauth ze znajomości hasła (ADR-122/144) zostaje tam, gdzie była.
 *
 * Bramka i dostęp jak na ekranie nadrzędnym — świadomie `getAuthContext`, a nie
 * `requireMember`: trasa jest na liście `CLOSING_NAV_HREFS` (ADR-138) i najemca
 * w oknie domykania MUSI móc zmienić hasło; izolacją rządzi tu wyłącznie GoTrue
 * (operacja dotyczy KONTA wołającego). `force-dynamic` z tego samego powodu co
 * ekran nadrzędny (interaktywny formularz + nonce CSP `strict-dynamic`, ADR-083).
 */
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login"));

  const t = await getTranslations("security");

  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenBackLink href="/bezpieczenstwo" label={`← ${t("backToSecurity")}`} />
      <ChangePasswordForm />
    </FormMeasure>
  );
}
