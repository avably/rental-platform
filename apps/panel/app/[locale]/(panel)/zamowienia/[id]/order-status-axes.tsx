import type { OrderStatus, PaymentStatus, ShipmentStatus } from "@avably/core";

import { StatusChip } from "@/lib/orders/status-chip";

/**
 * Rząd chipów statusu na szczególe zamówienia (sekcja 05 artefaktu): oś
 * zamówienia, oś płatności i — gdy zamówienie ma przesyłkę — oś wysyłki.
 *
 * Wydzielone z ekranu, żeby TRZECIA oś miała własnego strażnika: szczegół
 * jest asynchronicznym server componentem z odczytami z Supabase, więc
 * kontrakt renderu nie ma jak go wywołać. Ten komponent jest czysto
 * prezentacyjny, więc `orders-screen-contract.test.tsx` renderuje go na
 * fixture wszystkich sześciu wartości osi wysyłki.
 */
export function OrderStatusAxes({
  orderStatus,
  paymentStatus,
  shipmentStatus,
}: {
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  /** null = zamówienie bez przesyłki; oś wysyłki wtedy nie istnieje. */
  shipmentStatus: ShipmentStatus | null;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <StatusChip axis="order" value={orderStatus} />
      <StatusChip axis="payment" value={paymentStatus} />
      {shipmentStatus ? <StatusChip axis="shipment" value={shipmentStatus} /> : null}
    </div>
  );
}
