/**
 * Parser konfiguracji kurierskiej tenanta z wierszy tenant_settings.
 *
 * FUNKCJA CZYSTA (bez I/O): zapytanie o wiersze żyje w warstwie wywołującej
 * (panel, przez RLS) — dokładnie jak silnik wynajmu (decyzja wiążąca nr 2).
 *
 * ZERO TWARDYCH FALLBACKÓW (decyzja wiążąca nr 5, ADR-030/031): pierwowzór
 * jednonajemcowy przy braku konfiguracji podstawiał stały obiekt nadawcy
 * z realnym adresem i gabarytami pod konkretny sprzęt — w systemie
 * wielotenantowym taki default to wysyłka paczek najemcy z CUDZYM adresem
 * nadawcy. Brak lub wadliwość ustawienia jest tu zawsze GŁOŚNA:
 * CourierConfigError niesie pełną listę braków, żeby operator wiedział,
 * co uzupełnić, po jednym błędzie, a nie po serii prób.
 *
 * Kształt jsonb w bazie jest snake_case (spójnie z kolumnami), typy silnika
 * camelCase — mapowanie tylko tutaj. Walidacja jest lustrem CHECK-ów
 * z migracji 0013: baza jest bramką autorytatywną, parser daje czytelny
 * komunikat zanim żądanie w ogóle wyjdzie do dostawcy.
 */
import type {
  CourierCredentials,
  CourierSender,
  DeliveryPricing,
  ParcelDimensions,
} from "./types";

export const GLOBKURIER_CREDENTIALS_KEY = "globkurier_credentials";
export const COURIER_SENDER_KEY = "courier_sender";
export const COURIER_PARCEL_KEY = "courier_parcel";
export const DELIVERY_PRICING_KEY = "delivery_pricing";

/** Klucze tenant_settings składające się na konfigurację nadania przesyłki. */
export const COURIER_CONFIG_KEYS = [
  GLOBKURIER_CREDENTIALS_KEY,
  COURIER_SENDER_KEY,
  COURIER_PARCEL_KEY,
] as const;

export interface TenantSettingRow {
  key: string;
  value: unknown;
}

export class CourierConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Konfiguracja dostaw tenanta jest niekompletna: ${problems.join("; ")}`);
    this.name = "CourierConfigError";
  }
}

export interface CourierTenantConfig {
  credentials: CourierCredentials;
  sender: CourierSender;
  parcel: ParcelDimensions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

const PAID_METHODS = ["courier", "parcel_locker", "own_delivery"] as const;

function parseCredentials(value: unknown, problems: string[]): CourierCredentials | null {
  if (!isRecord(value)) {
    problems.push(`${GLOBKURIER_CREDENTIALS_KEY}: wartość nie jest obiektem`);
    return null;
  }
  const missing: string[] = [];
  if (!nonEmptyString(value.email)) missing.push("email");
  if (!nonEmptyString(value.password)) missing.push("password");
  if (value.environment !== "test" && value.environment !== "production") {
    missing.push("environment (test|production)");
  }
  if (missing.length > 0) {
    problems.push(`${GLOBKURIER_CREDENTIALS_KEY}: brak/nieprawidłowe pola: ${missing.join(", ")}`);
    return null;
  }
  return {
    email: value.email as string,
    password: value.password as string,
    environment: value.environment as CourierCredentials["environment"],
  };
}

function parseSender(value: unknown, problems: string[]): CourierSender | null {
  if (!isRecord(value)) {
    problems.push(`${COURIER_SENDER_KEY}: wartość nie jest obiektem`);
    return null;
  }
  const required = ["name", "street", "house_number", "post_code", "city", "phone", "email"] as const;
  const missing = required.filter((field) => !nonEmptyString(value[field]));
  if (missing.length > 0) {
    problems.push(`${COURIER_SENDER_KEY}: brak/nieprawidłowe pola: ${missing.join(", ")}`);
    return null;
  }
  const sender: CourierSender = {
    name: value.name as string,
    street: value.street as string,
    houseNumber: value.house_number as string,
    postCode: value.post_code as string,
    city: value.city as string,
    phone: value.phone as string,
    email: value.email as string,
  };
  if (nonEmptyString(value.apartment_number)) {
    sender.apartmentNumber = value.apartment_number;
  }
  return sender;
}

function parseParcel(value: unknown, problems: string[]): ParcelDimensions | null {
  if (!isRecord(value)) {
    problems.push(`${COURIER_PARCEL_KEY}: wartość nie jest obiektem`);
    return null;
  }
  const required = ["length_cm", "width_cm", "height_cm", "weight_kg"] as const;
  const invalid = required.filter((field) => !positiveNumber(value[field]));
  if (invalid.length > 0) {
    problems.push(
      `${COURIER_PARCEL_KEY}: pola muszą być liczbami dodatnimi: ${invalid.join(", ")}`,
    );
    return null;
  }
  return {
    lengthCm: value.length_cm as number,
    widthCm: value.width_cm as number,
    heightCm: value.height_cm as number,
    weightKg: value.weight_kg as number,
  };
}

/**
 * Wiersze tenant_settings → konfiguracja nadania przesyłki. Zbiera WSZYSTKIE
 * braki i wady naraz i rzuca CourierConfigError — nigdy nie podstawia defaultów.
 */
export function courierConfigFromSettings(rows: TenantSettingRow[]): CourierTenantConfig {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const problems: string[] = [];

  const rawCredentials = byKey.get(GLOBKURIER_CREDENTIALS_KEY);
  const rawSender = byKey.get(COURIER_SENDER_KEY);
  const rawParcel = byKey.get(COURIER_PARCEL_KEY);

  const credentials =
    rawCredentials === undefined
      ? (problems.push(`brak ustawienia ${GLOBKURIER_CREDENTIALS_KEY}`), null)
      : parseCredentials(rawCredentials, problems);
  const sender =
    rawSender === undefined
      ? (problems.push(`brak ustawienia ${COURIER_SENDER_KEY}`), null)
      : parseSender(rawSender, problems);
  const parcel =
    rawParcel === undefined
      ? (problems.push(`brak ustawienia ${COURIER_PARCEL_KEY}`), null)
      : parseParcel(rawParcel, problems);

  if (problems.length > 0 || !credentials || !sender || !parcel) {
    throw new CourierConfigError(problems);
  }
  return { credentials, sender, parcel };
}

/**
 * Wiersze tenant_settings → cennik dostaw. Brak klucza to legalne `null`
 * (o skutkach rozstrzyga calculateDeliveryCost — tam pada czytelny błąd dla
 * metod płatnych); WADLIWY wpis natomiast jest błędem konfiguracji, nie
 * cichym pominięciem.
 */
export function deliveryPricingFromSettings(rows: TenantSettingRow[]): DeliveryPricing | null {
  const raw = rows.find((row) => row.key === DELIVERY_PRICING_KEY)?.value;
  if (raw === undefined) return null;

  const problems: string[] = [];
  if (!isRecord(raw)) {
    throw new CourierConfigError([`${DELIVERY_PRICING_KEY}: wartość nie jest obiektem`]);
  }

  const pricing: DeliveryPricing = {};
  for (const [method, entry] of Object.entries(raw)) {
    if (!(PAID_METHODS as readonly string[]).includes(method)) {
      problems.push(`${DELIVERY_PRICING_KEY}: nieznana metoda "${method}"`);
      continue;
    }
    if (!isRecord(entry)) {
      problems.push(`${DELIVERY_PRICING_KEY}: wpis metody "${method}" nie jest obiektem`);
      continue;
    }
    const price = entry.price_grosze;
    if (typeof price !== "number" || !Number.isInteger(price) || price < 0) {
      problems.push(
        `${DELIVERY_PRICING_KEY}: "${method}".price_grosze musi być całkowitą liczbą groszy >= 0`,
      );
      continue;
    }
    const parsed: { priceGrosze: number; freeAboveGrosze?: number } = { priceGrosze: price };
    if ("free_above_grosze" in entry) {
      const threshold = entry.free_above_grosze;
      if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 0) {
        problems.push(
          `${DELIVERY_PRICING_KEY}: "${method}".free_above_grosze musi być całkowitą liczbą groszy >= 0`,
        );
        continue;
      }
      parsed.freeAboveGrosze = threshold;
    }
    pricing[method as (typeof PAID_METHODS)[number]] = parsed;
  }

  if (problems.length > 0) throw new CourierConfigError(problems);
  return pricing;
}
