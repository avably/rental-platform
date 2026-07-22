import { useTranslations } from "next-intl";

import { ReadList } from "@/components/screens/read-list";
import { ScreenSection } from "@/components/screens/screen-header";
import { SecondaryStatusChip } from "@/lib/secondary-status";

/**
 * Karta organizacji (mockup P8: `secondary-organization`) — KARTA KONTA, nie
 * wyłączony formularz.
 *
 * ZERO MUTACJI, ZERO ATRAP EDYCJI (ADR-059 D5). Wyszarzony formularz sugeruje,
 * że edycja jest o jedno uprawnienie dalej; lista odczytowa mówi wprost, że jej
 * nie ma. Nazwa organizacji jest tytułem karty, a stan — chipem przy tytule.
 *
 * Chip pojawia się WYŁĄCZNIE przy stanie, który zna mapa artefaktu (`active`).
 * Inaczej ekran zapewniałby o aktywności organizacji, która aktywna nie jest;
 * pozostałe stany czyta się z wiersza „Status", bez wciskania ich w jedną
 * etykietę.
 */
export function OrganizationCard({
  name,
  status,
  rows,
}: {
  name: string;
  status: string;
  rows: readonly { label: string; value: string; numeric?: boolean }[];
}) {
  const t = useTranslations("organization");

  return (
    <ScreenSection
      data-organization-details
      data-access-mode="read-only"
      title={name}
      status={status === "active" ? <SecondaryStatusChip axis="organization" value="active" /> : undefined}
      description={t("description")}
    >
      <ReadList rows={rows} />
      <p className="text-muted-foreground text-[13px] leading-[18px]">{t("readOnly")}</p>
    </ScreenSection>
  );
}
