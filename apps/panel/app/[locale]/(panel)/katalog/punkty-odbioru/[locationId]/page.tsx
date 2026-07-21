import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ScreenHeader } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import { updateLocationAction } from "../actions";
import { LocationForm } from "../location-form";

export default async function EditPickupLocationPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = await params;
  const ctx = await requireMemberPage(`/katalog/punkty-odbioru/${locationId}`);

  const { data: location } = await ctx.supabase
    .from("pickup_locations")
    .select("id, name, address_street, address_zip, address_city, active")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", locationId)
    .maybeSingle();

  if (!location) notFound();

  const t = await getTranslations("catalog.locations");

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        back={{ href: "/katalog/punkty-odbioru", label: t("backToList") }}
        title={t("editTitle", { name: location.name })}
      />
      <LocationForm
        action={updateLocationAction.bind(null, location.id)}
        defaults={{
          name: location.name,
          addressStreet: location.address_street ?? "",
          addressZip: location.address_zip ?? "",
          addressCity: location.address_city ?? "",
          active: location.active,
        }}
      />
    </div>
  );
}
