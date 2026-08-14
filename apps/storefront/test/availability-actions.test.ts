/**
 * Akcje serwera dostępności (faza 5, ADR-179) — bramka NAJEMCY (ADR-039).
 *
 * Wszystkie trzy akcje biorą `tenant_id` WYŁĄCZNIE z nagłówka `x-tenant-id`,
 * który stawia proxy sklepu, i NIGDY z argumentu. To jest jedyna rzecz, która
 * dzieli publiczny odczyt sklepu najemcy A od sklepu najemcy B po stronie
 * aplikacji — dalej stoi jeszcze zawężenie w ciele funkcji SECURITY DEFINER
 * (bramka `packages/db/test/public-availability-calendar.test.ts`).
 *
 * Testy pilnują też, że odmowa jest CICHA i TANIA: przy braku nagłówka albo
 * przy oczywiście złym wejściu warstwa danych nie zostaje w ogóle zawołana.
 * To nie jest optymalizacja — wywołanie z pustym najemcą byłoby żądaniem do
 * bazy, którego kształt odpowiedzi mógłby coś powiedzieć o istnieniu danych.
 */
import { AVAILABILITY_WINDOW_MAX_DAYS, addDays } from "@avably/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const headerValue = { current: null as string | null };

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => (name === "x-tenant-id" ? headerValue.current : null) }),
}));

const getPublicAvailability = vi.fn();
const getPublicCatalogAvailability = vi.fn();
const getPublicAvailabilityDays = vi.fn();

vi.mock("@/lib/checkout/catalog", () => ({
  // Rejestr adresów sprzętu (0083) — pusty: ten plik nie mierzy adresów,
  // a `null` z tego odczytu jest stanem LEGALNYM (linki spadają wtedy na
  // adres zastany), więc atrapa nie może go po prostu pominąć.
  getPublicProductSlugs: () => Promise.resolve({ products: [], redirects: [] }),

  getPublicAvailability: (...args: unknown[]) => getPublicAvailability(...args),
  getPublicCatalogAvailability: (...args: unknown[]) => getPublicCatalogAvailability(...args),
  getPublicAvailabilityDays: (...args: unknown[]) => getPublicAvailabilityDays(...args),
}));

const { checkAvailability, checkAvailabilityDays, checkCatalogAvailability } = await import(
  "@/lib/actions/availability"
);

const TENANT = "11111111-1111-4111-8111-111111111111";
const PRODUKT = "22222222-2222-4222-8222-222222222222";
const START = "2027-05-10";
const END = "2027-05-14";

beforeEach(() => {
  headerValue.current = TENANT;
  getPublicAvailability.mockReset().mockResolvedValue({ available_units: 2, total_units: 3 });
  getPublicCatalogAvailability.mockReset().mockResolvedValue({ products: [] });
  getPublicAvailabilityDays.mockReset().mockResolvedValue({ total_units: 3, days: {} });
});

describe("najemca pochodzi z NAGŁÓWKA, nie od klienta (ADR-039)", () => {
  it("każda akcja przekazuje do warstwy danych DOKŁADNIE wartość z nagłówka", async () => {
    headerValue.current = TENANT;

    await checkAvailability(PRODUKT, START, END);
    expect(getPublicAvailability).toHaveBeenCalledWith(TENANT, PRODUKT, START, END);

    await checkCatalogAvailability(START, END);
    expect(getPublicCatalogAvailability).toHaveBeenCalledWith(TENANT, START, END);

    await checkAvailabilityDays(PRODUKT, START, END);
    expect(getPublicAvailabilityDays).toHaveBeenCalledWith(TENANT, PRODUKT, START, END);
  });

  it("inny nagłówek → inny najemca; wartości nie da się podać argumentem", async () => {
    // Sygnatury akcji NIE MAJĄ parametru najemcy i to jest cała gwarancja po
    // tej stronie: nie ma czym podstawić cudzego identyfikatora. Ten przypadek
    // dowodzi drugiej połowy — że wynik naprawdę idzie za nagłówkiem.
    const inny = "33333333-3333-4333-8333-333333333333";
    headerValue.current = inny;
    await checkCatalogAvailability(START, END);
    expect(getPublicCatalogAvailability).toHaveBeenCalledWith(inny, START, END);
  });

  it("BRAK nagłówka → null, a warstwa danych nie zostaje zawołana ani razu", async () => {
    headerValue.current = null;

    expect(await checkAvailability(PRODUKT, START, END)).toBeNull();
    expect(await checkCatalogAvailability(START, END)).toBeNull();
    expect(await checkAvailabilityDays(PRODUKT, START, END)).toBeNull();

    expect(getPublicAvailability).not.toHaveBeenCalled();
    expect(getPublicCatalogAvailability).not.toHaveBeenCalled();
    expect(getPublicAvailabilityDays).not.toHaveBeenCalled();
  });
});

describe("tania walidacja wejścia przed sięgnięciem do bazy", () => {
  it("śmieć w dacie i zakres odwrócony kończą się null-em bez zapytania", async () => {
    expect(await checkCatalogAvailability("wczoraj", END)).toBeNull();
    expect(await checkCatalogAvailability(END, START)).toBeNull();
    expect(await checkAvailability("", START, END)).toBeNull();
    expect(await checkAvailabilityDays("", START, END)).toBeNull();

    expect(getPublicCatalogAvailability).not.toHaveBeenCalled();
    expect(getPublicAvailability).not.toHaveBeenCalled();
    expect(getPublicAvailabilityDays).not.toHaveBeenCalled();
  });

  // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie drugiej bramki sufitu z akcji. Bramką
  // WIĄŻĄCĄ jest baza (i ma własny test), więc ten przypadek pilnuje wyłącznie
  // tego, że nie płacimy za odrzucenie wyjściem do sieci — i że gdyby te dwie
  // strony kiedyś się rozjechały, rozjazd poszedł w stronę BEZPIECZNĄ.
  it("okno szersze niż sufit odrzucamy BEZ wyjścia do bazy", async () => {
    const naSuficie = addDays(START, AVAILABILITY_WINDOW_MAX_DAYS - 1);
    const ponadSufit = addDays(START, AVAILABILITY_WINDOW_MAX_DAYS);

    expect(await checkAvailabilityDays(PRODUKT, START, naSuficie)).not.toBeNull();
    expect(getPublicAvailabilityDays).toHaveBeenCalledTimes(1);

    expect(await checkAvailabilityDays(PRODUKT, START, ponadSufit)).toBeNull();
    // Wciąż JEDNO wywołanie — to drugie nie wyszło poza akcję.
    expect(getPublicAvailabilityDays).toHaveBeenCalledTimes(1);
  });

  it("sufit NIE dotyczy katalogu — najem półroczny jest legalnym terminem", async () => {
    expect(await checkCatalogAvailability(START, addDays(START, 180))).not.toBeNull();
    expect(getPublicCatalogAvailability).toHaveBeenCalledTimes(1);
  });
});
