/**
 * Zestaw kluczy szyfrujących (ADR-052) — konfiguracja jest albo POPRAWNA,
 * albo GŁOŚNO błędna. Cichy fallback na „brak szyfrowania" byłby tu gorszy
 * niż brak funkcji, bo dawałby fałszywe poczucie, że sekrety są chronione.
 */
import { describe, expect, it } from "vitest";

import { SecretsConfigError, resolveSecretsKeyring } from "./keyring";

const KEY_V1 = Buffer.alloc(32, 7).toString("base64");
const KEY_V2 = Buffer.alloc(32, 9).toString("base64");

describe("zestaw kluczy sekretów", () => {
  it("wczytuje bieżącą wersję i materiał klucza", () => {
    const ring = resolveSecretsKeyring({
      AVABLY_SECRETS_KEY_CURRENT: "1",
      AVABLY_SECRETS_KEY_V1: KEY_V1,
    });
    expect(ring.currentVersion).toBe(1);
    expect(Buffer.from(ring.keyFor(1)).toString("base64")).toBe(KEY_V1);
  });

  it("wczytuje WSZYSTKIE wersje obecne w środowisku, nie tylko bieżącą", () => {
    // Po rotacji stare wiersze czyta się starym kluczem — gdyby zestaw brał
    // wyłącznie _CURRENT, rotacja unieruchomiłaby integracje do czasu, aż
    // każdy najemca ręcznie nadpisze sekret.
    const ring = resolveSecretsKeyring({
      AVABLY_SECRETS_KEY_CURRENT: "2",
      AVABLY_SECRETS_KEY_V1: KEY_V1,
      AVABLY_SECRETS_KEY_V2: KEY_V2,
    });
    expect(ring.currentVersion).toBe(2);
    expect(Buffer.from(ring.keyFor(1)).toString("base64")).toBe(KEY_V1);
    expect(Buffer.from(ring.keyFor(2)).toString("base64")).toBe(KEY_V2);
  });

  it("ignoruje zmienne o nazwie spoza konwencji", () => {
    const ring = resolveSecretsKeyring({
      AVABLY_SECRETS_KEY_CURRENT: "1",
      AVABLY_SECRETS_KEY_V1: KEY_V1,
      AVABLY_SECRETS_KEY_VX: "śmieć",
      AVABLY_SECRETS_KEY: "też śmieć",
    });
    expect(ring.currentVersion).toBe(1);
  });

  describe("głośna odmowa zamiast cichego fallbacku", () => {
    it("brak wskazania bieżącej wersji", () => {
      expect(() => resolveSecretsKeyring({ AVABLY_SECRETS_KEY_V1: KEY_V1 })).toThrow(
        SecretsConfigError,
      );
    });

    it("bieżąca wersja bez odpowiadającego klucza", () => {
      expect(() =>
        resolveSecretsKeyring({
          AVABLY_SECRETS_KEY_CURRENT: "2",
          AVABLY_SECRETS_KEY_V1: KEY_V1,
        }),
      ).toThrow(/brak zmiennej AVABLY_SECRETS_KEY_V2/);
    });

    it("klucz o złej długości po zdekodowaniu", () => {
      // Base64 jest pobłażliwy i skraca wejście po cichu — to jedyna bramka,
      // która odróżnia obcięty sekret od poprawnego klucza.
      expect(() =>
        resolveSecretsKeyring({
          AVABLY_SECRETS_KEY_CURRENT: "1",
          AVABLY_SECRETS_KEY_V1: Buffer.alloc(16, 1).toString("base64"),
        }),
      ).toThrow(/16 bajtów/);
    });

    it("nieliczbowa wersja bieżąca", () => {
      expect(() =>
        resolveSecretsKeyring({
          AVABLY_SECRETS_KEY_CURRENT: "najnowszy",
          AVABLY_SECRETS_KEY_V1: KEY_V1,
        }),
      ).toThrow(SecretsConfigError);
    });

    it("komunikaty nie zdradzają materiału klucza", () => {
      try {
        resolveSecretsKeyring({
          AVABLY_SECRETS_KEY_CURRENT: "1",
          AVABLY_SECRETS_KEY_V1: Buffer.alloc(16, 1).toString("base64"),
        });
        throw new Error("oczekiwano SecretsConfigError");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).not.toContain(Buffer.alloc(16, 1).toString("base64"));
        expect(message).toContain("16 bajtów");
      }
    });
  });
});
