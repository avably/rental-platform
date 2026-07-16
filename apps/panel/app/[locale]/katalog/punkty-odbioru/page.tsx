import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@avably/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";

import { toggleLocationAction } from "./actions";
import { ToggleLocationButton } from "./toggle-button";

export default async function PickupLocationsPage() {
  const ctx = await requireMemberPage("/katalog/punkty-odbioru");

  const { data: locations } = await ctx.supabase
    .from("pickup_locations")
    .select("id, name, address_street, address_zip, address_city, active")
    .eq("tenant_id", ctx.tenantId)
    .order("name", { ascending: true });

  const t = await getTranslations("catalog.locations");

  const rows = locations ?? [];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/katalog">
        {t("backToCatalog")}
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Button asChild>
          <Link href="/katalog/punkty-odbioru/nowy">{t("newLocation")}</Link>
        </Button>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colName")}</TableHead>
              <TableHead>{t("colAddress")}</TableHead>
              <TableHead>{t("colActive")}</TableHead>
              <TableHead>{t("colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((location) => (
              <TableRow key={location.id}>
                <TableCell className="font-medium">
                  <Link className="underline" href={`/katalog/punkty-odbioru/${location.id}`}>
                    {location.name}
                  </Link>
                </TableCell>
                <TableCell>
                  {[location.address_street, location.address_zip, location.address_city]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={location.active ? "default" : "outline"}>
                    {location.active ? t("activeYes") : t("activeNo")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <ToggleLocationButton
                    action={toggleLocationAction.bind(null, location.id, !location.active)}
                    nextActive={!location.active}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
