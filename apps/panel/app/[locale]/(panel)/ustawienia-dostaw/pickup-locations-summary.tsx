/**
 * Podsumowanie punktów odbioru na hubie dostaw (ADR-236, uwaga właściciela:
 * „punkty odbioru jak są dodane powinny być pokazane").
 *
 * Do ADR-236 hub dawał wyłącznie LINK do podstrony — dodane punkty były
 * niewidoczne, dopóki się w nią nie weszło. Teraz kafelek pokazuje je wprost:
 * nazwa, adres i stan aktywności, prosto z `pickup_locations`. Zarządzanie
 * (dodawanie, edycja, wygaszanie) zostaje na podstronie — tu jest podgląd
 * i skrót, nie druga kopia edytora.
 *
 * Komponent JEST PREZENTACYJNY: dane czyta strona (przez RLS), tak jak reszta
 * huba. Oś dostępności idzie przez `availabilityBadgeProps` — ekran nie zna
 * słowa „positive" (ten sam wzorzec co `locations-table`).
 */
import { Button, StatusBadge } from "@avably/ui";
import { getTranslations } from "next-intl/server";

import { ScreenSection } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import { availabilityBadgeProps } from "@/lib/catalog/availability-chip";

export interface PickupLocationSummaryRow {
  id: string;
  name: string;
  address: string;
  active: boolean;
}

const nameLinkClass =
  "text-foreground rounded-sm font-medium no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring";

export async function PickupLocationsSummary({ rows }: { rows: PickupLocationSummaryRow[] }) {
  const t = await getTranslations("orders.delivery.locations");

  return (
    <ScreenSection
      data-delivery-hub-card="locations"
      data-delivery-locations-entry="true"
      title={t("title")}
      description={t("cardDescription")}
    >
      {rows.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
          <div>
            <Button asChild>
              <Link href="/ustawienia-dostaw/punkty-odbioru/nowy">{t("newLocation")}</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="grid gap-2 sm:grid-cols-2">
            {rows.map((location) => (
              <li
                key={location.id}
                data-location-tile
                data-location-id={location.id}
                className="border-border flex items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    href={`/ustawienia-dostaw/punkty-odbioru/${location.id}`}
                    className={nameLinkClass}
                  >
                    {location.name}
                  </Link>
                  <span className="text-muted-foreground text-[13px] leading-[18px]">
                    {location.address}
                  </span>
                </div>
                <StatusBadge {...availabilityBadgeProps(location.active)}>
                  {location.active ? t("activeYes") : t("activeNo")}
                </StatusBadge>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href="/ustawienia-dostaw/punkty-odbioru">{t("cardCta")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/ustawienia-dostaw/punkty-odbioru/nowy">{t("newLocation")}</Link>
            </Button>
          </div>
        </div>
      )}
    </ScreenSection>
  );
}
