/**
 * Testy modelu koszyka (apps/storefront/lib/cart/model.ts). Rdzeń jest czysty,
 * więc nie potrzebuje localStorage ani przeglądarki.
 *
 * Bramka kontraktu (ADR-042): AGREGACJA — ten sam produkt dodany wielokrotnie
 * daje JEDNĄ pozycję z sumą sztuk. Druga linia tego samego produktu jest w
 * public_checkout błędem, więc koszyk nie ma prawa jej wyprodukować.
 */
import { describe, expect, it } from "vitest";

import {
  EMPTY_CART,
  MAX_QUANTITY_PER_PRODUCT,
  addToCart,
  cartItemCount,
  hasValidDateRange,
  isCheckoutReady,
  normalizeCart,
  removeFromCart,
  setCartDates,
  setQuantity,
  toCheckoutItems,
} from "@/lib/cart/model";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("agregacja: jedna pozycja per produkt", () => {
  it("dodanie tego samego produktu dwa razy sumuje sztuki w JEDNEJ linii", () => {
    let cart = addToCart(EMPTY_CART, A, 1);
    cart = addToCart(cart, A, 2);
    expect(cart.items).toEqual([{ productId: A, quantity: 3 }]);
  });

  it("różne produkty to osobne linie w kolejności pierwszego dodania", () => {
    let cart = addToCart(EMPTY_CART, B, 1);
    cart = addToCart(cart, A, 1);
    cart = addToCart(cart, B, 4);
    expect(cart.items).toEqual([
      { productId: B, quantity: 5 },
      { productId: A, quantity: 1 },
    ]);
  });

  it("normalizacja skleja zduplikowane linie z podmienionego storage w jedną", () => {
    const tampered = {
      items: [
        { productId: A, quantity: 2 },
        { productId: A, quantity: 3 },
        { productId: B, quantity: 1 },
      ],
      startDate: null,
      endDate: null,
    };
    expect(normalizeCart(tampered).items).toEqual([
      { productId: A, quantity: 5 },
      { productId: B, quantity: 1 },
    ]);
  });

  it("toCheckoutItems oddaje zagregowane pozycje bez duplikatów produktu", () => {
    let cart = addToCart(EMPTY_CART, A, 1);
    cart = addToCart(cart, A, 1);
    cart = addToCart(cart, B, 2);
    const items = toCheckoutItems(cart);
    const ids = items.map((i) => i.productId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(items).toEqual([
      { productId: A, quantity: 2 },
      { productId: B, quantity: 2 },
    ]);
  });
});

describe("ilości i limity", () => {
  it("przycina sumę do MAX_QUANTITY_PER_PRODUCT", () => {
    const cart = addToCart(EMPTY_CART, A, MAX_QUANTITY_PER_PRODUCT + 50);
    expect(cart.items).toEqual([{ productId: A, quantity: MAX_QUANTITY_PER_PRODUCT }]);
  });

  it("setQuantity(0) usuwa pozycję", () => {
    let cart = addToCart(EMPTY_CART, A, 3);
    cart = setQuantity(cart, A, 0);
    expect(cart.items).toEqual([]);
  });

  it("removeFromCart usuwa właściwą linię", () => {
    let cart = addToCart(addToCart(EMPTY_CART, A, 1), B, 1);
    cart = removeFromCart(cart, A);
    expect(cart.items).toEqual([{ productId: B, quantity: 1 }]);
  });

  it("cartItemCount sumuje sztuki wszystkich linii", () => {
    let cart = addToCart(EMPTY_CART, A, 2);
    cart = addToCart(cart, B, 3);
    expect(cartItemCount(cart)).toBe(5);
  });

  it("odrzuca śmieciowe ilości (ujemne, ułamki, NaN)", () => {
    const cart = normalizeCart({
      items: [
        { productId: A, quantity: -5 },
        { productId: B, quantity: 2.9 },
      ],
      startDate: null,
      endDate: null,
    });
    // A odpada (0 po przycięciu), B ścina się do 2.
    expect(cart.items).toEqual([{ productId: B, quantity: 2 }]);
  });
});

describe("termin najmu (wspólny, INCLUSIVE)", () => {
  it("akceptuje poprawny zakres i odrzuca odwrócony", () => {
    expect(hasValidDateRange(setCartDates(EMPTY_CART, "2026-10-01", "2026-10-05"))).toBe(true);
    expect(hasValidDateRange(setCartDates(EMPTY_CART, "2026-10-05", "2026-10-01"))).toBe(false);
    // Zakres jednodniowy (start == end) jest poprawny (INCLUSIVE).
    expect(hasValidDateRange(setCartDates(EMPTY_CART, "2026-10-01", "2026-10-01"))).toBe(true);
  });

  it("odrzuca daty w złym formacie", () => {
    const cart = setCartDates(EMPTY_CART, "01-10-2026", "2026-10-05");
    expect(cart.startDate).toBeNull();
  });

  it("isCheckoutReady wymaga pozycji I poprawnego terminu", () => {
    const withDates = setCartDates(EMPTY_CART, "2026-10-01", "2026-10-05");
    expect(isCheckoutReady(withDates)).toBe(false); // brak pozycji
    const withItems = addToCart(EMPTY_CART, A, 1);
    expect(isCheckoutReady(withItems)).toBe(false); // brak terminu
    expect(isCheckoutReady(setCartDates(withItems, "2026-10-01", "2026-10-05"))).toBe(true);
  });
});
