"use client";

/**
 * Hub dostaw — warstwa PREZENTACJI ekranu ustawień (ADR-236, uwagi właściciela:
 * „ta strona to powinien być hub dostaw", „to też jakieś rozjebane, można
 * lepiej").
 *
 * Do ADR-236 ekran był stosem czterech surowych formularzy jeden pod drugim.
 * Teraz każda odpowiedzialność jest KARTĄ ze stanem, a edycja przenosi się do
 * MODALU: na stronie zostaje to, co operator czyta jednym spojrzeniem (czy
 * gotowe, co ustawione), a pytania — komplet pól — zadaje okno dialogowe wtedy,
 * gdy operator faktycznie chce coś zmienić.
 *
 * KONTRAKT DANYCH ZOSTAJE. Modale renderują DOKŁADNIE te same komponenty
 * formularzy (`CredentialsForm`, `SenderForm`, `ParcelForm`, `PricingForm`) co
 * przedtem — z całym echem U9, regułą właściciela (RLS 0024) i sekretem
 * write-only (ADR-052). Hub nie dubluje ani zapisu, ani walidacji; dokłada
 * wyłącznie zwinięcie, kafelki i zamknięcie modalu po udanym zapisie.
 */
import { DEFAULT_CURRENCY, formatMoney } from "@avably/core";
import { Button, Dialog, DialogContent, DialogTitle, DialogTrigger } from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { ScreenSection } from "@/components/screens/screen-header";
import type { FormState } from "@/lib/form-state";
import { SecondaryStatusChip } from "@/lib/secondary-status";

import { CourierLogo } from "./courier-logo";
import {
  CredentialsForm,
  ParcelForm,
  PricingForm,
  SenderForm,
  type PricingDefaults,
  type SectionStatus,
  type SenderDefaults,
} from "./delivery-settings-forms";

type SettingsAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

/** Etykieta przycisku edycji: właściciel ustawia/edytuje, członek podgląda. */
function editLabel(
  t: ReturnType<typeof useTranslations<"orders.delivery.settings">>,
  canWrite: boolean,
  isSet: boolean,
): string {
  if (!canWrite) return t("viewCta");
  return isSet ? t("editCta") : t("setCta");
}

const globkurierUrl = "https://globkurier.pl";

/**
 * Sekcja integracji z kurierami: kafelek GlobKuriera (konto zakładasz u nich,
 * tu tylko podłączasz) i kafelek InPost oznaczony „wkrótce". Konfiguracja konta
 * schodzi za modal — na kafelku zostaje sam stan i jedno wejście do edycji.
 */
export function IntegrationSection({
  action,
  configured,
  canWrite,
  defaults,
  status,
}: {
  action: SettingsAction;
  configured: boolean;
  canWrite: boolean;
  defaults: { email: string; environment: string } | null;
  status: SectionStatus;
}) {
  const t = useTranslations("orders.delivery.settings");
  const [open, setOpen] = useState(false);
  const triggerLabel = !canWrite
    ? t("viewCta")
    : configured
      ? t("integrationEditCta")
      : t("integrationConnectCta");

  return (
    <ScreenSection
      data-delivery-hub-card="integration"
      title={t("integrationTitle")}
      description={t("integrationDesc")}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div
          data-integration-provider="globkurier"
          className="border-border flex flex-col gap-3 rounded-lg border p-4"
        >
          <div className="flex items-center gap-3">
            <CourierLogo name={t("integrationGlobkurierName")} />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-medium">{t("integrationGlobkurierName")}</p>
              <SecondaryStatusChip
                axis="delivery-secret"
                value={configured ? "configured" : "missing"}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {t("integrationGlobkurierDesc")}
          </p>
          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {configured ? t("integrationConnectedNote") : t("integrationNotConnectedNote")}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button
                  variant={configured || !canWrite ? "outline" : "default"}
                  data-integration-edit="globkurier"
                >
                  {triggerLabel}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogTitle className="sr-only">{t("credentialsTitle")}</DialogTitle>
                <CredentialsForm
                  action={action}
                  configured={configured}
                  canWrite={canWrite}
                  defaults={defaults}
                  status={status}
                  onSuccess={() => setOpen(false)}
                />
              </DialogContent>
            </Dialog>
            <a
              href={globkurierUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground rounded-sm text-[13px] underline underline-offset-[3px] outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
            >
              {t("integrationGlobkurierLink")}
            </a>
          </div>
        </div>

        <div
          data-integration-provider="inpost"
          aria-disabled="true"
          className="border-border/70 bg-muted/20 flex flex-col gap-3 rounded-lg border border-dashed p-4"
        >
          <div className="flex items-center gap-3">
            <CourierLogo name={t("integrationInpostName")} decorative />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-muted-foreground font-medium">{t("integrationInpostName")}</p>
              {/*
                „Wkrótce" to ETYKIETA planu, nie stan z osi statusów — dlatego
                zwykła plakietka, a nie chip (`SecondaryStatusChip`/`StatusBadge`
                z tonem). Kontrakt `secondary-status-contract` słusznie zakazuje
                tonu wpisanego literałem, a osi „coming-soon" w mapie nie ma i po
                nic nie jest jej dokładać dla jednego, nieaktywnego kafelka.
              */}
              <span
                data-integration-soon="inpost"
                className="border-border bg-muted text-muted-foreground inline-flex h-7 w-fit items-center rounded-sm border px-2.5 text-[13px] leading-none font-medium"
              >
                {t("integrationSoon")}
              </span>
            </div>
          </div>
          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {t("integrationInpostDesc")}
          </p>
          <div className="mt-auto pt-1">
            <Button variant="outline" disabled data-integration-edit="inpost">
              {t("integrationConnectCta")}
            </Button>
          </div>
        </div>
      </div>
    </ScreenSection>
  );
}

/** Dane nadawcy: zwinięte do stanu + edycja w modalu (uwaga właściciela). */
export function SenderCard({
  action,
  canWrite,
  defaults,
  status,
}: {
  action: SettingsAction;
  canWrite: boolean;
  defaults: SenderDefaults | null;
  status: SectionStatus;
}) {
  const t = useTranslations("orders.delivery.settings");
  const [open, setOpen] = useState(false);
  const isSet = status.state === "complete";

  return (
    <ScreenSection
      data-delivery-hub-card="sender"
      title={t("senderTitle")}
      status={<SecondaryStatusChip axis="delivery-section" value={status.state} />}
      description={t("senderCardDesc")}
    >
      <div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant={isSet || !canWrite ? "outline" : "default"}
              data-delivery-hub-edit="sender"
            >
              {editLabel(t, canWrite, isSet)}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogTitle className="sr-only">{t("senderTitle")}</DialogTitle>
            <SenderForm
              action={action}
              canWrite={canWrite}
              defaults={defaults}
              status={status}
              onSuccess={() => setOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    </ScreenSection>
  );
}

/** Domyślna paczka: zwinięta do stanu + edycja w modalu. */
export function ParcelCard({
  action,
  canWrite,
  defaults,
  status,
}: {
  action: SettingsAction;
  canWrite: boolean;
  defaults: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number } | null;
  status: SectionStatus;
}) {
  const t = useTranslations("orders.delivery.settings");
  const [open, setOpen] = useState(false);
  const isSet = status.state === "complete";

  return (
    <ScreenSection
      data-delivery-hub-card="parcel"
      title={t("parcelTitle")}
      status={<SecondaryStatusChip axis="delivery-section" value={status.state} />}
      description={t("parcelCardDesc")}
    >
      <div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant={isSet || !canWrite ? "outline" : "default"}
              data-delivery-hub-edit="parcel"
            >
              {editLabel(t, canWrite, isSet)}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogTitle className="sr-only">{t("parcelTitle")}</DialogTitle>
            <ParcelForm
              action={action}
              canWrite={canWrite}
              defaults={defaults}
              status={status}
              onSuccess={() => setOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    </ScreenSection>
  );
}

const PRICING_METHOD_LABEL = {
  courier: "methodCourier",
  parcel_locker: "methodParcelLocker",
  own_delivery: "methodOwnDelivery",
} as const;

/**
 * Cennik metod dostawy: na stronie lista skonfigurowanych metod z ceną,
 * zarządzanie (dodaj/usuń metodę, edycja kwot) w modalu.
 */
export function PricingCard({
  action,
  canWrite,
  defaults,
  status,
}: {
  action: SettingsAction;
  canWrite: boolean;
  defaults: PricingDefaults | null;
  status: SectionStatus;
}) {
  const t = useTranslations("orders.delivery.settings");
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  const summary = (Object.keys(PRICING_METHOD_LABEL) as (keyof typeof PRICING_METHOD_LABEL)[])
    .filter((method) => defaults?.[method])
    .map((method) => ({
      method,
      label: t(PRICING_METHOD_LABEL[method]),
      price: formatMoney(defaults![method]!.priceGrosze, DEFAULT_CURRENCY, locale),
    }));
  const isSet = summary.length > 0;

  return (
    <ScreenSection
      data-delivery-hub-card="pricing"
      title={t("pricingTitle")}
      status={<SecondaryStatusChip axis="delivery-section" value={status.state} />}
      description={t("pricingCardDesc")}
    >
      {isSet ? (
        <ul className="flex flex-col gap-2">
          {summary.map((row) => (
            <li
              key={row.method}
              data-pricing-summary-method={row.method}
              className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <span className="font-medium">{row.label}</span>
              <span className="text-muted-foreground text-[13px] tabular-nums">{row.price}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p data-pricing-summary-empty className="text-muted-foreground text-sm">
          {t("pricingSummaryEmpty")}
        </p>
      )}
      <div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant={isSet || !canWrite ? "outline" : "default"}
              data-delivery-hub-edit="pricing"
            >
              {editLabel(t, canWrite, isSet)}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogTitle className="sr-only">{t("pricingTitle")}</DialogTitle>
            <PricingForm
              action={action}
              canWrite={canWrite}
              defaults={defaults}
              status={status}
              onSuccess={() => setOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    </ScreenSection>
  );
}
