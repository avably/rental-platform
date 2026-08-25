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
import { formatRentalRange } from "@avably/core";
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

const submitCheckout = vi.fn();
vi.mock("@/lib/actions/checkout", () => ({
  submitCheckout: (...args: unknown[]) => submitCheckout(...args),
}));

// Formularz kasy woła `useRouter` (przekierowanie po sukcesie). Poza aplikacją
// Next router nie istnieje — podmieniamy go na atrapę, bo nawigacja nie jest
// przedmiotem tych testów; przedmiotem jest to, CZY zamówienie w ogóle wyszło.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const { StoreTermBar, StoreTermProvider } = await import("@/components/storefront/store-term");
const { CartView } = await import("@/components/storefront/cart-view");
const { CheckoutForm } = await import("@/components/storefront/checkout-form");
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
      productPaths={{}}
      supabaseUrl="https://storage.test"
      currency="PLN"
      locale="pl"
      copy={copy}
    />
  );
}

function checkoutForm() {
  return (
    <CheckoutForm
      products={PRODUCTS as never}
      deliveryMethods={[{ method: "pickup", price_grosze: 0 }] as never}
      pickupLocations={
        [
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Magazyn",
            address_street: null,
            address_zip: null,
            address_city: "Warszawa",
          },
        ] as never
      }
      currency="PLN"
      locale="pl"
      copy={copy}
      paymentMethods={["transfer"] as never}
      customFields={[]}
      // Komplet dokumentów opublikowany (ADR-191) — bez tego formularz
      // renderuje blokadę zamiast checkboxa i submit nie wychodzi, a ta
      // suita bada oś TERMINU, nie bramkę dokumentów.
      terms={{ href: "/regulamin/w/1", versionLabel: "v1" }}
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
 * scenariusza, a nie obejściem: okno wyboru otwiera się na miesiącu terminu,
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

/** Pigułka paska otwiera OKNO wyboru (ADR-194) — dawniej rozwijała siatkę w treści. */
function openCalendar(): void {
  fireEvent.click(document.querySelector<HTMLButtonElement>("[data-store-term-toggle]")!);
}

/**
 * JEDYNY ZAPIS TERMINU: przycisk „Zastosuj" w oknie wyboru (ADR-194). Wybór
 * dni zmienia wyłącznie szkic okna — bez tego kliknięcia koszyk nie drgnie.
 */
function applyTerm(): void {
  fireEvent.click(document.querySelector<HTMLButtonElement>("[data-store-term-apply]")!);
}

beforeEach(() => {
  window.localStorage.clear();
  writeCart(EMPTY_CART);
  checkCatalogAvailability.mockReset();
  checkCatalogAvailability.mockResolvedValue(allFree());
  submitCheckout.mockReset();
  // Odpowiedź celowo NIE-sukcesowa: te testy pytają WYŁĄCZNIE o to, czy
  // zamówienie w ogóle wyszło z formularza. Ścieżka sukcesu prowadzi dalej
  // (przekierowanie na krok płatności) i ma własne bramki — ciągnięcie jej tu
  // dokładałoby do tego testu zależności, o których on nie mówi.
  submitCheckout.mockResolvedValue({ status: "rate_limited" });
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
    applyTerm();

    await waitFor(() => {
      expect(readCart().startDate).toBe(start);
      expect(readCart().endDate).toBe(end);
    });
  });

  // BRAMKA ADR-194: ZASTOSUJ = JEDYNY ZAPIS. Wybór dni w oknie zmienia szkic
  // okna, nie koszyk — zapis dzieje się dokładnie raz, na „Zastosuj".
  //
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: powrót zapisu na klik dnia (stara forma). Klient,
  // który tylko OGLĄDA terminy, zmieniałby przy tym swój koszyk — a panel
  // konfliktu wyskakiwałby w pół wyboru, o który nikt jeszcze nie prosił.
  it("wybór dat w oknie BEZ „Zastosuj\" nie zmienia stanu koszyka", async () => {
    render(shell());
    const start = dayFromToday(3);
    const end = dayFromToday(6);

    openCalendar();
    clickDay(start);
    clickDay(end);

    // Szkic wybrany (krańce zaznaczone w siatce), a koszyk nietknięty.
    expect(document.querySelector(`[data-calendar-day="${start}"]`)!.getAttribute("aria-pressed")).toBe("true");
    expect(readCart().startDate).toBeNull();
    expect(readCart().endDate).toBeNull();

    // Zamknięcie krzyżykiem też nie zapisuje.
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-store-term-modal-close]")!);
    expect(document.querySelector("[data-store-term-modal]")).toBeNull();
    expect(readCart().startDate).toBeNull();

    // KONTROLA POZYTYWNA: ta sama droga Z „Zastosuj" zapisuje — bez niej ten
    // test przechodziłby także wtedy, gdyby okno nie zapisywało NIGDY.
    openCalendar();
    clickDay(start);
    clickDay(end);
    applyTerm();
    await waitFor(() => expect(readCart().startDate).toBe(start));
    expect(readCart().endDate).toBe(end);
  });

  // „WYCZYŚĆ" zeruje szkic, a wyzerowany termin dociera do koszyka tą samą,
  // JEDYNĄ drogą zapisu — przez „Zastosuj" (ADR-194).
  it("„Wyczyść\" + „Zastosuj\" zeruje termin w koszyku", async () => {
    const start = dayFromToday(3);
    const end = dayFromToday(6);
    writeCart({ items: [], startDate: start, endDate: end });
    render(shell());

    openCalendar();
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-store-term-clear]")!);
    // Sam „Wyczyść" nie pisze — koszyk dalej trzyma termin.
    expect(readCart().startDate).toBe(start);

    applyTerm();
    await waitFor(() => expect(readCart().startDate).toBeNull());
    expect(readCart().endDate).toBeNull();
  });

  it("termin przy PUSTYM koszyku jest legalny — najpierw „kiedy\", potem „co\"", async () => {
    render(shell());
    const start = dayFromToday(2);

    openCalendar();
    clickDay(start);
    applyTerm();

    await waitFor(() => expect(readCart().startDate).toBe(start));
    expect(readCart().items).toHaveLength(0);
    // Termin NIEKOMPLETNY (sam początek) nie jest pytaniem: nie ma zakresu,
    // o który można zapytać. Kompletny — jest, także przy pustym koszyku
    // (patrz przypadek niżej).
    expect(checkCatalogAvailability).not.toHaveBeenCalled();
  });

  // ZMIANA ADR-180: do etapu A pytanie leciało WYŁĄCZNIE przy niepustym
  // koszyku, bo służyło jednej rzeczy — konfliktowi. Odkąd ta sama odpowiedź
  // maluje kafle katalogu, musi lecieć także przy koszyku pustym: klient
  // najpierw mówi „kiedy", a potem PATRZY, co jest wolne.
  //
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: powrót warunku „pytaj tylko przy niepustym
  // koszyku". Katalog milczałby wtedy dla każdego, kto jeszcze niczego nie
  // dodał — czyli dla każdego, kto dopiero wybiera.
  it("KOMPLETNY termin przy pustym koszyku PYTA o dostępność — katalog jej potrzebuje", async () => {
    render(shell());
    const start = dayFromToday(2);
    const end = dayFromToday(4);

    openCalendar();
    clickDay(start);
    clickDay(end);
    applyTerm();

    await waitFor(() => expect(checkCatalogAvailability).toHaveBeenCalledWith(start, end));
    expect(readCart().items).toHaveLength(0);
    expect(checkCatalogAvailability).toHaveBeenCalledTimes(1);
  });

  // JEDNO PYTANIE NA TERMIN, a nie na każdą zmianę koszyka: odpowiedź
  // o dostępność KATALOGU od zawartości koszyka nie zależy, a konflikt liczy
  // się z niej funkcją czystą (`cartConflicts`).
  //
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: powrót podpisu pozycji do klucza zapytania —
  // każde dołożenie sprzętu byłoby wtedy podróżą do bazy po tę samą odpowiedź.
  it("dołożenie pozycji do koszyka NIE dokłada drugiego pytania", async () => {
    render(shell(cartView()));
    const start = dayFromToday(2);
    const end = dayFromToday(4);

    openCalendar();
    clickDay(start);
    clickDay(end);
    applyTerm();
    await waitFor(() => expect(checkCatalogAvailability).toHaveBeenCalledTimes(1));

    writeCart({ items: [{ productId: ROWER, quantity: 1 }], startDate: start, endDate: end });
    await waitFor(() => expect(screen.getByText(/Rower górski/)).toBeTruthy());
    expect(checkCatalogAvailability).toHaveBeenCalledTimes(1);
  });

  // BRAMKA ADR-194: PIGUŁKA ODZWIERCIEDLA STAN KOSZYKA. Dwa stany tego samego
  // widoku: bez terminu zachęta, z terminem zakres + akcja zmiany. Nie ma tu
  // trzeciego stanu ani drugiego źródła — treść pigułki jest funkcją
  // `CartState.startDate/endDate` (SSR maluje stan „bez terminu", bo koszyk
  // mieszka w localStorage; hydratacja podmienia treść, nie obecność).
  //
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: pigułka z własnym stanem (nie czyta koszyka) albo
  // jednostanowa — klient z wybranym terminem nie widziałby GDZIE go zmienić,
  // a klient bez terminu nie dostawałby zachęty.
  it("pigułka odzwierciedla stan koszyka: zachęta bez terminu, zakres i zmiana z terminem", async () => {
    render(shell());
    const pill = document.querySelector<HTMLButtonElement>("[data-store-term-toggle]")!;
    const start = dayFromToday(5);
    const end = dayFromToday(8);

    // STAN 1 — bez terminu: zachęta, bez akcji zmiany.
    expect(pill.textContent).toContain(copy.term.choose);
    expect(pill.textContent).not.toContain(copy.term.change);

    // STAN 2 — termin w koszyku (zapisany skądkolwiek, np. z drugiej karty):
    // pigułka pokazuje zakres i akcję zmiany, zachęta znika.
    // [F8] Asercja zmieniona z ISO (`toContain(start)`) na frazę
    // `formatRentalRange` — intencja bez zmian (pigułka odzwierciedla zakres
    // z koszyka), zmienił się WYŁĄCZNIE format prezentacji (S-10: daty po
    // ludzku, fraza atomowa).
    writeCart({ items: [], startDate: start, endDate: end });
    await waitFor(() => {
      expect(
        document.querySelector("[data-store-term-summary]")!.textContent,
        "pigułka nie pokazała zakresu z koszyka",
      ).toContain(formatRentalRange(start, end, "pl"));
    });
    expect(pill.textContent).toContain(copy.term.change);
    expect(pill.textContent).not.toContain(copy.term.choose);
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
    // więc ostatni wybieralny dzień to dziś + 89. Nawigacja idzie DO KOŃCA
    // okna (aż przycisk zgaśnie), a nie o sztywną liczbę miesięcy — liczba
    // hopów zależy od dnia miesiąca i od tego, ile miesięcy maluje siatka.
    for (let hop = 0; hop < 6; hop += 1) {
      const next = screen.getByLabelText<HTMLButtonElement>(copy.term.nextMonth);
      if (next.disabled) break;
      fireEvent.click(next);
    }
    const last = document.querySelector<HTMLButtonElement>(
      `[data-calendar-day="${dayFromToday(89)}"]`,
    );
    const beyond = document.querySelector<HTMLButtonElement>(
      `[data-calendar-day="${dayFromToday(90)}"]`,
    );
    // Na krańcu okna dzień 89 MUSI być w siatce (kotwica staje na miesiącu
    // horyzontu) — bez tej nogi test przechodziłby nad pustką.
    expect(last, "ostatni dzień okna nie doszedł do siatki").not.toBeNull();
    expect(last!.disabled).toBe(false);
    if (beyond !== null) expect(beyond.disabled).toBe(true);
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
    applyTerm();

    await waitFor(() => expect(checkCatalogAvailability).toHaveBeenCalledWith(start, end));
  });

  it("pozycja, która się nie mieści, WCHODZI NA LISTĘ i nie znika z koszyka", async () => {
    checkCatalogAvailability.mockResolvedValue(rowerBrak());
    writeCart({ items: [{ productId: ROWER, quantity: 2 }], startDate: null, endDate: null });
    render(shell());

    openCalendar();
    clickDay(dayFromToday(10));
    clickDay(dayFromToday(12));
    applyTerm();

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
    applyTerm();

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

  // ZAPIS ZATRZYMANY U ŹRÓDŁA, nie tylko na wyglądzie przycisku.
  //
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie warunku z `handleSubmit`. NIC INNEGO TEGO
  // NIE PRZYKRYWA — `disabled` na przycisku nie zatrzymuje `requestSubmit()`
  // ani wysyłki z klawiatury, a bramka koszyka stoi na innej stronie i klient
  // może wejść w kasę adresem.
  it("konflikt zatrzymuje WYSYŁKĘ zamówienia, nie tylko gasi przycisk", async () => {
    checkCatalogAvailability.mockResolvedValue(rowerBrak());
    writeCart({
      items: [{ productId: ROWER, quantity: 2 }],
      startDate: dayFromToday(10),
      endDate: dayFromToday(12),
    });
    render(shell(checkoutForm()));

    await waitFor(() => {
      expect(document.querySelector("[data-checkout-conflict-blocked]")).not.toBeNull();
    });

    // Wysyłka POMIJA przycisk — dokładnie tak, jak zrobiłaby to klawiatura
    // albo skrypt. Gdyby bramka siedziała wyłącznie w atrybucie `disabled`,
    // zamówienie poszłoby na serwer po to, żeby tam paść.
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(checkCatalogAvailability).toHaveBeenCalled());
    expect(submitCheckout).not.toHaveBeenCalled();
  });

  // KONTROLA POZYTYWNA: ten sam formularz, ten sam sposób wysyłki, brak
  // konfliktu → zamówienie WYCHODZI. Bez tego test wyżej przechodziłby także
  // wtedy, gdyby formularz nie wysyłał niczego nigdy.
  it("bez konfliktu ten sam formularz wysyła zamówienie", async () => {
    checkCatalogAvailability.mockResolvedValue(allFree());
    writeCart({
      items: [{ productId: ROWER, quantity: 2 }],
      startDate: dayFromToday(10),
      endDate: dayFromToday(12),
    });
    render(shell(checkoutForm()));

    await waitFor(() => expect(checkCatalogAvailability).toHaveBeenCalled());
    expect(document.querySelector("[data-checkout-conflict-blocked]")).toBeNull();

    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(submitCheckout).toHaveBeenCalledTimes(1));
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
