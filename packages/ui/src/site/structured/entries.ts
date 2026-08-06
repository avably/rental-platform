import type { StructuredSectionContent } from "@avably/core/site";

import type { StorefrontProduct } from "../types";
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
 * Sekcja sprzętu (E7) jest jedynym typem, którego treścią nie jest jej własna
 * lista: przy źródle „katalog" lista wskazań jest pusta Z ZAŁOŻENIA, a sekcja
 * pokazuje początek katalogu; przy źródle „wybrane pozycje" wskazanie na
 * pozycję usuniętą z katalogu po prostu wypada (patrz `visibleProductsFor`).
 * Obie drogi dają liczbę, której w treści nie ma. Stąd JEDEN wyjątek i tyle
 * samo miejsc, w których trzeba o nim pamiętać.
 *
 * Pozostałe typy odpowiadają długością własnej listy — i to jest gałąź
 * DOMYŚLNA, więc kolejny typ strukturalny wchodzi tu bez zmiany ani jednej
 * linii, dopóki jego wpisy mieszkają w treści.
 *
 * Brak katalogu = pusta tablica, tak samo jak w rendererze: liczba jest wtedy
 * zerem i sekcja sprzętu mówi o tym wprost, zamiast udawać, że coś pokaże.
 */
export function structuredEntryCount(
  content: StructuredSectionContent,
  products: readonly StorefrontProduct[] = [],
): number {
  if (content.type === "products") return visibleProductsFor(content, products).length;
  return (content as unknown as { items: unknown[] }).items.length;
}
