import { describe, expect, it } from "vitest";

import {
  ORDER_PAYMENT_METHODS,
  isOrderPaymentMethod,
  paymentProviderFor,
  requiresPaymentAccount,
} from "./payment-method";

describe("forma płatności zamówienia", () => {
  it("słownik to dokładnie trzy formy — lustro CHECK-a orders_payment_method_check", () => {
    expect([...ORDER_PAYMENT_METHODS]).toEqual(["cod", "transfer", "online"]);
  });

  it("wartość spoza słownika nie przechodzi", () => {
    expect(isOrderPaymentMethod("transfer")).toBe(true);
    expect(isOrderPaymentMethod("blik")).toBe(false);
    expect(isOrderPaymentMethod("karta")).toBe(false);
    expect(isOrderPaymentMethod("")).toBe(false);
  });

  it("tylko płatność online wchodzi w reżim dostawcy — reszta rozlicza się ręcznie", () => {
    expect(paymentProviderFor("online")).toBe("stripe");
    expect(paymentProviderFor("transfer")).toBe("manual");
    expect(paymentProviderFor("cod")).toBe("manual");
  });

  it("brak deklaracji formy daje reżim ręczny, a nie błąd — zamówienie bez formy jest poprawne", () => {
    expect(paymentProviderFor(null)).toBe("manual");
  });

  it("konta rozliczeniowego wymaga wyłącznie płatność online", () => {
    expect(requiresPaymentAccount("online")).toBe(true);
    expect(requiresPaymentAccount("transfer")).toBe(false);
    expect(requiresPaymentAccount("cod")).toBe(false);
    expect(requiresPaymentAccount(null)).toBe(false);
  });
});
