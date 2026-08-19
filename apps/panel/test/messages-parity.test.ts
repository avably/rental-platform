/**
 * Parytet kluczy i18n EN↔PL (bramka CI, job `ci` — bez Supabase).
 *
 * next-intl ładuje messages/<locale>.json per żądanie (i18n/request.ts) i NIE
 * typuje kluczy — brakujący klucz w jednym locale ujawnia się dopiero jako
 * `t()` zwracające surowy identyfikator w przeglądarce. Ten test zamienia to
 * w twardą bramkę: oba pliki muszą mieć DOKŁADNIE ten sam zbiór kluczy
 * (liściowych). Dodanie stringa do jednego locale bez drugiego pali tu.
 */
import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

type Json = { [key: string]: string | Json };

function flattenKeys(obj: Json, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? flattenKeys(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("parytet kluczy i18n EN↔PL", () => {
  const enKeys = new Set(flattenKeys(en as Json));
  const plKeys = new Set(flattenKeys(pl as Json));

  it("EN nie ma kluczy, których brak w PL", () => {
    const onlyEn = [...enKeys].filter((key) => !plKeys.has(key));
    expect(onlyEn, `klucze tylko w EN: ${onlyEn.join(", ")}`).toEqual([]);
  });

  it("PL nie ma kluczy, których brak w EN", () => {
    const onlyPl = [...plKeys].filter((key) => !enKeys.has(key));
    expect(onlyPl, `klucze tylko w PL: ${onlyPl.join(", ")}`).toEqual([]);
  });

  /**
   * KTÓRE EKRANY MAJĄ KOMUNIKAT CAPTCHY — w obie strony (ADR-164).
   *
   * Do ADR-164 logowanie też go miało. Po zdjęciu weryfikacji na logowaniu
   * klucz stał się martwy, a martwy klucz w słowniku jest gorszy niż jego
   * brak: następny czytelnik wnioskuje z niego, że CAPTCHA na logowaniu
   * gdzieś tam jednak działa. Asercja negatywna trzyma go poza słownikiem.
   */
  it("komunikat CAPTCHY jest w kluczach obu locale — dla register i resetRequest", () => {
    for (const keys of [enKeys, plKeys]) {
      expect(keys.has("register.captchaFailed")).toBe(true);
      expect(keys.has("resetRequest.captchaFailed")).toBe(true);
    }
  });

  it("logowanie NIE ma komunikatu CAPTCHY — nie ma czego nim opisać (ADR-164)", () => {
    for (const keys of [enKeys, plKeys]) {
      expect(
        keys.has("login.captchaFailed"),
        "wrócił komunikat CAPTCHY logowania — przywrócenie widżetu wymaga ADR",
      ).toBe(false);
      // Kontrola pozytywna tej samej klasy: przestrzeń `login.` istnieje
      // i jest czytana poprawnie, więc asercja wyżej nie jest zielona przez
      // literówkę w prefiksie.
      expect(keys.has("login.signInFailed")).toBe(true);
    }
  });

  it("odnośnik o mailu potwierdzającym zszedł z OBU ekranów (ADR-164 + ADR-208)", () => {
    for (const keys of [enKeys, plKeys]) {
      expect(keys.has("login.noConfirmationMail")).toBe(false);
      // ADR-208 (uwaga właściciela) zdjął stały odnośnik także z rejestracji,
      // więc klucz jest martwy i NIE MA go w słowniku. Droga do „sprawdź
      // skrzynkę" nie zniknęła: przekierowanie akcji rejestracji + wyjście
      // przy odmowie logowania (ADR-153, N3 — klucz niżej).
      expect(keys.has("register.noConfirmationMail")).toBe(false);
      // Kontrola pozytywna tej samej klasy: klucz wyjścia awaryjnego przy
      // odmowie logowania ISTNIEJE — asercje wyżej nie są zielone przez
      // literówkę w prefiksie.
      expect(keys.has("login.resendConfirmation")).toBe(true);
    }
  });
});
