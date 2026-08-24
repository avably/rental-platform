// @vitest-environment jsdom
/**
 * DOSTĘPNOŚĆ NA KAFLACH KATALOGU — testy SKUTKU (faza 5, ADR-180).
 *
 * Katalog do tej zmiany milczał o dostępności: klient wybierał termin
 * w powłoce (ADR-179) i dalej przeglądał listę nie wiedząc, co jest wolne.
 *
 * Trzy osie, przy każdej zapisane, co musiałoby się zepsuć:
 *
 *   1. LICZBY DOCHODZĄ NA KAFEL. Nie „renderer dostał props", tylko: w kaflu
 *      TEJ pozycji jest TA liczba, a w kaflu sąsiada — jego własna.
 *   2. JEDNO WYWOŁANIE NA CAŁĄ LISTĘ. Katalog z trzema kaflami pyta bazę raz;
 *      po jednym na kafel byłoby N żądań na każde wyświetlenie strony razy
 *      liczba odwiedzających (rachunek stoi w nagłówku migracji 0081).
 *   3. BRAK TERMINU TO BRAK INFORMACJI. Kafel bez wybranego terminu nie pisze
 *      „dostępne" — bo tego nikt nie sprawdził.
 *
 * Fikstura jest w kształcie produkcji: sekcja strukturalna z presetu (dokładnie
 * to, co zapisuje kreator) i renderowana TYM SAMYM `SiteRenderer`, co sklep.
 * Suita, która rysowałaby kafle własnym komponentem, mierzyłaby atrapę.
 */
import { structuredPresetFor, type ProductsStructuredContent } from "@avably/core/site";
import { SiteRenderer, DEFAULT_SITE_LABELS, type RenderSection } from "@avably/ui";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicCatalogAvailability } from "@/lib/checkout/contract";

const checkCatalogAvailability = vi.fn<
  (start: string, end: string) => Promise<PublicCatalogAvailability | null>
>();

vi.mock("@/lib/actions/availability", () => ({
  checkCatalogAvailability: (start: string, end: string) => checkCatalogAvailability(start, end),
  checkAvailability: vi.fn(),
  checkAvailabilityDays: vi.fn(),
}));

const { StoreCatalogAvailability, StoreTermProvider } = await import(
  "@/components/storefront/store-term"
);
const { writeCart } = await import("@/lib/cart/storage");
const { EMPTY_CART } = await import("@/lib/cart/model");
const { getStorefrontCopy } = await import("@/lib/storefront/copy");

const copy = await getStorefrontCopy("pl");

const ROWER = "11111111-1111-4111-8111-111111111111";
const KAJAK = "22222222-2222-4222-8222-222222222222";
const NAMIOT = "33333333-3333-4333-8333-333333333333";

const KATALOG = [
  { id: ROWER, name: "Rower górski" },
  { id: KAJAK, name: "Kajak dwuosobowy" },
  { id: NAMIOT, name: "Namiot czteroosobowy" },
].map((product) => ({
  ...product,
  description: null,
  priceLabel: "120,00 zł / doba",
  imageUrl: null,
  imageAlt: product.name,
  href: `/product/${product.id}`,
}));

function dayFromToday(offset: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
}

const START = dayFromToday(3);
const END = dayFromToday(6);

function sekcjaSprzetu(): RenderSection {
  return {
    id: "sekcja-sprzetu",
    position: 0,
    type: "products",
    content: {
      ...(structuredPresetFor("products", "pl") as ProductsStructuredContent),
      source: "catalog",
      limit: 8,
    },
  } as unknown as RenderSection;
}

/** Katalog w powłoce — dokładnie ten szew, którym składa go `StoreChrome`. */
function katalog() {
  return (
    <StoreTermProvider>
      <StoreCatalogAvailability copy={copy}>
        <SiteRenderer
          sections={[sekcjaSprzetu()]}
          products={KATALOG}
          labels={DEFAULT_SITE_LABELS}
        />
      </StoreCatalogAvailability>
    </StoreTermProvider>
  );
}

/** Badge dostępności TEJ pozycji (albo `null`, gdy kafel milczy). */
function znacznikKafla(productId: string): Element | null {
  const kafel = document.querySelector(`[data-products-item="${productId}"]`);
  if (kafel === null) throw new Error(`Brak kafla pozycji ${productId}`);
  return kafel.querySelector("[data-products-availability]");
}

/** Etykieta narysowana na badge'u TEJ pozycji (albo `null`). */
function naKaflu(productId: string): string | null {
  const znacznik = znacznikKafla(productId);
  return znacznik === null ? null : (znacznik.textContent ?? "");
}

/** Stan handlowy badge'a (`available`/`low`/`unavailable`) albo `null`. */
function stanKafla(productId: string): string | null {
  return znacznikKafla(productId)?.getAttribute("data-products-availability-state") ?? null;
}

/** Liczba wolnych sztuk zapisana na badge'u — niezależnie od pokazanej etykiety. */
function sztukiKafla(productId: string): string | null {
  return znacznikKafla(productId)?.getAttribute("data-products-availability-units") ?? null;
}

function odpowiedz(units: Record<string, number>): PublicCatalogAvailability {
  return {
    products: Object.entries(units).map(([product_id, available_units]) => ({
      product_id,
      total_units: 5,
      available_units,
    })),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  writeCart({ ...EMPTY_CART, startDate: START, endDate: END });
  checkCatalogAvailability
    .mockReset()
    .mockResolvedValue(odpowiedz({ [ROWER]: 2, [KAJAK]: 0, [NAMIOT]: 7 }));
});

afterEach(cleanup);

describe("kafel katalogu streszcza dostępność do stanu handlowego (ADR-245)", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: zerwanie mostu między odpowiedzią o dostępność
  // a rendererem sekcji (albo pominięcie znacznika w którymś układzie kafla).
  // NIC INNEGO TEGO NIE PRZYKRYWA: renderer sam z siebie nie wie, że istnieje
  // termin, a bramka akcji serwera nie wie, że istnieje kafel.
  //
  // Trzy stany, trzy fikstury: NAMIOT=7 (>próg → „Dostępny", bez liczby),
  // ROWER=2 (1..próg → „Zostały 2 szt.", z liczbą), KAJAK=0 („Zajęty").
  it("każdy kafel dostaje SWÓJ stan, a niedobór pokazuje dokładną liczbę", async () => {
    render(katalog());

    await waitFor(() => expect(naKaflu(ROWER)).not.toBeNull());

    // NADMIAR: stan „dostępny" bez liczby — licznik przy nadmiarze rozprasza.
    expect(stanKafla(NAMIOT)).toBe("available");
    expect(naKaflu(NAMIOT)).toBe(copy.term.statusAvailable);
    expect(naKaflu(NAMIOT)).not.toContain("7");

    // NIEDOBÓR: stan „low" z DOKŁADNĄ liczbą — bo niedobór jest bodźcem.
    expect(stanKafla(ROWER)).toBe("low");
    expect(naKaflu(ROWER)).toContain("2");

    // ZERO: osobny stan, słowami, nie „0 szt." (to czyta się jak usterka).
    expect(stanKafla(KAJAK)).toBe("unavailable");
    expect(naKaflu(KAJAK)).toBe(copy.term.statusBusy);

    // Liczba wolnych sztuk zostaje na badge'u KAŻDEGO stanu (atrybut, nie
    // etykieta) — dowód, że stany nie pomyliły kafli.
    expect(sztukiKafla(NAMIOT)).toBe("7");
    expect(sztukiKafla(ROWER)).toBe("2");
    expect(sztukiKafla(KAJAK)).toBe("0");
  });

  // GRANICA PROGU: dokładnie na progu to jeszcze „low", o jeden wyżej — „dostępny".
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: `<` zamiast `<=` (albo przesunięcie progu) —
  // wada niewidoczna poza tą jedną wartością.
  it("granica progu mało-sztuk: 3 to jeszcze stan low, 4 to już dostepny", async () => {
    checkCatalogAvailability.mockResolvedValue(odpowiedz({ [ROWER]: 3, [NAMIOT]: 4 }));
    render(katalog());

    await waitFor(() => expect(stanKafla(ROWER)).not.toBeNull());
    expect(stanKafla(ROWER)).toBe("low");
    expect(naKaflu(ROWER)).toContain("3");
    expect(stanKafla(NAMIOT)).toBe("available");
  });

  // CO MUSIAŁOBY SIĘ ZEPSUĆ: zapytanie PER KAFEL zamiast jednego zbiorczego —
  // wada niewidoczna na ekranie i widoczna dopiero w rachunku za bazę.
  it("cała lista kosztuje DOKŁADNIE JEDNO wywołanie dostępności", async () => {
    render(katalog());

    await waitFor(() => expect(naKaflu(ROWER)).not.toBeNull());
    expect(document.querySelectorAll("[data-products-item]")).toHaveLength(3);
    expect(checkCatalogAvailability).toHaveBeenCalledTimes(1);
    expect(checkCatalogAvailability).toHaveBeenCalledWith(START, END);
  });

  // BEZ TERMINU KAFEL MILCZY. Napisanie tam „dostępne" byłoby obietnicą,
  // której nikt nie sprawdził; napisanie „niedostępne" — zgaszeniem sprzedaży.
  it("bez wybranego terminu kafle nie orzekają o dostępności i nie pytają bazy", async () => {
    writeCart(EMPTY_CART);
    render(katalog());

    await waitFor(() => {
      expect(document.querySelectorAll("[data-products-item]")).toHaveLength(3);
    });
    expect(document.querySelectorAll("[data-products-availability]")).toHaveLength(0);
    expect(checkCatalogAvailability).not.toHaveBeenCalled();
  });

  // Pozycja NIEOBECNA w odpowiedzi to „nie wiem", a nie zero: sprzęt dopiero
  // co dodany do katalogu (albo odpowiedź sprzed jego dodania) nie może
  // ogłaszać braku, którego nikt nie policzył.
  it("pozycja spoza odpowiedzi milczy, a jej sąsiedzi dalej mają liczby", async () => {
    checkCatalogAvailability.mockResolvedValue(odpowiedz({ [ROWER]: 2, [NAMIOT]: 7 }));
    render(katalog());

    await waitFor(() => expect(naKaflu(ROWER)).not.toBeNull());
    expect(naKaflu(KAJAK)).toBeNull();
    expect(stanKafla(NAMIOT)).toBe("available");
  });

  // KAFEL RYSUJE SIĘ W DWÓCH POKOLENIACH TREŚCI, nie w jednym: sekcja
  // strukturalna v3 (wyżej) i karta v1, której używa też element katalogu na
  // płótnie v2. Najemcy mają dziś jedne i drugie.
  //
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: dołożenie liczby tylko do nowszego kafla. Połowa
  // najemców miałaby katalog z dostępnością, a połowa bez — bez jednego błędu
  // i bez sposobu, żeby to zauważyć poza obejrzeniem obu sklepów.
  it("kafel w kształcie v1 (element katalogu płótna) też niesie liczbę", async () => {
    const sekcjaV1 = {
      id: "sekcja-v1",
      position: 0,
      type: "products",
      content: { heading: "Nasz sprzęt" },
    } as unknown as RenderSection;

    render(
      <StoreTermProvider>
        <StoreCatalogAvailability copy={copy}>
          <SiteRenderer sections={[sekcjaV1]} products={KATALOG} labels={DEFAULT_SITE_LABELS} />
        </StoreCatalogAvailability>
      </StoreTermProvider>,
    );

    await waitFor(() => {
      expect(document.querySelector(`[data-products-availability="${ROWER}"]`)).not.toBeNull();
    });
    expect(
      document.querySelector(`[data-products-availability="${ROWER}"]`)!.textContent,
    ).toContain("2");
    expect(
      document.querySelector(`[data-products-availability="${KAJAK}"]`)!.textContent,
    ).toBe(copy.term.statusBusy);
  });

  // Odmowa bazy (najemca poza oknem handlowym, awaria transportu) gasi liczby
  // W CAŁOŚCI. Kafel z ostatnią znaną liczbą byłby gorszy niż kafel bez niej.
  it("odmowa odczytu gasi liczby na wszystkich kaflach", async () => {
    checkCatalogAvailability.mockResolvedValue(null);
    render(katalog());

    await waitFor(() => expect(checkCatalogAvailability).toHaveBeenCalled());
    expect(document.querySelectorAll("[data-products-availability]")).toHaveLength(0);
  });
});
