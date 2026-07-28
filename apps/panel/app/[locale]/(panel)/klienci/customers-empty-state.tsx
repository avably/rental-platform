import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/**
 * Pusty stan listy klientów (R6a) — wzorzec `orders-empty-state.tsx`.
 *
 * Klient nie powstaje w panelu z palca: wpisuje go checkout przy pierwszym
 * zamówieniu (deduplikacja po lower(email) per tenant). Dlatego jedyna akcja
 * prowadzi do zamówień — tam zaczyna się droga, która wypełni tę listę.
 */
export function CustomersEmptyState() {
  const t = useTranslations("customers.emptyState");

  return (
    <div
      data-screen="empty"
      className="border-border bg-card flex flex-col items-start gap-4 rounded-lg border p-8"
    >
      <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("title")}</h2>
      <p className="text-muted-foreground text-sm">{t("body")}</p>
      <Button asChild>
        <Link href="/zamowienia">{t("goToOrders")}</Link>
      </Button>
    </div>
  );
}
