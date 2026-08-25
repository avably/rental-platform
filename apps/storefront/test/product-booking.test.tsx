// @vitest-environment jsdom
/**
 * WIDGET REZERWACJI SPRZĘTU — testy SKUTKU (faza 5, ADR-180).
 *
 * Nie pytamy, czy widget „importuje kalendarz". Pytamy, co widzi i co robi
 * klient: czy na ekranie jest LICZBA wolnych sztuk dla wybranego terminu, czy
 * dzień bez ani jednej sztuki da się kliknąć, czy „dodaj do koszyka" naprawdę
 * dokłada pozycję i czy termin po tym wszystkim jest jeden.
 *
 * Pięć osi, przy każdej zapisane, co musiałoby się zepsuć:
 *
 *   0. FORMA ZWARTA (ADR-194). Karta bez interakcji nie niesie siatki dni —
 *      siatkę otwiera POLE terminu, a jedynym zapisem jest „Zastosuj" w oknie.
 *   1. LICZBA Z TEJ SAMEJ ODPOWIEDZI, CO KAFEL. Widget nie pyta bazy o zakres
 *      po raz drugi — bierze liczbę z jednego wywołania katalogowego powłoki.
 *   2. SIATKA MALUJE DNI. `dayUnits` przychodzą z `checkAvailabilityDays` dla
 *      WIDOCZNEGO widoku okna wyboru, a dzień z zerem przestaje być wybieralny.
 *   3. KOSZYK. Dodanie pisze pozycję i NIE rusza terminu (jedno źródło prawdy).
 *   4. ZERO ZATRZYMUJE. Przy zerowej dostępności przycisk jest wyłączony —
 *      z kontrolą pozytywną na tych samych danych z liczbą dodatnią.
 *
 * Akcje serwera są podmienione: ich własnych bramek pilnują
 * `availability-actions.test.ts` (najemca z nagłówka) i suity bazy na żywym
 * Supabase. Tutaj badamy SZEW — o co widget pyta i co z odpowiedzi wnioskuje.
 */
import { formatRentalRange } from "@avably/core";
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

/** POLE terminu w karcie otwiera OKNO wyboru (ADR-194) — siatka nie wisi na stałe. */
function openField(): void {
  fireEvent.click(document.querySelector<HTMLButtonElement>("[data-product-booking-field]")!);
}

/** Jedyny zapis terminu: „Zastosuj" w oknie wyboru (ADR-194). */
function applyTerm(): void {
  fireEvent.click(document.querySelector<HTMLButtonElement>("[data-store-term-apply]")!);
}

/** Pełna droga klienta: pole → dwa dni → „Zastosuj" (okno zamyka się samo). */
function pickRange(start: string, end: string): void {
  openField();
  clickDay(start);
  clickDay(end);
  applyTerm();
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

describe("forma zwarta karty (ADR-194)", () => {
  // BRAMKA: KARTA NIE ROZKŁADA SIATKI NA STAŁE. Wzorzec właściciela: pole
  // z zachętą, siatka dopiero po kliknięciu — w oknie wyboru.
  //
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: powrót stale rozwiniętego kalendarza (stara
  // forma). Siatka zjadała pół pierwszego ekranu i spychała opis pod zwijkę —
  // dokładnie to, co właściciel kazał zdjąć.
  it("bez interakcji nie ma siatki dni — jest pole z zachętą (kontrola: po kliknięciu jest)", () => {
    render(widget());

    expect(
      document.querySelector("[data-calendar-day]"),
      "siatka dni wisi rozwinięta bez interakcji",
    ).toBeNull();
    const field = document.querySelector<HTMLButtonElement>("[data-product-booking-field]");
    expect(field, "karta nie ma pola terminu").not.toBeNull();
    expect(field!.textContent).toContain(copy.term.fieldPrompt);

    // KONTROLA POZYTYWNA: pole naprawdę otwiera siatkę — bez niej ta bramka
    // przechodziłaby też nad kartą, w której nie da się wybrać niczego.
    openField();
    expect(document.querySelector("[data-calendar-day]")).not.toBeNull();
  });

  // BRAMKA: ZASTOSUJ = JEDYNY ZAPIS (to samo prawo, którego pilnuje suita
  // powłoki — tu od strony wejścia z karty sprzętu).
  it("wybór dat w oknie BEZ „Zastosuj\" nie zmienia koszyka; z „Zastosuj\" — zmienia", async () => {
    render(widget());
    const start = dayFromToday(3);
    const end = dayFromToday(5);

    openField();
    clickDay(start);
    clickDay(end);
    expect(readCart().startDate, "klik w dzień zapisał termin bez „Zastosuj\"").toBeNull();
    expect(readCart().endDate).toBeNull();

    applyTerm();
    await waitFor(() => expect(readCart().startDate).toBe(start));
    expect(readCart().endDate).toBe(end);
    // Okno zamyka się po zapisie — karta wraca do formy zwartej.
    expect(document.querySelector("[data-store-term-modal]")).toBeNull();
  });

  // POLE POKAZUJE TERMIN Z KOSZYKA — ten sam stan, który widzi pigułka paska
  // i kasa. Bez terminu zachęta; z terminem zakres.
  it("pole niesie wybrany zakres z CartState, a bez terminu zachętę", async () => {
    render(widget());
    const start = dayFromToday(3);
    const end = dayFromToday(5);

    expect(
      document.querySelector("[data-product-booking-field]")!.textContent,
    ).toContain(copy.term.fieldPrompt);

    pickRange(start, end);
    await waitFor(() => {
      expect(
        document.querySelector("[data-product-booking-field]")!.textContent,
        "pole nie pokazało zakresu z koszyka",
      ).toContain(formatRentalRange(start, end, "pl"));
    });

    /*
      ZMIANA ŚWIADOMA (F8, TODO z briefu F6): pole pokazuje termin frazą
      `formatRentalRange` („26–28 sie 2026 · 3 dni"), a nie ISO z szablonu copy.
      Asercja negatywna jest tu istotna: bez niej `toContain` na frazie
      przeszedłby także wtedy, gdyby obok frazy stało jeszcze stare ISO.
    */
    expect(
      document.querySelector("[data-product-booking-field]")!.textContent,
      "pole nadal pokazuje surowe ISO",
    ).not.toContain(start);
  });
});

describe("liczba wolnych sztuk w wybranym terminie", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: gdyby widget czytał dostępność z własnego,
  // drugiego wywołania (albo w ogóle jej nie czytał), na ekranie nie byłoby
  // liczby — a klient dowiadywałby się o braku sprzętu dopiero przy kasie.
  it("po wybraniu terminu na ekranie jest LICZBA wolnych sztuk", async () => {
    checkCatalogAvailability.mockResolvedValue(catalog(2));
    render(widget());

    pickRange(dayFromToday(3), dayFromToday(5));

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
    pickRange(dayFromToday(3), dayFromToday(5));

    await waitFor(() => expect(checkCatalogAvailability).toHaveBeenCalledTimes(1));
    expect(checkCatalogAvailability).toHaveBeenCalledWith(dayFromToday(3), dayFromToday(5));
  });

  /*
    [F7b] AUTO-DOSTĘPNOŚĆ NA STRONIE SPRZĘTU (dyspozycja właściciela:
    „dostępność sama się sprawdza bez kliknięcia, jeśli daty już mamy").

    Termin jest USTAWIONY PRZED wejściem na stronę — w koszyku, czyli tam, gdzie
    zapisuje go pigułka belki, okno wyboru na innej karcie albo poprzednia
    sesja. Klient otwiera stronę sprzętu i ma odpowiedź OD RAZU: bez otwierania
    okna, bez „Zastosuj", bez ani jednego przycisku „sprawdź".

    CO MUSIAŁOBY SIĘ ZEPSUĆ: gdyby odczyt dostępności wisiał na interakcji
    (np. na otwarciu okna wyboru albo na osobnym przycisku), ten test byłby
    czerwony na PIERWSZEJ asercji — bo w scenariuszu nie ma ani jednego
    zdarzenia wejściowego. Testy wyżej tego nie przykrywają: one WYBIERAJĄ
    termin klikaniem, więc przeszłyby także w wariancie „sprawdzam po kliknięciu".
  */
  it("termin ustawiony WCZEŚNIEJ: liczba wolnych sztuk stoi bez ani jednej interakcji", async () => {
    checkCatalogAvailability.mockResolvedValue(catalog(2));
    writeCart({ items: [], startDate: dayFromToday(3), endDate: dayFromToday(5) });

    render(widget());

    await waitFor(() => {
      expect(
        document.querySelector('[data-product-booking-units="2"]'),
        "karta nie policzyła dostępności dla terminu, który już był w koszyku",
      ).not.toBeNull();
    });
    expect(screen.getByText(/wolne w tym terminie: 2/)).toBeTruthy();
    expect(checkCatalogAvailability).toHaveBeenCalledWith(dayFromToday(3), dayFromToday(5));
    // Kontrola przyrządu: okno wyboru NIE jest otwarte — nikt w nic nie kliknął.
    expect(document.querySelector("[data-store-term-apply]")).toBeNull();
  });

  /*
    [F7b] I AKTUALIZUJE SIĘ SAMA. Zmiana terminu przychodzi SPOZA karty (z
    pigułki belki albo z drugiej karty przeglądarki — koszyk jest wspólny), a
    liczba na karcie ma za nią nadążyć bez dotykania czegokolwiek na PDP.

    CO MUSIAŁOBY SIĘ ZEPSUĆ: odpowiedź trzymana bez klucza pytania (wtedy
    zostałaby stara liczba) albo odczyt odpalany raz na montaż (wtedy nowego
    wywołania by nie było).
  */
  it("zmiana terminu spoza karty odświeża liczbę bez interakcji na stronie", async () => {
    checkCatalogAvailability.mockResolvedValue(catalog(2));
    writeCart({ items: [], startDate: dayFromToday(3), endDate: dayFromToday(5) });
    render(widget());
    await waitFor(() => {
      expect(document.querySelector('[data-product-booking-units="2"]')).not.toBeNull();
    });

    checkCatalogAvailability.mockResolvedValue(catalog(1));
    writeCart({ items: [], startDate: dayFromToday(10), endDate: dayFromToday(12) });

    await waitFor(() => {
      expect(
        document.querySelector('[data-product-booking-units="1"]'),
        "karta została przy liczbie dla POPRZEDNIEGO terminu",
      ).not.toBeNull();
    });
    expect(checkCatalogAvailability).toHaveBeenLastCalledWith(dayFromToday(10), dayFromToday(12));
  });

  it("bez kompletnego terminu widget prosi o termin, zamiast zmyślać dostępność", async () => {
    render(widget());

    expect(screen.getByText(copy.product.dateRequired)).toBeTruthy();
    expect(document.querySelector("[data-product-booking-units]")).toBeNull();
    expect(addButton().disabled).toBe(true);
    // Zwinięta karta nie pyta o nic — o dni pyta dopiero OTWARTE okno wyboru.
    expect(checkAvailabilityDays).not.toHaveBeenCalled();
  });
});

describe("okno zapytania o dni", () => {
  // Funkcja czysta, więc jej granice sprawdzamy wprost: przycięcie do okna
  // wyboru jest tym, co dzieli zapytanie legalne od odrzuconego przez bazę
  // (sufit 90 dni) i od pytania o przeszłość, której siatka i tak nie da wybrać.
  it("przycina miesiąc do okna wyboru z OBU stron", async () => {
    const { bookingMonthWindow } = await import("@/components/storefront/product-booking");

    // Miesiąc w środku okna — pełny zakres miesiąca.
    expect(bookingMonthWindow("2027-06", "2027-05-10", "2027-08-07")).toEqual({
      from: "2027-06-01",
      to: "2027-06-30",
    });
    // Miesiąc, w którym okno się ZACZYNA — dolna granica podciągnięta.
    expect(bookingMonthWindow("2027-05", "2027-05-10", "2027-08-07")).toEqual({
      from: "2027-05-10",
      to: "2027-05-31",
    });
    // Miesiąc, w którym okno się KOŃCZY — górna granica ucięta.
    expect(bookingMonthWindow("2027-08", "2027-05-10", "2027-08-07")).toEqual({
      from: "2027-08-01",
      to: "2027-08-07",
    });
    // Miesiąc w całości poza oknem — nie ma o co pytać.
    expect(bookingMonthWindow("2027-09", "2027-05-10", "2027-08-07")).toBeNull();
    expect(bookingMonthWindow("2027-04", "2027-05-10", "2027-08-07")).toBeNull();
  });
});

describe("siatka dni w oknie wyboru maluje dostępność TEGO sprzętu", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: kotwica miesiąca policzona RAZ, przy pierwszym
  // renderze karty (a nie przy OTWARCIU okna). Termin przychodzi z koszyka,
  // czyli spoza drzewa — wracający klient z terminem w lipcu otworzyłby siatkę
  // na maju i musiał przewijać do miejsca, w którym już był.
  //
  // TEST MUSI ODTWORZYĆ TĘ KOLEJNOŚĆ, a nie tylko stan końcowy: termin
  // zapisuje się PO renderze karty, a PRZED otwarciem okna — dokładnie okno
  // czasowe, w którym kotwica ze stanu początkowego byłaby przeterminowana.
  it("okno otwiera się na miesiącu terminu, który przyszedł PO renderze karty", async () => {
    render(widget());

    const zaDwaMiesiace = dayFromToday(60);
    // Kontrola wyjściowa: świeżo otwarte okno BEZ terminu staje na bieżącym
    // miesiącu — dnia za dwa miesiące w siatce nie ma.
    openField();
    expect(
      document.querySelector(`[data-calendar-day="${zaDwaMiesiace}"]`),
      "kontrola wyjściowa: dzień za dwa miesiące NIE MOŻE być w siatce bez terminu",
    ).toBeNull();
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-store-term-modal-close]")!);

    writeCart({ ...EMPTY_CART, startDate: zaDwaMiesiace, endDate: dayFromToday(62) });
    await waitFor(() => {
      expect(
        document.querySelector("[data-product-booking-field]")!.textContent,
      ).toContain(formatRentalRange(zaDwaMiesiace, dayFromToday(62), "pl"));
    });

    openField();
    expect(
      document.querySelector(`[data-calendar-day="${zaDwaMiesiace}"]`),
      "okno stanęło na starym miesiącu mimo terminu z koszyka",
    ).not.toBeNull();
  });

  // CO MUSIAŁOBY SIĘ ZEPSUĆ: gdyby okno otwarte z karty nie podawało
  // `dayUnits`, siatka wyglądałaby jak ta z pigułki — sam wybór terminu, bez
  // ani jednej liczby. Klient wybierałby dni w ciemno i dowiadywał się
  // o zajętości po fakcie.
  it("dzień niesie liczbę wolnych sztuk z odpowiedzi dziennej", async () => {
    checkAvailabilityDays.mockResolvedValue(days(4));
    render(widget());
    openField();

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
    openField();

    await waitFor(() => {
      const dzien = document.querySelector<HTMLButtonElement>(`[data-calendar-day="${zajety}"]`)!;
      expect(dzien.dataset.calendarDayState).toBe("unavailable");
      expect(dzien.disabled).toBe(true);
    });
    const sasiad = document.querySelector<HTMLButtonElement>(`[data-calendar-day="${wolny}"]`)!;
    expect(sasiad.disabled, "kontrola pozytywna: sąsiedni dzień musi być wybieralny").toBe(false);
  });

  // Pytanie o dni jest PER WIDOK (para miesięcy naraz), a nie per dzień ani
  // per render: siatka ma sześćdziesiąt komórek i pętla po nich byłaby
  // sześćdziesięcioma żądaniami.
  it("o dni pyta RAZ na widoczny widok, oknem przyciętym do okna wyboru", async () => {
    render(widget());
    openField();

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
    pickRange(start, end);

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
    pickRange(dayFromToday(3), dayFromToday(6));

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
    pickRange(dayFromToday(3), dayFromToday(6));

    await waitFor(() => expect(addButton().disabled).toBe(false));
  });

  // Nieudany odczyt dostępności to „nie wiem", a nie „zajęte": wiążąca bramka
  // stoi na serwerze (przypisanie egzemplarza w `app.public_checkout`), więc
  // gaszenie sprzedaży za awarię odczytu byłoby kosztem najemcy za nic.
  it("odmowa odczytu dostępności NIE zamyka koszyka", async () => {
    checkCatalogAvailability.mockResolvedValue(null);
    render(widget());
    pickRange(dayFromToday(3), dayFromToday(6));

    await waitFor(() => expect(addButton().disabled).toBe(false));
    expect(screen.getByText(copy.term.bookingUnknown)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------
 * CLAMP DO DOSTĘPNOŚCI PRZY DODAWANIU (S-51 audytu 2026-08-25)
 * ---------------------------------------------------------------------- */

/**
 * CO BYŁO ZEPSUTE: karta oferowała PEŁNĄ dostępność niezależnie od tego, co już
 * leży w koszyku. Przy trzech wolnych sztukach klient mógł dodać trzy, wrócić
 * na tę samą stronę i dodać kolejne trzy — a prawda wychodziła dopiero
 * w koszyku, banerem naprawczym nad gotowym zamówieniem.
 *
 * MUTACJE, KTÓRE MAJĄ TU SPŁONĄĆ: zdjęcie odejmowania koszyka od sufitu
 * (test 1 i 2), clamp WYŁĄCZNIE na polu ilości bez clampu przy kliknięciu
 * (test 3 — pole omija się strzałkami, drugą kartą i wklejeniem), zgaszenie
 * przycisku ZAWSZE zamiast tylko przy wyczerpaniu (kontrola pozytywna w
 * teście 2).
 */
describe("dodawanie nie przekracza dostępności (S-51)", () => {
  function setQuantity(value: string): void {
    const input = document.querySelector<HTMLInputElement>("#booking-qty")!;
    fireEvent.change(input, { target: { value } });
  }

  it("sufit ilości schodzi o to, co JUŻ jest w koszyku", async () => {
    checkCatalogAvailability.mockResolvedValue(catalog(3));
    render(widget());
    pickRange(dayFromToday(3), dayFromToday(6));

    await waitFor(() => expect(addButton().disabled).toBe(false));

    // Kontrola wyjściowa: pusty koszyk → sufit to pełne trzy sztuki.
    expect(document.querySelector<HTMLInputElement>("#booking-qty")!.max).toBe("3");

    fireEvent.click(addButton());
    await waitFor(() => expect(readCart().items[0]?.quantity).toBe(1));

    await waitFor(() =>
      expect(
        document.querySelector<HTMLInputElement>("#booking-qty")!.max,
        "sufit nie odjął sztuki, która już leży w koszyku",
      ).toBe("2"),
    );
  });

  it("cała dostępność w koszyku: przycisk gaśnie, a komunikat mówi ILE z ILU", async () => {
    checkCatalogAvailability.mockResolvedValue(catalog(2));
    writeCart({
      ...EMPTY_CART,
      items: [{ productId: ROWER, quantity: 2 }],
      startDate: dayFromToday(3),
      endDate: dayFromToday(6),
    });
    render(widget());

    await waitFor(() =>
      expect(document.querySelector("[data-product-booking-in-cart]")).not.toBeNull(),
    );
    expect(addButton().disabled, "przycisk czynny mimo wyczerpanej dostępności").toBe(true);

    const komunikat = document.querySelector("[data-product-booking-in-cart]")!.textContent ?? "";
    expect(komunikat, "komunikat nie mówi, ile klient już ma").toContain("2");
    expect(komunikat).toBe(
      copy.product.cartAlready.replace("{inCart}", "2").replace("{available}", "2"),
    );

    // KONTROLA POZYTYWNA: przy JEDNEJ sztuce w koszyku i dwóch wolnych ten sam
    // przycisk jest czynny — czyli gasi go wyczerpanie, a nie sam fakt koszyka.
    cleanup();
    writeCart({
      ...EMPTY_CART,
      items: [{ productId: ROWER, quantity: 1 }],
      startDate: dayFromToday(3),
      endDate: dayFromToday(6),
    });
    render(widget());
    await waitFor(() => expect(addButton().disabled).toBe(false));
  });

  /*
    CLAMP MUSI STAĆ TAKŻE PRZY KLIKNIĘCIU, nie tylko na polu ilości — a to
    znaczy, że test musi POLE OMINĄĆ. Wpisanie za dużej liczby go nie omija:
    `onChange` clampuje ją w locie, więc taki scenariusz przechodzi także
    z widgetem BEZ clampu przy kliknięciu (mutant przeżył pierwszą wersję tego
    testu).

    Prawdziwe ominięcie jest jedno i występuje na produkcji: DRUGA KARTA
    przeglądarki dokłada sztuki do koszyka PO tym, jak klient wpisał tu swoją
    liczbę. Sufit spada, wpisana liczba zostaje — i tylko clamp w `onAdd`
    stoi między nią a koszykiem ponad dostępność.
  */
  it("kliknięcie dodaje NAJWYŻEJ tyle, ile zostało — gdy koszyk urósł w DRUGIEJ karcie", async () => {
    checkCatalogAvailability.mockResolvedValue(catalog(3));
    render(widget());
    pickRange(dayFromToday(3), dayFromToday(6));

    await waitFor(() => expect(addButton().disabled).toBe(false));

    // Klient wpisuje 3 przy pustym koszyku — liczba całkowicie legalna.
    setQuantity("3");
    expect(document.querySelector<HTMLInputElement>("#booking-qty")!.value).toBe("3");

    // DRUGA KARTA dokłada jedną sztukę. Sufit tej karty schodzi do 2,
    // ale wpisana wcześniej trójka zostaje w polu.
    writeCart({
      ...readCart(),
      items: [{ productId: ROWER, quantity: 1 }],
    });
    await waitFor(() =>
      expect(document.querySelector<HTMLInputElement>("#booking-qty")!.max).toBe("2"),
    );
    expect(
      document.querySelector<HTMLInputElement>("#booking-qty")!.value,
      "pole samo się poprawiło — test nie omija pola i nie mierzy clampu przy kliknięciu",
    ).toBe("3");

    fireEvent.click(addButton());

    await waitFor(() =>
      expect(
        readCart().items.find((line) => line.productId === ROWER)?.quantity,
        "koszyk przekroczył dostępność — clamp przy kliknięciu nie zadziałał",
      ).toBe(3),
    );
  });
});

/* -------------------------------------------------------------------------
 * LISTA KORZYŚCI POD CTA (benchmark pkt 5)
 * ---------------------------------------------------------------------- */

/**
 * Lista jest wyłącznie ODCZYTEM z danych pozycji katalogu — kaucja i próg
 * cenowy. Mutacja, która ma tu spłonąć: wstawienie stałej obietnicy („darmowa
 * dostawa"), czyli listy, która NIE znika, gdy najemca nie ma danych.
 */
describe("lista korzyści karty rezerwacji", () => {
  it("kaucja i próg cenowy z danych pozycji stają pod przyciskiem", () => {
    render(
      <StoreTermProvider>
        <ProductBooking
          productId={ROWER}
          priceParams={{ ...CENA, tiers: [{ tierDays: 3, multiplier: 0.9 }] }}
          copy={copy}
          locale="pl"
          currency="PLN"
        />
      </StoreTermProvider>,
    );

    expect(document.querySelector("[data-product-benefits]")).not.toBeNull();
    expect(document.querySelector('[data-product-benefit="deposit"]')!.textContent).toContain(
      "400,00",
    );
    const tier = document.querySelector('[data-product-benefit="tier"]')!.textContent ?? "";
    expect(tier).toContain("3");
    expect(tier, "próg bez wielkości upustu nie jest korzyścią").toContain("10");
  });

  it("sprzęt BEZ kaucji i BEZ progów nie dostaje listy w ogóle", () => {
    render(
      <StoreTermProvider>
        <ProductBooking
          productId={ROWER}
          priceParams={{ ...CENA, depositGrosze: 0, tiers: [] }}
          copy={copy}
          locale="pl"
          currency="PLN"
        />
      </StoreTermProvider>,
    );

    expect(
      document.querySelector("[data-product-benefits]"),
      "lista stoi mimo braku danych — czyli niesie obietnicę spoza danych najemcy",
    ).toBeNull();
  });
});
