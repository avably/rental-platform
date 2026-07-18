/**
 * Model koszyka storefrontu — CZYSTE funkcje nad stanem klienta (localStorage
 * to warstwa transportu, patrz lib/cart/storage.ts). Rdzeń jest tu, żeby dało
 * się go testować bez przeglądarki (wzorzec lib/waitlist-form-ui.ts).
 *
 * KONTRAKT AGREGACJI (ADR-042, backend 2.4a): jedna linia per produkt. Druga
 * pozycja tego samego produktu w wejściu public_checkout jest ODRZUCANA przez
 * bazę ('Produkt powtórzony w zamówieniu.'), bo nie wiedziałaby o egzemplarzach
 * zajętych przez pierwszą. Dlatego koszyk SUMUJE sztuki tego samego produktu w
 * jedną pozycję {product_id, quantity} — i tu, i przy każdym odczycie ze
 * storage (dane mogły zostać ręcznie podmienione).
 *
 * WSPÓLNY TERMIN (MVP, jak model orders): jeden zakres dat na całe zamówienie,
 * nie per pozycja. Zakres INCLUSIVE, walidacja end >= start.
 */
import type { CheckoutItemInput } from "@/lib/checkout/contract";

/** Górny limit ilości per produkt — lustro walidacji 2.4a (items[].quantity max 100). */
export const MAX_QUANTITY_PER_PRODUCT = 100;

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface CartState {
  items: CartLine[];
  /** ISO YYYY-MM-DD; null = termin nie wybrany. Wspólny dla całego zamówienia. */
  startDate: string | null;
  endDate: string | null;
}

export const EMPTY_CART: CartState = { items: [], startDate: null, endDate: null };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  const whole = Math.floor(quantity);
  if (whole < 0) return 0;
  if (whole > MAX_QUANTITY_PER_PRODUCT) return MAX_QUANTITY_PER_PRODUCT;
  return whole;
}

function normalizeDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

/**
 * Sprowadza dowolny (także ręcznie podmieniony w storage) stan do kanonicznego:
 * jedna linia per produkt z sumą sztuk, ilości w zakresie 1..MAX, daty w formacie
 * ISO albo null. Kolejność pierwszego wystąpienia produktu zachowana.
 */
export function normalizeCart(input: unknown): CartState {
  const raw = (input ?? {}) as Partial<CartState>;
  const order: string[] = [];
  const totals = new Map<string, number>();

  if (Array.isArray(raw.items)) {
    for (const line of raw.items) {
      const productId = typeof line?.productId === "string" ? line.productId.trim() : "";
      if (!productId) continue;
      const quantity = clampQuantity(Number(line?.quantity));
      if (quantity === 0) continue;
      if (!totals.has(productId)) order.push(productId);
      totals.set(productId, clampQuantity((totals.get(productId) ?? 0) + quantity));
    }
  }

  return {
    items: order.map((productId) => ({ productId, quantity: totals.get(productId) ?? 0 })),
    startDate: normalizeDate(raw.startDate),
    endDate: normalizeDate(raw.endDate),
  };
}

/**
 * Dokłada `quantity` sztuk produktu. Istniejąca linia rośnie (agregacja), nowy
 * produkt dostaje własną linię na końcu. Suma jest przycinana do MAX.
 */
export function addToCart(state: CartState, productId: string, quantity = 1): CartState {
  const add = clampQuantity(quantity);
  if (!productId || add === 0) return normalizeCart(state);
  const base = normalizeCart(state);
  const existing = base.items.find((line) => line.productId === productId);
  const items = existing
    ? base.items.map((line) =>
        line.productId === productId
          ? { ...line, quantity: clampQuantity(line.quantity + add) }
          : line,
      )
    : [...base.items, { productId, quantity: add }];
  return { ...base, items };
}

/** Ustawia ilość produktu wprost; 0 (lub mniej) usuwa linię. */
export function setQuantity(state: CartState, productId: string, quantity: number): CartState {
  const next = clampQuantity(quantity);
  const base = normalizeCart(state);
  if (next === 0) return removeFromCart(base, productId);
  const has = base.items.some((line) => line.productId === productId);
  const items = has
    ? base.items.map((line) => (line.productId === productId ? { ...line, quantity: next } : line))
    : [...base.items, { productId, quantity: next }];
  return { ...base, items };
}

export function removeFromCart(state: CartState, productId: string): CartState {
  const base = normalizeCart(state);
  return { ...base, items: base.items.filter((line) => line.productId !== productId) };
}

export function setCartDates(
  state: CartState,
  startDate: string | null,
  endDate: string | null,
): CartState {
  const base = normalizeCart(state);
  return { ...base, startDate: normalizeDate(startDate), endDate: normalizeDate(endDate) };
}

export function clearCart(): CartState {
  return { ...EMPTY_CART, items: [] };
}

/** Łączna liczba sztuk (badge w nagłówku). */
export function cartItemCount(state: CartState): number {
  return normalizeCart(state).items.reduce((sum, line) => sum + line.quantity, 0);
}

export function isCartEmpty(state: CartState): boolean {
  return normalizeCart(state).items.length === 0;
}

/** Zakres dat kompletny i nieodwrócony (INCLUSIVE) — lustro walidacji 2.4a. */
export function hasValidDateRange(state: CartState): boolean {
  const { startDate, endDate } = normalizeCart(state);
  return startDate !== null && endDate !== null && endDate >= startDate;
}

/** Koszyk gotowy do checkoutu: co najmniej jedna pozycja + poprawny termin. */
export function isCheckoutReady(state: CartState): boolean {
  return !isCartEmpty(state) && hasValidDateRange(state);
}

/** Pozycje w kształcie wejścia public_checkout (już zagregowane). */
export function toCheckoutItems(state: CartState): CheckoutItemInput[] {
  return normalizeCart(state).items.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
  }));
}
