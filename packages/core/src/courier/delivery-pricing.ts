/**
 * Koszt dostawy zamówienia (ADR-030): koszt stały metody + próg darmowej
 * dostawy per tenant (tenant_settings.delivery_pricing). Funkcja czysta —
 * cennik przychodzi jako DANE (deliveryPricingFromSettings), nie z bazy.
 *
 * Metoda płatna bez cennika to BŁĄD KONFIGURACJI (DeliveryPricingError),
 * nie darmowa dostawa: ciche 0 rozdawałoby dostawę za darmo dokładnie tym
 * najemcom, którzy nie skończyli konfiguracji (zero twardych fallbacków —
 * decyzja wiążąca nr 5).
 */
import { DELIVERY_PRICING_KEY } from "./tenant-config";
import type { DeliveryMethod, DeliveryPricing } from "./types";

export class DeliveryPricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryPricingError";
  }
}

export function calculateDeliveryCost(params: {
  method: DeliveryMethod;
  pricing: DeliveryPricing | null;
  rentalTotalGrosze: number;
}): number {
  const { method, pricing, rentalTotalGrosze } = params;

  // Odbiór osobisty jest z definicji darmowy i nie podlega konfiguracji.
  if (method === "pickup") return 0;

  const entry = pricing?.[method];
  if (!entry) {
    throw new DeliveryPricingError(
      `Brak cennika dostawy dla metody "${method}" — uzupełnij ustawienie ${DELIVERY_PRICING_KEY} tenanta.`,
    );
  }

  // Próg darmowej dostawy jest INCLUSIVE: total równy progowi = darmowa.
  if (entry.freeAboveGrosze !== undefined && rentalTotalGrosze >= entry.freeAboveGrosze) {
    return 0;
  }
  return entry.priceGrosze;
}

/**
 * Skąd wzięła się kwota dostawy — lustro CHECK-a
 * `orders_delivery_price_source_check` (0044).
 */
export const DELIVERY_PRICE_SOURCES = ["pricing", "manual"] as const;
export type DeliveryPriceSource = (typeof DELIVERY_PRICE_SOURCES)[number];

/**
 * Górna granica RĘCZNIE ustalonej ceny dostawy: 10 000 zł.
 *
 * Granica nie jest regułą biznesową („dostawa nigdy nie kosztuje więcej"),
 * tylko bezpiecznikiem pola liczbowego: bez niej literówka w groszach
 * (`1900` zamiast `19,00`) wchodzi do zamówienia jako 19 000 zł i wraca
 * dopiero z faktury. Kwota poza granicą jest ODMOWĄ z powodem, nie
 * przycięciem do maksimum — przycięcie zapisałoby liczbę, której operator
 * nigdy nie wpisał.
 */
export const DELIVERY_PRICE_OVERRIDE_MAX_GROSZE = 1_000_000;

export class DeliveryPriceOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryPriceOverrideError";
  }
}

export interface ResolvedDeliveryCost {
  grosze: number;
  source: DeliveryPriceSource;
}

/**
 * Ostateczna kwota dostawy zamówienia: cennik ALBO jawne nadpisanie operatora
 * (R3, pinezka „ceny z cenników + możliwość edycji ręcznej").
 *
 * Trzy rozstrzygnięcia, każde świadome:
 *
 * 1. Nadpisanie WYGRYWA z cennikiem i cennika nawet nie czyta. Ręczna cena
 *    jest odpowiedzią na sytuację, w której cennik nie ma odpowiedzi —
 *    także wtedy, gdy metoda nie ma jeszcze wpisu w cenniku. Wymaganie
 *    poprawnego cennika do zapisania ceny USTALONEJ POZA NIM byłoby bramką
 *    bez treści.
 * 2. Odbiór osobisty nadpisania NIE PRZYJMUJE. „pickup jest z definicji
 *    darmowy i nie podlega konfiguracji" (ADR-030) — furtka na ręczną kwotę
 *    otwierałaby drugą, sprzeczną definicję tej samej metody.
 * 3. Kwota to CAŁKOWITE grosze z przedziału [0, MAX]. Zero jest poprawne
 *    (dostawa gratis w ramach negocjacji), ułamek grosza i liczba ujemna —
 *    nie; przechodzą przez odmowę, nie przez zaokrąglenie.
 */
export function resolveDeliveryCost(params: {
  method: DeliveryMethod;
  pricing: DeliveryPricing | null;
  rentalTotalGrosze: number;
  /** `null` = brak nadpisania, licz z cennika. */
  overrideGrosze: number | null;
}): ResolvedDeliveryCost {
  const { method, pricing, rentalTotalGrosze, overrideGrosze } = params;

  if (overrideGrosze === null) {
    return { grosze: calculateDeliveryCost({ method, pricing, rentalTotalGrosze }), source: "pricing" };
  }

  if (method === "pickup") {
    throw new DeliveryPriceOverrideError(
      "Odbiór osobisty jest bezpłatny — nie można ustalić dla niego ceny dostawy.",
    );
  }
  if (!Number.isInteger(overrideGrosze)) {
    throw new DeliveryPriceOverrideError("Cena dostawy musi być pełną kwotą w groszach.");
  }
  if (overrideGrosze < 0 || overrideGrosze > DELIVERY_PRICE_OVERRIDE_MAX_GROSZE) {
    throw new DeliveryPriceOverrideError(
      `Cena dostawy musi mieścić się w przedziale 0 – ${DELIVERY_PRICE_OVERRIDE_MAX_GROSZE / 100} zł.`,
    );
  }

  return { grosze: overrideGrosze, source: "manual" };
}
