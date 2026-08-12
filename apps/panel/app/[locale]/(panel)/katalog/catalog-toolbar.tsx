import { Input } from "@avably/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  PRODUCT_STATUS_FILTERS,
  type ProductsFilter,
  type ProductStatusFilter,
} from "@/lib/catalog-validation";

/**
 * Belka listy katalogu (U8a).
 *
 * Dwa mechanizmy zawężania i ani jednego więcej, bo tyle unosi dziś model
 * danych: WYSZUKIWARKA po nazwie (z licznikiem „N pozycji") i CHIPY
 * PUBLIKACJI (aktywne / nieaktywne). Kategorii i tagów `products` nie ma —
 * patrz ADR-145, sekcja „co odłożone".
 *
 * CHIPY SĄ LINKAMI, nie przyciskami submit — ta sama lekcja co na belce
 * zamówień: przy kilku niezależnych grupach sterowania submit wysyła
 * wyłącznie wartość KLIKNIĘTEGO przycisku i po cichu zeruje resztę. Link
 * zachowuje komplet parametrów, więc fraza + status + sort składają się bez
 * gubienia się nawzajem. Formularzem jest wyłącznie wyszukiwarka, bo ma
 * realne pole tekstowe; jej ukryte pola niosą pozostałe zatwierdzone
 * parametry.
 *
 * Formularz jest GET-em (nawigacja RSC), więc nie ma tu klienckiego stanu
 * oczekiwania — i słusznie: bramka `pending-states-gate` celuje w mutacje.
 */
export function CatalogToolbar({
  filter,
  resultCount,
}: {
  filter: ProductsFilter;
  resultCount: number;
}) {
  const t = useTranslations("catalog.list");

  const committed: Record<string, string | undefined> = {
    q: filter.q,
    status: filter.status,
    sort: filter.sort,
    dir: filter.dir,
  };

  // Link zachowujący pozostałe parametry — `patch: undefined` usuwa parametr.
  const hrefFor = (patch: Record<string, string | undefined>): string => {
    const merged = { ...committed, ...patch };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value != null && value !== "") search.set(key, value);
    }
    const qs = search.toString();
    return qs ? `/katalog?${qs}` : "/katalog";
  };

  const chipClass =
    "inline-flex cursor-pointer items-center rounded-md border border-transparent bg-secondary px-3.5 py-2 text-[13px] leading-none font-semibold text-secondary-foreground no-underline outline-none transition-[color,background-color,border-color,text-decoration-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring aria-pressed:border-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground";

  const statusLabel: Record<ProductStatusFilter, string> = {
    aktywne: t("filterActive"),
    nieaktywne: t("filterInactive"),
  };

  return (
    <div className="flex flex-col gap-3">
      <form
        method="get"
        action="/katalog"
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
      >
        {Object.entries(committed)
          .filter(([key, value]) => key !== "q" && value != null && value !== "")
          .map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
        <div className="relative flex-1">
          <span
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          >
            <SearchGlyph />
          </span>
          <Input
            type="search"
            name="q"
            defaultValue={filter.q ?? ""}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchLabel")}
            data-catalog-search
            className="h-10 pl-9"
          />
          <button type="submit" className="sr-only">
            {t("searchLabel")}
          </button>
        </div>
        <span
          data-catalog-result-count
          className="text-muted-foreground shrink-0 text-sm tabular-nums"
          aria-live="polite"
        >
          {t("results", { count: resultCount })}
        </span>
      </form>

      <div className="flex flex-wrap items-center gap-2" data-catalog-status-filters>
        <Link
          href={hrefFor({ status: undefined })}
          aria-pressed={filter.status === undefined}
          data-catalog-status-chip="wszystkie"
          className={chipClass}
        >
          {t("filterAll")}
        </Link>
        {PRODUCT_STATUS_FILTERS.map((status) => (
          <Link
            key={status}
            href={hrefFor({ status })}
            aria-pressed={filter.status === status}
            data-catalog-status-chip={status}
            className={chipClass}
          >
            {statusLabel[status]}
          </Link>
        ))}
      </div>
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
