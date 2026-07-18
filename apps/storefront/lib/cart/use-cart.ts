"use client";

/**
 * Hook koszyka: koszyk to ZEWNĘTRZNY store (localStorage), więc czytamy go przez
 * useSyncExternalStore — idiom Reacta dla źródeł spoza drzewa (bez setState w
 * efekcie, bez rozjazdu SSR↔klient). `getCartSnapshot` zwraca stabilną
 * referencję między zmianami; `subscribeCart` powiadamia o zapisach (ta i inne
 * karty). Migawka serwerowa/przed hydratacją to pusty koszyk.
 *
 * `hydrated` (osobny store: false na serwerze/przy hydratacji, true potem)
 * pozwala ukryć badge/treść, dopóki realny koszyk nie jest znany.
 */
import { useCallback, useSyncExternalStore } from "react";

import {
  addToCart,
  clearCart,
  removeFromCart,
  setCartDates,
  setQuantity,
  type CartState,
} from "./model";
import {
  getCartSnapshot,
  getServerCartSnapshot,
  readCart,
  subscribeCart,
  writeCart,
} from "./storage";

export interface UseCart {
  cart: CartState;
  /** true dopiero po hydratacji — steruje ukryciem migotania badge/treści. */
  hydrated: boolean;
  add: (productId: string, quantity?: number) => void;
  setQty: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  setDates: (startDate: string | null, endDate: string | null) => void;
  clear: () => void;
}

const noopSubscribe = () => () => {};

export function useCart(): UseCart {
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot);
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  // Mutatory: policz nowy stan (czysty model) na bazie ŚWIEŻEGO odczytu →
  // zapisz. Zapis powiadamia subskrybentów, więc useSyncExternalStore odświeży
  // migawkę — bez ręcznego setState.
  const add = useCallback(
    (productId: string, quantity = 1) => writeCart(addToCart(readCart(), productId, quantity)),
    [],
  );
  const setQty = useCallback(
    (productId: string, quantity: number) => writeCart(setQuantity(readCart(), productId, quantity)),
    [],
  );
  const remove = useCallback((productId: string) => writeCart(removeFromCart(readCart(), productId)), []);
  const setDates = useCallback(
    (startDate: string | null, endDate: string | null) =>
      writeCart(setCartDates(readCart(), startDate, endDate)),
    [],
  );
  const clear = useCallback(() => writeCart(clearCart()), []);

  return { cart, hydrated, add, setQty, remove, setDates, clear };
}
