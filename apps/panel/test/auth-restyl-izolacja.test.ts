import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EKRANY `(auth)` SĄ PUBLICZNE I MAJĄ TAKIE ZOSTAĆ (sonda izolacji ADR-156).
 *
 * Restyling dołożył wspólne płótno z pasem marki, a pas marki to naturalne
 * miejsce, w które ktoś kiedyś zechce wstawić „Witaj, Anno" albo nazwę
 * organizacji. Byłby to wyciek na stronie, którą widzi każdy: samo pokazanie
 * czegokolwiek o koncie ZANIM ktokolwiek się zalogował zamienia ekran
 * w wyrocznię — a przy okazji wciąga trasę w render zależny od cookies.
 *
 * Skan pilnuje, że żaden plik warstwy widoku `(auth)` nie sięga po sesję.
 * WYJĄTEK jest JEDEN, wpisany dokładną ścieżką: `/reset/confirm` sprawdza
 * dowód recovery PRZED narysowaniem formularza (ADR-153, N7) — to jest cała
 * treść tamtej naprawy. Rozmiar listy wyjątków jest asercją, więc drugi wpis
 * wymaga świadomej zmiany testu, czyli recenzji.
 */

const authRoot = resolve(process.cwd(), "app/[locale]/(auth)");

/** Wszystkie moduły ekranów `(auth)` — bez akcji serwerowych. */
function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return collect(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const relative = (path: string) => path.replace(`${authRoot}/`, "");

/** Akcje serwerowe MUSZĄ czytać sesję — to nie jest warstwa widoku. */
const ACTION_FILES = /(^|\/)actions\.ts$/;

/** Jedyny ekran, który sesję czytać MA — bramka dowodu recovery. */
const SESSION_READING_SCREENS = ["reset/confirm/page.tsx"] as const;

/** Sygnatury odczytu sesji po stronie serwera. */
const SESSION_READS = [
  "createSupabaseServerClient",
  "getAuthContext",
  "requireMember",
  "getClaims",
] as const;

const viewFiles = collect(authRoot)
  .map((path) => ({ path, rel: relative(path), source: readFileSync(path, "utf8") }))
  .filter((file) => !ACTION_FILES.test(file.rel));

describe("ekrany (auth) nie wynoszą nic o sesji", () => {
  it("skan objął realny zbiór plików (kontrola pozytywna)", () => {
    // Bez podłogi zepsuta ścieżka dawałaby pustą listę i zielony test po
    // pustym zbiorze — dokładnie ten rodzaj dowodu, który nic nie broni.
    expect(viewFiles.length).toBeGreaterThanOrEqual(10);
    expect(viewFiles.map((f) => f.rel)).toContain("login/page.tsx");
    expect(viewFiles.map((f) => f.rel)).toContain("auth-shell.tsx");
    expect(SESSION_READING_SCREENS.length).toBe(1);
  });

  it("żaden ekran poza bramką recovery nie sięga po sesję", () => {
    const offenders = viewFiles.flatMap((file) => {
      if ((SESSION_READING_SCREENS as readonly string[]).includes(file.rel)) return [];
      return SESSION_READS.filter((needle) => file.source.includes(needle)).map(
        (needle) => `${file.rel}: ${needle}`,
      );
    });

    expect(offenders, `odczyt sesji na publicznym ekranie: ${offenders.join(", ")}`).toEqual([]);
  });

  it("KONTROLA POZYTYWNA: bramka recovery faktycznie sesję czyta", () => {
    // Bez tego asercja wyżej byłaby zielona także wtedy, gdyby ktoś zdjął
    // bramkę z `/reset/confirm` — czyli gdyby zniknęła naprawa ADR-153 N7.
    const gate = viewFiles.find((file) => file.rel === "reset/confirm/page.tsx");
    expect(gate, "brak pliku bramki recovery").toBeDefined();
    expect(gate!.source).toContain("createSupabaseServerClient");
    expect(gate!.source).toContain("hasRecentRecoveryProof");
  });

  it("wspólne płótno nie zna e-maila ani nazwy organizacji", () => {
    const shell = readFileSync(resolve(authRoot, "auth-shell.tsx"), "utf8");
    for (const needle of ["userEmail", "tenantId", "tenant_id", "organizationName"]) {
      expect(shell, `pas marki niesie dane konta: ${needle}`).not.toContain(needle);
    }
  });
});
