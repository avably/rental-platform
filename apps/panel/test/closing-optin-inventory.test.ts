/**
 * INWENTARZ-SNAPSHOT opt-in okna domykania (Zasada 8, ADR-138) — spec (e)9.
 *
 * Test kompletności w wersji „nieklasyfikowana akcja się zapali" jest przy
 * fail-closed NIEWYKONALNY: brak wpisu jest bezpieczny i cichy. Dlatego
 * pilnujemy ODWROTNEJ strony: zatwierdzonej listy wywołań, które opt-in
 * `{ closing: true }` MAJĄ. Dodanie flagi w jakimkolwiek pliku (albo
 * dodatkowego wystąpienia w pliku już obecnym) ŁAMIE ten test — rozszerzenie
 * allowlisty okna musi przejść przez recenzję i świadomą zmianę snapshotu,
 * nigdy przez sam diff funkcyjny.
 *
 * Wzorzec skanu: literał `{ closing: true })` — czyli ARGUMENT wywołania
 * (requireMember / requireMemberPage), nie wzmianka w komentarzu.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const PANEL_ROOT = join(__dirname, "..");
const SCAN_DIRS = ["app", "lib", "components"] as const;
const OPT_IN_PATTERN = /\{ closing: true \}\)/g;

/**
 * ZATWIERDZONA ALLOWLISTA (ADR-138) — lustro tabeli DZIAŁA z rozstrzygnięcia
 * Zasady 8: liczba wystąpień `{ closing: true })` per plik.
 */
const APPROVED_OPT_INS: Record<string, number> = {
  // Lista i szczegół zamówień (strony) + sekcje RSC szczegółu.
  "app/[locale]/(panel)/zamowienia/page.tsx": 1,
  "app/[locale]/(panel)/zamowienia/[id]/page.tsx": 1,
  "app/[locale]/(panel)/zamowienia/[id]/contract-section.tsx": 1,
  "app/[locale]/(panel)/zamowienia/[id]/delivery-section.tsx": 1,
  "app/[locale]/(panel)/zamowienia/[id]/email-log-section.tsx": 1,
  "app/[locale]/(panel)/zamowienia/[id]/invoice-section.tsx": 1,
  // Wydanie/zwrot (pojedynczo, zbiorczo) + mail o zmianie statusu.
  "app/[locale]/(panel)/zamowienia/actions.ts": 3,
  // Kaucja: pobranie ręczne + rozliczenie.
  "app/[locale]/(panel)/zamowienia/[id]/deposit-actions.ts": 2,
  // Umowa: wspólny kontekst obu akcji + PDF route.
  "app/[locale]/(panel)/zamowienia/[id]/contract-actions.ts": 1,
  "app/[locale]/(panel)/zamowienia/[id]/contract/[documentId]/route.ts": 1,
  // Kurier: komplet 7 akcji + etykieta PDF.
  "app/[locale]/(panel)/zamowienia/[id]/delivery-actions.ts": 7,
  "app/[locale]/(panel)/zamowienia/[id]/delivery-label/route.ts": 1,
  // Sprawdzenie płatności i faktura.
  "app/[locale]/(panel)/zamowienia/[id]/payment-actions.ts": 1,
  "app/[locale]/(panel)/zamowienia/[id]/invoice-actions.ts": 1,
  // Notatki (dodanie, edycja, usunięcie).
  "app/[locale]/(panel)/zamowienia/[id]/notes-actions.ts": 3,
  // Podgląd treści maila.
  "app/[locale]/(panel)/zamowienia/[id]/email-body-actions.ts": 1,
  // Klienci: odczyt (obie strony) + RODO erase (owner-only).
  "app/[locale]/(panel)/klienci/page.tsx": 1,
  "app/[locale]/(panel)/klienci/[id]/page.tsx": 1,
  "app/[locale]/(panel)/klienci/[id]/actions.ts": 1,
  // Eksport danych: ekran + wspólny handler trzech route'ów.
  "app/[locale]/(panel)/eksport-danych/page.tsx": 1,
  "lib/export/route-handler.ts": 1,
  // Organizacja (read-only; sekcja rozliczeń = droga zapłaty).
  "app/[locale]/(panel)/organizacja/page.tsx": 1,
};

function scanFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      scanFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

describe("inwentarz-snapshot wywołań z { closing: true } (ADR-138)", () => {
  it("zbiór plików i liczba wystąpień per plik są DOKŁADNIE zatwierdzone", () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) scanFiles(join(PANEL_ROOT, dir), files);

    const found: Record<string, number> = {};
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const count = source.match(OPT_IN_PATTERN)?.length ?? 0;
      if (count > 0) found[relative(PANEL_ROOT, file)] = count;
    }

    expect(found).toEqual(APPROVED_OPT_INS);
  });

  it("test-przynęta: wzorzec skanu ŁAPIE formę wywołania guardu", () => {
    // Gdyby ktoś zmienił kształt opt-in (np. na obiekt opcji z innym polem),
    // skan mógłby po cichu liczyć zero. Przynęta trzyma wzorzec przy życiu.
    const bait = 'await requireMember(undefined, { closing: true });';
    expect(bait.match(OPT_IN_PATTERN)?.length).toBe(1);
  });

  it("suma wywołań z opt-in zgadza się z raportowaną w ADR-138", () => {
    const total = Object.values(APPROVED_OPT_INS).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(33);
  });
});
