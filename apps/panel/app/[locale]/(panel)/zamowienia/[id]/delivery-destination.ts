/**
 * Cel dostarczenia ZAMÓWIENIA jako czysta funkcja (U3, audyt 2.5: „zamówienie
 * kurierskie nie pokazuje adresu dostawy").
 *
 * Kolumny 0044 (ADR-089) niosą wskaźnik ALBO migawkę:
 *   - `delivery_address_source='customer'` → adresem jest KARTOTEKA klienta
 *     (pola adresu zamówienia są puste z konstrukcji — CHECK
 *     `orders_delivery_address_shape`),
 *   - `delivery_address_source='custom'` → jednorazowa migawka tego zamówienia
 *     (ulica+kod+miasto wymagane tym samym CHECK-iem),
 *   - `delivery_point_*` → punkt przewoźnika (paczkomat),
 *   - wszystko NULL → metoda nie jedzie pod adres (odbiór osobisty) ALBO
 *     zamówienie sprzed 0044 — wtedy adresu NIE zgadujemy.
 *
 * Funkcja jest czysta i bez i18n, żeby kontrakt renderu mógł ją przejść na
 * fixture wszystkich wariantów bez Supabase (wzorzec deriveOrderTimeline).
 */

export interface DeliveryDestinationColumns {
  delivery_point_provider: string | null;
  delivery_point_code: string | null;
  delivery_point_address: string | null;
  delivery_address_source: string | null;
  delivery_address_name: string | null;
  delivery_address_street: string | null;
  delivery_address_zip: string | null;
  delivery_address_city: string | null;
  delivery_address_phone: string | null;
}

export interface CustomerAddressColumns {
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
}

export type OrderDeliveryDestination =
  | {
      kind: "custom";
      name: string | null;
      street: string;
      zip: string;
      city: string;
      phone: string | null;
    }
  | {
      /** Adres z kartoteki klienta — migawki nie ma, pokazujemy wskazywane pola. */
      kind: "customer";
      street: string | null;
      zip: string | null;
      city: string | null;
    }
  | { kind: "point"; code: string; address: string | null }
  | null;

/** „Ulica 1, 00-000 Miasto” z pól, które są — bez zlepiania pustych ogonów. */
export function formatAddressLine(
  street: string | null,
  zip: string | null,
  city: string | null,
): string | null {
  const town = [zip, city].filter(Boolean).join(" ");
  const parts = [street, town].filter((part) => part && part.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function orderDeliveryDestination(
  order: DeliveryDestinationColumns,
  customer: CustomerAddressColumns | null,
): OrderDeliveryDestination {
  // Punkt przewoźnika ma pierwszeństwo formalne: CHECK-i 0044 gwarantują, że
  // punkt i adres nie występują naraz (punkt tylko przy parcel_locker, adres
  // tylko przy courier/own_delivery) — kolejność gałęzi niczego nie ukrywa.
  if (order.delivery_point_provider && order.delivery_point_code) {
    return { kind: "point", code: order.delivery_point_code, address: order.delivery_point_address };
  }

  if (order.delivery_address_source === "custom") {
    // CHECK `orders_delivery_address_shape` wymusza komplet ulica+kod+miasto;
    // wiersz bez kompletu jest spoza kontraktu bazy — nie maskujemy go.
    if (!order.delivery_address_street || !order.delivery_address_zip || !order.delivery_address_city) {
      return null;
    }
    return {
      kind: "custom",
      name: order.delivery_address_name,
      street: order.delivery_address_street,
      zip: order.delivery_address_zip,
      city: order.delivery_address_city,
      phone: order.delivery_address_phone,
    };
  }

  if (order.delivery_address_source === "customer") {
    return {
      kind: "customer",
      street: customer?.address_street ?? null,
      zip: customer?.address_zip ?? null,
      city: customer?.address_city ?? null,
    };
  }

  return null;
}
