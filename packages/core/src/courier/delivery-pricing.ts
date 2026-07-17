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
