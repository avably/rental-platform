/**
 * Trwałość koszyka po stronie klienta (2.4b).
 *
 * DECYZJA: localStorage, nie cookie. Uzasadnienie:
 *  - Koszyk to WYŁĄCZNIE stan prezentacji klienta — serwer nie potrzebuje go
 *    przed złożeniem zamówienia (submitCheckout dostaje pozycje w payloadzie,
 *    tenant z nagłówka). Cookie dokładałby koszyk do KAŻDEGO żądania (strony,
 *    zdjęcia, RPC) bez powodu.
 *  - Strony sklepu renderują się serwerowo BEZ koszyka (katalog/produkt/checkout
 *    nie zależą od jego zawartości przy SSR), więc nie ma po co wysyłać go na
 *    serwer — odczyt następuje po hydratacji.
 *  - Izolacja jest naturalna: localStorage jest per-origin, a każdy tenant ma
 *    własną subdomenę (slug.avably.io) → koszyki tenantów się nie mieszają.
 *  - Pojemność i brak wpływu na nagłówki HTTP (cookie 4 KB vs localStorage MB).
 *
 * Zapis przechodzi przez normalizeCart, więc ręczna podmiana w devtools nie
 * wprowadzi stanu spoza kontraktu (duplikaty produktu, złe ilości/daty).
 */
import { EMPTY_CART, normalizeCart, type CartState } from "./model";

const STORAGE_KEY = "avably.cart.v1";
/** Zdarzenie same-tab (storage event leci tylko do INNYCH kart tej samej origin). */
const CART_EVENT = "avably:cart";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseRaw(raw: string | null): CartState {
  if (!raw) return EMPTY_CART;
  try {
    return normalizeCart(JSON.parse(raw));
  } catch {
    // Zepsuty JSON / zablokowany storage → pusty koszyk (fail-safe, nie wywala).
    return EMPTY_CART;
  }
}

export function readCart(): CartState {
  if (!isBrowser()) return EMPTY_CART;
  return parseRaw(readRaw());
}

// Cache migawki dla useSyncExternalStore: getSnapshot MUSI zwracać STABILNĄ
// referencję, dopóki dane się nie zmieniły — inaczej React wpada w pętlę
// renderów. Klucz cache to surowy string z localStorage; zmiana (zapis w tej
// lub innej karcie) unieważnia cache przy kolejnym odczycie.
let snapshotRaw: string | null = null;
let snapshotValue: CartState = EMPTY_CART;
let snapshotInit = false;

export function getCartSnapshot(): CartState {
  if (!isBrowser()) return EMPTY_CART;
  const raw = readRaw();
  if (snapshotInit && raw === snapshotRaw) return snapshotValue;
  snapshotInit = true;
  snapshotRaw = raw;
  snapshotValue = parseRaw(raw);
  return snapshotValue;
}

/** Migawka serwerowa/przed hydratacją: koszyk (localStorage) jeszcze nieznany. */
export function getServerCartSnapshot(): CartState {
  return EMPTY_CART;
}

export function writeCart(state: CartState): CartState {
  const normalized = normalizeCart(state);
  if (!isBrowser()) return normalized;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    // Powiadom subskrybentów w TEJ SAMEJ karcie (storage event ich nie dosięga).
    window.dispatchEvent(new CustomEvent(CART_EVENT));
  } catch {
    // Prywatny tryb / brak miejsca — koszyk działa w pamięci komponentu.
  }
  return normalized;
}

/** Subskrypcja zmian koszyka (ta karta: CART_EVENT; inne karty: storage event). */
export function subscribeCart(callback: () => void): () => void {
  if (!isBrowser()) return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CART_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CART_EVENT, callback);
  };
}
