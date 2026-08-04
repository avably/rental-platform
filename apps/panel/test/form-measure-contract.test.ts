import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Kontrakt miary formularza (P8 — artefakt Fazy 2, sekcja `form-measure`).
 *
 * Wzorzec `tokens-contract` / `status-contract` (ADR-053 D2, ADR-055):
 * kontrakt jest DWUKIERUNKOWY. Wartość czytamy z ARTEFAKTU
 * (`data-form-measure-contract`) i porównujemy z arkuszem panelu, więc mutacja
 * liczby po którejkolwiek stronie wywraca suitę. Handoff „projektant podał raz,
 * a kod pilnuje sam siebie" nie broni niczego: rok później artefakt mówi 42rem,
 * panel 36rem i nikt nie wie, które jest prawdą.
 *
 * Druga połowa kontraktu to UŻYCIE. Sam token w arkuszu jest martwy, jeśli
 * ekrany go nie wywołują — a każdy ekran, który wypadnie spod wspólnej miary,
 * musi wrócić do własnej klasy `max-w-*` i zapalić skan kontraktu spójności
 * (ADR-060). Obie bramki razem zamykają obie drogi ucieczki.
 */

const panelRoot = process.cwd();
const repositoryRoot = resolve(panelRoot, "../..");
const artifact = readFileSync(
  resolve(repositoryRoot, "docs/branding/2026-07-20-avably-faza-2-system.html"),
  "utf8",
);
const globals = readFileSync(resolve(panelRoot, "app/globals.css"), "utf8");

/** Komentarze wyjaśniają regułę i cytują jej liczbę — skan patrzy na KOD. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/** Reguła miary z kotwicy artefaktu — jedyne źródło liczby w tym teście. */
const contractMeasure = artifact.match(/data-form-measure-contract="([^"]+)"/)?.[1];

/** Powierzchnia handoffu: ta sama liczba zapisana jako CSS do przepisania. */
const measureSurface = decodeHtmlEntities(
  artifact.match(
    /<pre[^>]*data-code-surface="form-measure"[^>]*><code>([\s\S]*?)<\/code><\/pre>/,
  )?.[1] ?? "",
);

const SCREENS_UNDER_MEASURE = [
  // Osiem ekranów drugorzędnych P8 (+ wyzwanie MFA, trzeci stan osi security).
  "app/[locale]/(panel)/ustawienia-domen/page.tsx",
  "app/[locale]/(panel)/ustawienia-emaili/page.tsx",
  "app/[locale]/(panel)/historia-emaili/page.tsx",
  "app/[locale]/(panel)/ustawienia-dostaw/page.tsx",
  "app/[locale]/(panel)/ustawienia-umow/page.tsx",
  "app/[locale]/(panel)/ustawienia-platnosci/page.tsx",
  "app/[locale]/(panel)/zaproszenia/page.tsx",
  "app/[locale]/(panel)/organizacja/page.tsx",
  "app/[locale]/(panel)/bezpieczenstwo/page.tsx",
  "app/[locale]/(panel)/bezpieczenstwo/wyzwanie/page.tsx",
  // Formularze, które przed P8 miały WŁASNY wpis na whiteliście kontraktu
  // spójności — reguła artefaktu je wchłonęła.
  "app/[locale]/(panel)/katalog/product-form.tsx",
  "app/[locale]/(panel)/ustawienia-dostaw/punkty-odbioru/location-form.tsx",
  "app/[locale]/(panel)/zamowienia/nowe/order-wizard.tsx",
  "app/[locale]/(panel)/zamowienia/[id]/extension-form.tsx",
  // P8b/K1 — strona sklepu: miarę niesie SZUFLADA ustawień sekcji w kreatorze
  // (jedyny formularz tego ekranu po K1) oraz stan błędu ładowania. Płótno
  // zostaje poza miarą świadomie: to widok sklepu, a nie wiersz do czytania
  // i pole do wypełnienia. Launcher wypadł z listy, bo przestał mieć formularz.
  "app/[locale]/(kreator)/strona/kreator/section-settings-drawer.tsx",
  "app/[locale]/(panel)/strona/site-load-error.tsx",
] as const;

describe("kontrakt miary formularza — artefakt ↔ arkusz panelu", () => {
  it("artefakt niesie regułę miary i powierzchnię handoffu", () => {
    // Kontrola po pustym zbiorze: bez niej zniknięcie kotwicy z artefaktu
    // zamieniłoby wszystkie asercje niżej w porównania `undefined === undefined`.
    expect(contractMeasure, "brak data-form-measure-contract w artefakcie").toBeDefined();
    expect(contractMeasure).toMatch(/^[0-9.]+rem$/);
    expect(measureSurface, "brak powierzchni form-measure").toContain("--form-line-measure");
  });

  it("powierzchnia handoffu podaje tę samą liczbę co kotwica reguły", () => {
    const surfaceValue = measureSurface.match(/--form-line-measure:\s*([^;]+);/)?.[1]?.trim();
    expect(surfaceValue).toBe(contractMeasure);
  });

  it("arkusz panelu deklaruje miarę wartością Z ARTEFAKTU", () => {
    const declared = globals.match(/--form-line-measure:\s*([^;]+);/)?.[1]?.trim();
    expect(declared, "app/globals.css nie deklaruje --form-line-measure").toBeDefined();
    expect(declared).toBe(contractMeasure);
  });

  it("arkusz panelu wiąże atrybut z tokenem dokładnie jak artefakt", () => {
    const rule = globals.match(/\[data-form-line-measure\]\s*\{([\s\S]*?)\}/)?.[1];
    expect(rule, "brak reguły [data-form-line-measure] w app/globals.css").toBeDefined();
    expect(rule!.replace(/\s+/g, " ")).toContain("width: 100%");
    expect(rule!.replace(/\s+/g, " ")).toContain("max-width: var(--form-line-measure)");
  });

  it("miara nie jest zaszyta w żadnym pliku ekranu z palca", () => {
    // Druga strona dwukierunkowości: gdyby ekran wpisał 42rem u siebie,
    // zmiana liczby w artefakcie przestałaby cokolwiek zmieniać na ekranie.
    const offenders = SCREENS_UNDER_MEASURE.filter((path) =>
      stripComments(readFileSync(resolve(panelRoot, path), "utf8")).includes(contractMeasure!),
    );
    expect(offenders, `miara wpisana w ekranie: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("użycie wspólnej miary przez ekrany", () => {
  it("skan obejmuje realny zbiór ekranów", () => {
    expect(SCREENS_UNDER_MEASURE.length).toBe(16);
  });

  it.each(SCREENS_UNDER_MEASURE)("%s stoi pod wspólną miarą", (path) => {
    const source = readFileSync(resolve(panelRoot, path), "utf8");
    // Dwa legalne zapisy: opakowanie `<FormMeasure>` albo atrybut wprost na
    // formularzu, który sam jest całym blokiem miary (tak jak w artefakcie).
    //
    // Szukamy UŻYCIA, nie nazwy: sam import `FormMeasure` przechodził tę
    // bramkę także wtedy, gdy ekran wracał do własnego `max-w-*` i komponentu
    // już nie renderował (sprawdzone mutacją).
    expect(/<FormMeasure\b|data-form-line-measure/.test(source)).toBe(true);
  });

  it("komponent miary nie zna żadnej liczby — czyta wyłącznie token", () => {
    const component = stripComments(
      readFileSync(resolve(panelRoot, "components/screens/form-measure.tsx"), "utf8"),
    );
    expect(component).toContain("data-form-line-measure");
    expect(component, "komponent miary zna liczbę albo klasę szerokości").not.toMatch(
      /max-w-|\d+rem/,
    );
  });
});
