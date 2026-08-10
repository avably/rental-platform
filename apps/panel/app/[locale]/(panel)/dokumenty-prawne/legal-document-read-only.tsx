import { useTranslations } from "next-intl";

import { ReadList } from "@/components/screens/read-list";
import { ScreenSection } from "@/components/screens/screen-header";
import type { LegalDocumentKind } from "@/lib/legal-documents";

import { LegalVersionHistory } from "./legal-version-history";
import type { LegalDocumentView } from "./types";

/**
 * DOKUMENT PRAWNY W WIDOKU CZŁONKA ZESPOŁU (B4, ADR-129).
 *
 * Te same dane co u właściciela, jawnie BEZ akcji — ta sama zasada, co przy
 * ustawieniach umów (0024/0060): wyłączony formularz obiecuje edycję o jedno
 * uprawnienie dalej, a atrapa „Zapisz", która oddaje odmowę z RLS, uczy
 * ignorować komunikaty błędów. Dokument prawny to oświadczenie firmy, więc
 * pisze go właściciel; obsługa musi go widzieć, bo odpowiada na pytania
 * klientów.
 *
 * Treść idzie węzłem TEKSTOWYM (`whitespace-pre-wrap`), nigdy przez
 * `dangerouslySetInnerHTML`: to tekst pisany przez najemcę.
 */
export function LegalDocumentReadOnly({
  kind,
  document,
}: {
  kind: LegalDocumentKind;
  document: LegalDocumentView | null;
}) {
  const t = useTranslations("legalDocuments");
  const currentVersion = document?.currentVersionLabel ?? null;

  return (
    <ScreenSection
      data-legal-document={kind}
      data-legal-mode="read-only"
      title={t(`kind.${kind}`)}
      description={t("readOnly")}
    >
      <p data-legal-publish-status className="text-muted-foreground text-[13px] leading-[18px]">
        {currentVersion
          ? t("statusPublished", {
              version: currentVersion,
              date: document?.currentPublishedAtLabel ?? "—",
            })
          : t("statusUnpublished")}
      </p>

      {document ? (
        <ReadList
          rows={[
            { label: t("documentTitle"), value: document.title },
            {
              label: t("locale"),
              value: document.locale === "en" ? t("localeEn") : t("localePl"),
            },
            {
              label: t("body"),
              value: <span className="whitespace-pre-wrap">{document.bodyDraft}</span>,
            },
          ]}
        />
      ) : (
        <p className="text-sm">{t("missing")}</p>
      )}

      <LegalVersionHistory versions={document?.versions ?? []} />
    </ScreenSection>
  );
}
