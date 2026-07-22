/**
 * Ustawienia płatności online (Z2, ADR-065).
 *
 * Ekran odpowiada na jedno pytanie najemcy: „czy mogę przyjmować płatności
 * w sklepie i czy dostanę te pieniądze". Odpowiedź składa się z DWÓCH
 * niezależnych faktów u dostawcy (przyjmowanie wpłat, wypłaty), bo konto
 * potrafi mieć pierwszy bez drugiego.
 *
 * ŻADNEGO ODCZYTU U DOSTAWCY PRZY RENDERZE. Karta pokazuje ostatnią MIGAWKĘ
 * z kolumn `payment_accounts` razem z datą jej powstania — a nie świeży stan
 * pobrany przy każdym wejściu. Powody są dwa i oba ważą: (1) render strony nie
 * może zależeć od dostępności cudzego API, bo awaria dostawcy wywracałaby
 * ekran ustawień; (2) odczyt na każde wejście to wywołanie sieciowe na każde
 * odświeżenie karty, bez informacji, której najemca w tej chwili potrzebuje.
 * Odczyt dzieje się tam, gdzie ma znaczenie: po powrocie z onboardingu,
 * po kliknięciu „odśwież stan" i — od Z3 — przed każdą próbą pobrania środków.
 *
 * Dostęp dla każdego członka (RLS 0028 daje odczyt całemu tenantowi); bramka
 * właściciela dotyczy podpięcia i odłączenia konta i siedzi w bazie.
 */
import { connectAccountStage, stripeAvailability } from "@avably/core";
import { getTranslations } from "next-intl/server";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenBackLink } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import { PaymentsPanel, type PaymentAccountView } from "./payments-panel";
import { PAYMENT_SETTINGS_PATH } from "./payments-config";

export default async function PaymentSettingsPage() {
  const ctx = await requireMemberPage(PAYMENT_SETTINGS_PATH);
  const t = await getTranslations("paymentSettings");

  const { data: row } = await ctx.supabase
    .from("payment_accounts")
    .select(
      "provider_account_id, charges_enabled, payouts_enabled, details_submitted, requirements_due, last_error, last_synced_at",
    )
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  const account: PaymentAccountView | null = row
    ? {
        providerAccountId: row.provider_account_id as string,
        chargesEnabled: row.charges_enabled === true,
        payoutsEnabled: row.payouts_enabled === true,
        detailsSubmitted: row.details_submitted === true,
        requirementsDue: Array.isArray(row.requirements_due)
          ? (row.requirements_due as string[])
          : [],
        lastError: (row.last_error as string | null) ?? null,
        lastSyncedAt: (row.last_synced_at as string | null) ?? null,
      }
    : null;

  // Stan liczony TĄ SAMĄ funkcją, co przyszła bramka płatności w Z3 — jedno
  // miejsce zamiast warunku przepisanego na ekranie i w kodzie pieniędzy.
  const stage = connectAccountStage(
    account
      ? {
          providerAccountId: account.providerAccountId,
          chargesEnabled: account.chargesEnabled,
          payoutsEnabled: account.payoutsEnabled,
          detailsSubmitted: account.detailsSubmitted,
          requirementsDue: account.requirementsDue,
          disabledReason: null,
        }
      : null,
  );

  // Dostępność liczona na SERWERZE — klucz nie schodzi do klienta, schodzi
  // wyłącznie POWÓD (nazwy brakujących zmiennych).
  const availability = stripeAvailability();

  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenBackLink href="/" label={`← ${t("backLink")}`} />
      <p className="text-muted-foreground text-sm">{t("intro")}</p>

      <PaymentsPanel
        account={account}
        stage={stage}
        isOwner={ctx.role === "owner"}
        configAvailable={availability.available}
        configBlockedReason={availability.available ? null : availability.reason}
      />
    </FormMeasure>
  );
}
