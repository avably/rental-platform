/**
 * Konfiguracja portu domen: brak zmiennych = JAWNA niedostępność z powodem,
 * nigdy cichy sukces ani fallback na „domyślny projekt" (ADR-046, lustro
 * ADR-033).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  VERCEL_PROJECT_ENV,
  VERCEL_TEAM_ENV,
  VERCEL_TOKEN_ENV,
  VercelConfigError,
  resolveVercelConfig,
  vercelDomainsAvailability,
} from "./config";

const KEYS = [VERCEL_TOKEN_ENV, VERCEL_PROJECT_ENV, VERCEL_TEAM_ENV] as const;
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
      [VERCEL_TOKEN_ENV]: "tok",
      [VERCEL_PROJECT_ENV]: "prj",
      [VERCEL_TEAM_ENV]: "team",
    });

    expect(resolveVercelConfig()).toEqual({ token: "tok", projectId: "prj", teamId: "team" });
  });

  it("teamId jest opcjonalny (projekt na koncie osobistym)", () => {
    setEnv({ [VERCEL_TOKEN_ENV]: "tok", [VERCEL_PROJECT_ENV]: "prj" });
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
    expect(error?.problems).toEqual([`brak ${VERCEL_TOKEN_ENV}`, `brak ${VERCEL_PROJECT_ENV}`]);
  });

  it("pusty string w env to BRAK konfiguracji, nie wartość", () => {
    setEnv({ [VERCEL_TOKEN_ENV]: "", [VERCEL_PROJECT_ENV]: "prj" });
    expect(() => resolveVercelConfig()).toThrow(VercelConfigError);
  });

  // Wzorzec resolveApiKey (ADR-033): bez tego test „brak tokenu" przechodziłby
  // zielono na maszynie, która token w env ma.
  it("jawne `config` NIE spada na env procesu", () => {
    setEnv({ [VERCEL_TOKEN_ENV]: "tok-z-env", [VERCEL_PROJECT_ENV]: "prj-z-env" });
    expect(() => resolveVercelConfig({ config: {} })).toThrow(VercelConfigError);
  });

  it("availability podaje POWÓD niedostępności zamiast samego false", () => {
    setEnv({});
    const availability = vercelDomainsAvailability();

    expect(availability.available).toBe(false);
    expect(availability.reason).toContain(VERCEL_TOKEN_ENV);
  });
});
