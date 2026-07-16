import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";

import { createLocationAction } from "../actions";
import { LocationForm } from "../location-form";

export default async function NewPickupLocationPage() {
  await requireMemberPage("/katalog/punkty-odbioru/nowy");
  const t = await getTranslations("catalog.locations");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/katalog/punkty-odbioru">
        {t("backToList")}
      </Link>
      <h1 className="text-xl font-semibold">{t("createTitle")}</h1>
      <LocationForm
        action={createLocationAction}
        defaults={{ name: "", addressStreet: "", addressZip: "", addressCity: "", active: true }}
      />
    </main>
  );
}
