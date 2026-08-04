import { getTranslations } from "next-intl/server";

import { ScreenHeader } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import { createLocationAction } from "../actions";
import { LocationForm } from "../location-form";

export default async function NewPickupLocationPage() {
  await requireMemberPage("/ustawienia-dostaw/punkty-odbioru/nowy");
  const t = await getTranslations("orders.delivery.locations");

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        back={{ href: "/ustawienia-dostaw/punkty-odbioru", label: t("backToList") }}
        title={t("createTitle")}
      />
      <LocationForm
        action={createLocationAction}
        defaults={{ name: "", addressStreet: "", addressZip: "", addressCity: "", active: true }}
      />
    </div>
  );
}
