import { useTranslations } from "next-intl";

import { ReadList } from "@/components/screens/read-list";
import { ScreenSection } from "@/components/screens/screen-header";
import type { ContractDocumentSettings } from "@/lib/contract-settings";

/**
 * Ustawienia umów w widoku członka zespołu (mockup P8:
 * `data-contract-mode="member-read-only"`).
 *
 * Ten sam zestaw danych co u właściciela, jawnie BEZ akcji. Atrapa „Zapisz",
 * która oddaje odmowę z RLS 0024, jest gorsza od jej braku: obiecuje operację,
 * na którą rola nie ma prawa, i uczy ignorować komunikaty błędów.
 */
export function ContractReadOnly({ settings }: { settings: ContractDocumentSettings | null }) {
  const t = useTranslations("contractSettings");

  return (
    <ScreenSection data-contract-mode="member-read-only" description={t("readOnly")}>
      {settings ? (
        <ReadList
          rows={[
            { label: t("address"), value: settings.address },
            { label: t("nip"), value: settings.nip ?? "—" },
            { label: t("email"), value: settings.email },
            { label: t("termsVersion"), value: settings.terms_version },
            {
              label: t("termsBody"),
              value: <span className="whitespace-pre-wrap">{settings.terms_body}</span>,
            },
          ]}
        />
      ) : (
        <p className="text-sm">{t("missing")}</p>
      )}
    </ScreenSection>
  );
}
