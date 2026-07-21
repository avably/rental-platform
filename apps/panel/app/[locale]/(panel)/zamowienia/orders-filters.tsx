import { Button, FilterChip, Input } from "@avably/ui";
import { ORDER_STATUSES, type OrderStatus } from "@avably/core";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { OrdersFilter } from "@/lib/order-validation";

/**
 * Zwarte filtry listy (sekcja 04 artefaktu: „Filtry zwarte", pigułka
 * „Wszystkie" jako stan domyślny) — ADR-057.
 *
 * FORMA jest nowa, MOŻLIWOŚCI zostają: oś statusu przechodzi z pola wyboru na
 * pigułki, ale termin od/do i klient filtrują dalej tak samo. Stan filtrów
 * nadal mieszka w URL (GET), więc widok listy da się podesłać linkiem.
 *
 * Każda pigułka to `submit` z `name="status"` — przeglądarka wysyła wartość
 * WYŁĄCZNIE wciśniętego przycisku, więc chip nadpisuje oś statusu, nie
 * gubiąc dat ani klienta z tego samego formularza.
 */
export function OrdersFilters({
  filter,
  customers,
}: {
  filter: OrdersFilter;
  customers: { id: string; email: string; full_name: string | null }[];
}) {
  const t = useTranslations("orders.list");
  const tStatus = useTranslations("orders.statusLabels.order");

  const field =
    "border-input bg-background text-foreground h-9 rounded-md border px-3 text-sm outline-none transition-[border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring";

  return (
    <form method="get" className="mb-4 flex flex-col gap-3">
      {/*
        Submit domyślny dla Entera w polu daty. HTML aktywuje PIERWSZY przycisk
        submit formularza — bez tego Enter trafiłby w pigułkę „Wszystkie" i po
        cichu zdejmował filtr statusu. Poza drzewem dostępności i poza tabem:
        to nie jest kontrolka do klikania, tylko deklaracja domyślnej akcji.
      */}
      <button
        type="submit"
        name="status"
        value={filter.status ?? ""}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      >
        {t("apply")}
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip type="submit" name="status" value="" pressed={!filter.status}>
          {t("filterAll")}
        </FilterChip>
        {ORDER_STATUSES.map((status: OrderStatus) => (
          <FilterChip
            key={status}
            type="submit"
            name="status"
            value={status}
            pressed={filter.status === status}
          >
            {tStatus(status)}
          </FilterChip>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="filter-od"
            className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase"
          >
            {t("filterFrom")}
          </label>
          <Input id="filter-od" type="date" name="od" defaultValue={filter.od ?? ""} className="w-auto" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="filter-do"
            className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase"
          >
            {t("filterTo")}
          </label>
          <Input id="filter-do" type="date" name="do" defaultValue={filter.do ?? ""} className="w-auto" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="filter-klient"
            className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase"
          >
            {t("filterCustomer")}
          </label>
          <select
            id="filter-klient"
            name="klient"
            defaultValue={filter.klient ?? ""}
            className={field}
          >
            <option value="">{t("filterAnyCustomer")}</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.full_name ? `${customer.full_name} (${customer.email})` : customer.email}
              </option>
            ))}
          </select>
        </div>
        {/* Ten submit też niesie bieżący status: przycisk bez `name` wysłałby
            formularz BEZ osi statusu, czyli po cichu ją czyścił. */}
        <Button type="submit" variant="outline" name="status" value={filter.status ?? ""}>
          {t("apply")}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/zamowienia">{t("clear")}</Link>
        </Button>
      </div>
    </form>
  );
}
