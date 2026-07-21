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
import { formatMoney } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { getTenantCurrency } from "@/lib/tenant-currency";

interface ProductRow {
  id: string;
  name: string;
  base_price_day_grosze: number;
  deposit_grosze: number;
  active: boolean;
  product_units: { count: number }[];
}

export default async function CatalogPage() {
  const ctx = await requireMemberPage("/katalog");

  const { data: products } = await ctx.supabase
    .from("products")
    .select("id, name, base_price_day_grosze, deposit_grosze, active, product_units(count)")
    .eq("tenant_id", ctx.tenantId)
    .order("name", { ascending: true });

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("catalog.list");

  const rows = (products ?? []) as ProductRow[];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <nav className="flex items-center gap-3">
          <Link className="text-sm underline" href="/katalog/punkty-odbioru">
            {t("locationsLink")}
          </Link>
          <Button asChild>
            <Link href="/katalog/nowy">{t("newProduct")}</Link>
          </Button>
        </nav>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colName")}</TableHead>
              <TableHead>{t("colPricePerDay")}</TableHead>
              <TableHead>{t("colDeposit")}</TableHead>
              <TableHead>{t("colActive")}</TableHead>
              <TableHead>{t("colUnits")}</TableHead>
              <TableHead>{t("colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="font-medium">
                  <Link className="underline" href={`/katalog/${product.id}`}>
                    {product.name}
                  </Link>
                </TableCell>
                <TableCell>{formatMoney(product.base_price_day_grosze, currency, locale)}</TableCell>
                <TableCell>{formatMoney(product.deposit_grosze, currency, locale)}</TableCell>
                <TableCell>
                  <Badge variant={product.active ? "default" : "outline"}>
                    {product.active ? t("activeYes") : t("activeNo")}
                  </Badge>
                </TableCell>
                <TableCell>{product.product_units[0]?.count ?? 0}</TableCell>
                <TableCell>
                  <span className="flex gap-3 text-sm">
                    <Link className="underline" href={`/katalog/${product.id}/egzemplarze`}>
                      {t("unitsLink")}
                    </Link>
                    <Link className="underline" href={`/katalog/${product.id}/progi`}>
                      {t("tiersLink")}
                    </Link>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
