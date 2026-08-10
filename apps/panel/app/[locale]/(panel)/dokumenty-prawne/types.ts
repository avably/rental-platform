/**
 * Kształt danych ekranu dokumentów prawnych (B4, ADR-129).
 *
 * Osobny moduł, bo czytają go OBA warianty ekranu (formularz właściciela i
 * lista odczytowa personelu) oraz strona serwerowa, która je składa. Daty są
 * już SFORMATOWANE: formatowanie należy do serwera (`getFormatter`), żeby
 * komponent kliencki nie musiał znać strefy ani języka najemcy.
 */
import type { LegalDocumentKind, LegalDocumentLocale } from "@/lib/legal-documents";

export interface LegalVersionView {
  id: string;
  versionNo: number;
  versionLabel: string;
  publishedAtLabel: string;
  /** Pierwsze 12 znaków sha256 — do porównania „ta sama treść?" na oko. */
  checksum: string;
}

export interface LegalDocumentView {
  kind: LegalDocumentKind;
  title: string;
  bodyDraft: string;
  locale: LegalDocumentLocale;
  /** Etykieta ŻYWEJ wersji albo `null` — dokument nieopublikowany. */
  currentVersionLabel: string | null;
  currentPublishedAtLabel: string | null;
  /** Rejestr wersji, od najnowszej. Pusty, dopóki nikt nie kliknął „Opublikuj". */
  versions: LegalVersionView[];
}
