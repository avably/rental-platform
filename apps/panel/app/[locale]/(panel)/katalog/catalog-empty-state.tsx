import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/**
 * Pusty stan katalogu (forma sekcji 07 artefaktu) — ADR-058.
 *
 * COPY JEST NASZE, nie z artefaktu: sekcja 07 pokazuje pusty stan wyłącznie
 * dla listy zamówień, a katalog nie ma tam swojego bloku. Napisane w TONIE
 * artefaktu (krótkie stwierdzenie stanu + konkretne wezwanie), ale nie da się
 * go przypiąć kontraktem do źródła, którego nie ma — dlatego odstępstwo jest
 * spisane w ADR-058 i zgłoszone w raporcie, zamiast udawać cytat.
 *
 * JEDNA akcja, od 2026-08-04: dodanie produktu. Drugie wezwanie prowadziło do
 * punktów odbioru, a te przeprowadziły się do Dostaw — pusty magazyn zaprasza
 * do napełnienia magazynu, nie do konfiguracji wydawania. Znaku marki z
 * artefaktu tu nie ma — ta sama decyzja co w P4.
 */
export function CatalogEmptyState() {
  const t = useTranslations("catalog.emptyState");
  const tList = useTranslations("catalog.list");

  return (
    <div
      data-screen="empty"
      className="border-border bg-card flex flex-col items-start gap-4 rounded-lg border p-8"
    >
      <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("title")}</h2>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/katalog/nowy">{tList("newProduct")}</Link>
        </Button>
      </div>
    </div>
  );
}
