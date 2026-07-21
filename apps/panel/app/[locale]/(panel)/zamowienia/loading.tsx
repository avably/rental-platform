import { Skeleton } from "@avably/ui";
import { getTranslations } from "next-intl/server";

/**
 * Stan ładowania listy (sekcja 07 artefaktu) — ADR-057.
 *
 * Szkielet jest STATYCZNY (Skeleton z P2 nie pulsuje): twardy zakaz
 * `extra-loops` artefaktu wyklucza nieskończone animacje poza railem LP.
 * Paski są dekoracją (`aria-hidden` w komponencie), a informację o czekaniu
 * niesie `aria-busy` kontenera i tekst dla czytników.
 */
export default async function OrdersLoading() {
  const t = await getTranslations("orders.list");

  return (
    <div className="flex flex-col gap-4">
      <div
        data-screen="loading"
        aria-busy="true"
        className="border-border bg-card flex flex-col gap-px rounded-lg border p-3.5"
      >
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            data-skeleton-row={row + 1}
            className="grid grid-cols-[1.2fr_1.4fr_1.6fr_1.4fr_1fr_1.3fr_1.3fr_0.4fr] items-center gap-3 py-[18px]"
          >
            {[
              "id",
              "customer",
              "equipment",
              "date",
              "amount",
              "order-status",
              "payment-status",
              "actions",
            ].map((cell) => (
              <Skeleton key={cell} data-skeleton-cell data-cell={cell} />
            ))}
          </div>
        ))}
        <span className="sr-only">{t("loading")}</span>
      </div>
    </div>
  );
}
