/**
 * CACHE KATALOGU — IZOLACJA MIĘDZY NAJEMCAMI (faza 4a, ADR-184).
 *
 * ==================== DLACZEGO TO JEST NAJGROŹNIEJSZY PLIK W TEJ FAZIE ====================
 *
 * Katalog czyta funkcja `SECURITY DEFINER`, czyli POZA RLS-em. Dopóki każde
 * żądanie szło do bazy, izolację trzymał jawny filtr `tenant_id` w ciele
 * funkcji. Cache wprowadza warstwę, do której baza NIE SIĘGA: wpis trafiony
 * kluczem bez tożsamości najemcy oddaje CUDZY katalog — ceny, nazwy i zdjęcia
 * konkurencyjnej wypożyczalni na cudzej domenie. Żadna polityka RLS tego nie
 * złapie, bo do bazy w ogóle nie dochodzi.
 *
 * ==================== KONTROLA POZYTYWNA JEST WARUNKIEM SENSU ====================
 *
 * Sam test „B nie dostał danych A" przechodzi ŚPIEWAJĄCO także wtedy, gdy cache
 * nie działa w ogóle — bo wtedy każde żądanie idzie do bazy i nic nie ma prawa
 * wyciec. Dlatego pierwszy przypadek dowodzi, że cache DZIAŁA (drugie żądanie
 * NIE IDZIE do bazy), a dopiero na tym tle drugi pyta o izolację. Bez tej
 * kolejności byłaby to bramka zielona po pustym zbiorze.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { publicCatalogCacheKey } from "@avably/core/site";

import {
  __resetCatalogCacheForTests,
  getCachedCatalog,
  resolvePublicCatalog,
  setCachedCatalog,
  CATALOG_TTL_SECONDS,
} from "@/lib/catalog/catalog-cache";
import type { PublicCatalog } from "@/lib/checkout/contract";

const NAJEMCA_A = "aaaaaaaa-1111-4111-8111-111111111111";
const NAJEMCA_B = "bbbbbbbb-2222-4222-8222-222222222222";

/** Katalogi rozróżnialne co do nazwy — inaczej „wyciek" nie miałby jak być widoczny. */
function katalog(nazwa: string): PublicCatalog {
  return {
    tenant: { name: nazwa, locale: "pl", currency: "PLN" },
    custom_fields: [],
    categories: [],
    products: [],
    pickup_locations: [],
    delivery_methods: [],
  };
}

const KATALOG_A = katalog("Wypożyczalnia Alfa");
const KATALOG_B = katalog("Wypożyczalnia Beta");

/** Licznik ODCZYTÓW Z BAZY — mierzy to, po co ten cache w ogóle powstał. */
function bazaZLicznikiem() {
  const zapytania: string[] = [];
  return {
    zapytania,
    lookup: async (tenantId: string) => {
      zapytania.push(tenantId);
      return tenantId === NAJEMCA_A ? KATALOG_A : KATALOG_B;
    },
  };
}

const deps = (lookup: (t: string) => Promise<PublicCatalog | null>) => ({
  getCache: getCachedCatalog,
  setCache: setCachedCatalog,
  lookup,
});

describe("cache katalogu publicznego (ADR-184)", () => {
  beforeEach(() => {
    __resetCatalogCacheForTests();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  // -------------------------------------------------------------------
  // 1. KONTROLA POZYTYWNA — cache w ogóle działa
  // -------------------------------------------------------------------
  it("KONTROLA POZYTYWNA: drugie żądanie tego samego najemcy NIE IDZIE do bazy", async () => {
    const baza = bazaZLicznikiem();

    const pierwsze = await resolvePublicCatalog(NAJEMCA_A, deps(baza.lookup));
    const drugie = await resolvePublicCatalog(NAJEMCA_A, deps(baza.lookup));

    expect(pierwsze?.tenant.name).toBe("Wypożyczalnia Alfa");
    expect(drugie?.tenant.name, "cache oddał co innego niż baza").toBe("Wypożyczalnia Alfa");
    expect(
      baza.zapytania,
      "cache NIE DZIAŁA — każde żądanie idzie do bazy, więc test izolacji niżej nie ma czego bronić",
    ).toEqual([NAJEMCA_A]);
  });

  // -------------------------------------------------------------------
  // 2. IZOLACJA — na tle działającego cache'u
  // -------------------------------------------------------------------
  it("WYCIEK: najemca B nie dostaje katalogu najemcy A z ciepłego cache'u", async () => {
    const baza = bazaZLicznikiem();

    // Cache rozgrzany katalogiem A.
    await resolvePublicCatalog(NAJEMCA_A, deps(baza.lookup));
    expect(baza.zapytania, "rozgrzewka nie doszła do bazy").toEqual([NAJEMCA_A]);

    const dlaB = await resolvePublicCatalog(NAJEMCA_B, deps(baza.lookup));

    expect(dlaB?.tenant.name, "WYCIEK MIĘDZY NAJEMCAMI: B zobaczył katalog A").toBe(
      "Wypożyczalnia Beta",
    );
    // Druga połowa tej samej asercji: B poszedł PO SWOJE do bazy, a nie zjadł
    // cudzy wpis. Bez niej test przeszedłby też wtedy, gdyby cache oddawał
    // `undefined` na każdy klucz.
    expect(baza.zapytania, "B nie poszedł po swój katalog do bazy").toEqual([
      NAJEMCA_A,
      NAJEMCA_B,
    ]);
  });

  it("klucz cache'u NIESIE identyfikator najemcy", () => {
    // Klucz jest bramką izolacji, więc pytamy o niego wprost — a nie tylko
    // o skutek. Dwa najemcy nie mogą dzielić klucza, i to musi być widoczne
    // w jednej asercji, którą trudno przeoczyć przy refaktorze.
    expect(publicCatalogCacheKey(NAJEMCA_A)).toContain(NAJEMCA_A);
    expect(publicCatalogCacheKey(NAJEMCA_A)).not.toBe(publicCatalogCacheKey(NAJEMCA_B));
  });

  // -------------------------------------------------------------------
  // 3. UNIEWAŻNIENIE — skasowany wpis wraca do bazy
  // -------------------------------------------------------------------
  it("po unieważnieniu wpisu katalog jedzie z BAZY, a nie ze starego cache'u", async () => {
    const zapytania: string[] = [];
    let wersja = "przed zmianą ceny";
    const lookup = async (tenantId: string) => {
      zapytania.push(tenantId);
      return katalog(wersja);
    };

    await resolvePublicCatalog(NAJEMCA_A, deps(lookup));
    wersja = "po zmianie ceny";

    // Bez unieważnienia klient dalej widzi starą kopertę — to jest DOKŁADNIE
    // to, przed czym broni kasowanie wpisu z panelu.
    const zeStarego = await resolvePublicCatalog(NAJEMCA_A, deps(lookup));
    expect(zeStarego?.tenant.name).toBe("przed zmianą ceny");

    // Unieważnienie = to samo, co robi panel: wpis znika, następny odczyt
    // odbudowuje go z bazy.
    __resetCatalogCacheForTests();
    const poUniewaznieniu = await resolvePublicCatalog(NAJEMCA_A, deps(lookup));

    expect(poUniewaznieniu?.tenant.name, "unieważnienie nie zadziałało").toBe("po zmianie ceny");
    expect(zapytania).toEqual([NAJEMCA_A, NAJEMCA_A]);
  });

  // -------------------------------------------------------------------
  // 4. TTL jest ZABEZPIECZENIEM, więc musi mieć nazwaną wartość
  // -------------------------------------------------------------------
  it("TTL wpisu ma jawną, skończoną wartość", async () => {
    // Wpis bez TTL zostałby w magazynie na zawsze, gdyby unieważnienie
    // z panelu nie doszło — a wtedy „nieświeżość przez minutę" zamieniłaby
    // się w „nieświeżość do następnego wdrożenia".
    expect(CATALOG_TTL_SECONDS).toBeGreaterThan(0);
    expect(CATALOG_TTL_SECONDS).toBeLessThanOrEqual(300);

    await setCachedCatalog(NAJEMCA_A, KATALOG_A, 0);
    expect(
      await getCachedCatalog(NAJEMCA_A),
      "wpis z zerowym TTL przeżył — magazyn ignoruje czas życia",
    ).toBeUndefined();
  });
});
