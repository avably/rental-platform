// @vitest-environment jsdom
/**
 * WIDGET REZERWACJI SPRZĘTU — testy SKUTKU (faza 5, ADR-180).
 *
 * Nie pytamy, czy widget „importuje kalendarz". Pytamy, co widzi i co robi
 * klient: czy na ekranie jest LICZBA wolnych sztuk dla wybranego terminu, czy
 * dzień bez ani jednej sztuki da się kliknąć, czy „dodaj do koszyka" naprawdę
 * dokłada pozycję i czy termin po tym wszystkim jest jeden.
 *
 * Cztery osie, przy każdej zapisane, co musiałoby się zepsuć:
 *
 *   1. LICZBA Z TEJ SAMEJ ODPOWIEDZI, CO KAFEL. Widget nie pyta bazy o zakres
 *      po raz drugi — bierze liczbę z jednego wywołania katalogowego powłoki.
 *   2. SIATKA MALUJE DNI. `dayUnits` przychodzą z `checkAvailabilityDays` dla
 *      WIDOCZNEGO miesiąca, a dzień z zerem przestaje być wybieralny.
 *   3. KOSZYK. Dodanie pisze pozycję i NIE rusza terminu (jedno źródło prawdy).
 *   4. ZERO ZATRZYMUJE. Przy zerowej dostępności przycisk jest wyłączony —
 *      z kontrolą pozytywną na tych samych danych z liczbą dodatnią.
 *
 * Akcje serwera są podmienione: ich własnych bramek pilnują
 * `availability-actions.test.ts` (najemca z nagłówka) i suity bazy na żywym
 * Supabase. Tutaj badamy SZEW — o co widget pyta i co z odpowiedzi wnioskuje.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicAvailabilityDays, PublicCatalogAvailability } from "@/lib/checkout/contract";

const checkCatalogAvailability = vi.fn<
  (start: string, end: string) => Promise<PublicCatalogAvailability | null>
>();
const checkAvailabilityDays = vi.fn<
  (productId: string, start: string, end: string) => Promise<PublicAvailabilityDays | null>
>();

vi.mock("@/lib/actions/availability", () => ({
  checkCatalogAvailability: (start: string, end: string) => checkCatalogAvailability(start, end),
  checkAvailabilityDays: (productId: string, start: string, end: string) =>
    checkAvailabilityDays(productId, start, end),
  checkAvailability: vi.fn(),
}));

const { ProductBooking } = await import("@/components/storefront/product-booking");
const { StoreTermProvider } = await import("@/components/storefront/store-term");
const { readCart, writeCart } = await import("@/lib/cart/storage");
const { EMPTY_CART } = await import("@/lib/cart/model");
const { getStorefrontCopy } = await import("@/lib/storefront/copy");

const copy = await getStorefrontCopy("pl");

const ROWER = "11111111-1111-4111-8111-111111111111";

const CENA = {
  basePriceDayGrosze: 12_000,
  depositGrosze: 40_000,
  autoIncrementMultiplier: 1,
  tiers: [],
};

/** Dzień z bieżącego okna wyboru: `offset` dni od dziś (okno zaczyna się dziś). */
function dayFromToday(offset: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
}

function catalog(units: number): PublicCatalogAvailability {
  return { products: [{ product_id: ROWER, total_units: 5, available_units: units }] };
}

/** Mapa dzienna: wszystko po `units`, poza dniami wymienionymi w `wyjatki`. */
function days(units: number, wyjatki: Record<string, number> = {}): PublicAvailabilityDays {
  const map: Record<string, number> = {};
  for (let offset = 0; offset < 60; offset += 1) map[dayFromToday(offset)] = units;
  return { total_units: 5, days: { ...map, ...wyjatki } };
}

function widget() {
  return (
    <StoreTermProvider>
      <ProductBooking
        productId={ROWER}
        priceParams={CENA}
        copy={copy}
        locale="pl"
        currency="PLN"
      />
    </StoreTermProvider>
  );
}

/** Klik w dzień, przewijając siatkę do jego miesiąca (jak w powłoce). */
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

function addButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>("[data-product-booking-add]")!;
}

beforeEach(() => {
  window.localStorage.clear();
  writeCart(EMPTY_CART);
  checkCatalogAvailability.mockReset().mockResolvedValue(catalog(3));
  checkAvailabilityDays.mockReset().mockResolvedValue(days(3));
});

afterEach(cleanup);

describe("liczba wolnych sztuk w wybranym terminie", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: gdyby widget czytał dostępność z własnego,
  // drugiego wywołania (albo w ogóle jej nie czytał), na ekranie nie byłoby
  // liczby — a klient dowiadywałby się o braku sprzętu dopiero przy kasie.
  it("po wybraniu terminu na ekranie jest LICZBA wolnych sztuk", async () => {
    checkCatalogAvailability.mockResolvedValue(catalog(2));
    render(widget());

    clickDay(dayFromToday(3));
    clickDay(dayFromToday(5));

    await waitFor(() => {
      expect(document.querySelector('[data-product-booking-units="2"]')).not.toBeNull();
    });
    expect(screen.getByText(/wolne w tym terminie: 2/)).toBeTruthy();
  });

  // JEDNO PYTANIE, NIE DWA. Liczba dla zakresu jedzie z odpowiedzi
  // KATALOGOWEJ powłoki — tej samej, z której liczą się kafle i konflikt
  // koszyka. Drugie wywołanie o ten sam zakres byłoby drugą wersją tej samej
  // prawdy (i drugim miejscem, w którym mogłaby się rozjechać).
  it("nie pyta bazy o dostępność ZAKRESU po raz drugi", async () => {
    render(widget());
    clickDay(dayFromToday(3));
    clickDay(dayFromToday(5));

    await waitFor(() => expect(checkCatalogAvailability).toHaveBeenCalledTimes(1));
    expect(checkCatalogAvailability).toHaveBeenCalledWith(dayFromToday(3), dayFromToday(5));
  });

  it("bez kompletnego terminu widget prosi o termin, zamiast zmyślać dostępność", async () => {
    render(widget());
    await waitFor(() => expect(checkAvailabilityDays).toHaveBeenCalled());

    expect(screen.getByText(copy.product.dateRequired)).toBeTruthy();
    expect(document.querySelector("[data-product-booking-units]")).toBeNull();
    expect(addButton().disabled).toBe(true);
  });
});

describe("siatka dni maluje dostępność TEGO sprzętu", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: gdyby widget nie podawał `dayUnits`, siatka
  // wyglądałaby jak ta z powłoki — sam wybór terminu, bez ani jednej liczby.
  // Klient wybierałby dni w ciemno i dowiadywał się o zajętości po fakcie.
  it("dzień niesie liczbę wolnych sztuk z odpowiedzi dziennej", async () => {
    checkAvailabilityDays.mockResolvedValue(days(4));
    render(widget());

    await waitFor(() => {
      const dzien = document.querySelector<HTMLButtonElement>(
        `[data-calendar-day="${dayFromToday(3)}"]`,
      )!;
      expect(dzien.textContent).toContain("4");
    });
  });

  // TO JEST TA SAMA GRANICA, KTÓREJ PILNUJE BRAMKA BAZY (mapa dzienna niesie
  // KAŻDY dzień, także z zerem): dzień z zerem ma być NIEWYBIERALNY. Gdyby
  // wypadł z mapy, byłby „nie wiadomo" — czyli wybieralny — i klient
  // zarezerwowałby termin, w którym nie ma ani jednej sztuki.
  it("dzień z ZEREM jest niewybieralny, a dzień obok — wybieralny (kontrola pozytywna)", async () => {
    const zajety = dayFromToday(4);
    const wolny = dayFromToday(5);
    checkAvailabilityDays.mockResolvedValue(days(3, { [zajety]: 0 }));
    render(widget());

    await waitFor(() => {
      const dzien = document.querySelector<HTMLButtonElement>(`[data-calendar-day="${zajety}"]`)!;
      expect(dzien.dataset.calendarDayState).toBe("unavailable");
      expect(dzien.disabled).toBe(true);
    });
    const sasiad = document.querySelector<HTMLButtonElement>(`[data-calendar-day="${wolny}"]`)!;
    expect(sasiad.disabled, "kontrola pozytywna: sąsiedni dzień musi być wybieralny").toBe(false);
  });

  // Pytanie o dni jest PER MIESIĄC, a nie per dzień ani per render: siatka ma
  // trzydzieści komórek i pętla po nich byłaby trzydziestoma żądaniami.
  it("o dni pyta RAZ na widoczny miesiąc, oknem przyciętym do okna wyboru", async () => {
    render(widget());

    await waitFor(() => expect(checkAvailabilityDays).toHaveBeenCalledTimes(1));
    const [productId, from, to] = checkAvailabilityDays.mock.calls[0]!;
    expect(productId).toBe(ROWER);
    // Dolna granica to DZIŚ, a nie pierwszy dzień miesiąca: o przeszłość nie
    // ma po co pytać, a przy oknie 90-dniowym każdy zbędny dzień zbliża
    // zapytanie do sufitu, którym baza odmawia.
    expect(from).toBe(dayFromToday(0));
    expect(to! >= from!).toBe(true);

    fireEvent.click(screen.getByLabelText(copy.term.nextMonth));
    await waitFor(() => expect(checkAvailabilityDays).toHaveBeenCalledTimes(2));
    expect(checkAvailabilityDays.mock.calls[1]![1]).not.toBe(from);
  });
});

describe("dodanie do koszyka", () => {
  it("dokłada pozycję w wybranej ilości i NIE rusza terminu", async () => {
    render(widget());
    const start = dayFromToday(3);
    const end = dayFromToday(6);
    clickDay(start);
    clickDay(end);

    await waitFor(() => expect(addButton().disabled).toBe(false));
    fireEvent.change(document.querySelector<HTMLInputElement>("#booking-qty")!, {
      target: { value: "2" },
    });
    fireEvent.click(addButton());

    await waitFor(() => {
      expect(readCart().items).toEqual([{ productId: ROWER, quantity: 2 }]);
    });
    // Termin zapisał KALENDARZ, nie przycisk — dodanie go nie nadpisuje.
    expect(readCart().startDate).toBe(start);
    expect(readCart().endDate).toBe(end);
  });

  // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie warunku `units !== 0`. Klient dołożyłby
  // do koszyka sprzęt, którego w tym terminie nie ma ani jednej sztuki —
  // zamówienie doszłoby na serwer po to, żeby tam paść (23P01).
  it("przy ZEROWEJ dostępności przycisk jest wyłączony", async () => {
    checkCatalogAvailability.mockResolvedValue(catalog(0));
    render(widget());
    clickDay(dayFromToday(3));
    clickDay(dayFromToday(6));

    await waitFor(() => {
      expect(document.querySelector('[data-product-booking-units="0"]')).not.toBeNull();
    });
    expect(addButton().disabled).toBe(true);
    expect(screen.getByText(copy.product.unavailable)).toBeTruthy();
  });

  // KONTROLA POZYTYWNA dla testu wyżej: ten sam scenariusz, ta sama droga,
  // liczba dodatnia → przycisk CZYNNY. Bez tego tamten przechodziłby także
  // wtedy, gdyby przycisk był wyłączony ZAWSZE.
  it("przy dostępności dodatniej ten sam przycisk jest czynny", async () => {
    checkCatalogAvailability.mockResolvedValue(catalog(1));
    render(widget());
    clickDay(dayFromToday(3));
    clickDay(dayFromToday(6));

    await waitFor(() => expect(addButton().disabled).toBe(false));
  });

  // Nieudany odczyt dostępności to „nie wiem", a nie „zajęte": wiążąca bramka
  // stoi na serwerze (przypisanie egzemplarza w `app.public_checkout`), więc
  // gaszenie sprzedaży za awarię odczytu byłoby kosztem najemcy za nic.
  it("odmowa odczytu dostępności NIE zamyka koszyka", async () => {
    checkCatalogAvailability.mockResolvedValue(null);
    render(widget());
    clickDay(dayFromToday(3));
    clickDay(dayFromToday(6));

    await waitFor(() => expect(addButton().disabled).toBe(false));
    expect(screen.getByText(copy.term.bookingUnknown)).toBeTruthy();
  });
});
