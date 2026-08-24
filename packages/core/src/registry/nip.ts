/**
 * NIP (polski numer identyfikacji podatkowej) — normalizacja i suma
 * kontrolna. Czysta funkcja, zero I/O: bezpieczna zarówno po stronie
 * serwera (bramka przed strzałem do MF/GUS — L1/ADR-234), jak i klienta
 * (natychmiastowa walidacja formatu w formularzu, zanim użytkownik w ogóle
 * kliknie „Pobierz dane").
 *
 * Algorytm sumy kontrolnej (wagi 6,5,7,2,3,4,5,6,7, mod 11, ostatnia cyfra
 * = reszta) jest STANDARDEM ustawowym (rozporządzenie MF ws. NIP) — ten sam,
 * który powiela `app.nip_checksum_valid` w bazie (packages/db/supabase/
 * migrations/0096_tenant_company_identity.sql). DWIE implementacje tego
 * samego algorytmu (TS + SQL) są ŚWIADOME: baza broni się niezależnie od
 * aplikacji (defense in depth — RPC nie ufa samemu inputowi), a klient/serwer
 * TS potrzebuje walidacji BEZ okrążania przez Postgres. Zmiana algorytmu w
 * jednym miejscu bez drugiego jest regresją — testuj oba.
 */

const NIP_CHECKSUM_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

/** Usuwa wszystko poza cyframi (spacje, myślniki, prefiks „PL" itp.). */
export function normalizeNip(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * `true` WYŁĄCZNIE dla ciągu DOKŁADNIE 10 cyfr z poprawną sumą kontrolną.
 * Reszta z dzielenia równa 10 jest ODRZUCANA (żadna pojedyncza cyfra nie
 * może jej reprezentować — NIP z takim prefiksem nigdy nie istnieje).
 *
 * Przyjmuje SUROWY wejściowy string (z separatorami) — normalizuje sam,
 * żeby wołający nie musiał pamiętać kolejności `normalizeNip` → walidacja.
 */
export function isValidNipChecksum(input: string): boolean {
  const nip = normalizeNip(input);
  if (nip.length !== 10) return false;

  const digits = nip.split("").map(Number);
  const sum = NIP_CHECKSUM_WEIGHTS.reduce((acc, weight, index) => acc + weight * digits[index]!, 0);
  const checksum = sum % 11;
  if (checksum === 10) return false;

  return checksum === digits[9];
}
