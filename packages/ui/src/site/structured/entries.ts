import type { StructuredSectionContent } from "@avably/core/site";

import type { StorefrontCategory, StorefrontProduct } from "../types";
import { visibleCategoriesFor } from "./categories-shared";
import { visibleProductsFor } from "./products-shared";

/**
 * ILE WPISÓW SEKCJA NAPRAWDĘ ODDA DO DOKUMENTU (E8).
 *
 * ==================== PO CO OSOBNA FUNKCJA ====================
 *
 * Płótno kreatora musi wiedzieć, czy sekcja pokaże cokolwiek, ZANIM ją
 * narysuje — bo od tego zależy, czy dorysować pod nią stan pusty z akcją
 * naprawczą (E8). Odpowiedzi nie da się odczytać z DOM-u w czasie renderu,
 * a policzenie jej u siebie („`items.length`") byłoby DRUGĄ prawdą o tym, co
 * widać: dla jednego typu z rejestru to nieprawda.
 *
 * ==================== DLACZEGO NIE ZAWSZE `items.length` ====================
 *
 * DWA typy mają treść, która nie jest ich własną listą, i oba z tego samego
 * powodu — ich treścią jest KATALOG:
 *   • sekcja sprzętu (E7) przy źródle „katalog" ma listę wskazań pustą Z
 *     ZAŁOŻENIA, a pokazuje początek katalogu; przy „wybranych" wskazanie na
 *     pozycję usuniętą po prostu wypada (patrz `visibleProductsFor`);
 *   • sekcja kategorii (Faza 7) zachowuje się tak samo względem kategorii
 *     (patrz `visibleCategoriesFor`): „katalog" pokazuje wszystkie, a wybór
 *     wskazujący same usunięte kategorie daje sekcję pustą.
 * Obie drogi dają liczbę, której w treści nie ma. Stąd DWA wyjątki i tyle samo
 * miejsc, w których trzeba o nich pamiętać.
 *
 * Pozostałe typy odpowiadają długością własnej listy — i to jest gałąź
 * DOMYŚLNA, więc kolejny typ strukturalny wchodzi tu bez zmiany ani jednej
 * linii, dopóki jego wpisy mieszkają w treści.
 *
 * Brak katalogu = pusta tablica, tak samo jak w rendererze: liczba jest wtedy
 * zerem i sekcja mówi o tym wprost, zamiast udawać, że coś pokaże.
 */
export function structuredEntryCount(
  content: StructuredSectionContent,
  products: readonly StorefrontProduct[] = [],
  categories: readonly StorefrontCategory[] = [],
): number {
  if (content.type === "products") return visibleProductsFor(content, products).length;
  if (content.type === "categories") return visibleCategoriesFor(content, categories).length;
  return (content as unknown as { items: unknown[] }).items.length;
}
