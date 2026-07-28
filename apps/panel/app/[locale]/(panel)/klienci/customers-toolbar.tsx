import { Input } from "@avably/ui";
import { useTranslations } from "next-intl";

import type { CustomersFilter } from "@/lib/customer-validation";

/**
 * Belka listy klientów (R6a) — odchudzona wersja belki zamówień: sama
 * WYSZUKIWARKA (po nazwisku / mailu / telefonie) z licznikiem „N wyników".
 * Klientów nie filtruje się po statusie ani terminie, więc wiersza filtrów
 * zaawansowanych tu nie ma.
 *
 * Formularz GET: sort/dir jadą ukrytymi polami, żeby szukanie ich nie gubiło
 * (wzorzec `PreservedParams` z belki zamówień).
 */
export function CustomersToolbar({
  filter,
  resultCount,
}: {
  filter: CustomersFilter;
  resultCount: number;
}) {
  const t = useTranslations("customers.list");

  return (
    <form
      method="get"
      action="/klienci"
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      {filter.sort ? <input type="hidden" name="sort" value={filter.sort} /> : null}
      {filter.dir ? <input type="hidden" name="dir" value={filter.dir} /> : null}
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
          data-customers-search
          className="h-10 pl-9"
        />
        <button type="submit" className="sr-only">
          {t("searchLabel")}
        </button>
      </div>
      <span
        data-customers-result-count
        className="text-muted-foreground shrink-0 text-sm tabular-nums"
        aria-live="polite"
      >
        {t("results", { count: resultCount })}
      </span>
    </form>
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
