import { Button } from "@avably/ui";
import { getTranslations } from "next-intl/server";

import { ScreenHeader } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import { fetchCategories } from "@/lib/catalog/categories";
import { requireMemberPage } from "@/lib/member-page";

import { deleteCategoryAction, moveCategoryAction } from "./actions";
import { CategoriesTable, type CategoryTableRow } from "./categories-table";

/**
 * Kategorie katalogu (ADR-155) — wejście z ekranu katalogu.
 *
 * DLACZEGO TUTAJ, a nie własną pozycją w menu: kategoria opisuje KATALOG, więc
 * mieszka przy katalogu — dokładnie tak, jak import CSV (przycisk na liście,
 * nie pozycja w nawigacji). Struktura menu zostaje NIETKNIĘTA (kontrakt liczby
 * pozycji z artefaktu Fazy 2).
 *
 * `kategorie` jest STATYCZNYM segmentem RÓWNOLEGŁYM do `[id]`, więc nie wchodzi
 * pod powłokę karty produktu — segment statyczny wygrywa z dynamicznym przy
 * dopasowaniu trasy (ta sama zależność, co przy `/katalog/nowy` i `/katalog/import`).
 *
 * `force-dynamic`: trasa interaktywna (formularze akcji w wierszach) —
 * statyczny prerender + nonce CSP wycięłyby skrypty i strona nie zhydratowałaby
 * się BEZ ŻADNEGO błędu w konsoli (ADR-083).
 */
export const dynamic = "force-dynamic";

const LIST_PATH = "/katalog/kategorie";

export default async function CatalogCategoriesPage() {
  const ctx = await requireMemberPage(LIST_PATH);
  const categories = await fetchCategories(ctx.supabase, ctx.tenantId!);
  const t = await getTranslations("catalog.categories");

  const rows: CategoryTableRow[] = categories.map((category, index) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    productCount: category.productCount,
    first: index === 0,
    last: index === categories.length - 1,
    moveUpAction: moveCategoryAction.bind(null, category.id, "up"),
    moveDownAction: moveCategoryAction.bind(null, category.id, "down"),
    deleteAction: deleteCategoryAction.bind(null, category.id),
  }));

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        back={{ href: "/katalog", label: t("backToCatalog") }}
        title={t("title")}
        actions={
          <Button asChild>
            <Link href={`${LIST_PATH}/nowa`}>{t("newCategory")}</Link>
          </Button>
        }
      />

      <p className="text-muted-foreground text-sm">{t("intro")}</p>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-categories-empty>
          {t("empty")}
        </p>
      ) : (
        <CategoriesTable rows={rows} canDelete={ctx.role === "owner"} />
      )}
    </div>
  );
}
