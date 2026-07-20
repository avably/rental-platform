/**
 * Konfiguracja portu domen: brak zmiennych = JAWNA niedostępność z powodem,
 * nigdy cichy sukces ani fallback na „domyślny projekt" (ADR-046, lustro
 * ADR-033). Od 2.6c dochodzą dwa dowody: nazwy są POZA przestrzenią `VERCEL_*`
 * i nie mają fallbacku na stare, a cel wskazujący na nas samych gasi
 * rejestrację.
 *
 * DOWÓD MUTACYJNY (a) tego pliku: usuń wywołanie `selfTargetProblem` w
 * `resolveVercelConfig` (albo spraw, by zwracało zawsze `null`) i pali się
 * „nie zarejestruje hosta do projektu, w którym biegniemy" tutaj oraz jego
 * odpowiednik na akcji panelu w apps/panel/test/domains-retry.test.ts.
 * Restore przywraca zieleń.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  RUNNING_PROJECT_ENV,
  STOREFRONT_PROJECT_ENV,
  STOREFRONT_TEAM_ENV,
  STOREFRONT_TOKEN_ENV,
  VercelConfigError,
  resolveVercelConfig,
  vercelDomainsAvailability,
} from "./config";

/**
 * `RUNNING_PROJECT_ENV` jest na liście CELOWO, mimo że nie jest naszą
 * konfiguracją: `setEnv` kasuje wszystko, czego test nie poda, więc zmienna
 * systemowa obecna na maszynie dewelopera (albo w CI na Vercelu) nie może
 * przypadkiem zapalić bramki w teście, który jej nie dotyczy.
 */
const KEYS = [
  STOREFRONT_TOKEN_ENV,
  STOREFRONT_PROJECT_ENV,
  STOREFRONT_TEAM_ENV,
  RUNNING_PROJECT_ENV,
] as const;
const saved = new Map<string, string | undefined>();

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const key of KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

describe("resolveVercelConfig", () => {
  it("czyta DOKŁADNIE ustalone nazwy zmiennych", () => {
    setEnv({
      [STOREFRONT_TOKEN_ENV]: "tok",
      [STOREFRONT_PROJECT_ENV]: "prj",
      [STOREFRONT_TEAM_ENV]: "team",
    });

    expect(resolveVercelConfig()).toEqual({ token: "tok", projectId: "prj", teamId: "team" });
  });

  // 2.6c: nazwy MUSZĄ być poza przestrzenią `VERCEL_*`, bo dostawca wstrzykuje
  // tam własne wartości (System Environment Variables) i przykrywa nasze.
  it("nazwy zmiennych są w NASZEJ przestrzeni, nie w zarezerwowanej `VERCEL_*`", () => {
    for (const key of [STOREFRONT_TOKEN_ENV, STOREFRONT_PROJECT_ENV, STOREFRONT_TEAM_ENV]) {
      expect(key.startsWith("AVABLY_"), `${key} jest w przestrzeni dostawcy`).toBe(true);
    }
  });

  it("teamId jest opcjonalny (projekt na koncie osobistym)", () => {
    setEnv({ [STOREFRONT_TOKEN_ENV]: "tok", [STOREFRONT_PROJECT_ENV]: "prj" });
    expect(resolveVercelConfig().teamId).toBeUndefined();
  });

  it("zbiera WSZYSTKIE braki naraz, a nie po jednym", () => {
    setEnv({});
    const error = (() => {
      try {
        resolveVercelConfig();
        return null;
      } catch (e) {
        return e as VercelConfigError;
      }
    })();

    expect(error).toBeInstanceOf(VercelConfigError);
    expect(error?.problems).toEqual([
      `brak ${STOREFRONT_TOKEN_ENV}`,
      `brak ${STOREFRONT_PROJECT_ENV}`,
    ]);
  });

  it("pusty string w env to BRAK konfiguracji, nie wartość", () => {
    setEnv({ [STOREFRONT_TOKEN_ENV]: "", [STOREFRONT_PROJECT_ENV]: "prj" });
    expect(() => resolveVercelConfig()).toThrow(VercelConfigError);
  });

  // Wzorzec resolveApiKey (ADR-033): bez tego test „brak tokenu" przechodziłby
  // zielono na maszynie, która token w env ma.
  it("jawne `config` NIE spada na env procesu", () => {
    setEnv({ [STOREFRONT_TOKEN_ENV]: "tok-z-env", [STOREFRONT_PROJECT_ENV]: "prj-z-env" });
    expect(() => resolveVercelConfig({ config: {} })).toThrow(VercelConfigError);
  });

  it("availability podaje POWÓD niedostępności zamiast samego false", () => {
    setEnv({});
    const availability = vercelDomainsAvailability();

    expect(availability.available).toBe(false);
    expect(availability.reason).toContain(STOREFRONT_TOKEN_ENV);
  });
});

/**
 * ZERO FALLBACKU (2.6c). Sedno awarii produkcyjnej: `VERCEL_PROJECT_ID` niesie
 * id projektu, W KTÓRYM BIEGNIEMY. Sięgnięcie po nie, gdy nasza zmienna jest
 * pusta, to nie „rozsądny domyślny" — to gwarancja zarejestrowania hostów
 * sklepów do panelu.
 */
describe("stare nazwy z przestrzeni dostawcy są martwe", () => {
  const LEGACY = ["VERCEL_API_TOKEN", "VERCEL_TEAM_ID"] as const;

  afterEach(() => {
    for (const key of LEGACY) delete process.env[key];
  });

  it("komplet `VERCEL_*` NIE konfiguruje rejestracji — ani token, ani projekt", () => {
    // Stan sprzed 2.6c: wszystkie stare zmienne obecne, w tym systemowe id
    // projektu panelu. Cichy fallback zbudowałby z tego działającą (i BŁĘDNĄ)
    // konfigurację celującą w panel.
    setEnv({ [RUNNING_PROJECT_ENV]: "prj_panelu" });
    for (const key of LEGACY) process.env[key] = "wartosc-dostawcy";

    expect(() => resolveVercelConfig()).toThrow(VercelConfigError);

    const reason = vercelDomainsAvailability().reason ?? "";
    expect(reason).toContain(`brak ${STOREFRONT_TOKEN_ENV}`);
    expect(reason).toContain(`brak ${STOREFRONT_PROJECT_ENV}`);
  });
});

/**
 * BRAMKA ANTY-SAMOREJESTRACJA (2.6c). Test USTAWIA OBIE zmienne na tę samą
 * wartość — czyli odtwarza dokładnie stan produkcyjny, w którym zmienna
 * systemowa dostawcy przykryła naszą i panel zaczął rejestrować hosty do
 * siebie. Bez bramki `resolveVercelConfig` zwraca tu poprawną konfigurację
 * i rejestracja rusza.
 */
describe("cel rejestracji nie może być projektem, w którym biegniemy", () => {
  it("ta sama wartość w obu zmiennych = rejestracja NIEDOSTĘPNA z powodem", () => {
    setEnv({
      [STOREFRONT_TOKEN_ENV]: "tok",
      [STOREFRONT_PROJECT_ENV]: "prj_ten_sam",
      [RUNNING_PROJECT_ENV]: "prj_ten_sam",
    });

    const availability = vercelDomainsAvailability();

    expect(availability.available, "panel zarejestrowałby hosty sklepów do siebie").toBe(false);
    expect(availability.reason).toContain(STOREFRONT_PROJECT_ENV);
    expect(availability.reason).toContain(RUNNING_PROJECT_ENV);
  });

  it("próba mimo wszystko kończy się VercelConfigError, nie cichym przejściem", () => {
    setEnv({
      [STOREFRONT_TOKEN_ENV]: "tok",
      [STOREFRONT_PROJECT_ENV]: "prj_ten_sam",
      [RUNNING_PROJECT_ENV]: "prj_ten_sam",
    });

    expect(() => resolveVercelConfig()).toThrow(VercelConfigError);
  });

  // Powód trafia do `domains.last_error` i na ekran najemcy — tam mają być
  // NAZWY zmiennych do poprawienia, nigdy ich wartości (patrz page.tsx).
  it("powód nie zdradza id projektu", () => {
    setEnv({
      [STOREFRONT_TOKEN_ENV]: "tok",
      [STOREFRONT_PROJECT_ENV]: "prj_sekretne_id",
      [RUNNING_PROJECT_ENV]: "prj_sekretne_id",
    });

    expect(vercelDomainsAvailability().reason).not.toContain("prj_sekretne_id");
  });

  it("RÓŻNE projekty (panel ≠ storefront) to stan poprawny", () => {
    setEnv({
      [STOREFRONT_TOKEN_ENV]: "tok",
      [STOREFRONT_PROJECT_ENV]: "prj_storefront",
      [RUNNING_PROJECT_ENV]: "prj_panel",
    });

    expect(vercelDomainsAvailability().available).toBe(true);
  });

  // Dev i CI nie biegną w żadnym projekcie dostawcy — nie ma z czym kolidować.
  it("brak zmiennej systemowej (dev/CI) nie blokuje niczego", () => {
    setEnv({ [STOREFRONT_TOKEN_ENV]: "tok", [STOREFRONT_PROJECT_ENV]: "prj_storefront" });
    expect(vercelDomainsAvailability().available).toBe(true);
  });

  // Bramka czyta env procesu, nie wstrzyknięty obiekt: „w jakim projekcie
  // biegnę" to fakt środowiska, więc argument nie może go przesłonić.
  it("wstrzyknięta konfiguracja też podlega bramce", () => {
    setEnv({ [RUNNING_PROJECT_ENV]: "prj_ten_sam" });

    expect(() =>
      resolveVercelConfig({ config: { token: "tok", projectId: "prj_ten_sam" } }),
    ).toThrow(VercelConfigError);
  });
});
