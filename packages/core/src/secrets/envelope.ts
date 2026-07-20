/**
 * Koperta sekretu tenanta — AES-256-GCM, format `v1:<wersja>:<iv>:<tag>:<ct>`.
 *
 * GCM, a nie CBC/CTR: sekret bez uwierzytelnienia da się po cichu ZMIENIĆ.
 * Kto ma zapis do wiersza, mógłby przy szyfrze bez tagu przestawiać bity
 * szyfrogramu i sterować odszyfrowanym hasłem, nie znając klucza. Tag GCM
 * zamienia taką manipulację w twardy błąd odczytu.
 *
 * AAD = `${tenantId}:${key}` i to jest tu rzecz najważniejsza po samym
 * szyfrowaniu: koperta jest ZWIĄZANA z wierszem, w którym leży. Przeniesienie
 * szyfrogramu tenanta A do wiersza tenanta B (albo spod klucza
 * `globkurier_password` pod token rozliczeniowy fazy 3) nie odszyfruje się —
 * fail-closed. Bez AAD posiadacz zapisu do tenant_secrets mógłby wkleić sobie
 * cudzą integrację i nadawać przesyłki na cudzym koncie u dostawcy, nigdy nie
 * widząc hasła. Szyfrowanie samo w sobie by tego nie zatrzymało.
 *
 * ŻADEN komunikat błędu w tym module nie niesie wartości jawnej, klucza ani
 * szyfrogramu: te wyjątki lądują w logach i na ekranie operatora (ADR-052).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { type SecretsKeyring } from "./keyring";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
/** 96-bitowy IV — rozmiar zalecany dla GCM (jedyny bez dodatkowego hashowania). */
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Lustro CHECK-a `tenant_secrets.ciphertext` z migracji 0024. */
const ENVELOPE_PATTERN = /^v1:([0-9]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/;

export class SecretEnvelopeError extends Error {
  constructor(message: string) {
    super(`Nie udało się odczytać sekretu tenanta: ${message}`);
    this.name = "SecretEnvelopeError";
  }
}

export interface SecretEnvelope {
  ciphertext: string;
  keyVersion: number;
}

/** Miejsce sekretu w bazie — to ono jest uwierzytelniane jako AAD. */
export interface SecretLocation {
  tenantId: string;
  key: string;
}

function aad(location: SecretLocation): Buffer {
  return Buffer.from(`${location.tenantId}:${location.key}`, "utf8");
}

const b64u = (buf: Buffer): string => buf.toString("base64url");

/**
 * Wartość jawna → koperta gotowa do zapisu w public.tenant_secrets.
 * Szyfruje ZAWSZE bieżącą wersją klucza, także przy nadpisaniu — dzięki temu
 * zwykła edycja sekretu domyka rotację bez osobnego narzędzia.
 */
export function encryptTenantSecret(
  plaintext: string,
  location: SecretLocation,
  keyring: SecretsKeyring,
): SecretEnvelope {
  if (plaintext.length === 0) {
    throw new SecretEnvelopeError("wartość jawna jest pusta");
  }
  const version = keyring.currentVersion;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyring.keyFor(version), iv);
  cipher.setAAD(aad(location));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: `${ENVELOPE_VERSION}:${version}:${b64u(iv)}:${b64u(tag)}:${b64u(encrypted)}`,
    keyVersion: version,
  };
}

/**
 * Koperta z bazy → wartość jawna. Każda niezgodność (obcy format, zła wersja
 * klucza, naruszony tag, koperta z cudzego wiersza) kończy się wyjątkiem —
 * nigdy „pustym sekretem", bo ten poszedłby do dostawcy jako puste hasło
 * i awaria wyszłaby dopiero po stronie kuriera.
 */
export function decryptTenantSecret(
  envelope: string,
  location: SecretLocation,
  keyring: SecretsKeyring,
): string {
  const match = ENVELOPE_PATTERN.exec(envelope);
  if (!match) {
    throw new SecretEnvelopeError("koperta ma nieznany format");
  }
  // Grupy są zadeklarowane jako `string | undefined` (noUncheckedIndexedAccess).
  // Dopasowanie wzorca gwarantuje ich obecność, ale gwarancję zapisujemy jawnie
  // zamiast uciszać typ wykrzyknikiem — asercja `!` przetrwałaby zmianę wzorca,
  // a ten warunek się na niej wywali.
  const [, rawVersion, rawIv, rawTag, rawData] = match;
  if (!rawVersion || !rawIv || !rawTag || !rawData) {
    throw new SecretEnvelopeError("koperta ma niekompletne człony");
  }

  const iv = Buffer.from(rawIv, "base64url");
  const tag = Buffer.from(rawTag, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretEnvelopeError("koperta ma nieprawidłowe rozmiary IV/tagu");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    keyring.keyFor(Number.parseInt(rawVersion, 10)),
    iv,
  );
  decipher.setAAD(aad(location));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(rawData, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Komunikat CELOWO nie rozróżnia „zły klucz" od „naruszony szyfrogram" od
    // „koperta z cudzego wiersza": rozróżnienie nie pomaga operatorowi,
    // a atakującemu z zapisem do tabeli podpowiadałoby, którą hipotezę
    // testuje. Oryginalny wyjątek nie jest opakowywany, bo node dokleja
    // do niego fragmenty wejścia.
    throw new SecretEnvelopeError("weryfikacja koperty nie powiodła się");
  }
}
