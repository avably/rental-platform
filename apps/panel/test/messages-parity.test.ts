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

  it("komunikat CAPTCHA jest w kluczach obu locale (login + register)", () => {
    for (const keys of [enKeys, plKeys]) {
      expect(keys.has("login.captchaFailed")).toBe(true);
      expect(keys.has("register.captchaFailed")).toBe(true);
    }
  });
});
