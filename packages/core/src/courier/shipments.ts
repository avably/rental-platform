/**
 * Budowa żądań przesyłek GlobKurier + mapowanie statusów dostawcy (ADR-031).
 *
 * Zwrot to przesyłka LUSTRZANA (wzorzec pierwowzoru): kurier odbiera paczkę
 * od klienta i wiezie ją do nadawcy tenanta — czyli te same dane, zamienione
 * stronami. Jedna funkcja obsługuje oba kierunki, żeby lustro nie mogło się
 * rozjechać w dwóch kopiach.
 */
import { DEFAULT_CURRENCY, isCurrencyCode, type CurrencyCode } from "../money";
import { PAYMENT_IDS } from "./config";
import type {
  CourierSender,
  GlobKurierBestPriceAddress,
  GlobKurierBestPriceRequest,
  GlobKurierProduct,
  ParcelDimensions,
  ShipmentStatus,
  ShipmentType,
} from "./types";

/** Strona przesyłki (nadawca albo odbiorca) w postaci neutralnej. */
export interface ShipmentParty {
  name: string;
  street: string;
  houseNumber: string;
  apartmentNumber?: string;
  postCode: string;
  city: string;
  phone: string;
  email: string;
}

function toBestPriceAddress(party: ShipmentParty): GlobKurierBestPriceAddress {
  const address: GlobKurierBestPriceAddress = {
    name: party.name,
    street: party.street,
    houseNumber: party.houseNumber,
    postCode: party.postCode,
    city: party.city,
    country: "PL",
    phone: party.phone,
    email: party.email,
  };
  if (party.apartmentNumber !== undefined) {
    address.apartmentNumber = party.apartmentNumber;
  }
  return address;
}

function senderToParty(sender: CourierSender): ShipmentParty {
  return {
    name: sender.name,
    street: sender.street,
    houseNumber: sender.houseNumber,
    ...(sender.apartmentNumber !== undefined ? { apartmentNumber: sender.apartmentNumber } : {}),
    postCode: sender.postCode,
    city: sender.city,
    phone: sender.phone,
    email: sender.email,
  };
}

/**
 * Żądanie bestPrice dla przesyłki zamówienia.
 *
 * Stałe (faza 1): płatność z konta pre-paid tenanta, odbiór kurierem spod
 * adresu (PICKUP/PICKUP — paczkomaty wymagają pointId i są długiem),
 * purpose NOT_SOLD (sprzęt wynajęty, nie sprzedany), odbiorca prywatny.
 *
 * `productId` PRZYPINA przewoźnika wybranego w wyszukiwarce ofert: bez niego
 * bestPrice sam dobiera najtańszy produkt (zachowanie sprzed wyszukiwarki),
 * z nim operator dostaje dokładnie tego przewoźnika, którego zaznaczył
 * i którego cenę widział.
 *
 * Dodatki (`addons`) są kluczowane KATEGORIĄ, nie liczbowym id produktu, więc
 * nie łamią decyzji „bez ADDON_IDS" (plan Zadania 7): `insuranceValuePln`
 * włącza ubezpieczenie (`INSURANCE: { value }`), `saturdayDelivery` — dostawę
 * w sobotę (`WEEKEND_DELIVERY: {}` — PUSTY obiekt, dodatek bez wartości, wzór
 * z działającego pierwowzoru). Mogą wystąpić razem. Wszystkie parametry są
 * opcjonalne: gdy ich nie ma, żądanie jest identyczne jak przed tą zmianą.
 */
export function buildBestPriceRequest(params: {
  type: ShipmentType;
  sender: CourierSender;
  customer: ShipmentParty;
  parcel: ParcelDimensions;
  content: string;
  referenceNumber: string;
  productId?: number;
  insuranceValuePln?: number;
  saturdayDelivery?: boolean;
}): GlobKurierBestPriceRequest {
  const tenantParty = senderToParty(params.sender);
  const from = params.type === "outbound" ? tenantParty : params.customer;
  const to = params.type === "outbound" ? params.customer : tenantParty;

  const shipment: GlobKurierBestPriceRequest["shipment"] = {
    length: params.parcel.lengthCm,
    width: params.parcel.widthCm,
    height: params.parcel.heightCm,
    weight: params.parcel.weightKg,
    quantity: 1,
  };
  if (params.productId !== undefined) {
    shipment.productId = params.productId;
  }

  const request: GlobKurierBestPriceRequest = {
    shipment,
    senderAddress: toBestPriceAddress(from),
    receiverAddress: toBestPriceAddress(to),
    content: params.content,
    paymentId: PAYMENT_IDS.PREPAID,
    agreements: { receiveElectronicBills: true, processingPersonalData: true },
    purpose: "NOT_SOLD",
    collectionType: "PICKUP",
    deliveryType: "PICKUP",
    referenceNumber: params.referenceNumber,
    receiverType: "PRIVATE_PERSON",
  };
  const addons: NonNullable<GlobKurierBestPriceRequest["addons"]> = {};
  if (params.insuranceValuePln !== undefined) {
    addons.INSURANCE = { value: params.insuranceValuePln };
  }
  if (params.saturdayDelivery) {
    // Dostawa w sobotę: kategoria WEEKEND_DELIVERY z PUSTYM obiektem — to dodatek
    // bez wartości (inaczej niż INSURANCE), dosyłany na obecnym torze PICKUP.
    addons.WEEKEND_DELIVERY = {};
  }
  if (Object.keys(addons).length > 0) {
    request.addons = addons;
  }
  return request;
}

/**
 * Oferta przewoźnika dla panelu — kształt, który wychodzi do przeglądarki
 * (bez surowego produktu API). Cena w GROSZACH (int), spójnie z resztą
 * pieniędzy w systemie i z formatMoney; API GlobKurier podaje ją w złotych.
 */
export interface CarrierOffer {
  productId: number;
  serviceCode?: string;
  carrierName: string;
  carrierLogo?: string;
  priceGrosze: number;
  currency: CurrencyCode;
  deliveryDays?: number;
  deliveryTime?: string;
}

/**
 * Produkt z searchProducts → oferta dla UI. `productId` (= `id` produktu) jest
 * TYM, co wraca do createOrderBestPrice, żeby przypiąć wybór operatora;
 * serviceCode/nazwa/logo są wyłącznie do pokazania. Cena brutto w złotych
 * przeliczana na grosze. Waluta zawężana do obsługiwanej (GlobKurier to
 * dostawca PL — nieznana wartość spada na PLN, nie wywraca formatowania kwoty).
 */
export function courierOfferFromProduct(product: GlobKurierProduct): CarrierOffer {
  const offer: CarrierOffer = {
    productId: product.id,
    carrierName: product.carrierName,
    priceGrosze: Math.round(product.priceGross * 100),
    currency: isCurrencyCode(product.currency) ? product.currency : DEFAULT_CURRENCY,
  };
  if (product.serviceCode) offer.serviceCode = product.serviceCode;
  if (product.carrierLogo) offer.carrierLogo = product.carrierLogo;
  if (typeof product.deliveryDays === "number") offer.deliveryDays = product.deliveryDays;
  if (product.deliveryTime) offer.deliveryTime = product.deliveryTime;
  return offer;
}

const PROVIDER_STATUS_MAP: Record<string, ShipmentStatus> = {
  NEW_SHIPMENT: "created",
  IN_PROGRESS: "in_progress",
  IN_TRANSIT: "in_transit",
  DELIVERED: "delivered",
  CANCELED: "cancelled",
  RETURNED_TO_SENDER: "returned_to_sender",
};

/**
 * Status dostawcy → wewnętrzny cykl życia przesyłki. Nieznany status zwraca
 * null (wewnętrzny status zostaje bez zmian, surowy trafia do
 * provider_status) — CHECK na cudzych wartościach zamieniałby dryf API
 * dostawcy w twardą awarię synchronizacji (ADR-031).
 */
export function mapProviderStatus(providerStatus: string): ShipmentStatus | null {
  return PROVIDER_STATUS_MAP[providerStatus] ?? null;
}

/**
 * Stany, z których wolno ANULOWAĆ nadaną przesyłkę (L4, ADR-105).
 *
 * Lista jest pozytywna, nie negatywna, i to jest cała jej treść: gdyby
 * powstała jako „wszystko poza dostarczonym", każdy nowy stan cyklu życia
 * wpadałby domyślnie do anulowalnych — czyli nowy stan otwierałby operację
 * kosztową, o której nikt nie zdecydował.
 *
 * Rozstrzygnięcie po mapie `mapProviderStatus`:
 *   * `created` (NEW_SHIPMENT) i `in_progress` (IN_PROGRESS) — zlecenie jest
 *     u dostawcy, paczki jeszcze nikt nie wiezie: anulowanie ma sens i skutek,
 *   * `in_transit` — paczka jest fizycznie w drodze; „anulowanie" nie zawróci
 *     kuriera, a lokalny status skłamałby o tym, gdzie jest sprzęt,
 *   * `delivered` i `returned_to_sender` — stany terminalne, nie ma czego
 *     anulować,
 *   * `cancelled` — już anulowana; drugie żądanie to koszt bez skutku.
 *
 * Nieznany status dostawcy NIE zmienia statusu wewnętrznego (ADR-031), więc
 * ta funkcja pyta wyłącznie o stan wewnętrzny — nigdy o surowy string dostawcy.
 */
const CANCELLABLE_STATUSES: readonly ShipmentStatus[] = ["created", "in_progress"];

export function isShipmentCancellable(status: ShipmentStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}
