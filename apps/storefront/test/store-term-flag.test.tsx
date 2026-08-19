/**
 * FLAGA GLOBALNEJ PIGUŁKI TERMINU (ADR-203, migracja 0090) — warstwa sklepu.
 *
 * ==================== CZEGO PILNUJE TEN PLIK ====================
 *
 *   1. PARSOWANIE KOPERTY jest fail-soft do DOMYŚLNEGO `true`: nieudany
 *      odczyt, zły kształt i nieznany klucz nie mają prawa zgasić pigułki
 *      w sklepach wszystkich najemców (zero regresu — kanon ADR-171).
 *   2. REGUŁA „FLAGA OFF → term=null" ma DOKŁADNIE jedno miejsce
 *      (`storeTermInput`) i obie strony: off → null (pasek znika), on →
 *      komplet składników (pasek jak przed 0090).
 *   3. KONTRAKT ŹRÓDŁA: każde `term={` w trasach sklepu to `storeTermInput(`
 *      albo jawny `null` — trasa, która złożyłaby warunek u siebie (albo
 *      wpięła literał `{ products, locale }` z pominięciem flagi), pali ten
 *      test. Skan plikowy ma ślepą plamę (mierzy tekst, nie zachowanie —
 *      lekcja z kontraktów źródła), więc NIE stoi sam: dowód behawioralny
 *      na prawdziwym renderze tras trzymają product-template-route.test.tsx
 *      (przypadek 3e) i catalog-page-route.test.tsx (pigułka on/off) — ten
 *      skan domyka pozostałe trasy, dla których renderu trasy w suicie nie ma.
 *
 * Mechanikę paska przy `term=null` (brak pigułki, wiersza i panelu R4)
 * trzyma od ADR-179 sama powłoka — `StoreChrome` nie renderuje wtedy
 * `StoreTermBar` w ogóle; ta suita nie dubluje tamtych bramek.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STORE_FLAGS,
  getPublicStoreFlags,
  parseStoreFlags,
} from "@/lib/site/store-flags";
import { storeTermInput } from "@/lib/storefront/term-input";

const APP_ROOT = join(__dirname, "..");

describe("parsowanie flag powłoki (fail-soft, zero regresu)", () => {
  it("kompletna koperta niesie wartość z bazy — w OBIE strony", () => {
    expect(parseStoreFlags({ term_calendar_enabled: false })).toEqual({
      termCalendarEnabled: false,
    });
    expect(parseStoreFlags({ term_calendar_enabled: true })).toEqual({
      termCalendarEnabled: true,
    });
  });

  it("śmieć spada na domyślne TRUE — pigułka jak przed 0090, nigdy zgaszona blipem", () => {
    for (const payload of [null, undefined, [], "tak", 7, { term_calendar_enabled: "false" }, {}]) {
      expect(parseStoreFlags(payload), `payload: ${JSON.stringify(payload)}`).toEqual(
        DEFAULT_STORE_FLAGS,
      );
    }
    expect(DEFAULT_STORE_FLAGS.termCalendarEnabled, "domyślna wartość to zachowanie sprzed 0090").toBe(
      true,
    );
  });

  it("nieznany klucz koperty jest IGNOROWANY — następna flaga nie wywróci starego kodu", () => {
    expect(
      parseStoreFlags({ term_calendar_enabled: false, przyszla_flaga: "cokolwiek" }),
    ).toEqual({ termCalendarEnabled: false });
  });

  it("błąd transportu oddaje domyślne flagi (fail-soft jak powłoka wyglądu)", async () => {
    const client = {
      schema: () => ({
        rpc: async () => ({ data: null, error: { message: "awaria" } }),
      }),
    } as unknown as SupabaseClient;
    expect(await getPublicStoreFlags("11111111-1111-4111-8111-111111111111", client)).toEqual(
      DEFAULT_STORE_FLAGS,
    );
  });

  it("odpowiedź z bazy przechodzi przez parser — false dociera do sklepu", async () => {
    const client = {
      schema: () => ({
        rpc: async () => ({ data: { term_calendar_enabled: false }, error: null }),
      }),
    } as unknown as SupabaseClient;
    expect(await getPublicStoreFlags("11111111-1111-4111-8111-111111111111", client)).toEqual({
      termCalendarEnabled: false,
    });
  });
});

describe("storeTermInput — jedno miejsce reguły „flaga off → term=null”", () => {
  const products = [{ id: "p-1", name: "Wiertarka" }];

  it("flaga ON: komplet składników paska — pigułka jak przed 0090", () => {
    expect(storeTermInput({ termCalendarEnabled: true }, products, "pl")).toEqual({
      products,
      locale: "pl",
    });
  });

  it("flaga OFF: null — powłoka nie renderuje ani pigułki, ani wiersza, ani panelu R4", () => {
    expect(storeTermInput({ termCalendarEnabled: false }, products, "pl")).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * Kontrakt źródła: sześć miejsc `term=`, jedna reguła
 * ---------------------------------------------------------------------- */

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsxFilesUnder(path));
    else if (entry.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("kontrakt źródła: term w trasach wyłącznie przez storeTermInput albo null", () => {
  it("każde `term={` poza powłoką to `storeTermInput(` albo jawny `null`", () => {
    // Poza skanem zostają ŚWIADOMIE: `components/storefront/page-shell.tsx`
    // (przelotka `term={term}` — props wymagany, więc wołający i tak
    // rozstrzyga) oraz sama powłoka (`store-chrome.tsx` — konsument propsa).
    const scanned = [
      ...tsxFilesUnder(join(APP_ROOT, "app")),
      ...tsxFilesUnder(join(APP_ROOT, "lib")),
      join(APP_ROOT, "components", "storefront", "legal-page.tsx"),
    ];

    const offenders: string[] = [];
    let matches = 0;
    for (const file of scanned) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/term=\{([^}]*)\}?/g)) {
        matches += 1;
        const value = match[1]!.trim();
        if (value === "null" || value.startsWith("storeTermInput(")) continue;
        offenders.push(`${file}: term={${value}`);
      }
    }

    // Czujnik po pustym zbiorze: skan, który nie widzi ANI JEDNEGO `term={`,
    // nie pilnuje niczego (przeniesienie propsa unieważniłoby regex).
    expect(matches, "skan nie znalazł żadnego `term={` — kontrakt mierzy pustkę").toBeGreaterThanOrEqual(
      8,
    );
    expect(offenders, "trasa omija storeTermInput — flaga najemcy nie dociera do paska").toEqual([]);
  });

  it("wszystkie SZEŚĆ tras handlowych podaje term przez storeTermInput", () => {
    // Wyliczenie z ADR-203 — jeżeli trasa dojdzie albo ubędzie, ta lista ma
    // się zmienić ŚWIADOMIE, razem z decyzją o zasięgu flagi.
    const commercial = [
      "app/(tenant)/store/page.tsx",
      "app/(tenant)/store/[slug]/page.tsx",
      "app/(tenant)/katalog/page.tsx",
      "app/(tenant)/cart/page.tsx",
      "app/(tenant)/checkout/page.tsx",
      "lib/catalog/product-page.tsx",
    ];
    for (const file of commercial) {
      const source = readFileSync(join(APP_ROOT, file), "utf8");
      expect(
        source.includes("term={storeTermInput(ctx.storeFlags"),
        `${file}: trasa handlowa nie respektuje flagi pigułki`,
      ).toBe(true);
    }
  });
});
