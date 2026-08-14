/**
 * ADRES STRONY SPRZĘTU — rozstrzyganie i przekierowania 308 (ADR-182).
 *
 * Test mierzy SKUTEK, nie obecność trasy: nie „plik `/produkt/[slug]` istnieje",
 * tylko „ten adres oddaje TEN sprzęt, tamten oddaje 308 pod adres bieżący,
 * a nieznany oddaje 404".
 *
 * OŚ IZOLACJI JEST TU NAZWANA WPROST. Adres rozstrzyga się WYŁĄCZNIE przez
 * rejestr (`ctx.productSlugs`), który baza zawęża do jednego najemcy — nigdy
 * przez skanowanie katalogu. Gdyby trasa szukała pozycji po nazwie albo po
 * slugu policzonym z nazwy, adres najemcy A trafiałby w sprzęt najemcy B
 * wszędzie tam, gdzie obaj nazwali sprzęt tak samo — a nazwy sprzętu do
 * wypożyczenia powtarzają się między wypożyczalniami niemal zawsze.
 *
 * Render (szablon vs strona wbudowana) mierzy osobno
 * `product-template-route.test.tsx` — ten plik pyta tylko o ADRES.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SPRZET_ID = "22222222-2222-4222-8222-222222222222";
const SLUG = "rower-gorski";
const STARY_SLUG = "rower";

/* -------------------------------------------------------------------------
 * Mocki — rejestr adresów sterowany z każdego przypadku
 * ---------------------------------------------------------------------- */

interface Rejestr {
  products: { id: string; slug: string }[];
  redirects: { from: string; to: string }[];
}

const stan: { rejestr: Rejestr | null; renderowano: number } = {
  rejestr: null,
  renderowano: 0,
};

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  // 308 przerywa render rzutem, dokładnie jak w produkcji.
  permanentRedirect: (to: string) => {
    throw new Error(`308:${to}`);
  },
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

vi.mock("@/lib/storefront/context", () => ({
  loadStorefrontContext: async () => ({
    tenantId: TENANT,
    catalog: {
      tenant: { name: "Wypożyczalnia Testowa", locale: "pl", currency: "PLN" },
      products: [
        {
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
        },
      ],
      custom_fields: [],
      categories: [],
      pickup_locations: [],
      delivery_methods: [],
    },
    productSlugs: stan.rejestr,
  }),
}));

async function otworzAdres(slug: string) {
  const { default: Trasa } = await import("../app/(tenant)/produkt/[slug]/page");
  return Trasa({ params: Promise.resolve({ slug }) });
}

async function otworzAdresZastany(id: string) {
  const { default: Trasa } = await import("../app/(tenant)/product/[id]/page");
  return Trasa({ params: Promise.resolve({ id }) });
}

describe("adres strony sprzętu (ADR-182)", () => {
  beforeEach(() => {
    stan.rejestr = {
      products: [{ id: SPRZET_ID, slug: SLUG }],
      redirects: [{ from: STARY_SLUG, to: SLUG }],
    };
    stan.renderowano = 0;
    wyrenderowane.length = 0;
    vi.resetModules();
  });

  // -------------------------------------------------------------------
  // 1. Adres bieżący
  // -------------------------------------------------------------------
  it("`/produkt/rower-gorski` oddaje stronę TEGO sprzętu", async () => {
    await otworzAdres(SLUG);
    expect(wyrenderowane, "trasa nie wyrenderowała pozycji spod tego adresu").toEqual([SPRZET_ID]);
  });

  // -------------------------------------------------------------------
  // 2. Stare adresy → 308
  // -------------------------------------------------------------------
  it("STARY adres sprzętu oddaje 308 pod adres bieżący, nie 404", async () => {
    // Te adresy są w Google i w linkach wklejonych przez klientów najemcy.
    // Twarde 404 to utrata ruchu, za który najemca już zapłacił.
    await expect(otworzAdres(STARY_SLUG)).rejects.toThrow(`308:/produkt/${SLUG}`);
    expect(stan.renderowano, "stary adres wyrenderował stronę zamiast przekierować").toBe(0);
  });

  it("ADRES ZASTANY z identyfikatorem (`/product/{uuid}`) oddaje 308 pod nowy", async () => {
    await expect(otworzAdresZastany(SPRZET_ID)).rejects.toThrow(`308:/produkt/${SLUG}`);
    expect(stan.renderowano).toBe(0);
  });

  // -------------------------------------------------------------------
  // 3. Adres nieznany → 404
  // -------------------------------------------------------------------
  it("adres spoza rejestru oddaje 404, a nie stronę losowej pozycji", async () => {
    await expect(otworzAdres("czego-tu-nie-ma")).rejects.toThrow("notFound");
    expect(stan.renderowano).toBe(0);
  });

  it("adres zastany z identyfikatorem spoza katalogu najemcy oddaje 404", async () => {
    await expect(
      otworzAdresZastany("99999999-9999-4999-8999-999999999999"),
    ).rejects.toThrow("notFound");
  });

  // -------------------------------------------------------------------
  // 4. IZOLACJA — adres rozstrzyga rejestr, nie nazwa pozycji
  // -------------------------------------------------------------------
  it("adres, którego rejestr TEGO najemcy nie zna, nie trafia w pozycję o pasującej nazwie", async () => {
    /*
     * Stan realistyczny: katalog najemcy zawiera „Rower górski", więc slug
     * policzony z nazwy dałby dokładnie `rower-gorski`. Rejestr tego adresu
     * jednak NIE ZAWIERA — bo należy do innego najemcy. Odpowiedzią musi być
     * 404, a nie „znalazłem coś o takiej nazwie".
     */
    stan.rejestr = { products: [], redirects: [] };
    await expect(otworzAdres(SLUG)).rejects.toThrow("notFound");
    expect(wyrenderowane, "trasa wyrenderowała pozycję spoza rejestru najemcy").toEqual([]);
  });

  // -------------------------------------------------------------------
  // 5. Brak rejestru — degradacja w stronę adresu zastanego
  // -------------------------------------------------------------------
  it("bez rejestru adres ZASTANY dalej RENDERUJE stronę, zamiast gasnąć", async () => {
    /*
     * Chwilowy błąd odczytu rejestru nie może zamienić katalogu w zbiór
     * ślepych linków: bez rejestru kafle linkują pod `/product/{id}`, więc ta
     * trasa musi wtedy pokazać stronę, a nie 404 ani 308 „w ciemno".
     */
    stan.rejestr = null;
    await otworzAdresZastany(SPRZET_ID);
    expect(wyrenderowane).toEqual([SPRZET_ID]);
  });

  it("bez rejestru adres SLUGOWY oddaje 404 — nie zgadujemy, do czego prowadzi", async () => {
    stan.rejestr = null;
    await expect(otworzAdres(SLUG)).rejects.toThrow("notFound");
  });
});
