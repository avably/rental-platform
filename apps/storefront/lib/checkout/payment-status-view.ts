/**
 * Co strona powrotu z płatności ma prawo powiedzieć (Z3, ADR-066) — czysta
 * funkcja, żeby ta reguła miała test, a nie żyła w drzewie JSX.
 *
 * REGUŁA JEDYNA I NIENARUSZALNA: słowo „opłacone" pada WYŁĄCZNIE wtedy, gdy
 * `payment_status` z NASZEJ bazy jest równe `paid`. W Z3 nie ma ścieżki, która
 * ten status ustawia — pisze go dopiero webhook (Z4) po odczycie u dostawcy.
 * Dopóki go nie napisze, klient widzi „sprawdzamy płatność", i to jest
 * komunikat PRAWDZIWY, a nie tymczasowy.
 *
 * Odczyt u dostawcy (`readPaymentIntent`) wolno tej stronie wykonać i wolno
 * jej pokazać, co z niego wyszło — ale jako informację o tym, co widzi
 * DOSTAWCA, nigdy jako podstawę zdania o naszym zamówieniu. Stąd osobne pole
 * `providerSettled` zamiast wmieszania go w werdykt.
 */

export type PaymentStatusView =
  /** Baza mówi `paid` — jedyny stan, w którym mówimy „opłacone". */
  | { kind: "paid" }
  /** Płatność w toku: wysłana do dostawcy, u nas jeszcze nie zaksięgowana. */
  | { kind: "checking"; providerSettled: boolean }
  /** Próba nieudana — zamówienie żyje, klient może ponowić. */
  | { kind: "failed" }
  /** Obieg offline: rozliczenie z wypożyczalnią, nic tu nie sprawdzamy. */
  | { kind: "offline" }
  /** Zamówienie anulowane albo zwrócone — poza cyklem płatności. */
  | { kind: "closed" };

export interface PaymentStatusInput {
  /** Z NASZEJ bazy (app.get_public_order_payment). */
  paymentStatus: string;
  paymentProvider: string;
  /**
   * Wynik ODCZYTU u dostawcy — opcjonalny (odczyt mógł się nie udać albo nie
   * być potrzebny). Nigdy nie zmienia werdyktu; zmienia tylko to, jak
   * szczegółowo tłumaczymy klientowi „w toku".
   */
  providerSettled?: boolean | undefined;
}

export function paymentStatusView(input: PaymentStatusInput): PaymentStatusView {
  if (input.paymentProvider !== "stripe") return { kind: "offline" };

  switch (input.paymentStatus) {
    case "paid":
    case "deposit_refunded":
      return { kind: "paid" };
    case "payment_failed":
      return { kind: "failed" };
    case "refunded":
    case "cancelled":
      return { kind: "closed" };
    default:
      // `unpaid` i `pending` znaczą tu to samo dla klienta: pieniądze mogły
      // wyjść z jego konta, a u nas jeszcze ich nie ma. Rozróżnianie tych
      // dwóch stanów na ekranie nie dałoby mu nic poza wrażeniem, że coś
      // poszło nie tak.
      return { kind: "checking", providerSettled: input.providerSettled === true };
  }
}
