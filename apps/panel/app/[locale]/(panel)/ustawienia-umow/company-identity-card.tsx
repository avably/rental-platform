import { useTranslations } from "next-intl";

import { ReadList } from "@/components/screens/read-list";
import { ScreenSection } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";

/**
 * Dane firmowe organizacji na SZCZYCIE ekranu ustawień umów (uwagi właściciela
 * #1 i #3).
 *
 * ══ SKĄD TE DANE ══
 *
 * Nazwa prawna, NIP i REGON żyją na `public.tenants` (ADR-234) — zebrane
 * i ZWERYFIKOWANE przeciw rejestrowi przy zakładaniu organizacji. Tutaj są
 * WYŁĄCZNIE do wglądu: tożsamości firmy nie zmienia się na ekranie umów, więc
 * atrapa edytowalnego pola obiecywałaby operację, której ten ekran nie ma jak
 * zapisać (contract_document nie ma na nie miejsca — sztywny CHECK 0026).
 * Adres i treść umowy edytuje się NIŻEJ; nazwę handlową — w Organizacji, i tam
 * prowadzi link (uwaga #3: „napisać, że są do zmiany — gdzie, i link").
 *
 * ══ ORGANIZACJA SPRZED ADR-234 ══
 *
 * Wiersze utworzone przed wprowadzeniem weryfikacji NIP mają te kolumny NULL
 * (zero backfillu, zero zgadywania). Karta mówi to wprost zamiast pokazywać
 * puste myślniki bez wyjaśnienia — operator wie, że dane uzupełni w Organizacji.
 */
export interface CompanyIdentity {
  /** Nazwa handlowa (tenants.name) — zawsze jest, to źródło prawdy dla UI. */
  name: string;
  /** Pełna nazwa z rejestru (tenants.legal_name) — bywa NULL dla starszych organizacji. */
  legalName: string | null;
  nip: string | null;
  regon: string | null;
}

export function CompanyIdentityCard({ identity }: { identity: CompanyIdentity }) {
  const t = useTranslations("contractSettings");
  const hasRegistryData = Boolean(identity.legalName || identity.nip || identity.regon);

  return (
    <ScreenSection
      data-company-identity={hasRegistryData ? "present" : "empty"}
      title={t("companyDataTitle")}
      description={t("companyDataNote")}
    >
      {hasRegistryData ? (
        <ReadList
          rows={[
            { label: t("companyLegalName"), value: identity.legalName ?? identity.name },
            { label: t("companyNipLabel"), value: identity.nip ?? "—", numeric: true },
            { label: t("companyRegon"), value: identity.regon ?? "—", numeric: true },
          ]}
        />
      ) : (
        <p className="text-sm" data-company-identity-empty>
          {t("companyDataEmpty")}
        </p>
      )}

      <p className="text-muted-foreground text-[13px] leading-[18px]">
        {t("companyNameSource")}{" "}
        <Link
          href="/organizacja"
          className="underline underline-offset-[3px] hover:no-underline"
          data-company-identity-link
        >
          {t("companyNameLink")}
        </Link>
      </p>
    </ScreenSection>
  );
}
