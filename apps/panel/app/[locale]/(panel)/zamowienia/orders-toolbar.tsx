import { Button, Input } from "@avably/ui";
import { ORDER_STATUSES, type OrderStatus } from "@avably/core";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { PanelSelect } from "@/components/fields/panel-select";
import { DATE_PRESETS, type DatePreset } from "@/lib/orders/date-presets";
import type { OrdersFilter } from "@/lib/order-validation";

import { OrdersDateFilter } from "./orders-date-filter";

/**
 * Belka listy zamówień (uwaga przeglądu U1, ADR-057).
 *
 * Na wierzchu: WYSZUKIWARKA (główny sposób zawężania, zastępuje picker klienta)
 * z licznikiem „N wyników" i szybkie chipy zakresu terminu. Pod „Filtry
 * zaawansowane" (<details>, składane bez JS): status, własny zakres dat i wybór
 * klienta.
 *
 * WSZYSTKIE chipy to LINKI (stan w URL, GET), a nie przyciski submit w jednym
 * formularzu: przy kilku niezależnych grupach chipów submit wysyła wyłącznie
 * wartość KLIKNIĘTEGO przycisku i po cichu zeruje pozostałe grupy. Link
 * zachowuje komplet parametrów, więc wyszukiwarka + status + termin składają
 * się bez gubienia się nawzajem. Wyszukiwarka i własny zakres to jedyne
 * formularze — bo mają realne pola tekstowe.
 */
const PRESET_LABEL_KEY: Record<DatePreset, string> = {
  "biezacy-miesiac": "presetThisMonth",
  "przyszly-miesiac": "presetNextMonth",
  "najblizsze-14-dni": "presetNext14",
};

type CommittedParams = {
  q?: string;
  status?: string;
  od?: string;
  do?: string;
  klient?: string;
  preset?: string;
  sort?: string;
  dir?: string;
};

export function OrdersToolbar({
  filter,
  customers,
  resultCount,
}: {
  filter: OrdersFilter;
  customers: { id: string; email: string; full_name: string | null }[];
  resultCount: number;
}) {
  const t = useTranslations("orders.list");
  const tStatus = useTranslations("orders.statusLabels.order");

  const committed: CommittedParams = {
    q: filter.q,
    status: filter.status,
    od: filter.od,
    do: filter.do,
    klient: filter.klient,
    preset: filter.preset,
    sort: filter.sort,
    dir: filter.dir,
  };

  // Link zachowujący pozostałe parametry — `patch: undefined` usuwa parametr.
  const hrefFor = (patch: Partial<CommittedParams>): string => {
    const merged = { ...committed, ...patch };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value != null && value !== "") search.set(key, value);
    }
    const qs = search.toString();
    return qs ? `/zamowienia?${qs}` : "/zamowienia";
  };

  const chipClass =
    "inline-flex cursor-pointer items-center rounded-md border border-transparent bg-secondary px-3.5 py-2 text-[13px] leading-none font-semibold text-secondary-foreground no-underline outline-none transition-[color,background-color,border-color,text-decoration-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring aria-pressed:border-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground";

  const field =
    "border-input bg-background text-foreground h-9 rounded-md border px-3 text-sm outline-none transition-[border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring";

  return (
    <div className="flex flex-col gap-3">
      {/* Wyszukiwarka + licznik. Ukryte pola niosą pozostałe zatwierdzone
          parametry, żeby szukanie ich nie gubiło (i odwrotnie). */}
      <form method="get" action="/zamowienia" className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <PreservedParams committed={committed} exclude={["q"]} />
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
            data-orders-search
            className="h-10 pl-9"
          />
          <button type="submit" className="sr-only">
            {t("searchLabel")}
          </button>
        </div>
        <span
          data-orders-result-count
          className="text-muted-foreground shrink-0 text-sm tabular-nums"
          aria-live="polite"
        >
          {t("results", { count: resultCount })}
        </span>
      </form>

      {/* Szybkie zakresy terminu — chip aktywny przełącza się z powrotem na
          brak zakresu (drugi klik zdejmuje filtr). */}
      <div className="flex flex-wrap gap-2">
        {DATE_PRESETS.map((preset) => {
          const active = filter.preset === preset;
          return (
            <Link
              key={preset}
              href={hrefFor(
                active
                  ? { preset: undefined, od: undefined, do: undefined }
                  : { preset, od: undefined, do: undefined },
              )}
              aria-pressed={active}
              className={chipClass}
            >
              {t(PRESET_LABEL_KEY[preset])}
            </Link>
          );
        })}
      </div>

      <details className="border-border bg-card rounded-lg border px-4 py-3">
        <summary className="text-foreground cursor-pointer text-sm font-medium select-none">
          {t("advancedFilters")}
        </summary>

        <div className="mt-3 flex flex-col gap-4">
          {/* Status — jako chipy-linki (grupa niezależna od zakresu i klienta). */}
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
              {t("filterStatus")}
            </span>
            <div className="flex flex-wrap gap-2">
              <Link href={hrefFor({ status: undefined })} aria-pressed={!filter.status} className={chipClass}>
                {t("filterAll")}
              </Link>
              {ORDER_STATUSES.map((status: OrderStatus) => {
                const active = filter.status === status;
                return (
                  <Link
                    key={status}
                    href={hrefFor({ status: active ? undefined : status })}
                    aria-pressed={active}
                    className={chipClass}
                  >
                    {tStatus(status)}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Własny zakres terminu + klient — formularz (realne pola). Apply NIE
              niesie presetu: własny zakres i preset wykluczają się. */}
          <form method="get" action="/zamowienia" className="flex flex-wrap items-end gap-3 text-sm">
            <PreservedParams committed={committed} exclude={["od", "do", "klient", "preset"]} />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="filter-termin"
                className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase"
              >
                {t("filterTerm")}
              </label>
              <OrdersDateFilter id="filter-termin" defaultFrom={filter.od ?? ""} defaultTo={filter.do ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="filter-klient"
                className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase"
              >
                {t("filterCustomer")}
              </label>
              <PanelSelect
                id="filter-klient"
                name="klient"
                defaultValue={filter.klient ?? ""}
                className={field}
                options={[
                  { value: "", label: t("filterAnyCustomer") },
                  ...customers.map((customer) => ({
                    value: customer.id,
                    label: customer.full_name
                      ? `${customer.full_name} (${customer.email})`
                      : customer.email,
                  })),
                ]}
              />
            </div>
            <Button type="submit" variant="outline">
              {t("apply")}
            </Button>
            <Button asChild variant="ghost">
              <Link href="/zamowienia">{t("clear")}</Link>
            </Button>
          </form>
        </div>
      </details>
    </div>
  );
}

/** Ukryte pola niosące zatwierdzone parametry przez submit (poza `exclude`). */
function PreservedParams({
  committed,
  exclude,
}: {
  committed: CommittedParams;
  exclude: (keyof CommittedParams)[];
}) {
  return (
    <>
      {(Object.entries(committed) as [keyof CommittedParams, string | undefined][])
        .filter(([key, value]) => value != null && value !== "" && !exclude.includes(key))
        .map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
    </>
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
