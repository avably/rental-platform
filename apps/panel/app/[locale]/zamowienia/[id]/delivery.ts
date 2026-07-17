/**
 * Czyste typy i helpery sekcji dostawy szczegółu zamówienia — bez dyrektyw
 * ("use server"/"use client"), importowalne z akcji, route handlera etykiety
 * i server componentu.
 */
import {
  COURIER_CONFIG_KEYS,
  CourierConfigError,
  GlobKurierAPI,
  courierConfigFromSettings,
  type CourierTenantConfig,
  type ShipmentStatus,
  type ShipmentType,
} from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Wiersz przesyłki dla UI — BEZ provider_order_hash (klucz do etykiety
 * zostaje server-side, ADR-031). */
export interface ShipmentRow {
  id: string;
  shipment_type: ShipmentType;
  status: ShipmentStatus;
  provider_order_number: string;
  provider_status: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  price_grosze: number | null;
  created_at: string;
}

export const SHIPMENT_ROW_COLUMNS =
  "id, shipment_type, status, provider_order_number, provider_status, tracking_number, tracking_url, price_grosze, created_at";

/**
 * Nadanie przesyłki ograniczone do metody 'courier': paczkomaty wymagają
 * pointId punktu (dług — ADR-031), pickup/own_delivery nie są przesyłkami.
 */
export function canCreateShipments(deliveryMethod: string): boolean {
  return deliveryMethod === "courier";
}

/**
 * Konfiguracja kurierska tenanta z bazy → klient API. Wspólne dla akcji
 * i route handlera etykiety. `configError` to komunikat DLA OPERATORA
 * (lista braków z CourierConfigError) — brak konfiguracji jest stanem
 * obsługiwanym, nie wyjątkiem ścieżki.
 */
export async function loadCourierApi(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<
  | { api: GlobKurierAPI; config: CourierTenantConfig; configError?: undefined }
  | { configError: string; api?: undefined; config?: undefined }
> {
  const { data, error } = await supabase
    .from("tenant_settings")
    .select("key, value")
    .eq("tenant_id", tenantId)
    .in("key", [...COURIER_CONFIG_KEYS]);
  if (error) {
    return { configError: `Nie udało się odczytać konfiguracji dostaw: ${error.message}` };
  }
  try {
    const config = courierConfigFromSettings(data ?? []);
    return { api: new GlobKurierAPI(config.credentials), config };
  } catch (err) {
    if (err instanceof CourierConfigError) return { configError: err.message };
    throw err;
  }
}
