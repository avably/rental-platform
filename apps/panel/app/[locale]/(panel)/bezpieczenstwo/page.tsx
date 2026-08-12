import { redirect } from "next/navigation";

import { FormMeasure } from "@/components/screens/form-measure";
import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { safeNextPath } from "@/lib/validation";

import { TotpEnrollForm } from "./form";
import { ChangePasswordForm, SignOutOtherDevicesForm } from "./password-form";

/**
 * Bezpieczeństwo konta: 2FA, zmiana hasła i odcięcie pozostałych urządzeń.
 *
 * Tu kieruje `requireSuperadminPage` superadmina bez żadnego czynnika
 * (`mfa_enrollment_required`), więc ekran musi umieć oddać go tam, dokąd
 * szedł — `next` przenosimy do formularza, sanityzowany tą samą funkcją co
 * wszędzie w panelu (wyłącznie ścieżki wewnętrzne).
 *
 * BRAMKA ZOSTAJE NA `getAuthContext` — świadomie, nie przez przeoczenie.
 * Trasa jest na liście `CLOSING_NAV_HREFS` (Zasada 8, ADR-138): podniesienie
 * jej do `requireMember` odebrałoby zawieszonemu najemcy możliwość zmiany
 * hasła, czyli zamknęłoby drogę wyjścia komuś, kto akurat jej najbardziej
 * potrzebuje. Bezpieczeństwo konta nie jest funkcją statusu rozliczeniowego
 * organizacji, a izolacją danych i tak rządzi tu wyłącznie GoTrue: obie
 * operacje dotyczą KONTA wołającego i nie czytają ani nie zapisują niczego
 * w naszej bazie.
 *
 * `force-dynamic` (ADR-083): layout locale ma `generateStaticParams`, a ekran
 * jest interaktywny (trzy formularze na `useActionState`). Bez pinu trasa
 * mogłaby pójść w statyczny prerender, a CSP panelu (nonce per żądanie +
 * `strict-dynamic`) odmówiłaby wykonania skryptów wypieczonych z nonce'em
 * z czasu builda — strona wyrenderowałaby się poprawnie i NIE zhydratowała,
 * bez jednego błędu w konsoli.
 */
export const dynamic = "force-dynamic";

export default async function SecurityPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const { next } = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login"));

  return (
    <FormMeasure className="flex flex-col gap-4">
      <TotpEnrollForm next={safeNextPath(next) ?? undefined} />
      <ChangePasswordForm />
      <SignOutOtherDevicesForm />
    </FormMeasure>
  );
}
