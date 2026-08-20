"use client";

/**
 * Widok konta płatności (Z2, ADR-065; układ P8 wg artefaktu Fazy 2, sekcja
 * `secondary-payments`). Warstwa interakcji nad akcjami serwerowymi — cały
 * stan pochodzi z serwera, tu jest wyłącznie prezentacja i wywołanie.
 *
 * DWIE OSI GOTOWOŚCI STOJĄ OSOBNO I TO JEST SEDNO TEGO EKRANU. Konto, które
 * przyjmuje płatności, ale nie wypłaca środków (`restricted` u dostawcy),
 * wygląda w każdym uproszczonym widoku jak sukces: klient płaci, błędu nie ma,
 * a pieniądze najemcy stoją. Dlatego „Przyjmowanie płatności" i „Wypłaty" to
 * dwa osobne wiersze z własnym słowem, a chip nagłówka ma dla tego przypadku
 * WŁASNY stan (`payouts_blocked`), a nie „gotowe" ani „w toku".
 *
 * DRUGA RZECZ: karta zawsze mówi, KIEDY stan został odczytany. Bez tej daty
 * najemca czytałby migawkę sprzed tygodnia jak bieżącą prawdę — a to kopia
 * prezentacyjna, nie źródło (ADR-049).
 */
import { Button } from "@avably/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useActionState } from "react";

import { ReadList } from "@/components/screens/read-list";
import { ScreenSection } from "@/components/screens/screen-header";
import type { FormState } from "@/lib/form-state";
import { SecondaryStatusChip } from "@/lib/secondary-status";

import { ONBOARDING_NONCE_FIELD } from "./onboarding-nonce";
import {
  disconnectPaymentAccountAction,
  openExpressDashboardAction,
  refreshPaymentAccountAction,
  startPaymentOnboardingAction,
} from "./payments-actions";

const initialState: FormState = {};

export interface PaymentAccountView {
  providerAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  lastError: string | null;
  lastSyncedAt: string | null;
}

export type PaymentAccountStage = "missing" | "pending" | "payouts_blocked" | "ready";

/**
 * Przycisk uruchamiający onboarding KYC.
 *
 * TRZY powody wyłączenia i KAŻDY musi być powiedziany. Cicho nieklikalna
 * kontrolka jest gorsza od jej braku: najemca klika w kółko i uznaje panel za
 * zepsuty (lekcja z przycisku ponowienia rejestracji domen).
 */
function OnboardingButton({
  available,
  isOwner,
  resume,
  onboardingNonce,
}: {
  available: boolean;
  isOwner: boolean;
  resume: boolean;
  onboardingNonce: string;
}) {
  const t = useTranslations("paymentSettings");
  const [state, formAction, pending] = useActionState(startPaymentOnboardingAction, initialState);
  const disabled = pending || !available || !isOwner;

  return (
    <div className="flex flex-col gap-2 text-sm" data-payment-onboarding>
      <form action={formAction}>
        {/* Nonce per render (ADR-216): dwuklik TEGO renderu dzieli klucz
            idempotencji → jedno konto; ponowienie po porażce to nowy render →
            nowy nonce → świeży klucz omijający błąd zacache'owany na 24h. */}
        <input type="hidden" name={ONBOARDING_NONCE_FIELD} value={onboardingNonce} />
        <Button type="submit" loading={pending} disabled={disabled}>
          {resume ? t("resumeCta") : t("startCta")}
        </Button>
      </form>

      {/* Bez powodu z serwera (U1, audyt W3): brak kluczy dostawcy to sprawa
          platformy — najemca dostaje neutralne zdanie ze słownika. */}
      {!available && (
        <p role="status" className="text-status-attention-fg" data-payment-blocked="config">
          {t("unavailable")}
        </p>
      )}
      {available && !isOwner && (
        <p role="status" className="text-status-attention-fg" data-payment-blocked="role">
          {t("ownerOnly")}
        </p>
      )}
      {state.formError && (
        <p role="alert" className="text-destructive">
          {state.formError}
        </p>
      )}
    </div>
  );
}

/**
 * Przycisk „Zarządzaj w Stripe" — otwiera Express Dashboard najemcy (ADR-217).
 *
 * Renderowany przez `PaymentsPanel` WYŁĄCZNIE dla konta gotowego
 * (`stage === "ready"`); dla missing/pending obowiązuje onboarding, nie ten
 * przycisk. Owner-only spójnie z granicą podpięcia/odłączenia konta: Express
 * Dashboard zmienia konto bankowe wypłat i pokazuje saldo. Pracownik widzi
 * przycisk wyłączony Z POWODEM (cicho nieklikalna kontrolka jest gorsza od jej
 * braku) — a i tak sama akcja odrzuca nie-właściciela (pas i szelki).
 */
function ManageInStripeButton({ isOwner }: { isOwner: boolean }) {
  const t = useTranslations("paymentSettings");
  const [state, formAction, pending] = useActionState(openExpressDashboardAction, initialState);
  const disabled = pending || !isOwner;

  return (
    <div className="flex flex-col gap-2 text-sm" data-payment-dashboard>
      <form action={formAction}>
        <Button type="submit" variant="secondary" loading={pending} disabled={disabled}>
          {t("manageCta")}
        </Button>
      </form>

      {!isOwner && (
        <p role="status" className="text-status-attention-fg" data-payment-blocked="dashboard-role">
          {t("manageOwnerOnly")}
        </p>
      )}
      {state.formError && (
        <p role="alert" className="text-destructive">
          {state.formError}
        </p>
      )}
    </div>
  );
}

function AccountActions({ isOwner }: { isOwner: boolean }) {
  const t = useTranslations("paymentSettings");
  const [refreshState, refreshAction, refreshing] = useActionState(
    refreshPaymentAccountAction,
    initialState,
  );
  const [disconnectState, disconnectAction, disconnecting] = useActionState(
    disconnectPaymentAccountAction,
    initialState,
  );

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <form action={refreshAction}>
          <Button type="submit" variant="secondary" loading={refreshing} disabled={refreshing}>
            {t("refreshCta")}
          </Button>
        </form>

        {isOwner && (
          <form action={disconnectAction}>
            <Button type="submit" variant="destructive" loading={disconnecting} disabled={disconnecting}>
              {t("disconnectCta")}
            </Button>
          </form>
        )}
      </div>

      {refreshState.success && <p className="text-status-positive-fg">{t("refreshOk")}</p>}
      {refreshState.formError && (
        <p role="alert" className="text-status-attention-fg">
          {t("refreshFailed")} {refreshState.formError}
        </p>
      )}
      {disconnectState.formError && (
        <p role="alert" className="text-destructive">
          {disconnectState.formError}
        </p>
      )}
    </div>
  );
}

export function PaymentsPanel({
  account,
  stage,
  isOwner,
  configAvailable,
  onboardingNonce,
}: {
  account: PaymentAccountView | null;
  stage: PaymentAccountStage;
  isOwner: boolean;
  configAvailable: boolean;
  onboardingNonce: string;
}) {
  const t = useTranslations("paymentSettings");
  const format = useFormatter();

  return (
    <ScreenSection
      data-payment-account-card
      data-payment-stage={stage}
      title={t("accountTitle")}
      status={<SecondaryStatusChip axis="payment-account" value={stage} />}
      description={t(`stageHint.${stage}`)}
    >
      {account ? (
        <>
          <ReadList
            data-payment-capabilities
            rows={[
              {
                label: t("chargesLabel"),
                value: (
                  <span data-payment-capability="charges" data-enabled={String(account.chargesEnabled)}>
                    {account.chargesEnabled ? t("capabilityOn") : t("capabilityOff")}
                  </span>
                ),
              },
              {
                label: t("payoutsLabel"),
                value: (
                  <span data-payment-capability="payouts" data-enabled={String(account.payoutsEnabled)}>
                    {account.payoutsEnabled ? t("capabilityOn") : t("capabilityOff")}
                  </span>
                ),
              },
              {
                label: t("detailsLabel"),
                value: account.detailsSubmitted ? t("capabilityOn") : t("capabilityOff"),
              },
              { label: t("accountIdLabel"), value: account.providerAccountId },
              {
                label: t("syncedLabel"),
                // Data ODCZYTU, nie „ostatniej zmiany": karta ma mówić, jak
                // stara jest ta migawka.
                value: account.lastSyncedAt
                  ? format.dateTime(new Date(account.lastSyncedAt), "short")
                  : t("neverSynced"),
              },
            ]}
          />

          {account.requirementsDue.length > 0 && (
            <div className="flex flex-col gap-1" data-payment-requirements>
              <p className="text-sm font-medium">{t("requirementsHeading")}</p>
              <ul className="text-muted-foreground list-disc pl-5 text-[13px] leading-[18px]">
                {account.requirementsDue.map((requirement) => (
                  <li key={requirement} data-requirement={requirement}>
                    {requirement}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-[13px] leading-[18px]">
                {t("requirementsHint")}
              </p>
            </div>
          )}

          {account.lastError && (
            <p role="alert" className="text-destructive text-[13px] leading-[18px]">
              {t("lastError")} {account.lastError}
            </p>
          )}

          <AccountActions isOwner={isOwner} />

          {/* Konto gotowe → wejście do Express Dashboardu (ADR-217); konto
              missing/pending → wznowienie onboardingu. Rozłącznie, bo to dwa
              różne pytania najemcy („zarządzaj" vs „dokończ konfigurację"). */}
          {stage === "ready" ? (
            <ManageInStripeButton isOwner={isOwner} />
          ) : (
            <OnboardingButton
              available={configAvailable}
              isOwner={isOwner}
              resume
              onboardingNonce={onboardingNonce}
            />
          )}
        </>
      ) : (
        <OnboardingButton
          available={configAvailable}
          isOwner={isOwner}
          resume={false}
          onboardingNonce={onboardingNonce}
        />
      )}
    </ScreenSection>
  );
}
