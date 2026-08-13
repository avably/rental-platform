/**
 * ROZWIĄZANIE WIĄZAŃ PRZY RENDERZE (faza 3, ADR-163) — warstwa, w której model
 * z rdzenia spotyka KONTRAKT PREZENTACYJNY katalogu.
 *
 * ==================== PO CO OSOBNY PLIK ====================
 *
 * Rdzeń zna wiązanie (skąd wziąć, co przy pustce), ale nie zna kształtu wiersza
 * katalogu — i nie ma powodu go znać. Pakiet UI zna `StorefrontProduct`, ale nie
 * ma prawa mieć własnej odpowiedzi na pytanie „co znaczy puste". Ten plik składa
 * jedno z drugim i jest JEDYNYM miejscem, w którym pozycja katalogu zamienia się
 * w worek wartości silnika.
 *
 * ==================== ZAWĘŻENIE, KTÓRE TU STOI ====================
 *
 * Wskazana pozycja jest szukana WYŁĄCZNIE w liście podanej do renderu
 * ({@link SiteRecordContext.products}) — czyli w katalogu publicznym TEGO
 * najemcy, tym samym, z którego sekcja sprzętu rysuje kafle. Identyfikator
 * spoza tej listy nie ma czego znaleźć, więc nie oddaje ani jednej wartości:
 * ani nazwy, ani ceny, ani zdjęcia. To jest zawężenie ZBIORU, a nie zaufanie do
 * RLS-u — RLS pilnuje ODCZYTU katalogu, a nie tego, czego szuka w nim render.
 */
import {
  bindableAttributesOf,
  bindingOf,
  resolveProductBinding,
  type BindableElement,
  type BoundValue,
  type ElementBinding,
  type ProductBindingValues,
} from "@avably/core/site";

import type { StorefrontProduct } from "./types";

/**
 * KONTEKST REKORDU WSTRZYKIWANY PRZY RENDERZE.
 *
 * Dwa pola, bo wiązanie zna dwa sposoby wskazania rekordu (patrz
 * `BINDING_RECORD_KINDS` w rdzeniu):
 *   • `products` — KATALOG, w którym wolno szukać pozycji wskazanej wprost;
 *   • `record` — pozycja, NA KTÓREJ STOI strona. Wypełnia go szablon strony
 *     produktu (faza 5); powierzchnia bez rekordu strony po prostu go nie
 *     podaje, a wiązanie do niego zachowuje się wtedy jak wiązanie do pozycji,
 *     której nie ma — czyli wycina węzeł.
 */
export interface SiteRecordContext {
  products: readonly StorefrontProduct[];
  record?: StorefrontProduct;
}

/**
 * POZYCJA KATALOGU → WOREK WARTOŚCI SILNIKA.
 *
 * Wszystko przychodzi GOTOWE z warstwy odczytu: cena jest już etykietą
 * (`priceLabel`), adres zdjęcia — pełnym publicznym URL-em. To ta sama zasada,
 * którą kontrakt `StorefrontProduct` stosuje od 2.4b: zamiana typu na tekst dla
 * człowieka ma w produkcie JEDNO miejsce, więc związany nagłówek nie pokaże
 * kwoty inaczej niż kafel obok.
 */
export function productBindingValues(product: StorefrontProduct): ProductBindingValues {
  return {
    name: product.name,
    price: product.priceLabel,
    description: product.description,
    image: product.imageUrl ? { url: product.imageUrl, alt: product.imageAlt } : null,
  };
}

/**
 * REKORD WSKAZANY PRZEZ WIĄZANIE — albo `undefined`.
 *
 * Wyszukanie idzie po LIŚCIE PODANEJ DO RENDERU i nigdzie indziej. Nie ma tu
 * żadnego zapytania, żadnego cache'u i żadnej drugiej listy, w której dałoby się
 * znaleźć pozycję spoza katalogu najemcy.
 */
export function bindingRecordOf(
  binding: ElementBinding,
  context: SiteRecordContext,
): StorefrontProduct | undefined {
  if (binding.record.kind === "pageProduct") return context.record;
  const wanted = binding.record.productId;
  return context.products.find((product) => product.id === wanted);
}

/** Wartość jednego wiązania — `null` znaczy „wytnij ten węzeł". */
export function resolveElementBinding(
  binding: ElementBinding,
  context: SiteRecordContext,
): BoundValue | null {
  const product = bindingRecordOf(binding, context);
  return resolveProductBinding(binding, product ? productBindingValues(product) : undefined);
}

export interface ElementBindingResult {
  /**
   * WĘZEŁ WYCIĘTY. Wystarczy JEDNO wiązanie bez wartości: element, którego
   * nagłówek nie ma czego pokazać, nie jest elementem „prawie pełnym" — jest
   * pustym pudełkiem po treści, której nie ma.
   */
  cut: boolean;
  /** Wartości per atrybut — czyta je render zamiast pól statycznych. */
  values: Record<string, BoundValue>;
}

const NOTHING_BOUND: ElementBindingResult = { cut: false, values: {} };

/**
 * KOMPLET WIĄZAŃ ELEMENTU ROZWIĄZANY PRZED ZBUDOWANIEM WĘZŁA.
 *
 * Pytanie pada RAZ, w rendererze płótna, zanim powstanie JSX — dzięki temu
 * wycięcie dzieje się PO STRONIE SERWERA: węzeł nie jedzie do przeglądarki ani
 * w kodzie strony, ani w danych hydracji. Ukrycie CSS-em zostawiałoby treść
 * w dokumencie (obciążenie, indeksowanie), a warunek w przeglądarce dawałby
 * klientowi pusty blok i skok układu.
 *
 * Pętla idzie po LIŚCIE ZAMKNIĘTEJ atrybutów rodzaju, a nie po kluczach mapy
 * `bindings` z treści — gdyby szła po kluczach, każdy klucz, który kiedykolwiek
 * ominąłby schemat, dostałby własną drogę do renderu.
 */
export function elementBindings(
  element: BindableElement,
  context: SiteRecordContext | undefined,
): ElementBindingResult {
  const attributes = bindableAttributesOf(element.kind);
  if (attributes.length === 0) return NOTHING_BOUND;

  let cut = false;
  let bound = false;
  const values: Record<string, BoundValue> = {};

  for (const { attribute } of attributes) {
    const binding = bindingOf(element, attribute);
    if (!binding) continue;
    bound = true;
    /*
     * BRAK KONTEKSTU = BRAK REKORDU, nie „pokaż treść statyczną". Powierzchnia,
     * która nie podała katalogu (miniatura szablonu, podgląd presetu w palecie),
     * nie ma skąd wziąć wartości — a pokazanie w tym miejscu napisu projektowego
     * uczyłoby operatora, że wiązanie „czasem działa, czasem nie".
     */
    const value = context ? resolveElementBinding(binding, context) : null;
    if (value === null) {
      cut = true;
      continue;
    }
    values[attribute] = value;
  }

  return bound ? { cut, values } : NOTHING_BOUND;
}
