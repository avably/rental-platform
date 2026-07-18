/**
 * Parytet kluczy i18n EN↔PL storefrontu (bramka CI, job `ci` — bez Supabase).
 *
 * Storefront ładuje messages/<locale>.json dla osi marketingowej (next-intl,
 * i18n/request.ts) ORAZ dla osi tenanckiej (copy przekazywane propsami wg
 * tenants.locale — lib/storefront/copy.ts). Żadna z tych ścieżek nie typuje
 * kluczy: brak stringa w jednym locale ujawnia się dopiero w przeglądarce. Ten
 * test jest twardą bramką — oba pliki muszą mieć DOKŁADNIE ten sam zbiór kluczy
 * liściowych (parytet WSZĘDZIE, także w namespace `storefront`).
 */
import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

type Json = { [key: string]: unknown };

function flattenKeys(obj: Json, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value !== null && typeof value === "object"
      ? flattenKeys(value as Json, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("parytet kluczy i18n EN↔PL (storefront)", () => {
  const enKeys = new Set(flattenKeys(en as unknown as Json));
  const plKeys = new Set(flattenKeys(pl as unknown as Json));

  it("EN nie ma kluczy, których brak w PL", () => {
    const onlyEn = [...enKeys].filter((key) => !plKeys.has(key));
    expect(onlyEn, `klucze tylko w EN: ${onlyEn.join(", ")}`).toEqual([]);
  });

  it("PL nie ma kluczy, których brak w EN", () => {
    const onlyPl = [...plKeys].filter((key) => !enKeys.has(key));
    expect(onlyPl, `klucze tylko w PL: ${onlyPl.join(", ")}`).toEqual([]);
  });

  it("namespace `storefront` istnieje w obu locale z kompletem podsekcji", () => {
    for (const keys of [enKeys, plKeys]) {
      for (const section of ["nav", "common", "product", "cart", "checkout", "confirmation"]) {
        expect([...keys].some((key) => key.startsWith(`storefront.${section}.`))).toBe(true);
      }
    }
    // Każdy status błędu checkoutu ma komunikat w obu locale.
    for (const keys of [enKeys, plKeys]) {
      for (const err of ["unavailable", "rejected", "rateLimited", "captcha", "server"]) {
        expect(keys.has(`storefront.checkout.errors.${err}`)).toBe(true);
      }
    }
  });
});
