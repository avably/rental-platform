import { Button } from "@avably/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

/**
 * 404 szczegółu zamówienia (sekcja 07 artefaktu) — ADR-057.
 *
 * Copy PL wprost z artefaktu, przypięte kontraktem
 * (`orders-copy-contract.test.ts`). Wyjście jest JEDNO i prowadzi tam, gdzie
 * operator ma co robić: na listę zamówień.
 */
export default async function OrderNotFound() {
  const t = await getTranslations("orders.notFound");

  return (
    <div
      data-screen="not-found"
      className="border-border bg-card flex flex-col items-start gap-4 rounded-lg border p-8"
    >
      <p className="text-muted-foreground text-2xl font-semibold tabular-nums">{t("code")}</p>
      <h1 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("title")}</h1>
      <Button asChild>
        <Link href="/zamowienia">{t("backToOrders")}</Link>
      </Button>
    </div>
  );
}
