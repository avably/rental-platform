import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenBackLink, ScreenSection } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import { readAccountDeletionContext } from "./account-deletion";
import { requestAccountDeletionAction } from "./actions";
import { DeleteAccountForm } from "./delete-account-form";

/**
 * Podstrona usunięcia konta (uwaga właściciela: „usuwanie konta itd.").
 *
 * OSTROŻNIE — to NIE jest ekran, który kasuje. Usunięcie konta/organizacji to
 * nieodwracalna kaskada, a bezpiecznego backendu erasure dla własnego konta
 * operatora dziś NIE MA. Ekran: (1) ostrzega WPROST, co usunięcie oznacza,
 * (2) blokuje jedynego właściciela organizacji (jego konto trzyma dane tenanta
 * — nie osieroci ich jedno kliknięcie), (3) każdemu innemu daje flow „poproś
 * o usunięcie" z potwierdzeniem przez przepisanie adresu; żądanie ląduje w
 * metadanych konta, a właściwą kaskadę projektuje właściciel/PM osobno.
 *
 * Dostęp jak na ekranie nadrzędnym — `getAuthContext` (trasa w
 * `CLOSING_NAV_HREFS`), `force-dynamic` (interaktywny formularz + nonce CSP).
 */
export const dynamic = "force-dynamic";

export default async function DeleteAccountPage() {
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login"));

  const t = await getTranslations("security");
  const deletion = await readAccountDeletionContext(supabase, ctx);

  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenBackLink href="/bezpieczenstwo" label={`← ${t("backToSecurity")}`} />

      {/* Ostrzeżenie — jedyne miejsce, w którym operator dowiaduje się, co
          usunięcie obejmuje, a czego (obowiązki podatkowe) nie zdejmuje. */}
      <ScreenSection
        data-account-delete-intro
        title={t("deletePageTitle")}
        description={t("deletePageBody")}
      >
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("deletePageScope")}</p>
      </ScreenSection>

      {deletion.isSoleOwner ? (
        <ScreenSection
          data-account-delete-blocked
          title={t("deleteSoleOwnerTitle")}
          description={t("deleteSoleOwnerBlock")}
        >
          <Link
            href="/zaproszenia"
            className="w-fit text-sm font-medium underline underline-offset-[3px]"
          >
            {t("deleteSoleOwnerTransferLink")}
          </Link>
        </ScreenSection>
      ) : (
        <DeleteAccountForm email={deletion.email ?? ""} action={requestAccountDeletionAction} />
      )}
    </FormMeasure>
  );
}
