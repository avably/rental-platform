"use client";

/**
 * Widok domen sklepu (Zadanie 2.6, ADR-046; układ P8 wg artefaktu Fazy 2,
 * sekcja `secondary-domains`). Warstwa interakcji nad akcjami serwerowymi —
 * cała logika stanu (rejestracja, werdykt weryfikacji) siedzi po stronie
 * serwera, tu jest wyłącznie prezentacja i wywołanie.
 *
 * Mockup zamienia listę zdań na SEKWENCJĘ STANÓW: każdy adres jest kartą,
 * której stan niesie chip z mapy (oś `domain`), a nie kolorowy akapit.
 * Dostępność rejestracji hostów stoi WYŻEJ niż adresy, bo przy braku
 * konfiguracji cała sekwencja ponowień jest martwa i trzeba to powiedzieć raz,
 * na górze — a nie przy każdym przycisku z osobna.
 *
 * Instrukcja CNAME zostaje PRZY KAŻDEJ niezweryfikowanej domenie, a nie raz na
 * górze ekranu: to jedyny krok, który najemca musi wykonać u SIEBIE (u swojego
 * rejestratora), i najczęstszy powód, dla którego domena nie przechodzi
 * weryfikacji.
 */
import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { ReadList } from "@/components/screens/read-list";
import { ScreenSection } from "@/components/screens/screen-header";
import type { FormState } from "@/lib/form-state";
import { SecondaryStatusChip } from "@/lib/secondary-status";

import {
  addCustomDomainAction,
  checkDomainAction,
  removeCustomDomainAction,
  retrySubdomainAction,
} from "./domains-actions";

const initialState: FormState = {};

export interface DomainRow {
  id: string;
  domain: string;
  kind: "subdomain" | "custom";
  verified: boolean;
  verifiedAt: string | null;
  lastError: string | null;
  /** Host potwierdzony u dostawcy (provider_domain_id ≠ NULL). */
  registered: boolean;
}

/**
 * Stan adresu na osi `domain` z artefaktu.
 *
 * `verified` NIE wystarczy na etykietę subdomeny: 0022 stawia je na true w tej
 * samej transakcji co tenant, więc adres bez rejestracji u dostawcy pokazywał
 * się jako „Działa", oddając w rzeczywistości 404. Stan ma opisywać sklep, nie
 * zawartość kolumny — dlatego nieudana rejestracja jest OSOBNĄ wartością osi,
 * z tonem `problem`, a nie tym samym „czeka", co świeżo dodana domena własna.
 */
export function domainState(domain: DomainRow): "live" | "pending" | "registration_failed" {
  if (domain.verified && (domain.kind === "custom" || domain.registered)) return "live";
  if (domain.kind === "subdomain" && (!domain.registered || domain.lastError !== null)) {
    return "registration_failed";
  }
  return "pending";
}

/**
 * Przycisk ponowienia rejestracji subdomeny (Zadanie 2.6b).
 *
 * Dwa stany wyłączenia i OBA muszą mówić dlaczego. Brak konfiguracji dostawcy
 * gasi przycisk z powodem — cicho nieklikalna kontrolka jest gorsza od jej
 * braku, bo najemca próbuje w kółko i uznaje panel za zepsuty.
 */
function RetrySubdomainButton({
  available,
  blockedReason,
}: {
  available: boolean;
  blockedReason: string | null;
}) {
  const t = useTranslations("domainSettings");
  const [state, formAction, pending] = useActionState(retrySubdomainAction, initialState);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <form action={formAction}>
        <Button type="submit" loading={pending} disabled={pending || !available}>
          {t("retryCta")}
        </Button>
      </form>

      {!available && (
        <p role="status" className="text-status-attention-fg">
          {t("retryUnavailable")} {blockedReason}
        </p>
      )}
      {state.success && <p className="text-status-positive-fg">{t("retryOk")}</p>}
      {state.formError && (
        <p role="alert" className="text-destructive">
          {t("retryFailed")} {state.formError} {t("retryContactFallback")}
        </p>
      )}
    </div>
  );
}

function AddDomainForm() {
  const t = useTranslations("domainSettings");
  const [state, formAction, pending] = useActionState(addCustomDomainAction, initialState);

  return (
    <ScreenSection title={t("addTitle")} data-domain-add-form>
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <Label htmlFor="custom-domain">{t("domainLabel")}</Label>
        <Input
          id="custom-domain"
          name="domain"
          placeholder="sklep.twojafirma.pl"
          disabled={pending}
        />
        <p className="text-muted-foreground">{t("domainHint")}</p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" loading={pending} disabled={pending}>
            {t("addCta")}
          </Button>
          {state.success && <span className="text-status-positive-fg">{t("addedOk")}</span>}
        </div>

        {(state.formError ?? state.fieldErrors?.domain) && (
          <p role="alert" className="text-destructive">
            {state.formError ?? state.fieldErrors?.domain}
          </p>
        )}
      </form>
    </ScreenSection>
  );
}

/** Rekord, który najemca ma wpisać u swojego rejestratora. */
function CnameInstruction({ host, target }: { host: string; target: string }) {
  const t = useTranslations("domainSettings");

  return (
    <div className="flex flex-col gap-2" data-dns-instructions>
      <p className="text-sm font-medium">{t("dnsHeading")}</p>
      <p className="text-muted-foreground text-[13px] leading-[18px]">{t("dnsIntro")}</p>
      <ReadList
        rows={[
          { label: t("dnsType"), value: "CNAME" },
          { label: t("dnsName"), value: host },
          { label: t("dnsValue"), value: target },
        ]}
      />
      <p className="text-muted-foreground text-[13px] leading-[18px]">{t("dnsPropagation")}</p>
    </div>
  );
}

function DomainActions({ domain }: { domain: DomainRow }) {
  const t = useTranslations("domainSettings");
  const [checkState, checkAction, checking] = useActionState(checkDomainAction, initialState);
  const [removeState, removeAction, removing] = useActionState(
    removeCustomDomainAction,
    initialState,
  );

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <form action={checkAction}>
          <input type="hidden" name="domain" value={domain.domain} />
          <Button type="submit" variant="secondary" loading={checking} disabled={checking}>
            {t("checkCta")}
          </Button>
        </form>

        {domain.kind === "custom" && (
          <form action={removeAction}>
            <input type="hidden" name="domain" value={domain.domain} />
            <Button type="submit" variant="destructive" loading={removing} disabled={removing}>
              {t("removeCta")}
            </Button>
          </form>
        )}
      </div>

      {checkState.success && <p className="text-status-positive-fg">{t("verifiedOk")}</p>}
      {checkState.formError && (
        <p role="alert" className="text-status-attention-fg">
          {t("stillPending")} {checkState.formError}
        </p>
      )}
      {removeState.formError && (
        <p role="alert" className="text-destructive">
          {removeState.formError}
        </p>
      )}
    </div>
  );
}

function DomainCard({
  domain,
  cnameTarget,
  registrationAvailable,
  registrationBlockedReason,
}: {
  domain: DomainRow;
  cnameTarget: string;
  registrationAvailable: boolean;
  registrationBlockedReason: string | null;
}) {
  const t = useTranslations("domainSettings");
  const state = domainState(domain);

  return (
    <ScreenSection
      data-domain-kind={domain.kind}
      title={domain.domain}
      status={<SecondaryStatusChip axis="domain" value={state} />}
      description={domain.kind === "subdomain" ? t("kindSubdomain") : t("kindCustom")}
    >
      {/* Powód ostatniego niepowodzenia — bez niego porażka rejestracji byłaby
          ciszą: wiersz jest, sklep nie odpowiada, najemca nie wie dlaczego. */}
      {domain.lastError && (
        <p role="alert" className="text-status-attention-fg text-sm">
          {t("lastErrorLabel")} {domain.lastError}
        </p>
      )}

      {domain.kind === "custom" && !domain.verified && (
        <CnameInstruction host={domain.domain} target={cnameTarget} />
      )}

      {state === "registration_failed" && (
        <RetrySubdomainButton
          available={registrationAvailable}
          blockedReason={registrationBlockedReason}
        />
      )}

      <DomainActions domain={domain} />
    </ScreenSection>
  );
}

export function DomainsPanel({
  domains,
  cnameTarget,
  registrationAvailable,
  registrationBlockedReason,
}: {
  domains: DomainRow[];
  cnameTarget: string;
  registrationAvailable: boolean;
  registrationBlockedReason: string | null;
}) {
  const t = useTranslations("domainSettings");

  return (
    <>
      <ScreenSection
        data-domain-provider-state
        title={t("providerTitle")}
        status={
          <SecondaryStatusChip
            axis="domain-provider"
            value={registrationAvailable ? "available" : "unavailable"}
          />
        }
        description={
          registrationAvailable
            ? t("providerAvailable")
            : `${t("registrationUnavailable")} ${registrationBlockedReason ?? ""}`
        }
      />

      {domains.length === 0 ? (
        // Pustka NIE jest tu ślepym zaułkiem: wiersz subdomeny mógł nie
        // powstać (kolizja `on conflict` w 0022), a ponowienie go utworzy
        // i zarejestruje. Odsyłanie najemcy do kontaktu było opisem problemu
        // zamiast wyjścia z niego.
        <ScreenSection data-domain-list title={t("listHeading")} description={t("emptyState")}>
          <RetrySubdomainButton
            available={registrationAvailable}
            blockedReason={registrationBlockedReason}
          />
        </ScreenSection>
      ) : (
        <div data-domain-list className="flex flex-col gap-4">
          {domains.map((domain) => (
            <DomainCard
              key={domain.id}
              domain={domain}
              cnameTarget={cnameTarget}
              registrationAvailable={registrationAvailable}
              registrationBlockedReason={registrationBlockedReason}
            />
          ))}
        </div>
      )}

      <AddDomainForm />
    </>
  );
}
