/**
 * FORMA PŁATNOŚCI zamówienia (R3, pinezka „powinna być dodana forma płatności
 * jaką płaci klient").
 *
 * Wartości są lustrem CHECK-a `orders_payment_method_check` (0029) i tego
 * samego zbioru, którym posługuje się checkout sklepu — jeden słownik dla obu
 * ścieżek zapisu, żeby „przelew" z panelu i „przelew" ze sklepu były tą samą
 * daną, a nie dwoma podobnymi napisami.
 *
 * `payment_provider` NIE jest osobnym wyborem: wywodzi się z formy (ADR-066).
 * Tu jest jedyna definicja tej reguły po stronie TypeScriptu; jej bliźniak
 * w SQL siedzi w app.public_checkout (0029) i app.create_order (0044).
 */
import type { PaymentProvider } from "../rental";

export const ORDER_PAYMENT_METHODS = ["cod", "transfer", "online"] as const;
export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

export function isOrderPaymentMethod(value: string): value is OrderPaymentMethod {
  return (ORDER_PAYMENT_METHODS as readonly string[]).includes(value);
}

/**
 * Formy rozliczane POZA systemem — pieniądze przechodzą z ręki do ręki albo
 * przez bank najemcy, a zamówienie tylko odnotowuje umowę.
 */
export const OFFLINE_PAYMENT_METHODS = ["cod", "transfer"] as const;

/**
 * Reżim rozliczenia wywiedziony z formy płatności (ADR-066).
 *
 * Brak deklaracji (`null`) daje `manual`, a nie błąd: zamówienie bez wybranej
 * formy jest poprawne (operator dopyta klienta później), a `manual` to reżim,
 * w którym nikt nie czeka na dostawcę płatności.
 */
export function paymentProviderFor(method: OrderPaymentMethod | null): PaymentProvider {
  return method === "online" ? "stripe" : "manual";
}

/**
 * Czy wybór tej formy wymaga podłączonego konta rozliczeniowego tenanta.
 *
 * Bramką ostateczną jest app.create_order (0044), która sprawdza ISTNIENIE
 * wiersza `payment_accounts` — tu chodzi o to, żeby ekran mógł powiedzieć
 * „podłącz konto" ZANIM operator wypełni cały formularz i zderzy się z 22023.
 * To nie jest ocena GOTOWOŚCI konta — tę wolno stwierdzić wyłącznie odczytem
 * u dostawcy (ADR-049).
 */
export function requiresPaymentAccount(method: OrderPaymentMethod | null): boolean {
  return method === "online";
}
