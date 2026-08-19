/**
 * ADRES STRONY SPRZĘTU — rozstrzyganie i przekierowania 308 (ADR-182).
 *
 * Test mierzy SKUTEK, nie obecność trasy: nie „plik `/produkt/[slug]` istnieje",
 * tylko „ten adres oddaje TEN sprzęt, tamten oddaje 308 pod adres bieżący,
 * a nieznany oddaje 404".
 *
 * OŚ IZOLACJI JEST TU NAZWANA WPROST. Adres rozstrzyga WYŁĄCZNIE baza, zawężona
 * do jednego najemcy — nigdy skanowanie katalogu po nazwie. Gdyby trasa szukała
 * pozycji po nazwie albo po slugu policzonym z nazwy, adres najemcy A trafiałby
 * w sprzęt najemcy B wszędzie tam, gdzie obaj nazwali sprzęt tak samo — a nazwy
 * sprzętu do wypożyczenia powtarzają się między wypożyczalniami niemal zawsze.
 *
 * ==================== CO ZMIENIŁA FAZA 4a (ADR-185) ====================
 *
 * Do fazy 4a rozstrzygnięcie szło przez REJESTR adresów całego najemcy
 * (`ctx.productSlugs`), czytany NIEZALEŻNIE od katalogu. Dwa niezależne odczyty
 * znaczyły, że stan „znam pozycję, nie znam jej adresu" był reprezentowalny,
 * i trasa zastana musiała go umieć obsłużyć renderem.
 *
 * Od ADR-185 pozycja i jej adres przyjeżdżają JEDNĄ kopertą
 * (`app.get_public_product`), więc ten stan nie ma już gdzie powstać. Testy
 * mockują tu WARSTWĘ DANYCH, a nie kontekst — dzięki temu pod pomiarem stoi
 * prawdziwa logika `loadProductPageContext`, w tym mapowanie trzech odpowiedzi
 * koperty na render / 308 / 404.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SPRZET_ID = "22222222-2222-4222-8222-222222222222";
const SLUG = "rower-gorski";
const STARY_SLUG = "rower";

/* -------------------------------------------------------------------------
 * Mocki — koperta wąskiego odczytu sterowana z każdego przypadku
 * ---------------------------------------------------------------------- */

interface Koperta {
  match: "current" | "redirect" | "none";
  slug: string | null;
  tenant: { name: string; locale: "pl" | "en"; currency: "PLN" };
  custom_fields: unknown[];
  product: { id: string; name: string } | null;
}

const POZYCJA = {
  id: SPRZET_ID,
  name: "Rower górski",
  description: null,
  base_price_day_grosze: 12_000,
  deposit_grosze: 0,
  auto_increment_multiplier: 1,
  buffer_before_days: 0,
  buffer_after_days: 0,
  custom_fields: {},
  category_ids: [],
  pricing_tiers: [],
  images: [],
};

const TENANT_ROW = { name: "Wypożyczalnia Testowa", locale: "pl" as const, currency: "PLN" as const };

/**
 * Atrapa BAZY, nie atrapa kontekstu: odwzorowuje `app.get_public_product`,
 * czyli rozstrzyga adres tak, jak rozstrzyga go SQL — po zawartości rejestru
 * TEGO najemcy. `null` = błąd odczytu / najemca poza oknem handlowym.
 */
const stan: {
  odpowiedz: Koperta | null;
  renderowano: number;
  wywolania: ({ slug: string } | { productId: string })[];
} = { odpowiedz: null, renderowano: 0, wywolania: [] };

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-tenant-id": TENANT })),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  // 308 przerywa render rzutem, dokładnie jak w produkcji.
  permanentRedirect: (to: string) => {
    throw new Error(`308:${to}`);
  },
}));

vi.mock("@/lib/checkout/catalog", () => ({
  getPublicProduct: async (
    _tenantId: string,
    target: { slug: string } | { productId: string },
  ) => {
    stan.wywolania.push(target);
    return stan.odpowiedz;
  },
}));

vi.mock("@/lib/site/published", () => ({
  getTenantAppearance: async () => ({ template: "classic", style: {}, logo: null }),
  getPublishedSite: async () => null,
  tenantAppearanceStyle: () => ({}),
}));

vi.mock("@/lib/legal/published", () => ({ getPublishedLegalDocuments: async () => [] }));
// Flagi powłoki (ADR-203) — atrapa jak reszta warstwy danych wyżej: ten plik
// mierzy ADRESY, a domyślne `true` to stan każdego najemcy sprzed 0090.
vi.mock("@/lib/site/store-flags", () => ({
  getPublicStoreFlags: async () => ({ termCalendarEnabled: true }),
}));
vi.mock("@/lib/storefront/copy", () => ({
  getStorefrontCopy: async () => ({}),
  format: (s: string) => s,
}));

/*
  RENDER ZASTĄPIONY ZNACZNIKIEM. Ten plik pyta o ROZSTRZYGNIĘCIE ADRESU, więc
  ciągnięcie pełnego drzewa powłoki tylko po to, żeby sprawdzić „doszło do
  renderu", kosztowałoby kilkanaście sekund i mierzyło cudzy kontrakt.
  Atrapa zapisuje, KTÓRA pozycja poszła do renderu — a to jest dokładnie ta
  informacja, którą chcemy sprawdzić przy izolacji.
*/
const wyrenderowane: string[] = [];
vi.mock("@/lib/catalog/product-page", () => ({
  productPageMetadata: async () => ({}),
  renderProductPage: async ({ raw }: { raw: { id: string } }) => {
    stan.renderowano += 1;
    wyrenderowane.push(raw.id);
    return null;
  },
}));

async function otworzAdres(slug: string) {
  const { default: Trasa } = await import("../app/(tenant)/produkt/[slug]/page");
  return Trasa({ params: Promise.resolve({ slug }) });
}

async function otworzAdresZastany(id: string) {
  const { default: Trasa } = await import("../app/(tenant)/product/[id]/page");
  return Trasa({ params: Promise.resolve({ id }) });
}

function koperta(over: Partial<Koperta>): Koperta {
  return {
    match: "current",
    slug: SLUG,
    tenant: TENANT_ROW,
    custom_fields: [],
    product: POZYCJA,
    ...over,
  } as Koperta;
}

describe("adres strony sprzętu (ADR-182)", () => {
  beforeEach(() => {
    stan.odpowiedz = koperta({});
    stan.renderowano = 0;
    stan.wywolania.length = 0;
    wyrenderowane.length = 0;
    vi.resetModules();
  });

  // -------------------------------------------------------------------
  // 1. Adres bieżący
  // -------------------------------------------------------------------
  it("`/produkt/rower-gorski` oddaje stronę TEGO sprzętu", async () => {
    await otworzAdres(SLUG);
    expect(wyrenderowane, "trasa nie wyrenderowała pozycji spod tego adresu").toEqual([SPRZET_ID]);
    // ...i zapytała bazę DOKŁADNIE o ten adres, a nie o katalog.
    expect(stan.wywolania).toEqual([{ slug: SLUG }]);
  });

  // -------------------------------------------------------------------
  // 2. Stare adresy → 308
  // -------------------------------------------------------------------
  it("STARY adres sprzętu oddaje 308 pod adres bieżący, nie 404", async () => {
    // Te adresy są w Google i w linkach wklejonych przez klientów najemcy.
    // Twarde 404 to utrata ruchu, za który najemca już zapłacił.
    stan.odpowiedz = koperta({ match: "redirect", product: null });
    await expect(otworzAdres(STARY_SLUG)).rejects.toThrow(`308:/produkt/${SLUG}`);
    expect(stan.renderowano, "stary adres wyrenderował stronę zamiast przekierować").toBe(0);
  });

  it("ADRES ZASTANY z identyfikatorem (`/product/{uuid}`) oddaje 308 pod nowy", async () => {
    await expect(otworzAdresZastany(SPRZET_ID)).rejects.toThrow(`308:/produkt/${SLUG}`);
    expect(stan.renderowano).toBe(0);
    expect(stan.wywolania, "trasa zastana pytała slugiem zamiast identyfikatorem").toEqual([
      { productId: SPRZET_ID },
    ]);
  });

  // -------------------------------------------------------------------
  // 3. Adres nieznany → 404
  // -------------------------------------------------------------------
  it("adres spoza rejestru oddaje 404, a nie stronę losowej pozycji", async () => {
    stan.odpowiedz = koperta({ match: "none", slug: null, product: null });
    await expect(otworzAdres("czego-tu-nie-ma")).rejects.toThrow("notFound");
    expect(stan.renderowano).toBe(0);
  });

  it("adres zastany z identyfikatorem spoza katalogu najemcy oddaje 404", async () => {
    stan.odpowiedz = koperta({ match: "none", slug: null, product: null });
    await expect(
      otworzAdresZastany("99999999-9999-4999-8999-999999999999"),
    ).rejects.toThrow("notFound");
  });

  // -------------------------------------------------------------------
  // 4. IZOLACJA — adres rozstrzyga baza, nie nazwa pozycji
  // -------------------------------------------------------------------
  it("adres, którego rejestr TEGO najemcy nie zna, nie trafia w pozycję o pasującej nazwie", async () => {
    /*
     * Stan realistyczny: katalog najemcy zawiera „Rower górski", więc slug
     * policzony z nazwy dałby dokładnie `rower-gorski`. Baza tego adresu jednak
     * NIE ZNA dla tego najemcy — bo należy do innego. Odpowiedzią musi być 404,
     * a nie „znalazłem coś o takiej nazwie".
     */
    stan.odpowiedz = koperta({ match: "none", slug: null, product: null });
    await expect(otworzAdres(SLUG)).rejects.toThrow("notFound");
    expect(wyrenderowane, "trasa wyrenderowała pozycję spoza rejestru najemcy").toEqual([]);
  });

  // -------------------------------------------------------------------
  // 5. Nieudany odczyt → 404, nigdy cudza pozycja
  // -------------------------------------------------------------------
  it("nieudany odczyt oddaje 404, a nie stronę zbudowaną z niepełnych danych", async () => {
    /*
     * FAIL-CLOSED. Do fazy 4a rejestr adresów degradował się MIĘKKO (`null` =
     * „adresów nie znamy", kafle linkują pod adres zastany), bo był odczytem
     * OSOBNYM od katalogu. Od ADR-185 adres jedzie tą samą kopertą, co pozycja:
     * nieudany odczyt znaczy, że nie znamy ANI pozycji, ANI adresu — a wtedy
     * nie ma czego wyrenderować. Cicha degradacja do „jakiejś" strony byłaby tu
     * gorsza od 404.
     */
    stan.odpowiedz = null;
    await expect(otworzAdres(SLUG)).rejects.toThrow("notFound");
    await expect(otworzAdresZastany(SPRZET_ID)).rejects.toThrow("notFound");
    expect(stan.renderowano).toBe(0);
  });

  it("koperta bez adresu NIE renderuje — pozycja bez adresu nie jest stanem legalnym", async () => {
    /*
     * Gdyby baza kiedykolwiek oddała `match: "current"` bez sluga, kanon
     * i JSON-LD wskazywałyby adres zastany, czyli ten sam duplikat kanoniczny,
     * przed którym broni `productPath`. Zamykamy to na wejściu, a nie w renderze.
     */
    stan.odpowiedz = koperta({ slug: null });
    await expect(otworzAdres(SLUG)).rejects.toThrow("notFound");
    expect(stan.renderowano).toBe(0);
  });
});
