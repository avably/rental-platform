import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";

import type { ExportErrorCode } from "@/lib/export/route-handler";

import { ExportOrdersRange } from "./export-orders-range";

/**
 * Ekran „Eksport danych" (C2, ADR-111) — KOMPONENT PREZENTACYJNY, zero I/O.
 *
 * Trzy karty = trzy zbiory (zamówienia / klienci / katalog). Każda karta to
 * NATYWNY formularz POST prosto w route handler — świadomie bez JS:
 *  • POST, nie GET — parametry eksportu nie wchodzą do URL ani historii
 *    przeglądarki (zasada „zero danych osobowych w URL", ADR-111),
 *  • odpowiedź z `content-disposition: attachment` zostawia stronę na
 *    miejscu, więc nie potrzeba żadnego stanu klienta,
 *  • błędy miękkie (limit wierszy, zły zakres dat) wracają redirectem 303
 *    z kodem w query — baner na górze tłumaczy kod przez next-intl.
 *
 * Karta klientów renderuje formularz WYŁĄCZNIE ownerowi — ale UI jest tu
 * tylko lustrem: bramka roli żyje w rdzeniu eksportu (lib/export/customers)
 * i w guardzie route handlera.
 */
export function ExportView({
  locale,
  isOwner,
  error,
}: {
  locale: string;
  isOwner: boolean;
  error: ExportErrorCode | null;
}) {
  const t = useTranslations("dataExport");
  const action = (slug: string) => `/${locale}/eksport-danych/${slug}`;

  return (
    <div className="flex flex-col gap-4" data-export-screen="true">
      <p className="text-muted-foreground text-sm">{t("intro")}</p>

      {error ? (
        <p
          data-export-error={error}
          role="alert"
          className="border-destructive/50 text-destructive rounded-md border px-4 py-3 text-sm"
        >
          {error === "limit" ? t("errorLimit") : t("errorRange")}
        </p>
      ) : null}

      {/* Tytuły kart to h2, nie h3: jedyny h1 ekranu niesie belka shella
          (ADR-060), a h3 przeskakiwało poziom konspektu (M-A11Y-01, audyt
          17.08). Rozmiar niesie klasa; pilnuje heading-hierarchy-contract. */}
      <section className="border-border rounded-lg border p-5" data-export-card="orders">
        <h2 className="text-base font-semibold">{t("orders.title")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t("orders.description")}</p>
        <form method="post" action={action("zamowienia")} className="mt-4 flex flex-wrap items-end gap-3">
          <ExportOrdersRange />
          <Button type="submit" data-export-submit="orders">
            {t("orders.submit")}
          </Button>
        </form>
      </section>

      <section className="border-border rounded-lg border p-5" data-export-card="customers">
        <h2 className="text-base font-semibold">{t("customers.title")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t("customers.description")}</p>
        {isOwner ? (
          <form method="post" action={action("klienci")} className="mt-4">
            <Button type="submit" data-export-submit="customers">
              {t("customers.submit")}
            </Button>
          </form>
        ) : (
          <p className="text-muted-foreground mt-4 text-sm" data-export-owner-only="true">
            {t("customers.ownerOnly")}
          </p>
        )}
      </section>

      <section className="border-border rounded-lg border p-5" data-export-card="catalog">
        <h2 className="text-base font-semibold">{t("catalog.title")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t("catalog.description")}</p>
        <form method="post" action={action("katalog")} className="mt-4">
          <Button type="submit" data-export-submit="catalog">
            {t("catalog.submit")}
          </Button>
        </form>
      </section>
    </div>
  );
}
