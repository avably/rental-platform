import { Button } from "@avably/ui";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { CatalogEmptyState } from "./catalog-empty-state";
import { ProductsTable, type ProductsTableRow } from "./products-table";

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

  // Zapytanie NIETKNIĘTE co do znaku względem stanu sprzed restylingu:
  // te same kolumny, ten sam filtr tenanta, to samo sortowanie.
  const { data: products } = await ctx.supabase
    .from("products")
    .select("id, name, base_price_day_grosze, deposit_grosze, active, product_units(count)")
    .eq("tenant_id", ctx.tenantId)
    .order("name", { ascending: true });

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("catalog.list");
  const tImport = await getTranslations("catalogImport");

  const rows = ((products ?? []) as ProductRow[]).map(
    (product): ProductsTableRow => ({
      id: product.id,
      name: product.name,
      basePriceDayGrosze: product.base_price_day_grosze,
      depositGrosze: product.deposit_grosze,
      active: product.active,
      unitCount: product.product_units[0]?.count ?? 0,
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Punkty odbioru wyprowadzone do Dostaw (2026-08-04): katalog opisuje
          SPRZĘT, a punkt odbioru jest sposobem jego wydania — stoi więc obok
          kuriera i paczkomatu. Import CSV (C3, ADR-112) wraca tu jako druga
          akcja ŚWIADOMIE: to operacja NA katalogu (hurtowa edycja cennika),
          nie na jego otoczeniu — a wejście przyciskiem zamiast pozycją
          w nawigacji utrzymuje kontrakt struktury grup z artefaktu Fazy 2. */}
      <header className="mb-2 flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="secondary">
            <Link href="/katalog/import">{tImport("entry")}</Link>
          </Button>
          <Button asChild>
            <Link href="/katalog/nowy">{t("newProduct")}</Link>
          </Button>
        </div>
      </header>

      {rows.length === 0 ? (
        <CatalogEmptyState />
      ) : (
        <ProductsTable rows={rows} currency={currency} locale={locale} />
      )}
    </div>
  );
}
