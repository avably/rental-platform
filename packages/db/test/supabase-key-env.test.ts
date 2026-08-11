/**
 * Fabryki klientów Supabase × warstwa kluczy ADR-142 — dowód BEHAWIORALNY
 * (test woła fabryki tak, jak woła je produkcja; lekcja kontraktu źródła:
 * bramka literałowa sama z siebie nie dowodzi, że fabryka przez warstwę
 * PRZECHODZI).
 *
 * Kontrakt per fabryka: nowa nazwa działa · legacy działa · obie → nowa
 * wygrywa · brak obu → twardy błąd nazywający OBA env (fail-honest).
 * Bez sieci: konstrukcja klienta nie dotyka Supabase.
 *
 * Plik jest jawnie dopuszczony w scripts/audit-service-role.sh — musi
 * nazywać sekret i wołać createServiceClient, bo testuje właśnie fabrykę.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createServerClient } from "../src/client";
import { createServiceClient } from "../src/service";

const URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const PUBLISHABLE_ENV = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
const PUBLISHABLE_LEGACY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
const SECRET_ENV = "SUPABASE_SECRET_KEY";
const SECRET_LEGACY_ENV = "SUPABASE_SERVICE_ROLE_KEY";

const NEW_PUBLISHABLE = "sb_publishable_db_test";
const LEGACY_PUBLISHABLE = "legacy-anon-jwt-db-test";
const NEW_SECRET = "sb_secret_db_test";
const LEGACY_SECRET = "legacy-service-role-jwt-db-test";

const COOKIES = { getAll: () => [], setAll: () => {} };

/**
 * Klucz, którym klient faktycznie podpisze żądania (apikey/Authorization).
 * Własność jest `protected` w TS, ale istnieje w runtime — gdyby supabase-js
 * zmienił kształt, test padnie GŁOŚNO na toBeTypeOf, nie fałszywą zielenią.
 */
function usedKey(client: unknown): string {
  const key = (client as { supabaseKey?: unknown }).supabaseKey;
  expect(key, "supabase-js nie trzyma już supabaseKey — zaktualizuj sondę").toBeTypeOf("string");
  return key as string;
}

function clearKeyEnv() {
  for (const name of [PUBLISHABLE_ENV, PUBLISHABLE_LEGACY_ENV, SECRET_ENV, SECRET_LEGACY_ENV]) {
    vi.stubEnv(name, "");
  }
  vi.stubEnv(URL_ENV, "http://127.0.0.1:54321");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createServerClient — klucz publikowalny przez warstwę ADR-142", () => {
  it("nowa nazwa działa sama", () => {
    clearKeyEnv();
    vi.stubEnv(PUBLISHABLE_ENV, NEW_PUBLISHABLE);
    expect(usedKey(createServerClient(COOKIES))).toBe(NEW_PUBLISHABLE);
  });

  it("legacy działa sama", () => {
    clearKeyEnv();
    vi.stubEnv(PUBLISHABLE_LEGACY_ENV, LEGACY_PUBLISHABLE);
    expect(usedKey(createServerClient(COOKIES))).toBe(LEGACY_PUBLISHABLE);
  });

  it("obie → wygrywa nowa", () => {
    clearKeyEnv();
    vi.stubEnv(PUBLISHABLE_ENV, NEW_PUBLISHABLE);
    vi.stubEnv(PUBLISHABLE_LEGACY_ENV, LEGACY_PUBLISHABLE);
    expect(usedKey(createServerClient(COOKIES))).toBe(NEW_PUBLISHABLE);
  });

  it("brak obu → twardy błąd nazywający oba env", () => {
    clearKeyEnv();
    expect(() => createServerClient(COOKIES)).toThrowError(
      new RegExp(`${PUBLISHABLE_ENV}[\\s\\S]*${PUBLISHABLE_LEGACY_ENV}`),
    );
  });
});

describe("createServiceClient — klucz sekretny przez fabrykę (ADR-142)", () => {
  it("nowa nazwa działa sama", () => {
    clearKeyEnv();
    vi.stubEnv(SECRET_ENV, NEW_SECRET);
    expect(usedKey(createServiceClient())).toBe(NEW_SECRET);
  });

  it("legacy działa sama", () => {
    clearKeyEnv();
    vi.stubEnv(SECRET_LEGACY_ENV, LEGACY_SECRET);
    expect(usedKey(createServiceClient())).toBe(LEGACY_SECRET);
  });

  it("obie → wygrywa nowa", () => {
    clearKeyEnv();
    vi.stubEnv(SECRET_ENV, NEW_SECRET);
    vi.stubEnv(SECRET_LEGACY_ENV, LEGACY_SECRET);
    expect(usedKey(createServiceClient())).toBe(NEW_SECRET);
  });

  it("brak obu → twardy błąd nazywający oba env", () => {
    clearKeyEnv();
    expect(() => createServiceClient()).toThrowError(
      new RegExp(`${SECRET_ENV}[\\s\\S]*${SECRET_LEGACY_ENV}`),
    );
  });

  it("kontrola negatywna: klucz publikowalny NIE zasila fabryki sekretnej", () => {
    // Fallback ma być dwu-nazwowy w OBRĘBIE rodzaju klucza — publishable w
    // fabryce service-role oznaczałby cichą degradację uprawnień webhooków.
    clearKeyEnv();
    vi.stubEnv(PUBLISHABLE_ENV, NEW_PUBLISHABLE);
    expect(() => createServiceClient()).toThrowError(/sb_secret/);
  });
});
