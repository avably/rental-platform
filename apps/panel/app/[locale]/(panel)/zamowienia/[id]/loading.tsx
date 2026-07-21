import { Skeleton } from "@avably/ui";
import { getTranslations } from "next-intl/server";

/**
 * Stan ładowania szczegółu (sekcja 07 artefaktu) — ADR-057.
 *
 * Szkielet odwzorowuje układ detalu: nagłówek, cztery pola kolumny głównej
 * i panel boczny. Statyczny, jak Skeleton z P2 (zakaz `extra-loops`).
 */
export default async function OrderDetailLoading() {
  const t = await getTranslations("orders.detail");

  return (
    <div data-screen="loading" aria-busy="true" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="w-32" />
        <Skeleton className="h-6 w-64" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          {[0, 1, 2, 3].map((field) => (
            <div key={field} className="flex flex-col gap-1.5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="w-56" />
            </div>
          ))}
        </div>
        <div className="border-border flex flex-col gap-6 lg:border-l lg:pl-6">
          <div className="flex gap-2">
            <Skeleton className="h-7 w-24 rounded-sm" />
            <Skeleton className="h-7 w-24 rounded-sm" />
          </div>
          {[0, 1, 2].map((field) => (
            <div key={field} className="flex flex-col gap-1.5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="w-40" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">{t("loading")}</span>
    </div>
  );
}
