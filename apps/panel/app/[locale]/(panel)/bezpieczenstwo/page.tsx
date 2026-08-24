import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenSection } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { safeNextPath } from "@/lib/validation";

import { TotpEnrollForm } from "./form";
import { SignOutOtherDevicesForm } from "./password-form";

/**
 * Konto i bezpieczeństwo: ustawienia konta (e-mail, zmiana hasła), 2FA,
 * odcięcie pozostałych urządzeń i wejście do usunięcia konta.
 *
 * Uwagi właściciela (przegląd z żywego ekranu): (1) „zmiana hasła jest do
 * schowania pod link", (2) „powinny tu być ustawienia konta — usuwanie konta
 * itd., tutaj nie ma nic". Stąd zmiana hasła NIE STOI już inline: przeniosła
 * się na podstronę `/bezpieczenstwo/haslo` (link z karty „Konto"), a główny
 * ekran zyskał kartę konta (e-mail do wglądu) i strefę krytyczną z wejściem do
 * `/bezpieczenstwo/usun-konto`. 2FA i „inne urządzenia" zostają na miejscu —
 * to kontrolki bezpieczeństwa, nie zaśmiecenie ekranu.
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

  const t = await getTranslations("security");

  return (
    <FormMeasure className="flex flex-col gap-4">
      {/* Karta „Konto": e-mail do wglądu i WEJŚCIE do zmiany hasła (uwaga 1 —
          formularz zmiany hasła schowany pod link, na podstronie `/haslo`). */}
      <ScreenSection data-account-section title={t("accountTitle")} description={t("accountBody")}>
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground text-[13px] leading-[18px]">
            {t("accountEmailLabel")}
          </span>
          <span data-account-email className="font-medium break-all">
            {ctx.user.email ?? "—"}
          </span>
        </div>
        <Link
          href="/bezpieczenstwo/haslo"
          className="w-fit text-sm font-medium underline underline-offset-[3px]"
        >
          {t("changePasswordLink")}
        </Link>
      </ScreenSection>

      <TotpEnrollForm next={safeNextPath(next) ?? undefined} />
      <SignOutOtherDevicesForm />

      {/* Strefa krytyczna (uwaga 2 — „usuwanie konta itd."). Wejście, nie akcja:
          ostrzeżenie, potwierdzenie i bramka jedynego właściciela żyją na
          podstronie `/usun-konto`. Kasowania NIE robimy cichcem — brak
          bezpiecznego backendu erasure jest zaraportowany jako osobne,
          bramkowane zadanie. */}
      <ScreenSection
        data-account-delete-entry
        title={t("deleteTitle")}
        description={t("deleteBody")}
      >
        <Link
          href="/bezpieczenstwo/usun-konto"
          className="text-destructive w-fit text-sm font-medium underline underline-offset-[3px]"
        >
          {t("deleteLink")}
        </Link>
      </ScreenSection>
    </FormMeasure>
  );
}
