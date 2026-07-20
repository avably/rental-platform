/**
 * Konfiguracja portu domen (Zadanie 2.6, ADR-046; nazwy i bramka — 2.6c).
 *
 * SEMANTYKA BRAKU KONFIGURACJI = LUSTRO ADR-033 (Resend), nie ADR-032
 * (Turnstile). Turnstile bez sekretu robi dev-skip i PRZEPUSZCZA, bo brak
 * CAPTCHY w dev jest nieszkodliwy. Tutaj dev-skip byłby CICHYM SUKCESEM
 * najgorszego rodzaju: panel pokazałby „domena zarejestrowana", host nie
 * istniałby u dostawcy, a najemca dowiedziałby się o tym dopiero z 404
 * własnego sklepu. Dlatego brak konfiguracji = rejestracja JAWNIE niedostępna:
 * `vercelDomainsAvailability` gasi kontrolkę i podaje powód, a próba wywołania
 * mimo to kończy się `VercelConfigError`. ZERO fallbacków — nie ma
 * „domyślnego projektu", pod który dałoby się zarejestrować host.
 *
 * DLACZEGO PREFIKS `AVABLY_` (2.6c, awaria produkcyjna). Pierwsza wersja
 * czytała `VERCEL_API_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` — nazwy
 * z ZAREZERWOWANEJ przestrzeni dostawcy. `VERCEL_PROJECT_ID` jest SYSTEMOWĄ
 * zmienną Vercela (build i runtime) niosącą id projektu, W KTÓRYM WŁAŚNIE
 * BIEGNIEMY, a projekt panelu ma włączone „System Environment Variables".
 * Nasza zmienna o tej samej nazwie była więc przykrywana wartością systemową:
 * właściciel wpisał poprawne id storefrontu, panel i tak rejestrował hosty
 * sklepów DO SIEBIE. Objaw był niemy — API oddawało 201, panel pisał „Działa",
 * a sklepy najemców zwracały 404 z projektu panelu.
 *
 * ZERO FALLBACKU NA STARE NAZWY. Cichy odczyt `VERCEL_PROJECT_ID`, gdy nowa
 * zmienna jest pusta, przywróciłby DOKŁADNIE tę awarię — tyle że trudniejszą
 * do znalezienia, bo „przecież przenieśliśmy nazwy". Brak nowej zmiennej ma
 * gasić kontrolkę, nie sięgać po wartość dostawcy.
 *
 * Nazwy własne (nasza przestrzeń, dostawca ich nie nadpisze):
 *   AVABLY_VERCEL_API_TOKEN      (sensitive)
 *   AVABLY_STOREFRONT_PROJECT_ID (projekt storefrontu — CEL rejestracji)
 *   AVABLY_VERCEL_TEAM_ID        (opcjonalny — konto osobiste go nie ma)
 */
import type { VercelDomainsAvailability, VercelDomainsConfig } from "./types";

export const STOREFRONT_TOKEN_ENV = "AVABLY_VERCEL_API_TOKEN";
export const STOREFRONT_PROJECT_ENV = "AVABLY_STOREFRONT_PROJECT_ID";
export const STOREFRONT_TEAM_ENV = "AVABLY_VERCEL_TEAM_ID";

/**
 * Zmienna SYSTEMOWA dostawcy: id projektu, w którym biegnie TEN proces. Nigdy
 * nasza konfiguracja — czytamy ją WYŁĄCZNIE po to, żeby rozpoznać, że cel
 * rejestracji wskazuje na nas samych (patrz `selfTargetProblem`).
 */
export const RUNNING_PROJECT_ENV = "VERCEL_PROJECT_ID";

export class VercelConfigError extends Error {
  constructor(public readonly problems: string[]) {
    // „niedostępna", nie „nieskonfigurowana": bramka anty-samorejestracja
    // zapala się przy konfiguracji KOMPLETNEJ, tylko wskazującej zły projekt.
    super(`Rejestracja domen jest niedostępna: ${problems.join("; ")}`);
    this.name = "VercelConfigError";
  }
}

export interface VercelConfigOptions {
  /** Jawne wartości (test, wymuszona konfiguracja); domyślnie z env procesu. */
  config?: Partial<VercelDomainsConfig> | undefined;
}

/**
 * `in` zamiast `??` — wzorzec resolveApiKey z ADR-033: jawne `config: undefined`
 * to decyzja wołającego (test wymuszający brak konfiguracji) i NIE MOŻE spaść
 * na env procesu, bo wtedy test „brak tokenu" przechodziłby zielono na maszynie,
 * która token ma.
 */
function readConfig(options: VercelConfigOptions): Partial<VercelDomainsConfig> {
  if ("config" in options) return options.config ?? {};
  return {
    token: process.env[STOREFRONT_TOKEN_ENV],
    projectId: process.env[STOREFRONT_PROJECT_ENV],
    teamId: process.env[STOREFRONT_TEAM_ENV],
  };
}

/** Pusty string w env to BRAK konfiguracji, nie wartość. */
function present(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

/**
 * BRAMKA ANTY-SAMOREJESTRACJA (2.6c). Cel rejestracji równy projektowi, w
 * którym biegniemy, to POMYŁKA KONFIGURACYJNA, nie tryb pracy: panel
 * rejestrowałby hosty sklepów do samego siebie, a najemca dostawał 404 spod
 * adresu opisanego w panelu jako działający.
 *
 * Dlaczego bramka, skoro nazwy są już rozdzielone. Rozdzielenie nazw usuwa
 * JEDNĄ drogę do tej pomyłki (przykrycie zmienną systemową) — ręczne wklejenie
 * złego id zostaje. Ta pomyłka kosztowała dzień diagnozy przy niemym objawie,
 * więc ma być NIEMOŻLIWA, nie udokumentowana.
 *
 * Porównujemy z env procesu, a nie z wstrzykniętą konfiguracją: „w jakim
 * projekcie biegnę" to fakt środowiska, którego wołający nie ma prawa
 * przesłonić — inaczej bramka dałaby się wyłączyć argumentem.
 *
 * Brak `VERCEL_PROJECT_ID` (dev, CI, własny hosting) = nie biegniemy w żadnym
 * projekcie dostawcy, więc nie ma z czym kolidować i bramka milczy.
 *
 * ZAŁOŻENIE ARCHITEKTURY: rejestrujący (panel) i cel (storefront) to ZAWSZE
 * dwa różne projekty. Gdyby kiedyś storefront sam rejestrował swoje hosty,
 * ta bramka jest miejscem do świadomej zmiany decyzji — nie do obejścia.
 */
function selfTargetProblem(projectId: string): string | null {
  const running = present(process.env[RUNNING_PROJECT_ENV]);
  if (!running || running !== projectId) return null;

  // Bez WARTOŚCI id: komunikat idzie do `domains.last_error` i na ekran
  // najemcy (page.tsx: nazwy zmiennych — nigdy ich wartości).
  return (
    `${STOREFRONT_PROJECT_ENV} wskazuje projekt, w którym biegnie panel ` +
    `(${RUNNING_PROJECT_ENV}) — hosty sklepów trafiłyby do panelu zamiast do storefrontu`
  );
}

/**
 * Zbiera WSZYSTKIE braki naraz (wzorzec CourierConfigError, ADR-031) — operator
 * uzupełnia konfigurację po jednym komunikacie, a nie po serii prób.
 */
export function resolveVercelConfig(options: VercelConfigOptions = {}): VercelDomainsConfig {
  const raw = readConfig(options);
  const token = present(raw.token);
  const projectId = present(raw.projectId);

  const problems: string[] = [];
  if (!token) problems.push(`brak ${STOREFRONT_TOKEN_ENV}`);
  if (!projectId) problems.push(`brak ${STOREFRONT_PROJECT_ENV}`);
  // Bramka dopiero po sprawdzeniu obecności: „brak zmiennej" i „zmienna
  // wskazuje na nas" to dwa różne komunikaty dla operatora.
  if (projectId) {
    const selfTarget = selfTargetProblem(projectId);
    if (selfTarget) problems.push(selfTarget);
  }
  if (problems.length > 0) throw new VercelConfigError(problems);

  // teamId opcjonalny: projekt na koncie osobistym nie należy do żadnego zespołu
  // i przekazanie pustego `teamId` w query byłoby błędem 403 u dostawcy.
  return { token: token as string, projectId: projectId as string, teamId: present(raw.teamId) };
}

export function vercelDomainsAvailability(
  options: VercelConfigOptions = {},
): VercelDomainsAvailability {
  try {
    resolveVercelConfig(options);
    return { available: true };
  } catch (error) {
    if (error instanceof VercelConfigError) return { available: false, reason: error.message };
    throw error;
  }
}
