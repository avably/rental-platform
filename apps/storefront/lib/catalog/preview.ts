/**
 * PODGLĄD kwot koszyka/checkoutu (2.4b) — liczony po stronie klienta silnikiem
 * @avably/core (calculatePrice), żeby kupujący widział szacunek na żywo przy
 * zmianie terminu/ilości/dostawy.
 *
 * TO JEST WYŁĄCZNIE PODGLĄD. Kwota WIĄŻĄCA pochodzi z odpowiedzi serwera
 * (CheckoutResult.order z app.public_checkout) — klient nie ma parametru ceny i
 * nie może jej zaniżyć (oś bezpieczeństwa ADR-042). Ekran potwierdzenia
 * pokazuje kwoty z serwera, nie ten podgląd; rozbieżność (np. próg dostawy tuż
 * przy granicy) rozstrzyga serwer.
 */
import { calculatePrice } from "@avably/core";

import type {
  CheckoutDeliveryMethod,
  PublicCatalogProduct,
  PublicDeliveryMethod,
} from "@/lib/checkout/contract";
import type { CartLine } from "@/lib/cart/model";

import { toPriceParams } from "./present";

export interface PreviewTotals {
  rentalGrosze: number;
  depositGrosze: number;
  deliveryGrosze: number;
  totalGrosze: number;
  /** Pozycje bez odpowiadającego produktu w katalogu (nieaktywny/usunięty). */
  missingProductIds: string[];
}

export interface PreviewInput {
  items: CartLine[];
  products: PublicCatalogProduct[];
  startDate: string;
  endDate: string;
  deliveryMethod: CheckoutDeliveryMethod | null;
  deliveryMethods: PublicDeliveryMethod[];
}

/** Koszt dostawy metody z publicznego cennika (lustro calculateDeliveryCost). */
export function previewDeliveryGrosze(
  method: CheckoutDeliveryMethod | null,
  deliveryMethods: PublicDeliveryMethod[],
  rentalTotalGrosze: number,
): number {
  if (method === null || method === "pickup") return 0;
  const entry = deliveryMethods.find((m) => m.method === method);
  if (!entry) return 0;
  // Próg darmowej dostawy INCLUSIVE (== próg = darmowa).
  if (
    entry.free_above_grosze !== null &&
    entry.free_above_grosze !== undefined &&
    rentalTotalGrosze >= entry.free_above_grosze
  ) {
    return 0;
  }
  return entry.price_grosze;
}

/**
 * Szacunkowe kwoty koszyka dla wybranego terminu. Najem i kaucja sumują się po
 * pozycjach (ilość × wycena sztuki), dostawa dolicza się po najmie. Zwraca zera
 * przy niepełnym/odwróconym terminie — podgląd nie zgaduje.
 */
export function previewTotals(input: PreviewInput): PreviewTotals {
  const empty: PreviewTotals = {
    rentalGrosze: 0,
    depositGrosze: 0,
    deliveryGrosze: 0,
    totalGrosze: 0,
    missingProductIds: [],
  };
  if (!input.startDate || !input.endDate || input.endDate < input.startDate) return empty;

  const byId = new Map(input.products.map((product) => [product.id, product]));
  let rentalGrosze = 0;
  let depositGrosze = 0;
  const missingProductIds: string[] = [];

  for (const line of input.items) {
    const product = byId.get(line.productId);
    if (!product) {
      missingProductIds.push(line.productId);
      continue;
    }
    const price = calculatePrice(input.startDate, input.endDate, toPriceParams(product));
    rentalGrosze += price.rentalGrosze * line.quantity;
    depositGrosze += price.depositGrosze * line.quantity;
  }

  const deliveryGrosze = previewDeliveryGrosze(
    input.deliveryMethod,
    input.deliveryMethods,
    rentalGrosze,
  );

  return {
    rentalGrosze,
    depositGrosze,
    deliveryGrosze,
    totalGrosze: rentalGrosze + depositGrosze + deliveryGrosze,
    missingProductIds,
  };
}
