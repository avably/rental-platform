/**
 * CEL DOSTARCZENIA zamówienia (R3, ADR-089) — dokąd fizycznie jedzie sprzęt.
 *
 * Metoda dostawy (`DeliveryMethod`) mówi CZYM, ten moduł mówi DOKĄD. Dwie
 * osie, bo dla tej samej metody cel bywa różny: kurier jedzie pod adres
 * z kartoteki albo pod jednorazowy inny, a paczkomat — do punktu przewoźnika
 * wskazanego identyfikatorem.
 *
 * Funkcje są CZYSTE i nie znają bazy: kształt struktury pilnują CHECK-i 0044,
 * a te predykaty dają tę samą odpowiedź zanim żądanie do bazy poleci — żeby
 * formularz mówił „uzupełnij kod punktu", a nie zwracał surowe 23514.
 */
import type { DeliveryMethod } from "./types";

/**
 * Dostawcy punktów odbioru. Dziś jeden — lista rośnie razem z integracjami
 * i jest lustrem CHECK-a `orders_delivery_point_provider_check` (0044).
 */
export const DELIVERY_POINT_PROVIDERS = ["inpost"] as const;
export type DeliveryPointProvider = (typeof DELIVERY_POINT_PROVIDERS)[number];

/**
 * Punkt odbioru u przewoźnika.
 *
 * `code` jest identyfikatorem, po którym punkt adresuje API dostawcy — i to on
 * jest daną wiążącą. `address` jest DLA CZŁOWIEKA (umowa, e-mail, lista
 * kompletacji) i dlatego opcjonalny: brak opisu nie może blokować nadania.
 */
export interface DeliveryPoint {
  provider: DeliveryPointProvider;
  code: string;
  address: string | null;
}

/** Metody, przy których zamówienie jedzie do PUNKTU przewoźnika. */
export function methodUsesDeliveryPoint(method: DeliveryMethod): boolean {
  return method === "parcel_locker";
}

/** Metody, przy których zamówienie jedzie POD ADRES. */
export function methodUsesDeliveryAddress(method: DeliveryMethod): boolean {
  return method === "courier" || method === "own_delivery";
}

export function isDeliveryPointProvider(value: string): value is DeliveryPointProvider {
  return (DELIVERY_POINT_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Skąd bierze się adres dostarczenia (lustro CHECK-a
 * `orders_delivery_address_shape`, 0044):
 *   • `customer` — WSKAŹNIK na kartotekę klienta; zamówienie nie trzyma kopii,
 *     więc poprawka adresu w kartotece nie zostawia za sobą drugiej prawdy,
 *   • `custom`   — MIGAWKA jednorazowego adresu tego zamówienia.
 */
export const DELIVERY_ADDRESS_SOURCES = ["customer", "custom"] as const;
export type DeliveryAddressSource = (typeof DELIVERY_ADDRESS_SOURCES)[number];

export interface DeliveryAddress {
  name: string | null;
  street: string;
  zip: string;
  city: string;
  phone: string | null;
}

/**
 * Cel dostarczenia jako JEDNA wartość — wariant zależny od metody. Dzięki
 * temu wołający nie może przypadkiem zapisać punktu i adresu naraz: takiego
 * stanu po prostu nie da się nazwać.
 */
export type DeliveryDestination =
  | { kind: "none" }
  | { kind: "point"; point: DeliveryPoint }
  | { kind: "customer" }
  | { kind: "custom"; address: DeliveryAddress };

/**
 * Rozkład celu na kolumny 0044. Jedyne miejsce, które zna nazwy kolumn —
 * akcja serwerowa woła to, zamiast składać dwadzieścia parametrów z palca.
 */
export interface DeliveryDestinationColumns {
  deliveryPointProvider: string | null;
  deliveryPointCode: string | null;
  deliveryPointAddress: string | null;
  deliveryAddressSource: string | null;
  deliveryAddressName: string | null;
  deliveryAddressStreet: string | null;
  deliveryAddressZip: string | null;
  deliveryAddressCity: string | null;
  deliveryAddressPhone: string | null;
}

const EMPTY_COLUMNS: DeliveryDestinationColumns = {
  deliveryPointProvider: null,
  deliveryPointCode: null,
  deliveryPointAddress: null,
  deliveryAddressSource: null,
  deliveryAddressName: null,
  deliveryAddressStreet: null,
  deliveryAddressZip: null,
  deliveryAddressCity: null,
  deliveryAddressPhone: null,
};

export function destinationColumns(
  destination: DeliveryDestination,
): DeliveryDestinationColumns {
  switch (destination.kind) {
    case "point":
      return {
        ...EMPTY_COLUMNS,
        deliveryPointProvider: destination.point.provider,
        deliveryPointCode: destination.point.code,
        deliveryPointAddress: destination.point.address,
      };
    case "customer":
      // WSKAŹNIK: samo źródło, zero pól adresu — kopii nie robimy (ADR-089).
      return { ...EMPTY_COLUMNS, deliveryAddressSource: "customer" };
    case "custom":
      return {
        ...EMPTY_COLUMNS,
        deliveryAddressSource: "custom",
        deliveryAddressName: destination.address.name,
        deliveryAddressStreet: destination.address.street,
        deliveryAddressZip: destination.address.zip,
        deliveryAddressCity: destination.address.city,
        deliveryAddressPhone: destination.address.phone,
      };
    case "none":
      return { ...EMPTY_COLUMNS };
  }
}

/**
 * Czy cel PASUJE do metody. Lustro bramek `orders_delivery_point_method`
 * i `orders_delivery_address_method` (0044) — te odrzucają punkt przy kurierze
 * i adres przy paczkomacie, bo taka para jest sprzecznością, a nie nadmiarem.
 */
export function destinationMatchesMethod(
  method: DeliveryMethod,
  destination: DeliveryDestination,
): boolean {
  switch (destination.kind) {
    case "point":
      return methodUsesDeliveryPoint(method);
    case "customer":
    case "custom":
      return methodUsesDeliveryAddress(method);
    case "none":
      // Odbiór osobisty adresuje `pickup_location_id` — brak celu jest tam
      // stanem POPRAWNYM, nie brakiem danych.
      return !methodUsesDeliveryPoint(method) && !methodUsesDeliveryAddress(method);
  }
}
