/**
 * Punkty odbioru — podstrona ekranu Dostawy (decyzja właściciela 2026-08-04).
 *
 * Ekran mieszkał pod Katalogiem, bo punkt odbioru zakładało się przy okazji
 * produktów. Merytorycznie należy jednak do dostaw: to jeden z SPOSOBÓW, w jaki
 * sprzęt trafia do klienta — obok kuriera i paczkomatu, których konfiguracja
 * stoi piętro wyżej, w `/ustawienia-dostaw`. Przeprowadzka jest wyłącznie
 * przeniesieniem UI: model danych, akcje serwerowe i odczyt punktów przez
 * kreator zamówienia zostają BEZ zmian.
 */
import { Button } from "@avably/ui";
import { getTranslations } from "next-intl/server";

import { ScreenHeader } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";

import { toggleLocationAction } from "./actions";
import { LocationsTable, type LocationsTableRow } from "./locations-table";

export default async function PickupLocationsPage() {
  const ctx = await requireMemberPage("/ustawienia-dostaw/punkty-odbioru");

  const { data: locations } = await ctx.supabase
    .from("pickup_locations")
    .select("id, name, address_street, address_zip, address_city, active")
    .eq("tenant_id", ctx.tenantId)
    .order("name", { ascending: true });

  const t = await getTranslations("orders.delivery.locations");

  const rows = (locations ?? []).map(
    (location): LocationsTableRow => ({
      id: location.id,
      name: location.name,
      address:
        [location.address_street, location.address_zip, location.address_city]
          .filter(Boolean)
          .join(", ") || "\u2014",
      active: location.active,
      toggleAction: toggleLocationAction.bind(null, location.id, !location.active),
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        back={{ href: "/ustawienia-dostaw", label: t("backToDelivery") }}
        title={t("title")}
        actions={
          <Button asChild>
            <Link href="/ustawienia-dostaw/punkty-odbioru/nowy">{t("newLocation")}</Link>
          </Button>
        }
      />

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <LocationsTable rows={rows} />
      )}
    </div>
  );
}
