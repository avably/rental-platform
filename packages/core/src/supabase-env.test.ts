/**
 * Kontrakt warstwy kluczy publikowalnych Supabase (ADR-142):
 * nowa nazwa działa · legacy działa · obie → nowa wygrywa · pusty string =
 * brak · brak obu → twardy błąd nazywający OBA env do ustawienia.
 *
 * Dowody mutacyjne (odtwarzalne): zdjęcie fallbacku legacy w
 * readSupabasePublishableKey → testy „legacy działa" płoną; zamiana throw na
 * zwrot pustki w requireSupabasePublishableKey → testy „brak obu" płoną.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SUPABASE_PUBLISHABLE_KEY_ENV,
  SUPABASE_PUBLISHABLE_KEY_LEGACY_ENV,
  readSupabasePublishableKey,
  requireSupabasePublishableKey,
} from "./supabase-env";

const NEW_KEY = "sb_publishable_test_nowy";
const LEGACY_KEY = "legacy-anon-jwt";

function stubBoth(newValue: string | undefined, legacyValue: string | undefined) {
  vi.stubEnv(SUPABASE_PUBLISHABLE_KEY_ENV, newValue ?? "");
  vi.stubEnv(SUPABASE_PUBLISHABLE_KEY_LEGACY_ENV, legacyValue ?? "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("klucz publikowalny Supabase — fallback dwu-nazwowy (ADR-142)", () => {
  it("nowa nazwa działa sama", () => {
    stubBoth(NEW_KEY, undefined);
    expect(readSupabasePublishableKey()).toBe(NEW_KEY);
    expect(requireSupabasePublishableKey()).toBe(NEW_KEY);
  });

  it("legacy działa sama (do czasu wyłączenia w Supabase)", () => {
    stubBoth(undefined, LEGACY_KEY);
    expect(readSupabasePublishableKey()).toBe(LEGACY_KEY);
    expect(requireSupabasePublishableKey()).toBe(LEGACY_KEY);
  });

  it("obie ustawione → wygrywa NOWA", () => {
    stubBoth(NEW_KEY, LEGACY_KEY);
    expect(readSupabasePublishableKey()).toBe(NEW_KEY);
  });

  it("pusty string nowej nazwy = brak → legacy przejmuje (VAR=\"\" to „wyłączone\")", () => {
    stubBoth("", LEGACY_KEY);
    expect(readSupabasePublishableKey()).toBe(LEGACY_KEY);
  });

  it("brak obu → read zwraca undefined (ścieżki fail-closed degradują się same)", () => {
    stubBoth(undefined, undefined);
    expect(readSupabasePublishableKey()).toBeUndefined();
  });

  it("brak obu → require rzuca i komunikat NAZYWA oba env (fail-honest)", () => {
    stubBoth(undefined, undefined);
    expect(() => requireSupabasePublishableKey()).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(SUPABASE_PUBLISHABLE_KEY_ENV),
      }),
    );
    expect(() => requireSupabasePublishableKey()).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(SUPABASE_PUBLISHABLE_KEY_LEGACY_ENV),
      }),
    );
    // Lekcja projektu: NEXT_PUBLIC_* jest build-time — komunikat musi
    // ostrzegać przed „restart wystarczy".
    expect(() => requireSupabasePublishableKey()).toThrowError(/przebuduj/i);
  });

  it("kontrola negatywna komunikatu: przy USTAWIONYM kluczu nic nie rzuca", () => {
    stubBoth(NEW_KEY, undefined);
    expect(() => requireSupabasePublishableKey()).not.toThrow();
  });
});
