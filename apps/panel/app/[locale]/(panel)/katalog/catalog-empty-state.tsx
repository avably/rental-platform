import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/**
 * Puste stany katalogu (forma sekcji 07 artefaktu) — ADR-058, rozdzielone
 * w U8a (ADR-145).
 *
 * COPY JEST NASZE, nie z artefaktu: sekcja 07 pokazuje pusty stan wyłącznie
 * dla listy zamówień, a katalog nie ma tam swojego bloku. Napisane w TONIE
 * artefaktu (krótkie stwierdzenie stanu + konkretne wezwanie), ale nie da się
 * go przypiąć kontraktem do źródła, którego nie ma — dlatego odstępstwo jest
 * spisane w ADR-058 i zgłoszone w raporcie, zamiast udawać cytat.
 *
 * DWA PUSTE STANY, NIE JEDEN (U8a). Do U8a katalog miał jeden komunikat dla
 * dwóch zupełnie różnych sytuacji, a to są dwa różne problemy operatora i dwa
 * różne wyjścia:
 *
 *   * PUSTY MAGAZYN (dzień zero) — nie ma czego szukać; jedyne sensowne
 *     wezwanie to dodać pierwszy produkt. „Wyczyść filtry" byłoby tu
 *     bezsensowne (nie ma żadnych filtrów do wyczyszczenia), a „Pusty
 *     magazyn" na ekranie z aktywną frazą byłoby wprost NIEPRAWDĄ —
 *     magazyn jest pełny, to fraza nie trafiła.
 *   * FILTR NIC NIE ZNALAZŁ — produkty SĄ; wyjściem jest zdjęcie zawężenia,
 *     więc ekran daje link czyszczący, a nie zaproszenie do zakładania
 *     kolejnej pozycji.
 *
 * JEDNA akcja w stanie dnia zero, od 2026-08-04: dodanie produktu. Drugie
 * wezwanie prowadziło do punktów odbioru, a te przeprowadziły się do Dostaw —
 * pusty magazyn zaprasza do napełnienia magazynu, nie do konfiguracji
 * wydawania. Znaku marki z artefaktu tu nie ma — ta sama decyzja co w P4.
 */
export function CatalogEmptyState() {
  const t = useTranslations("catalog.emptyState");
  const tList = useTranslations("catalog.list");

  return (
    <div
      data-screen="empty"
      data-catalog-empty="brak-produktow"
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

/**
 * Wyszukiwanie/filtr nic nie znalazły. Wezwanie prowadzi do CZYSTEJ listy
 * (`/katalog` bez parametrów), bo to jest ruch, który przywraca widok —
 * i jest linkiem, nie przyciskiem, żeby stan nadal mieszkał wyłącznie w URL.
 */
export function CatalogNoResultsState() {
  const t = useTranslations("catalog.emptyState");

  return (
    <div
      data-screen="empty"
      data-catalog-empty="brak-wynikow"
      className="border-border bg-card flex flex-col items-start gap-4 rounded-lg border p-8"
    >
      <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">
        {t("noResultsTitle")}
      </h2>
      <p className="text-muted-foreground text-sm">{t("noResultsBody")}</p>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="secondary">
          <Link href="/katalog" data-catalog-clear-filters>
            {t("clearFilters")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
