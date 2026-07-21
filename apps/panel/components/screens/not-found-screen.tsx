import { Button } from "@avably/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

/**
 * Ekran 404 podstron panelu (sekcja 07 artefaktu) — ADR-058.
 *
 * KOD I TYTUŁ SĄ WSPÓŁDZIELONE, nie kopiowane. Obie treści przypiął do
 * artefaktu kontrakt P4 (`orders-copy-contract.test.ts`) pod kluczami
 * `orders.notFound.*` — artefakt pokazuje 404 tylko raz, w kontekście
 * zamówień, więc tam wylądował ich dom. Przepisanie tych samych zdań pod
 * `catalog.notFound.*` dałoby drugą kopię copy przypiętego do artefaktu,
 * czyli dokładnie to, czego zakazuje brief; przenoszenie klucza do
 * wspólnej przestrzeni ruszałoby zielony kontrakt P4 bez zysku.
 *
 * RÓŻNI SIĘ TYLKO WYJŚCIE — każdy ekran podaje własne, prowadzące tam, gdzie
 * operator ma co robić.
 */
export async function NotFoundScreen({
  back,
}: {
  back: { href: string; label: string };
}) {
  const t = await getTranslations("orders.notFound");

  return (
    <div
      data-screen="not-found"
      className="border-border bg-card flex flex-col items-start gap-4 rounded-lg border p-8"
    >
      <p className="text-muted-foreground text-2xl font-semibold tabular-nums">{t("code")}</p>
      <h1 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("title")}</h1>
      <Button asChild>
        <Link href={back.href}>{back.label}</Link>
      </Button>
    </div>
  );
}
