import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/**
 * Pusty stan listy (sekcja 07 artefaktu) — ADR-057.
 *
 * Copy PL jest WPROST z artefaktu i przypięte kontraktem
 * (`orders-copy-contract.test.ts`): pusty ekran to miejsce, w którym produkt
 * najłatwiej zaczyna mówić innym głosem niż reszta systemu.
 *
 * Dwie akcje, bo pierwsze zamówienie wymaga katalogu: „Dodaj zamówienie" dla
 * tenanta, który ma już produkty, i wyjście do katalogu dla tego, który nie ma.
 * Znaku marki z artefaktu tu nie ma — panel nie dostał w P3 komponentu znaku,
 * a dorabianie go w pasie ekranów byłoby wyjściem poza P4.
 */
export function OrdersEmptyState() {
  const t = useTranslations("orders.emptyState");

  return (
    <div
      data-screen="empty"
      className="border-border bg-card flex flex-col items-start gap-4 rounded-lg border p-8"
    >
      <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("title")}</h2>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/zamowienia/nowe">{t("addOrder")}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/katalog">{t("goToCatalog")}</Link>
        </Button>
      </div>
    </div>
  );
}
