/**
 * Czyste typy i helpery sekcji dostawy szczegółu zamówienia — bez dyrektyw
 * ("use server"/"use client"), importowalne z akcji, route handlera etykiety
 * i server componentu.
 */
import {
  COURIER_CONFIG_KEYS,
  CourierConfigError,
  GLOBKURIER_PASSWORD_SECRET_KEY,
  GlobKurierAPI,
  SecretEnvelopeError,
  SecretsConfigError,
  courierConfigFromSettings,
  decryptTenantSecret,
  resolveSecretsKeyring,
  type CourierTenantConfig,
  type ShipmentStatus,
  type ShipmentType,
} from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import { courierConfigSummaryPl } from "./courier-config-copy";

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
 * Prefill jednej strony przesyłki dla modalu nadania (wszystko jako string —
 * pola formularza). Definicja żyje TU (moduł bez dyrektyw), żeby importował ją
 * i server component, i klient modalu, bez sięgania serwera do „use client".
 */
export interface PartyDefaults {
  name: string;
  street: string;
  houseNumber: string;
  apartmentNumber: string;
  postCode: string;
  city: string;
  phone: string;
  email: string;
}

interface OrderCustomerRow {
  customers: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    address_street: string | null;
    address_zip: string | null;
    address_city: string | null;
  } | null;
}

/**
 * Prefill odbiorcy z kartoteki klienta zamówienia. Numer domu/lokalu zostają
 * puste — kartoteka trzyma ulicę jednym polem, a operator uzupełni je w modalu
 * (edytowalny override). Braki to puste stringi, nie zmyślone wartości.
 */
export async function loadRecipientDefaults(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string,
): Promise<PartyDefaults> {
  const { data } = await supabase
    .from("orders")
    .select(
      "customers(full_name, email, phone, address_street, address_zip, address_city)",
    )
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();
  const customer = (data as unknown as OrderCustomerRow | null)?.customers ?? null;
  return {
    name: customer?.full_name ?? "",
    street: customer?.address_street ?? "",
    houseNumber: "",
    apartmentNumber: "",
    postCode: customer?.address_zip ?? "",
    city: customer?.address_city ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
  };
}

/**
 * Nadanie przesyłki ograniczone do metody 'courier': paczkomaty wymagają
 * pointId punktu (dług — ADR-031), pickup/own_delivery nie są przesyłkami.
 */
export function canCreateShipments(deliveryMethod: string): boolean {
  return deliveryMethod === "courier";
}

/**
 * Hasło dostawcy z public.tenant_secrets → wartość jawna (ADR-052).
 *
 * Odszyfrowanie żyje TUTAJ, na serwerze, a wynik nie opuszcza tej ścieżki:
 * idzie prosto do GlobKurierAPI i nigdzie indziej. Brak sekretu to zwykłe
 * `null` (parser zamieni je w czytelny brak konfiguracji), ale WADLIWY sekret
 * albo brak klucza szyfrującego to stan JAWNIE niedostępny — nigdy cicha
 * próba nadania z pustym hasłem.
 *
 * Komunikaty są celowo ogólne: ani szyfrogram, ani wartość jawna, ani klucz
 * nie mają prawa trafić do tekstu, który dalej ląduje na ekranie i w logach.
 */
async function loadCourierPassword(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ password: string | null } | { configError: string }> {
  const { data, error } = await supabase
    .from("tenant_secrets")
    .select("ciphertext")
    .eq("tenant_id", tenantId)
    .eq("key", GLOBKURIER_PASSWORD_SECRET_KEY)
    .maybeSingle();
  if (error) {
    return { configError: `Nie udało się odczytać sekretu dostaw: ${error.message}` };
  }
  if (!data) return { password: null };

  try {
    const keyring = resolveSecretsKeyring(process.env);
    return {
      password: decryptTenantSecret(
        data.ciphertext as string,
        { tenantId, key: GLOBKURIER_PASSWORD_SECRET_KEY },
        keyring,
      ),
    };
  } catch (err) {
    if (err instanceof SecretsConfigError) {
      return {
        configError:
          "Szyfrowanie sekretów nie jest skonfigurowane na tym środowisku — " +
          "nadanie przesyłki jest niedostępne.",
      };
    }
    if (err instanceof SecretEnvelopeError) {
      return {
        configError:
          "Zapisane hasło dostawcy jest nieczytelne — zapisz je ponownie w ustawieniach dostaw.",
      };
    }
    throw err;
  }
}

/**
 * Znacznik „hasło jest zapisane" na potrzeby WYŁĄCZNIE ekranowej oceny
 * kompletności konfiguracji. Nie jest hasłem i nigdy nie opuszcza tej ścieżki:
 * parser potrzebuje wiedzieć, CZY sekret istnieje, a nie jaki jest.
 */
const SECRET_PRESENT_MARKER = "(zapisane)";

/**
 * Kompletność konfiguracji kurierskiej DLA WIDOKU — bez odszyfrowywania.
 *
 * Sekcja dostawy pokazuje listę braków i domyślne gabaryty paczki; do żadnej
 * z tych rzeczy hasło nie jest potrzebne. Odszyfrowywanie sekretu przy KAŻDYM
 * wyrenderowaniu szczegółu zamówienia rozlewałoby wartość jawną po ścieżce,
 * która jej nie używa — dlatego pytamy bazę wyłącznie o STAN
 * (app.tenant_secret_is_set → boolean) i podstawiamy znacznik obecności.
 * Odszyfrowanie żyje w loadCourierApi, czyli tam, gdzie naprawdę nadajemy.
 */
export async function loadCourierConfigStatus(
  supabase: SupabaseClient,
  tenantId: string,
  settings: { key: string; value: unknown }[],
): Promise<CourierTenantConfig> {
  const { data: hasSecret } = await supabase
    .schema("app")
    .rpc("tenant_secret_is_set", { p_key: GLOBKURIER_PASSWORD_SECRET_KEY });
  return courierConfigFromSettings(settings, hasSecret === true ? SECRET_PRESENT_MARKER : null);
}

/**
 * Konfiguracja kurierska tenanta z bazy → klient API. Wspólne dla akcji
 * i route handlera etykiety. `configError` to komunikat DLA OPERATORA
 * (lista braków z CourierConfigError) — brak konfiguracji jest stanem
 * obsługiwanym, nie wyjątkiem ścieżki.
 *
 * Od ADR-052 konfiguracja składa się z DWÓCH źródeł: jawnej części
 * w tenant_settings i zaszyfrowanego hasła w tenant_secrets. Kontrakt portu
 * (GlobKurierAPI) jest nietknięty — zmienił się wyłącznie sposób, w jaki
 * credentiale docierają do konstruktora.
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

  const secret = await loadCourierPassword(supabase, tenantId);
  if ("configError" in secret) return { configError: secret.configError };

  try {
    const config = courierConfigFromSettings(data ?? [], secret.password);
    return { api: new GlobKurierAPI(config.credentials), config };
  } catch (err) {
    // Język najemcy zamiast nazw kluczy ustawień (U1, audyt W3): formError
    // z akcji ląduje na ekranie, więc dostaje to samo tłumaczenie na wiadra,
    // co sekcja dostawy. Surowa lista problemów zostaje w wyjątku silnika.
    if (err instanceof CourierConfigError) {
      return { configError: courierConfigSummaryPl(err.problems) };
    }
    throw err;
  }
}
