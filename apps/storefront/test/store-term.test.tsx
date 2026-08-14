// @vitest-environment jsdom
/**
 * TERMIN W POWŁOCE SKLEPU — testy SKUTKU (faza 5, ADR-179).
 *
 * Nie sprawdzamy, czy powłoka „importuje kalendarz". Sprawdzamy, co się dzieje
 * PO kliknięciu w dni: czy zmienia się stan koszyka, czy poleciało pytanie
 * o dostępność DLA TEGO terminu i czy kasa faktycznie przestaje być osiągalna,
 * kiedy nowy termin nie mieści koszyka.
 *
 * Akcja serwera jest podmieniona (`vi.mock`), bo jedyne, co wnosi do tego
 * scenariusza, to odpowiedź bazy — a odpowiedzi bazy pilnuje własna bramka
 * (`packages/db/test/public-availability-calendar.test.ts`) na żywej bazie.
 * Tutaj badamy SZEW: czy powłoka pyta o właściwy termin i czy z odpowiedzi
 * wyciąga właściwy wniosek.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicCatalogAvailability } from "@/lib/checkout/contract";

const checkCatalogAvailability = vi.fn<
  (start: string, end: string) => Promise<PublicCatalogAvailability | null>
>();

vi.mock("@/lib/actions/availability", () => ({
  checkCatalogAvailability: (start: string, end: string) =>
    checkCatalogAvailability(start, end),
  checkAvailability: vi.fn(),
  checkAvailabilityDays: vi.fn(),
}));

const { StoreTermBar, StoreTermProvider } = await import("@/components/storefront/store-term");
const { CartView } = await import("@/components/storefront/cart-view");
const { readCart, writeCart } = await import("@/lib/cart/storage");
const { EMPTY_CART } = await import("@/lib/cart/model");
const { getStorefrontCopy } = await import("@/lib/storefront/copy");

const copy = await getStorefrontCopy("pl");

const ROWER = "11111111-1111-4111-8111-111111111111";
const KAJAK = "22222222-2222-4222-8222-222222222222";

const PRODUCTS = [
  {
    id: ROWER,
    name: "Rower górski",
    description: null,
    base_price_day_grosze: 12_000,
    deposit_grosze: 40_000,
    auto_increment_multiplier: 1,
    buffer_before_days: 0,
    buffer_after_days: 0,
    custom_fields: {},
    category_ids: [],
    pricing_tiers: [],
    images: [],
  },
  {
    id: KAJAK,
    name: "Kajak dwuosobowy",
    description: null,
    base_price_day_grosze: 9_000,
    deposit_grosze: 20_000,
    auto_increment_multiplier: 1,
    buffer_before_days: 0,
    buffer_after_days: 0,
    custom_fields: {},
    category_ids: [],
    pricing_tiers: [],
    images: [],
  },
];

/** Odpowiedź „wszystko wolne w nadmiarze" — stan spoczynkowy scenariuszy. */
function allFree(units = 5): PublicCatalogAvailability {
  return {
    products: PRODUCTS.map((product) => ({
      product_id: product.id,
      total_units: units,
      available_units: units,
    })),
  };
}

function shell(children?: React.ReactNode) {
  return (
    <StoreTermProvider>
      <StoreTermBar copy={copy} products={PRODUCTS} locale="pl" />
      {children}
    </StoreTermProvider>
  );
}

function cartView() {
  return (
    <CartView
      products={PRODUCTS as never}
      supabaseUrl="https://storage.test"
      currency="PLN"
      locale="pl"
      copy={copy}
    />
  );
}

/** Dzień z bieżącego okna wyboru: `offset` dni od dziś (okno zaczyna się dziś). */
function dayFromToday(offset: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
}

/**
 * Klik w dzień, przewijając siatkę do jego miesiąca. Przewijanie jest częścią
 * scenariusza, a nie obejściem: kalendarz otwiera się na miesiącu terminu,
 * który klient JUŻ ma, więc wybór terminu o miesiąc dalej naprawdę wymaga
 * kliknięcia „następny miesiąc" — i tę drogę też trzeba przejść.
 */
function clickDay(iso: string): void {
  for (let hop = 0; hop < 6; hop += 1) {
    const node = document.querySelector<HTMLButtonElement>(`[data-calendar-day="${iso}"]`);
    if (node !== null) {
      fireEvent.click(node);
      return;
    }
    fireEvent.click(screen.getByLabelText(copy.term.nextMonth));
  }
  throw new Error(`Brak dnia ${iso} w siatce po przewinięciu okna`);
}

function openCalendar(): void {
  fireEvent.click(document.querySelector<HTMLButtonElement>("[data-store-term-toggle]")!);
}

beforeEach(() => {
  window.localStorage.clear();
  writeCart(EMPTY_CART);
  checkCatalogAvailability.mockReset();
  checkCatalogAvailability.mockResolvedValue(allFree());
});

// jsdom trzyma dokument między przypadkami — bez tego selektory trafiają
// w węzeł z poprzedniego renderu i test kłamie w obie strony.
afterEach(cleanup);

describe("wybór terminu w powłoce", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: gdyby pasek trzymał WŁASNY stan terminu obok
  // koszyka (R1), koszyk zostałby pusty, a kasa liczyłaby inny termin niż
  // pokazuje pasek. Nic innego tego nie przykrywa: model koszyka sam z siebie
  // nie wie, że istnieje pasek.
  it("zmiana zakresu w powłoce ZAPISUJE się do stanu koszyka", async () => {
    render(shell());
    const start = dayFromToday(3);
    const end = dayFromToday(6);

    openCalendar();
    clickDay(start);
    clickDay(end);

    await waitFor(() => {
      expect(readCart().startDate).toBe(start);
      expect(readCart().endDate).toBe(end);
    });
  });

  it("termin przy PUSTYM koszyku jest legalny — najpierw „kiedy\", potem „co\"", async () => {
    render(shell());
    const start = dayFromToday(2);

    openCalendar();
    clickDay(start);

    await waitFor(() => expect(readCart().startDate).toBe(start));
    expect(readCart().items).toHaveLength(0);
    // Pusty koszyk nie ma z czym kolidować, więc nie pytamy bazy o nic.
    expect(checkCatalogAvailability).not.toHaveBeenCalled();
  });

  // CO MUSIAŁOBY SIĘ ZEPSUĆ (R2): gdyby powłoka zaczęła malować dostępność,
  // w siatce pojawiłaby się liczba przy dniu — sygnał, który wygląda na dowód,
  // choć w powłoce nie wiadomo, DLA CZEGO miałby nim być.
  it("siatka w powłoce NIE maluje dostępności — dzień niesie samą datę", () => {
    render(shell());
    openCalendar();
    const day = document.querySelector<HTMLButtonElement>(
      `[data-calendar-day="${dayFromToday(3)}"]`,
    )!;
    expect(day.textContent).toBe(String(Number(dayFromToday(3).slice(8, 10))));
    expect(day.dataset.calendarDayState).toBe("available");
  });

  it("okno wyboru kończy się na horyzoncie — dzień 90 jest, dzień 91 już nie", () => {
    render(shell());
    openCalendar();
    // Horyzont liczy się ze stałej rdzenia (AVAILABILITY_WINDOW_MAX_DAYS = 90),
    // więc ostatni wybieralny dzień to dziś + 89.
    fireEvent.click(screen.getByLabelText(copy.term.nextMonth));
    fireEvent.click(screen.getByLabelText(copy.term.nextMonth));
    fireEvent.click(screen.getByLabelText(copy.term.nextMonth));
    const last = document.querySelector<HTMLButtonElement>(
      `[data-calendar-day="${dayFromToday(89)}"]`,
    );
    const beyond = document.querySelector<HTMLButtonElement>(
      `[data-calendar-day="${dayFromToday(90)}"]`,
    );
    if (last !== null) expect(last.disabled).toBe(false);
    if (beyond !== null) expect(beyond.disabled).toBe(true);
    // Przynajmniej jedna z dwóch stron granicy musi być w siatce — inaczej test
    // przechodziłby nad pustką (obie gałęzie warunkowe pominięte).
    expect(last !== null || beyond !== null).toBe(true);
  });
});

describe("konflikt terminu z koszykiem (R4)", () => {
  /** Odpowiedź, w której roweru brakuje — kajak wolny. */
  function rowerBrak(): PublicCatalogAvailability {
    return {
      products: [
        { product_id: ROWER, total_units: 3, available_units: 0 },
        { product_id: KAJAK, total_units: 4, available_units: 4 },
      ],
    };
  }

  // CO MUSIAŁOBY SIĘ ZEPSUĆ: gdyby pasek pytał o STARY termin (albo nie pytał
  // wcale po zmianie), konflikt nie pojawiłby się nigdy, mimo że w nowym
  // terminie sprzętu nie ma.
  it("po zmianie terminu pytanie o dostępność leci dla NOWEGO zakresu", async () => {
    writeCart({ items: [{ productId: ROWER, quantity: 2 }], startDate: null, endDate: null });
    render(shell());

    const start = dayFromToday(10);
    const end = dayFromToday(12);
    openCalendar();
    clickDay(start);
    clickDay(end);

    await waitFor(() => expect(checkCatalogAvailability).toHaveBeenCalledWith(start, end));
  });

  it("pozycja, która się nie mieści, WCHODZI NA LISTĘ i nie znika z koszyka", async () => {
    checkCatalogAvailability.mockResolvedValue(rowerBrak());
    writeCart({ items: [{ productId: ROWER, quantity: 2 }], startDate: null, endDate: null });
    render(shell());

    openCalendar();
    clickDay(dayFromToday(10));
    clickDay(dayFromToday(12));

    await waitFor(() => {
      expect(document.querySelector(`[data-store-term-conflict-item="${ROWER}"]`)).not.toBeNull();
    });
    // NIC NIE ZNIKA SAMO — to jest cała treść rozstrzygnięcia R4.
    expect(readCart().items).toEqual([{ productId: ROWER, quantity: 2 }]);
    expect(screen.getByText(/Rower górski/)).toBeTruthy();
  });

  // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie bramki konfliktu z widoku koszyka.
  // NIC INNEGO TEGO NIE PRZYKRYWA: `isCheckoutReady` patrzy wyłącznie na
  // pozycje i kształt dat, o dostępności nie wie nic.
  it("dopóki trwa konflikt, odnośnika do kasy NIE MA (nie jest tylko przygaszony)", async () => {
    checkCatalogAvailability.mockResolvedValue(rowerBrak());
    writeCart({
      items: [{ productId: ROWER, quantity: 2 }],
      startDate: dayFromToday(10),
      endDate: dayFromToday(12),
    });
    render(shell(cartView()));

    await waitFor(() => {
      expect(document.querySelector("[data-cart-checkout-blocked]")).not.toBeNull();
    });
    const links = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).not.toContain("/checkout");
    expect(screen.getByText(copy.cart.checkoutBlockedConflict)).toBeTruthy();
  });

  // KONTROLA POZYTYWNA dla testu wyżej: przy tym samym koszyku i tym samym
  // terminie, ale odpowiedzi „jest wolne", odnośnik do kasy MUSI być. Bez tego
  // test wyżej przechodziłby także wtedy, gdyby link nie pojawiał się NIGDY.
  it("bez konfliktu odnośnik do kasy jest na miejscu", async () => {
    checkCatalogAvailability.mockResolvedValue(allFree());
    writeCart({
      items: [{ productId: ROWER, quantity: 2 }],
      startDate: dayFromToday(10),
      endDate: dayFromToday(12),
    });
    render(shell(cartView()));

    await waitFor(() => {
      const links = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
      expect(links).toContain("/checkout");
    });
    expect(document.querySelector("[data-cart-checkout-blocked]")).toBeNull();
  });

  it("„usuń pozycje\" zdejmuje z koszyka DOKŁADNIE te w konflikcie", async () => {
    checkCatalogAvailability.mockResolvedValue(rowerBrak());
    writeCart({
      items: [
        { productId: ROWER, quantity: 2 },
        { productId: KAJAK, quantity: 1 },
      ],
      startDate: dayFromToday(10),
      endDate: dayFromToday(12),
    });
    render(shell());

    await waitFor(() => {
      expect(document.querySelector("[data-store-term-drop]")).not.toBeNull();
    });
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-store-term-drop]")!);

    await waitFor(() => {
      expect(readCart().items).toEqual([{ productId: KAJAK, quantity: 1 }]);
    });
  });

  it("„wróć do poprzedniego terminu\" przywraca termin sprzed zmiany", async () => {
    const stary = { start: dayFromToday(3), end: dayFromToday(5) };
    writeCart({
      items: [{ productId: ROWER, quantity: 2 }],
      startDate: stary.start,
      endDate: stary.end,
    });
    render(shell());

    // Pierwszy termin jest wolny, nowy — nie.
    checkCatalogAvailability.mockResolvedValue(rowerBrak());
    openCalendar();
    clickDay(dayFromToday(20));
    clickDay(dayFromToday(22));

    await waitFor(() => {
      expect(document.querySelector("[data-store-term-revert]")).not.toBeNull();
    });
    checkCatalogAvailability.mockResolvedValue(allFree());
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-store-term-revert]")!);

    await waitFor(() => {
      expect(readCart().startDate).toBe(stary.start);
      expect(readCart().endDate).toBe(stary.end);
    });
  });

  // CO MUSIAŁOBY SIĘ ZEPSUĆ: gdyby błąd odczytu dostępności był traktowany jak
  // „wszystko zajęte", chwilowa awaria zamykałaby najemcy sprzedaż. Gdyby był
  // traktowany jak konflikt — to samo. Ma być stanem TRZECIM: nie wiemy.
  it("nieudany odczyt dostępności nie tworzy konfliktu ani nie blokuje kasy", async () => {
    checkCatalogAvailability.mockResolvedValue(null);
    writeCart({
      items: [{ productId: ROWER, quantity: 2 }],
      startDate: dayFromToday(10),
      endDate: dayFromToday(12),
    });
    render(shell(cartView()));

    await waitFor(() => expect(checkCatalogAvailability).toHaveBeenCalled());
    expect(document.querySelector("[data-store-term-conflict]")).toBeNull();
    const links = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("/checkout");
  });
});
