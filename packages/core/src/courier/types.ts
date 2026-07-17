/**
 * Typy klienta GlobKurier oraz konfiguracji kurierskiej tenanta.
 *
 * Port typów API 1:1 z jednonajemcowego pierwowzoru, z trzema świadomymi
 * odstępstwami (ADR-031):
 *   * BEZ stałych gabarytów paczek i danych nadawcy w kodzie — twarde wartości
 *     pod konkretny sprzęt i konkretny adres to udokumentowany anty-wzorzec
 *     (decyzja wiążąca nr 5 planu fazy 1); źródłem jest wyłącznie konfiguracja
 *     tenanta (tenant_settings, patrz tenant-config.ts),
 *   * środowisko API (test/production) jest częścią credentiali TENANTA,
 *     nie pochodną NODE_ENV procesu,
 *   * typy konfiguracji tenanta (CourierCredentials, CourierSender,
 *     ParcelDimensions, DeliveryPricing) zdefiniowane tutaj jako kontrakt
 *     między silnikiem a panelem.
 */

export type GlobKurierEnvironment = "production" | "test";

export interface GlobKurierAuth {
  token: string;
  expiresAt: number;
}

// --- Adresy ---

export interface GlobKurierAddress {
  name: string;
  city: string;
  street: string;
  houseNumber: string;
  apartmentNumber?: string;
  postCode: string;
  countryId: number; // 1 = Polska
  pointId?: string; // identyfikator punktu (np. paczkomatu)
  phone: string;
  email: string;
  contactPerson?: string;
}

/** Adres endpointu bestPrice — kod kraju zamiast countryId. */
export interface GlobKurierBestPriceAddress {
  name: string;
  city: string;
  street: string;
  houseNumber: string;
  apartmentNumber?: string;
  postCode: string;
  country: string; // 'PL'
  pointId?: string;
  phone: string;
  email: string;
  contactPerson?: string;
}

// --- Przesyłka ---

export interface GlobKurierShipment {
  length: number; // cm
  width: number; // cm
  height: number; // cm
  weight: number; // kg
  quantity: number;
  productId: number; // identyfikator produktu przewoźnika
}

export interface GlobKurierAddon {
  id: number;
  value?: number;
  bankAccountNumber?: string;
  name?: string;
  addressLine1?: string;
  swiftCode?: string;
}

export interface GlobKurierAgreements {
  receiveElectronicBills: boolean;
  processingPersonalData: boolean;
}

export type GlobKurierCollectionType = "PICKUP" | "POINT" | "CROSSBORDER";

export type GlobKurierPurpose =
  | "SOLD"
  | "GIFT"
  | "SAMPLE"
  | "NOT_SOLD"
  | "PERSONAL_EFFECTS"
  | "REPAIR_AND_RETURN";

export type GlobKurierOrderStatus =
  | "NEW_SHIPMENT"
  | "IN_PROGRESS"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELED"
  | "RETURNED_TO_SENDER";

// --- Żądania ---

export interface GlobKurierCreateOrderRequest {
  shipment: GlobKurierShipment;
  senderAddress: GlobKurierAddress;
  receiverAddress: GlobKurierAddress;
  content: string;
  paymentId: number; // patrz PAYMENT_IDS w config.ts
  agreements: GlobKurierAgreements;
  addons?: GlobKurierAddon[];
  purpose?: GlobKurierPurpose;
  collectionType: GlobKurierCollectionType;
  referenceNumber?: string;
}

/** Dodatki bestPrice — kluczowane kategorią, nie liczbowym id. */
export interface GlobKurierBestPriceAddons {
  INSURANCE?: { value: number };
  CASH_ON_DELIVERY?: { value: number; bankAccountNumber?: string };
  [key: string]: { value?: number; [k: string]: unknown } | undefined;
}

export interface GlobKurierBestPriceRequest {
  shipment: {
    length: number;
    width: number;
    height: number;
    weight: number;
    quantity: number;
    integrationName?: string;
    productId?: number;
  };
  senderAddress: GlobKurierBestPriceAddress;
  receiverAddress: GlobKurierBestPriceAddress;
  content: string;
  paymentId: number;
  agreements: GlobKurierAgreements;
  addons?: GlobKurierBestPriceAddons;
  purpose?: GlobKurierPurpose;
  collectionType: GlobKurierCollectionType;
  deliveryType: GlobKurierCollectionType;
  referenceNumber?: string;
  receiverType?: "COMPANY" | "PRIVATE_PERSON";
}

export interface GlobKurierSearchProductsRequest {
  senderPostCode: string;
  senderCountryId: number;
  receiverPostCode: string;
  receiverCountryId: number;
  length: number;
  width: number;
  height: number;
  weight: number;
  collectionType?: GlobKurierCollectionType;
}

// --- Odpowiedzi ---

export interface GlobKurierProduct {
  id: number;
  name: string;
  carrierName: string;
  carrierLogo?: string;
  priceGross: number;
  priceNet: number;
  currency: string;
  deliveryTime?: string;
  deliveryDays?: number;
  collectionType: GlobKurierCollectionType;
  additionalInfo?: string;
  serviceCode?: string;
  addons?: {
    id: number;
    name: string;
    priceGross: number;
    priceNet: number;
    required: boolean;
  }[];
  addonsCategories?: unknown;
}

export interface GlobKurierOrderResponse {
  number: string; // np. GK240610123456
  hash?: string; // hash zamówienia do pobrania etykiety
  status: GlobKurierOrderStatus;
  creationDate: string;
  pricing: {
    priceGross: number;
    priceNet: number;
    vatPercent: number;
    currency: string;
  };
  trackingNumber?: string;
  trackingUrl?: string;
}

export interface GlobKurierLabelResponse {
  type: "WAYBILL" | "PROTOCOL";
  format: "PDF" | "ZPL";
  content: string; // base64
}

export interface GlobKurierErrorResponse {
  code: string;
  message: string;
  details?: Record<string, string[]>;
  fields?: Record<string, string>;
}

// --- Konfiguracja kurierska tenanta (kontrakt silnik ↔ panel) ---

export interface CourierCredentials {
  email: string;
  password: string;
  environment: GlobKurierEnvironment;
}

/** Nadawca tenanta — w tenant_settings pod kluczem courier_sender (snake_case). */
export interface CourierSender {
  name: string;
  street: string;
  houseNumber: string;
  apartmentNumber?: string;
  postCode: string;
  city: string;
  phone: string;
  email: string;
}

/** Domyślne gabaryty paczki tenanta — klucz courier_parcel. */
export interface ParcelDimensions {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}

export type PaidDeliveryMethod = "courier" | "parcel_locker" | "own_delivery";

export type DeliveryMethod = "pickup" | PaidDeliveryMethod;

export interface DeliveryMethodPricing {
  priceGrosze: number;
  /** Próg darmowej dostawy (inclusive). Brak pola = brak progu. */
  freeAboveGrosze?: number;
}

/** Cennik dostaw tenanta — klucz delivery_pricing. `pickup` zawsze 0 i nie występuje. */
export type DeliveryPricing = Partial<Record<PaidDeliveryMethod, DeliveryMethodPricing>>;

export type ShipmentType = "outbound" | "return";

/** Wewnętrzny cykl życia przesyłki (kolumna courier_shipments.status, ADR-031). */
export type ShipmentStatus =
  | "created"
  | "in_progress"
  | "in_transit"
  | "delivered"
  | "cancelled"
  | "returned_to_sender";
