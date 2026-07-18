/**
 * Konfiguracja portu domen (Zadanie 2.6, ADR-046).
 *
 * SEMANTYKA BRAKU KONFIGURACJI = LUSTRO ADR-033 (Resend), nie ADR-032
 * (Turnstile). Turnstile bez sekretu robi dev-skip i PRZEPUSZCZA, bo brak
 * CAPTCHY w dev jest nieszkodliwy. Tutaj dev-skip byłby CICHYM SUKCESEM
 * najgorszego rodzaju: panel pokazałby „domena zarejestrowana", host nie
 * istniałby u dostawcy, a najemca dowiedziałby się o tym dopiero z 404
 * własnego sklepu. Dlatego brak `VERCEL_API_TOKEN`/`VERCEL_PROJECT_ID` =
 * rejestracja JAWNIE niedostępna: `vercelDomainsAvailability` gasi kontrolkę
 * i podaje powód, a próba wywołania mimo to kończy się `VercelConfigError`.
 * ZERO fallbacków — nie ma „domyślnego projektu", pod który dałoby się
 * zarejestrować host.
 *
 * Nazwy zmiennych są USTALONE z właścicielem infrastruktury i nie mają
 * wariantów: VERCEL_API_TOKEN (sensitive), VERCEL_PROJECT_ID (projekt
 * storefrontu), VERCEL_TEAM_ID (opcjonalny — konto osobiste go nie ma).
 */
import type { VercelDomainsAvailability, VercelDomainsConfig } from "./types";

export const VERCEL_TOKEN_ENV = "VERCEL_API_TOKEN";
export const VERCEL_PROJECT_ENV = "VERCEL_PROJECT_ID";
export const VERCEL_TEAM_ENV = "VERCEL_TEAM_ID";

export class VercelConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Rejestracja domen nie jest skonfigurowana: ${problems.join("; ")}`);
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
    token: process.env[VERCEL_TOKEN_ENV],
    projectId: process.env[VERCEL_PROJECT_ENV],
    teamId: process.env[VERCEL_TEAM_ENV],
  };
}

/** Pusty string w env to BRAK konfiguracji, nie wartość. */
function present(value: string | undefined): string | undefined {
  return value ? value : undefined;
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
  if (!token) problems.push(`brak ${VERCEL_TOKEN_ENV}`);
  if (!projectId) problems.push(`brak ${VERCEL_PROJECT_ENV}`);
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
