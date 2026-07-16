import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
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
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/katalog/punkty-odbioru">
        {t("backToList")}
      </Link>
      <h1 className="text-xl font-semibold">{t("editTitle", { name: location.name })}</h1>
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
    </main>
  );
}
