/**
 * GOTOWOŚĆ ZAMÓWIENIA DO ZAPISU — jedno miejsce, w którym ekran wie, czego
 * jeszcze brakuje (U7, audyt 2.6: „«Utwórz zamówienie» jest aktywne dla
 * pustego formularza; walidacja odzywa się dopiero po kliknięciu").
 *
 * ============ DLACZEGO OSOBNY MODUŁ, A NIE `if` W KOMPONENCIE ============
 *
 * Powód jest jeden i twardy: TA LISTA MUSI ZGADZAĆ SIĘ ZE SCHEMATEM
 * `orderFormSchema`. Przycisk wygaszony, gdy schemat i tak by przyjął, to
 * odmowa bez powodu; przycisk czynny, gdy schemat odmówi, to obietnica bez
 * pokrycia — czyli dokładnie stan sprzed U7, tylko z ładniejszym opakowaniem.
 * Reguły stoją więc w czystej funkcji, a test
 * `order-preview-save-parity.test.tsx` przypina je do schematu z OBU stron:
 * „brak blokad ⟺ schemat przyjmuje" dla tablicy stanów formularza. Rozjazd
 * którejkolwiek strony pali test z imienia.
 *
 * Reguły są LUSTREM `.refine`-ów schematu (apps/panel/lib/order-validation.ts),
 * w tej samej kolejności, w jakiej operator wypełnia ekran. Termin sprawdza
 * `assertIsoDate` z silnika — ta sama funkcja, którą waliduje schemat, więc
 * data o poprawnym kształcie i nieistniejąca w kalendarzu (2026-02-31) odpada
 * po obu stronach tak samo.
 *
 * Czego tu NIE MA i być nie może: kształtu e-maila nowego klienta ani innych
 * reguł „pole wypełnione, ale błędnie". Lista mówi, CZEGO BRAKUJE, zanim
 * operator kliknie; literówka w polu jest błędem pola i odzywa się przy nim
 * po wysyłce. Wygaszanie przycisku na literówce zabrałoby jedyną drogę,
 * którą operator ten błąd zobaczy.
 */
import {
  DELIVERY_PRICE_OVERRIDE_MAX_GROSZE,
  assertIsoDate,
  methodUsesDeliveryAddress,
  methodUsesDeliveryPoint,
  type DeliveryMethod,
} from "@avably/core";

import { parseMajorToGrosze } from "@/lib/money-input";

/**
 * Powody, dla których zamówienia jeszcze nie da się utworzyć. Kolejność jest
 * kolejnością EKRANU (klient → pozycje → termin → dostawa), bo lista czyta
 * się jak plan pracy, a nie jak zrzut błędów.
 */
export const ORDER_BLOCKERS = [
  "customer",
  "items",
  "term",
  "pickupLocation",
  "deliveryPoint",
  "deliveryAddress",
  "deliveryPrice",
  "deliveryPricing",
  "availability",
] as const;

export type OrderBlocker = (typeof ORDER_BLOCKERS)[number];

export interface OrderDraft {
  /** Klient wskazany z kartoteki albo wpisany e-mail nowego (dokładnie jeden). */
  hasCustomer: boolean;
  /** Ile sztuk w koszyku (pozycja zamówienia = jedna sztuka). */
  itemCount: number;
  startDate: string;
  endDate: string;
  method: DeliveryMethod;
  pickupLocationId: string;
  pointCode: string;
  addressSource: "" | "customer" | "custom";
  addressStreet: string;
  addressZip: string;
  addressCity: string;
  priceSource: "pricing" | "manual";
  price: string;
  /** Metoda płatna bez cennika i bez ceny własnej (ADR-030: zero cichych zer). */
  deliveryPricingProblem: boolean;
  /** Ile produktów nie ma kompletu wolnych egzemplarzy w wybranym terminie. */
  shortageCount: number;
}

/**
 * Czy termin jest kompletny i sensowny — TA SAMA reguła co w schemacie
 * (`isoDateSchema` + `.refine(end >= start)`), liczona tą samą funkcją
 * silnika. Komponent nie ma prawa mieć własnego wzorca daty: regex
 * `^\d{4}-\d{2}-\d{2}$` przepuszcza 2026-02-31, którego schemat nie przyjmie.
 */
export function hasValidTerm(startDate: string, endDate: string): boolean {
  try {
    const start = assertIsoDate(startDate.trim());
    const end = assertIsoDate(endDate.trim());
    return end >= start;
  } catch {
    return false;
  }
}

export function orderBlockers(draft: OrderDraft): OrderBlocker[] {
  const blockers: OrderBlocker[] = [];

  if (!draft.hasCustomer) blockers.push("customer");
  if (draft.itemCount === 0) blockers.push("items");
  if (!hasValidTerm(draft.startDate, draft.endDate)) blockers.push("term");

  // Lustro orders_pickup_requires_location (0007).
  if (draft.method === "pickup" && draft.pickupLocationId.trim() === "") {
    blockers.push("pickupLocation");
  }
  // Lustro „dostawa do paczkomatu wymaga numeru punktu" (0044).
  if (methodUsesDeliveryPoint(draft.method) && draft.pointCode.trim() === "") {
    blockers.push("deliveryPoint");
  }
  // Lustro orders_delivery_address_shape: wskaźnik na kartotekę ALBO komplet.
  if (methodUsesDeliveryAddress(draft.method)) {
    const custom =
      draft.addressStreet.trim() === "" ||
      draft.addressZip.trim() === "" ||
      draft.addressCity.trim() === "";
    if (draft.addressSource === "" || (draft.addressSource === "custom" && custom)) {
      blockers.push("deliveryAddress");
    }
  }
  // Cena własna zadeklarowana, ale kwoty nie ma albo jest poza granicą.
  if (draft.priceSource === "manual") {
    const grosze = parseMajorToGrosze(draft.price);
    if (grosze === null || grosze > DELIVERY_PRICE_OVERRIDE_MAX_GROSZE) {
      blockers.push("deliveryPrice");
    }
  }
  // Metoda płatna bez cennika — akcja serwerowa i tak odmówi (ADR-030),
  // więc powód stoi na ekranie ZANIM operator kliknie.
  if (draft.deliveryPricingProblem) blockers.push("deliveryPricing");
  if (draft.shortageCount > 0) blockers.push("availability");

  return blockers;
}
