/**
 * PUBLICZNE POLA WŁASNE SPRZĘTU — JEDNO WYJŚCIE NA DWA EKRANY (faza 1a/1b, ADR-154).
 *
 * ==================== CO TU JEST ROZSTRZYGANE ====================
 *
 * Katalog publiczny (`app.get_public_catalog`, 0058) niesie przy sprzęcie MAPĘ
 * `id definicji → wartość`, a osobno — na poziomie sklepu — LISTĘ definicji.
 * Same wartości są nie do pokazania: pod kluczem stoi identyfikator definicji,
 * a nie jej etykieta, i wartość bywa liczbą, datą albo prawdą logiczną. Ten
 * moduł składa jedno z drugim w wiersze „etykieta: wartość", z których korzystają
 * DWA ekrany naraz: tabela specyfikacji na stronie produktu (faza 1a) i kafel
 * w sekcji sprzętu (faza 1b).
 *
 * Jedno miejsce, bo inaczej byłyby dwa i rozjechałyby się przy pierwszej
 * poprawce — a rozjazd znaczyłby tutaj, że kafel pokazuje pole, którego strona
 * produktu nie pokazuje (albo odwrotnie).
 *
 * ==================== GRANICA PUBLICZNA: LICZYMY PO DEFINICJACH ====================
 *
 * Pętla idzie po DEFINICJACH z katalogu i bierze te, które w mapie sprzętu
 * WYSTĘPUJĄ — nigdy odwrotnie. To jest lustro zawężenia z migracji 0058
 * i jedyna reguła w tym pliku, która broni czegoś więcej niż wyglądu:
 *
 *   • baza wypuszcza wartości WYŁĄCZNIE pod definicjami oznaczonymi
 *     „zamawianie" (`show_in_checkout`), więc pole opisujące sprzęt na użytek
 *     lady (koszt zakupu, numer w ewidencji) nie ma tędy drogi na zewnątrz;
 *   • gdyby pętla szła po KLUCZACH mapy, każdy klucz, który kiedykolwiek
 *     znalazłby się w kolumnie z pominięciem bazy, wyrenderowałby się na
 *     stronie klienta — bez etykiety, ale z wartością.
 *
 * Drugie zawężenie jest w tej samej pętli i osobne: definicja musi dotyczyć
 * ENCJI `product`. Lista definicji ze sklepu niesie wszystkie trzy encje (pola
 * klienta i zamówienia rysuje formularz kasy), więc bez tego warunku pole
 * „Numer zlecenia wewnętrznego" z encji zamówienia opisałoby wartość, która
 * przypadkiem stoi w kolumnie sprzętu pod tym samym identyfikatorem.
 */
import {
  formatCustomFieldValue,
  isCustomFieldType,
  type CustomFieldDefinition,
} from "@avably/core";
import type { StorefrontProductField } from "@avably/ui";

import type { PublicCatalogProduct, PublicCustomField } from "@/lib/checkout/contract";

/** Język zapisu wartości (data, liczba) — ten sam zbiór, co locale sklepu. */
export type ProductFieldLocale = "pl" | "en";

/**
 * PUBLICZNA DEFINICJA W KSZTAŁCIE DOMENOWYM.
 *
 * Kształt publiczny jest ŚCIŚLE WĘŻSZY od wiersza (0058: bez flag widoczności,
 * bez `archived_at`, bez `created_at`), a `formatCustomFieldValue` oczekuje
 * pełnej definicji. Uzupełniamy więc brakujące pola wartościami, które są
 * PRAWDZIWE dla wszystkiego, co przeszło przez granicę publiczną: pole
 * zarchiwizowane stamtąd nie wychodzi (`archivedAt: null`), a wyszło właśnie
 * dlatego, że jest oznaczone „zamawianie" (`showInCheckout: true`).
 *
 * Flagi, których granica publiczna NIE potwierdza, stoją na `false` — bo
 * „nie wiemy" jest tu bliżej „nie" niż „tak", a jedyną funkcją, która je czyta
 * (`visibleCustomFields`), i tak nie wołamy: filtr widoczności zrobiła baza.
 */
export function publicCustomFieldDefinition(field: PublicCustomField): CustomFieldDefinition {
  return {
    id: field.id,
    entity: field.entity === "customer" || field.entity === "order" ? field.entity : "product",
    // Typ spoza słownika znaczy „traktuj jak tekst" — wartość i tak pokażemy
    // tak, jak leży, zamiast wywracać stronę przez jedną definicję.
    type: isCustomFieldType(field.field_type) ? field.field_type : "text",
    label: field.label,
    helpText: field.help_text,
    required: field.required,
    options: Array.isArray(field.options) ? (field.options as string[]) : [],
    position: 0,
    showInPanel: false,
    showInCheckout: true,
    showInContract: false,
    archivedAt: null,
    createdAt: null,
  };
}

/**
 * WIERSZE PÓL WŁASNYCH SPRZĘTU — w kolejności z panelu ustawień.
 *
 * Kolejność niesie sama lista definicji: baza sortuje ją po `(position,
 * created_at, id)`, czyli dokładnie tak, jak operator widzi pola w ustawieniach
 * i jak wychodzą na umowie PDF. Sortowanie tutaj drugi raz byłoby drugim
 * źródłem prawdy o porządku.
 *
 * Wartość PUSTA po sformatowaniu (pusty napis, wartość spoza słownika typu)
 * NIE daje wiersza: sierocą etykietę bez wartości widać na stronie jak dziurę,
 * a w tabeli specyfikacji — jak błąd generatora. Ta sama reguła, co
 * w `customFieldDisplayRows` rdzenia.
 */
export function productFieldRows(
  product: Pick<PublicCatalogProduct, "custom_fields">,
  definitions: readonly PublicCustomField[],
  locale: ProductFieldLocale,
): StorefrontProductField[] {
  const rows: StorefrontProductField[] = [];
  for (const raw of definitions) {
    if (raw.entity !== "product") continue;
    const definition = publicCustomFieldDefinition(raw);
    const value = formatCustomFieldValue(definition, product.custom_fields[raw.id], locale);
    if (value === "") continue;
    rows.push({ id: raw.id, label: definition.label, value });
  }
  return rows;
}
