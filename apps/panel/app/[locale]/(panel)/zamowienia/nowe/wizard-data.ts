/**
 * Kształty danych, którymi strona serwerowa karmi kreator zamówienia.
 *
 * Typy mieszkają OSOBNO od komponentów, bo po R3 kreator to kilka plików
 * klienckich, a strona serwerowa importuje same typy — import typu z modułu
 * `"use client"` działa, ale wciąga do grafu serwera plik, który nie ma tam
 * czego szukać.
 */
import type { DeliveryPricing } from "@avably/core";

import type { DayAvailability, ProductPricingRow } from "../pricing";

export interface WizardCustomer {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
}

export interface WizardUnit {
  unitId: string;
  unavailableFrom: string | null;
  unavailableTo: string | null;
}

export interface WizardBooked {
  unitId: string;
  startDate: string;
  endDate: string;
}

export interface WizardProduct {
  pricing: ProductPricingRow;
  name: string;
  units: WizardUnit[];
  booked: WizardBooked[];
  /** Mapa dostępności policzona SERWEROWO silnikiem (buildDayMap). */
  dayMap: DayAvailability[];
}

export interface WizardLocation {
  id: string;
  name: string;
}

export type { DeliveryPricing };
