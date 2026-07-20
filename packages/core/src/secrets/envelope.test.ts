/**
 * Koperta sekretu tenanta (ADR-052).
 *
 * Testy pilnują trzech rzeczy, z których każda jest osobnym mechanizmem:
 *   1. runda tam i z powrotem działa,
 *   2. koperta jest ZWIĄZANA z wierszem (AAD) — przeniesiona nie odszyfruje się,
 *   3. w żadnym komunikacie błędu nie ma wartości jawnej ani klucza.
 */
import { describe, expect, it } from "vitest";

import {
  SecretEnvelopeError,
  decryptTenantSecret,
  encryptTenantSecret,
} from "./envelope";
import { resolveSecretsKeyring, type SecretsKeyring } from "./keyring";

const KEY_V1 = Buffer.alloc(32, 1).toString("base64");
const KEY_V2 = Buffer.alloc(32, 2).toString("base64");

const keyring = (current: number, keys: Record<string, string>): SecretsKeyring =>
  resolveSecretsKeyring({ AVABLY_SECRETS_KEY_CURRENT: String(current), ...keys });

const RING_V1 = keyring(1, { AVABLY_SECRETS_KEY_V1: KEY_V1 });
const LOCATION = { tenantId: "11111111-1111-4111-8111-111111111111", key: "globkurier_password" };
const PLAINTEXT = "hasło-dostawcy-!@#-ąęś";

describe("koperta sekretu tenanta", () => {
  it("szyfruje i odszyfrowuje tę samą wartość", () => {
    const envelope = encryptTenantSecret(PLAINTEXT, LOCATION, RING_V1);
    expect(decryptTenantSecret(envelope.ciphertext, LOCATION, RING_V1)).toBe(PLAINTEXT);
  });

  it("koperta nie zawiera wartości jawnej", () => {
    const { ciphertext } = encryptTenantSecret(PLAINTEXT, LOCATION, RING_V1);
    expect(ciphertext).not.toContain(PLAINTEXT);
    expect(ciphertext).not.toContain("hasło");
  });

  it("kształt koperty odpowiada CHECK-owi tenant_secrets.ciphertext z migracji 0024", () => {
    // Lustro wyrażenia z bazy. Rozjazd tych dwóch oznaczałby, że aplikacja
    // produkuje koperty, których baza nie przyjmie — awaria wyszłaby dopiero
    // przy pierwszym zapisie na produkcji.
    const { ciphertext } = encryptTenantSecret(PLAINTEXT, LOCATION, RING_V1);
    expect(ciphertext).toMatch(/^v1:[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(ciphertext.length).toBeGreaterThanOrEqual(24);
  });

  it("każde szyfrowanie daje inną kopertę (losowy IV)", () => {
    // Deterministyczna koperta zdradzałaby, że dwa wiersze mają to samo hasło.
    const first = encryptTenantSecret(PLAINTEXT, LOCATION, RING_V1);
    const second = encryptTenantSecret(PLAINTEXT, LOCATION, RING_V1);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  describe("związanie z wierszem (AAD)", () => {
    it("koperta tenanta A nie odszyfruje się w wierszu tenanta B", () => {
      const { ciphertext } = encryptTenantSecret(PLAINTEXT, LOCATION, RING_V1);
      expect(() =>
        decryptTenantSecret(
          ciphertext,
          { tenantId: "22222222-2222-4222-8222-222222222222", key: LOCATION.key },
          RING_V1,
        ),
      ).toThrow(SecretEnvelopeError);
    });

    it("koperta spod jednego klucza nie odszyfruje się pod innym", () => {
      // Ochrona przed podstawieniem hasła kuriera jako tokenu rozliczeniowego
      // (albo odwrotnie), gdy oba sekrety zamieszkają w tej samej tabeli.
      const { ciphertext } = encryptTenantSecret(PLAINTEXT, LOCATION, RING_V1);
      expect(() =>
        decryptTenantSecret(ciphertext, { ...LOCATION, key: "fakturownia_token" }, RING_V1),
      ).toThrow(SecretEnvelopeError);
    });
  });

  describe("naruszenie koperty", () => {
    it("przestawiony bajt szyfrogramu jest wykrywany, nie zwracany", () => {
      const { ciphertext } = encryptTenantSecret(PLAINTEXT, LOCATION, RING_V1);
      const parts = ciphertext.split(":");
      const data = Buffer.from(parts[4] ?? "", "base64url");
      data[0] = (data[0] ?? 0) ^ 0xff;
      parts[4] = data.toString("base64url");
      expect(() => decryptTenantSecret(parts.join(":"), LOCATION, RING_V1)).toThrow(
        SecretEnvelopeError,
      );
    });

    it("obcy format koperty jest odrzucany", () => {
      expect(() => decryptTenantSecret("zwykły-tekst", LOCATION, RING_V1)).toThrow(
        /nieznany format/,
      );
    });
  });

  describe("rotacja klucza", () => {
    const RING_V2 = keyring(2, {
      AVABLY_SECRETS_KEY_V1: KEY_V1,
      AVABLY_SECRETS_KEY_V2: KEY_V2,
    });

    it("szyfruje bieżącą wersją, a stare koperty nadal czyta", () => {
      const old = encryptTenantSecret(PLAINTEXT, LOCATION, RING_V1);
      expect(old.keyVersion).toBe(1);

      const fresh = encryptTenantSecret(PLAINTEXT, LOCATION, RING_V2);
      expect(fresh.keyVersion).toBe(2);

      // Sedno rotacji: po przestawieniu _CURRENT wiersze sprzed rotacji
      // muszą się czytać dalej, inaczej rotacja byłaby awarią.
      expect(decryptTenantSecret(old.ciphertext, LOCATION, RING_V2)).toBe(PLAINTEXT);
      expect(decryptTenantSecret(fresh.ciphertext, LOCATION, RING_V2)).toBe(PLAINTEXT);
    });

    it("wersja w kopercie zgadza się z key_version (CHECK 0024)", () => {
      const { ciphertext, keyVersion } = encryptTenantSecret(PLAINTEXT, LOCATION, RING_V2);
      expect(ciphertext.startsWith(`v1:${keyVersion}:`)).toBe(true);
    });

    it("brak klucza w wersji zapisanej w kopercie to głośny błąd", () => {
      const old = encryptTenantSecret(PLAINTEXT, LOCATION, RING_V1);
      const ringWithoutV1 = keyring(2, { AVABLY_SECRETS_KEY_V2: KEY_V2 });
      expect(() => decryptTenantSecret(old.ciphertext, LOCATION, ringWithoutV1)).toThrow(
        /wersji 1/,
      );
    });
  });

  describe("sekret nie wycieka komunikatem błędu", () => {
    // Te wyjątki lądują w logach serwera i w komunikacie dla operatora.
    // Gdyby niosły wartość jawną, szyfrowanie w bazie byłoby bez znaczenia.
    const collectMessages = (): string[] => {
      const messages: string[] = [];
      const attempts: Array<() => unknown> = [
        () => decryptTenantSecret("zwykły-tekst", LOCATION, RING_V1),
        () => decryptTenantSecret("v1:9:AAAA:BBBB:CCCC", LOCATION, RING_V1),
        () =>
          decryptTenantSecret(
            encryptTenantSecret(PLAINTEXT, LOCATION, RING_V1).ciphertext,
            { ...LOCATION, key: "inny_klucz" },
            RING_V1,
          ),
        () => encryptTenantSecret("", LOCATION, RING_V1),
      ];
      for (const attempt of attempts) {
        try {
          attempt();
        } catch (err) {
          messages.push(err instanceof Error ? `${err.message} ${err.stack ?? ""}` : String(err));
        }
      }
      return messages;
    };

    it("żaden komunikat nie zawiera wartości jawnej ani materiału klucza", () => {
      const messages = collectMessages();
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message).not.toContain(PLAINTEXT);
        expect(message).not.toContain(KEY_V1);
        expect(message).not.toContain(Buffer.from(KEY_V1, "base64").toString("hex"));
      }
    });
  });
});
