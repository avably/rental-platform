"use client";

/**
 * Widok domen sklepu (Zadanie 2.6, ADR-046). Warstwa interakcji nad akcjami
 * serwerowymi — cała logika stanu (rejestracja, werdykt weryfikacji) siedzi po
 * stronie serwera, tu jest wyłącznie prezentacja i wywołanie.
 *
 * Instrukcja CNAME jest pokazana PRZY KAŻDEJ niezweryfikowanej domenie, a nie
 * raz na górze ekranu: to jedyny krok, który najemca musi wykonać u SIEBIE
 * (u swojego rejestratora), i najczęstszy powód, dla którego domena nie
 * przechodzi weryfikacji.
 */
import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { FormState } from "@/lib/form-state";

import {
  addCustomDomainAction,
  checkDomainAction,
  removeCustomDomainAction,
} from "./domains-actions";

const initialState: FormState = {};

export interface DomainRow {
  id: string;
  domain: string;
  kind: "subdomain" | "custom";
  verified: boolean;
  verifiedAt: string | null;
  lastError: string | null;
}

function AddDomainForm() {
  const t = useTranslations("domainSettings");
  const [state, formAction, pending] = useActionState(addCustomDomainAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded border p-3 text-sm">
      <p className="font-medium">{t("addTitle")}</p>

      <Label htmlFor="custom-domain">{t("domainLabel")}</Label>
      <Input id="custom-domain" name="domain" placeholder="sklep.twojafirma.pl" disabled={pending} />
      <p className="text-gray-500">{t("domainHint")}</p>

      <Button type="submit" disabled={pending}>
        {t("addCta")}
      </Button>

      {(state.formError ?? state.fieldErrors?.domain) && (
        <p role="alert" className="text-red-600">
          {state.formError ?? state.fieldErrors?.domain}
        </p>
      )}
      {state.success && <p className="text-green-700">{t("addedOk")}</p>}
    </form>
  );
}

/** Rekord, który najemca ma wpisać u swojego rejestratora. */
function CnameInstruction({ host, target }: { host: string; target: string }) {
  const t = useTranslations("domainSettings");

  return (
    <div className="flex flex-col gap-1 rounded bg-gray-50 p-2">
      <p className="font-medium">{t("dnsHeading")}</p>
      <p className="text-gray-600">{t("dnsIntro")}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3">
        <dt className="text-gray-500">{t("dnsType")}</dt>
        <dd>CNAME</dd>
        <dt className="text-gray-500">{t("dnsName")}</dt>
        <dd className="break-all font-mono">{host}</dd>
        <dt className="text-gray-500">{t("dnsValue")}</dt>
        <dd className="break-all font-mono">{target}</dd>
      </dl>
      <p className="text-gray-500">{t("dnsPropagation")}</p>
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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={checkAction}>
          <input type="hidden" name="domain" value={domain.domain} />
          <Button type="submit" disabled={checking}>
            {t("checkCta")}
          </Button>
        </form>

        {domain.kind === "custom" && (
          <form action={removeAction}>
            <input type="hidden" name="domain" value={domain.domain} />
            <Button type="submit" variant="secondary" disabled={removing}>
              {t("removeCta")}
            </Button>
          </form>
        )}
      </div>

      {checkState.success && <p className="text-green-700">{t("verifiedOk")}</p>}
      {checkState.formError && (
        <p role="alert" className="text-amber-700">
          {t("stillPending")} {checkState.formError}
        </p>
      )}
      {removeState.formError && (
        <p role="alert" className="text-red-600">
          {removeState.formError}
        </p>
      )}
    </div>
  );
}

function DomainCard({ domain, cnameTarget }: { domain: DomainRow; cnameTarget: string }) {
  const t = useTranslations("domainSettings");

  return (
    <li className="flex flex-col gap-2 rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="break-all font-mono">{domain.domain}</span>
        <span className={domain.verified ? "text-green-700" : "text-amber-700"}>
          {domain.verified ? t("statusLive") : t("statusPending")}
        </span>
      </div>

      <p className="text-gray-500">
        {domain.kind === "subdomain" ? t("kindSubdomain") : t("kindCustom")}
      </p>

      {/* Powód ostatniego niepowodzenia — bez niego porażka rejestracji byłaby
          ciszą: wiersz jest, sklep nie odpowiada, najemca nie wie dlaczego. */}
      {domain.lastError && (
        <p role="alert" className="text-amber-700">
          {t("lastErrorLabel")} {domain.lastError}
        </p>
      )}

      {domain.kind === "custom" && !domain.verified && (
        <CnameInstruction host={domain.domain} target={cnameTarget} />
      )}

      <DomainActions domain={domain} />
    </li>
  );
}

export function DomainsPanel({
  domains,
  cnameTarget,
}: {
  domains: DomainRow[];
  cnameTarget: string;
}) {
  const t = useTranslations("domainSettings");

  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("listHeading")}</h2>
        {domains.length === 0 ? (
          <p className="text-sm text-gray-500">{t("emptyState")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {domains.map((domain) => (
              <DomainCard key={domain.id} domain={domain} cnameTarget={cnameTarget} />
            ))}
          </ul>
        )}
      </section>

      <AddDomainForm />
    </>
  );
}
