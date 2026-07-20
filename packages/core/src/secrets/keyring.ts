/**
 * Klucze szyfrujące sekrety tenantów — odczyt i walidacja konfiguracji.
 *
 * Klucz mieszka w ZMIENNEJ ŚRODOWISKOWEJ aplikacji, celowo poza bazą: to jest
 * cała istota wariantu wybranego w ADR-052. Baza (łącznie z service_role,
 * Studio, zrzutem pg_dump i kopią zapasową) widzi wyłącznie szyfrogram,
 * a żeby go rozpakować, trzeba skompromitować drugą, niezależną rzecz.
 *
 * ROTACJA bez zmiany kodu: kluczy jest ZBIÓR ponumerowany
 * (AVABLY_SECRETS_KEY_V1, _V2, ...), a AVABLY_SECRETS_KEY_CURRENT wskazuje
 * ten, którym SZYFRUJEMY. Odszyfrowanie idzie po numerze zapisanym w kopercie,
 * więc stare wiersze czytają się starym kluczem dopóty, dopóki nie zostaną
 * nadpisane. Rotacja = dołożenie _V<n+1> i przestawienie _CURRENT.
 *
 * ZERO CICHYCH FALLBACKÓW (wzorzec ADR-030/031/033): brak albo wadliwa
 * konfiguracja to głośny SecretsConfigError, nigdy „domyślny klucz" ani
 * przejście w tryb bez szyfrowania. Klucz awaryjny byłby kluczem publicznym.
 */

/** Prefiks zmiennej z materiałem klucza; numer wersji doklejany na końcu. */
export const SECRETS_KEY_ENV_PREFIX = "AVABLY_SECRETS_KEY_V";

/** Zmienna wskazująca wersję klucza używaną do SZYFROWANIA. */
export const SECRETS_KEY_CURRENT_ENV = "AVABLY_SECRETS_KEY_CURRENT";

/** AES-256 — klucz musi mieć dokładnie 32 bajty. */
export const SECRET_KEY_BYTES = 32;

export class SecretsConfigError extends Error {
  constructor(message: string) {
    super(`Konfiguracja szyfrowania sekretów jest nieprawidłowa: ${message}`);
    this.name = "SecretsConfigError";
  }
}

export interface SecretsKeyring {
  /** Wersja, którą szyfrujemy nowe i nadpisywane sekrety. */
  readonly currentVersion: number;
  /** Materiał klucza dla danej wersji; brak wersji = błąd, nigdy undefined. */
  keyFor(version: number): Uint8Array;
}

/** Źródło zmiennych — wstrzykiwane, żeby testy nie grzebały w process.env. */
export type EnvSource = Record<string, string | undefined>;

function decodeKey(raw: string, envName: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    // Buffer.from(..., "base64") jest POBŁAŻLIWY: cicho ignoruje znaki spoza
    // alfabetu i skraca wynik, więc literówka w sekrecie Vercela dałaby klucz
    // krótszy, a nie błąd. Stąd kontrola długości niżej — jest ona jedyną
    // rzeczą, która odróżnia klucz od śmiecia.
    bytes = new Uint8Array(Buffer.from(raw.trim(), "base64"));
  } catch {
    throw new SecretsConfigError(`${envName} nie jest poprawnym base64`);
  }
  if (bytes.length !== SECRET_KEY_BYTES) {
    // Komunikat podaje DŁUGOŚĆ, nigdy treść — ten błąd trafia do logów.
    throw new SecretsConfigError(
      `${envName} ma ${bytes.length} bajtów po zdekodowaniu, wymagane ${SECRET_KEY_BYTES}`,
    );
  }
  return bytes;
}

/**
 * Zmienne środowiskowe → zestaw kluczy. Rzuca SecretsConfigError, gdy
 * konfiguracji brak albo jest niespójna — wołający ma pokazać jawną
 * niedostępność funkcji, nie udawać, że sekretów nie ma.
 */
export function resolveSecretsKeyring(env: EnvSource): SecretsKeyring {
  const rawCurrent = env[SECRETS_KEY_CURRENT_ENV]?.trim();
  if (!rawCurrent) {
    throw new SecretsConfigError(`brak zmiennej ${SECRETS_KEY_CURRENT_ENV}`);
  }
  if (!/^[0-9]+$/.test(rawCurrent)) {
    throw new SecretsConfigError(
      `${SECRETS_KEY_CURRENT_ENV} musi być liczbą całkowitą, jest "${rawCurrent}"`,
    );
  }
  const currentVersion = Number.parseInt(rawCurrent, 10);
  if (currentVersion < 1) {
    throw new SecretsConfigError(`${SECRETS_KEY_CURRENT_ENV} musi być >= 1`);
  }

  // Wczytujemy WSZYSTKIE wersje obecne w środowisku, nie tylko bieżącą:
  // po rotacji stare wiersze nadal muszą się odszyfrować, a zorientowanie się
  // o braku starego klucza dopiero przy odczycie konkretnego tenanta byłoby
  // awarią odłożoną w czasie i trudną do powiązania z przyczyną.
  const keys = new Map<number, Uint8Array>();
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(SECRETS_KEY_ENV_PREFIX) || !value) continue;
    const suffix = name.slice(SECRETS_KEY_ENV_PREFIX.length);
    if (!/^[0-9]+$/.test(suffix)) continue;
    keys.set(Number.parseInt(suffix, 10), decodeKey(value, name));
  }

  if (!keys.has(currentVersion)) {
    throw new SecretsConfigError(
      `${SECRETS_KEY_CURRENT_ENV}=${currentVersion}, ale brak zmiennej ` +
        `${SECRETS_KEY_ENV_PREFIX}${currentVersion}`,
    );
  }

  return {
    currentVersion,
    keyFor(version: number): Uint8Array {
      const key = keys.get(version);
      if (!key) {
        throw new SecretsConfigError(
          `sekret zaszyfrowano kluczem w wersji ${version}, a ` +
            `${SECRETS_KEY_ENV_PREFIX}${version} nie ma w środowisku`,
        );
      }
      return key;
    },
  };
}
