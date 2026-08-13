/**
 * SILNIK PODPIĘCIA DANYCH — ELEMENT BIERZE WARTOŚĆ Z REKORDU (faza 3, ADR-163).
 *
 * ==================== JEDNO ZDANIE, NA KTÓRYM STOI CAŁY PLIK ====================
 *
 * TREŚĆ NIESIE WSKAZANIE, NIGDY KOPIĘ WARTOŚCI. Element zapisuje w `jsonb`
 * odpowiedź na pytanie „skąd wziąć", a nie „co pokazać" — wartość czyta się
 * z katalogu PRZY RENDERZE. To jest ta sama reguła, którą ADR-154 wymusił
 * konstrukcyjnie na kaflu sprzętu (`subtitleField` jest `uuid`, więc operator
 * NIE MA JAK wpisać tam ceny), przeniesiona piętro niżej: na atrybut elementu.
 *
 * Powód jest ZMIERZONY, nie teoretyczny. Na stronie wzorcowej właściciela ten
 * sam sprzęt kosztuje 45 zł/dzień w jednym miejscu i 59 zł/dzień w drugim, bo
 * cenę wpisano ręcznie dwa razy. Każde pole, w które da się wpisać WARTOŚĆ
 * zamiast WSKAZANIA, jest przyszłym rozjazdem cen w sklepie najemcy.
 *
 * ==================== ZERO MIGRACJI ====================
 *
 * Wiązanie mieszka w treści sekcji (`jsonb`, 0019) jako opcjonalny klucz
 * `bindings` elementu płótna. Ani jedna kolumna, ani jeden CHECK się nie
 * zmienia; treść zapisana przed fazą 3 parsuje się bez zmian, bo brak klucza
 * znaczy „element statyczny" — czyli dokładnie to, czym był.
 *
 * ==================== WIĄZANIE IDZIE NA ATRYBUT, NIE NA ELEMENT ====================
 *
 * Wzorzec Block Bindings: związany jest ATRYBUT widgetu (napis nagłówka,
 * etykieta przycisku, źródło zdjęcia), a nie cały widget. Dzięki temu przycisk
 * może mieć nazwę z katalogu i adres od operatora, a nagłówek — treść z katalogu
 * i poziom ze skali szablonu. Zbiór atrybutów jest ZAMKNIĘTY
 * ({@link BINDABLE_ATTRIBUTES}) i przypięty testem kontraktowym: lista otwarta
 * znaczyłaby, że pierwszy refaktor cicho rozszerza powierzchnię publiczną.
 *
 * ==================== ZGODNOŚĆ TYPÓW JEST W SCHEMACIE, NIE W INTERFEJSIE ====================
 *
 * Każde wiązalne pole sprzętu ma TYP WARTOŚCI (`text` albo `image`), a schemat
 * wiązania powstaje DLA TYPU, którego oczekuje atrybut. Wiązanie ceny do źródła
 * zdjęcia nie jest więc „odradzane" ani „walidowane" — ono się NIE PARSUJE.
 * Interfejs zawęża listę wyboru tą samą funkcją ({@link productBindingFieldsOf}),
 * więc operator nie ma jak zbudować wiązania, którego serwer nie przyjmie.
 */
import { z } from "zod";

// Import TYPU (kasowany w kompilacji) — `./elements` importuje ten plik
// w RUNTIME, więc odwrotna zależność wartościowa zamknęłaby cykl ładowania.
import type { CanvasElementKind } from "./elements";

// -----------------------------------------------------------------------
// Typ wartości
// -----------------------------------------------------------------------

/**
 * TYPY WARTOŚCI, KTÓRE UMIE PRZENIEŚĆ WIĄZANIE.
 *
 * Dwa, i to nie jest liczba na wyrost: różnica między napisem a obrazem jest
 * różnicą KSZTAŁTU węzła w dokumencie (`<p>` kontra `<img src>`), a nie
 * formatowania. Kwota, data i liczba są tu NAPISAMI świadomie — warstwa odczytu
 * formatuje je raz, w jednym miejscu produktu (`formatMoney`,
 * `formatCustomFieldValue`), więc render nie ma czego wybierać i nie ma jak
 * pokazać ceny inaczej niż umowa PDF.
 */
export const BINDING_VALUE_KINDS = ["text", "image"] as const;
export type BindingValueKind = (typeof BINDING_VALUE_KINDS)[number];

// -----------------------------------------------------------------------
// Zamknięta lista wiązalnych pól sprzętu
// -----------------------------------------------------------------------

export interface ProductBindingFieldSpec {
  /** Typ wartości, którą pole oddaje — wejście zgodności typów. */
  value: BindingValueKind;
  /**
   * Czy pole BYWA PUSTE w katalogu publicznym.
   *
   * To nie jest metadana opisowa, tylko BRAMKA WARTOŚCI ZASTĘPCZEJ (niżej):
   * pole, które w katalogu jest zawsze wypełnione, nie ma stanu pustego, więc
   * wartość zastępcza dla niego jest napisem, który NIGDY się nie pokaże —
   * czyli miejscem, w które operator wpisuje cenę „na wszelki wypadek".
   */
  optional: boolean;
}

/**
 * WIĄZALNE POLA SPRZĘTU — ZAMKNIĘTA, WERSJONOWANA LISTA.
 *
 * ==================== SKĄD DOKŁADNIE TE CZTERY ====================
 *
 * Z KOPERTY ODCZYTU PUBLICZNEGO, a nie z życzeń. Sklep dostaje sprzęt przez
 * `app.get_public_catalog` (0020/0058) i widzi w nim nazwę, opis, cenę bazową,
 * kaucję, progi cenowe, zdjęcia i wartości pól własnych oznaczonych
 * „zamawianie". Wiązalne jest to, co da się z tego pokazać JAKO ZDANIE O JEDNEJ
 * POZYCJI, bez drugiego zapytania i bez zgadywania.
 *
 * ==================== CZEGO TU NIE MA I DLACZEGO ====================
 *
 *   • DOSTĘPNOŚĆ. Brief fazy 3 wymieniał ją jako piąte pole i w tym repo NIE
 *     DA SIĘ jej dziś związać — nie z braku nakładu pracy, tylko z braku danej:
 *     `PublicCatalogProduct` nie niesie ani liczby sztuk, ani stanu magazynu,
 *     a `PublicAvailability` (`available_units`/`total_units`) jest odpowiedzią
 *     na pytanie o KONKRETNY ZAKRES DAT i przychodzi osobnym wywołaniem. Render
 *     strony nie ma dat, więc „dostępność" pokazana bez nich byłaby albo stałą
 *     („jest w ofercie" — prawda dla wszystkiego, co w ogóle widać w katalogu),
 *     albo liczbą wziętą z powietrza. Wpuszczenie jej wymaga poszerzenia
 *     koperty publicznej, czyli MIGRACJI — a ta faza z założenia nie ma ani
 *     jednej. Dopisanie pola do tej mapy będzie wtedy jedną linią.
 *   • KAUCJA i PROGI CENOWE. Są w kopercie, ale nie w kontrakcie
 *     prezentacyjnym (`StorefrontProduct` niesie JEDNĄ gotową etykietę ceny).
 *     Wiązalne pole bez wartości na którejś powierzchni renderu daje podgląd,
 *     który kłamie — a to jest gorsze niż brak pola.
 *   • POLA WŁASNE SPRZĘTU. Wiąże je już faza 1b, na poziomie SEKCJI
 *     (`subtitleField`, `featureFields` — ADR-154). Druga droga do tych samych
 *     wartości znaczyłaby dwa miejsca, w których trzeba pilnować granicy
 *     „zamawianie".
 */
export const PRODUCT_BINDING_FIELDS = {
  /** Nazwa pozycji — w katalogu wymagana, więc nigdy pusta. */
  name: { value: "text", optional: false },
  /** GOTOWA etykieta ceny („od 120,00 zł / doba") — składa ją warstwa odczytu. */
  price: { value: "text", optional: false },
  /** Opis pozycji — w katalogu opcjonalny (`description` bywa `null`). */
  description: { value: "text", optional: true },
  /** PIERWSZE zdjęcie pozycji razem z jego opisem alternatywnym. */
  image: { value: "image", optional: true },
} as const satisfies Record<string, ProductBindingFieldSpec>;

/**
 * Lustro kluczy mapy wyżej — kolejność jest kolejnością na liście wyboru
 * w szufladzie. Osobna stała, bo `Object.keys` gubi typy literałowe, a lista
 * wiązalnych pól jest dokładnie tym, co przypina test kontraktowy.
 */
export const PRODUCT_BINDING_FIELD_KEYS = [
  "name",
  "price",
  "description",
  "image",
] as const satisfies readonly (keyof typeof PRODUCT_BINDING_FIELDS)[];
export type ProductBindingField = (typeof PRODUCT_BINDING_FIELD_KEYS)[number];

/** Wiązalne pola o danym typie wartości — wejście schematu ORAZ listy w UI. */
export function productBindingFieldsOf(
  kind: BindingValueKind,
): readonly ProductBindingField[] {
  return PRODUCT_BINDING_FIELD_KEYS.filter(
    (key) => PRODUCT_BINDING_FIELDS[key].value === kind,
  );
}

// -----------------------------------------------------------------------
// Wskazanie rekordu
// -----------------------------------------------------------------------

/**
 * SKĄD BIERZE SIĘ REKORD — SŁOWNIK, nie flaga.
 *
 *   • `product` — POZYCJA WSKAZANA. Element stoi na dowolnej stronie i pokazuje
 *     wartość KONKRETNEGO sprzętu (blok „polecany sprzęt" na stronie głównej).
 *     To jest wariant, który zamyka zmierzony defekt 45 kontra 59 zł.
 *   • `pageProduct` — POZYCJA, NA KTÓREJ STOI STRONA. Szablon strony produktu
 *     (faza 5) renderuje się raz na sprzęt, a rekord podaje trasa. Wariant
 *     istnieje TU, bo to jest silnik, który fazę 5 odblokowuje — ale kontrolka
 *     w szufladzie pojawia się dopiero na powierzchni, która rekord strony
 *     naprawdę ma (patrz `pageRecord` w panelu). Kontrolka bez skutku uczy
 *     operatora, że ustawienia bywają ozdobą.
 *
 * Słownik, a nie „opcjonalne `productId`", z tego samego powodu, co przy źródle
 * sekcji sprzętu (E7): pole opcjonalne o dwóch znaczeniach zmusza każdego
 * czytelnika do odgadnięcia, które z nich obowiązuje.
 */
export const BINDING_RECORD_KINDS = ["product", "pageProduct"] as const;
export type BindingRecordKind = (typeof BINDING_RECORD_KINDS)[number];

export const bindingRecordSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("product"),
      /**
       * WSKAZANIE, nie kopia. Identyfikator rozwiązuje się WYŁĄCZNIE w katalogu
       * podanym do renderu — czyli w katalogu publicznym TEGO najemcy. Cudzy
       * identyfikator nie ma tam czego znaleźć, więc nie oddaje wartości; nie
       * jest to zasługa RLS-u, tylko zbioru, w którym render szuka.
       */
      productId: z.string().uuid(),
    })
    .strict(),
  z.object({ kind: z.literal("pageProduct") }).strict(),
]);
export type BindingRecordRef = z.infer<typeof bindingRecordSchema>;

// -----------------------------------------------------------------------
// Co się dzieje, gdy pole jest puste
// -----------------------------------------------------------------------

/**
 * ZACHOWANIE PRZY PUSTEJ WARTOŚCI — dwa stany, wybrane świadomie.
 *
 *   • `hide` — WĘZEŁ ZOSTAJE WYCIĘTY przy renderze, po stronie serwera. Nie
 *     „schowany CSS-em" (treść zostałaby w kodzie strony i w indeksie) i nie
 *     „pusty" (pusty przycisk jest przyciskiem prowadzącym donikąd, a pusty
 *     kafel zdjęcia — szarym prostokątem mówiącym „tu miało coś być").
 *   • `fallback` — pokaż PODANY NAPIS. To jest ten trzeci stan, którego brak
 *     jest najczęstszą luką w narzędziach rynkowych.
 *
 * ==================== DLACZEGO WYCIĘCIE JEST TU BEZPIECZNE ====================
 *
 * Bo płótno v2 ma GEOMETRIĘ ABSOLUTNĄ: każdy element zna własne `{x,y,w,h}`,
 * więc usunięcie jednego węzła NIE PRZESUWA sąsiadów ani o piksel. W układzie
 * przepływowym „nie rysuj" i „narysuj pusty" dają dwa różne układy i wybór jest
 * kompromisem; tutaj wycięcie zabiera dokładnie tyle, ile miało zabrać.
 *
 * Odwrotny kierunek jest ważniejszy: element narysowany „pusty" zostawia
 * w dokumencie węzeł, który klient widzi jako defekt strony, a robot — jako
 * treść. Dlatego `hide` jest DOMYŚLNE.
 */
export const BINDING_EMPTY_MODES = ["hide", "fallback"] as const;
export type BindingEmptyMode = (typeof BINDING_EMPTY_MODES)[number];

/**
 * WARTOŚĆ ZASTĘPCZA — krótka i tylko tam, gdzie ma prawo się pokazać.
 *
 * Sufit jest niski celowo: zastępcze zdanie ma powiedzieć „tego nie podaliśmy",
 * a nie zastąpić opis sprzętu ręcznie wpisanym akapitem. Dłuższy limit
 * zapraszałby do przeniesienia treści z katalogu do strony — czyli do drugiego
 * źródła prawdy, którego ta faza jest zaprzeczeniem.
 */
const bindingFallback = z.string().trim().min(1).max(200);

function fieldEnumOf(kind: BindingValueKind) {
  const fields = productBindingFieldsOf(kind);
  return z.enum(fields as unknown as [ProductBindingField, ...ProductBindingField[]]);
}

/**
 * WIĄZANIE ATRYBUTU O DANYM TYPIE WARTOŚCI.
 *
 * Dwa kształty, bo dwa typy wartości mają różne prawa:
 *   • `text` zna wartość zastępczą — ale WYŁĄCZNIE dla pola, które w katalogu
 *     BYWA puste. Wiązanie do nazwy albo do ceny nie ma jak jej nieść: pole
 *     `fallback` przy `whenEmpty: "hide"` jest odrzucane, a `whenEmpty:
 *     "fallback"` dla pola zawsze wypełnionego — również. To jest dokładnie
 *     ta bramka, przez którą „45 zł" nie ma jak wejść do treści strony;
 *   • `image` zna WYŁĄCZNIE wycięcie. Zastępcze zdjęcie byłoby fotografią
 *     sprzętu, którego najemca nie ma — kłamstwem o ofercie, a nie wartością
 *     domyślną. Klucza `fallback` w tym kształcie po prostu NIE MA.
 */
export function bindingSchemaFor(valueKind: BindingValueKind) {
  if (valueKind === "image") {
    return z
      .object({
        record: bindingRecordSchema,
        field: fieldEnumOf("image"),
        whenEmpty: z.literal("hide").default("hide"),
      })
      .strict();
  }

  return z
    .object({
      record: bindingRecordSchema,
      field: fieldEnumOf("text"),
      whenEmpty: z.enum(BINDING_EMPTY_MODES).default("hide"),
      fallback: bindingFallback.optional(),
    })
    .strict()
    .superRefine((binding, ctx) => {
      const optional = PRODUCT_BINDING_FIELDS[binding.field].optional;

      if (binding.whenEmpty === "fallback") {
        if (!optional) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["whenEmpty"],
            message: "To pole sprzętu jest zawsze wypełnione — nie ma stanu pustego.",
          });
        }
        if (!binding.fallback) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["fallback"],
            message: "Wartość zastępcza jest wymagana przy tym zachowaniu.",
          });
        }
        return;
      }

      if (binding.fallback !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fallback"],
          message: "Wartość zastępcza bez włączonego zachowania nie pokaże się nigdy.",
        });
      }
    });
}

/** Wiązanie atrybutu tekstowego — jeden obiekt schematu na cały system. */
export const textBindingSchema = bindingSchemaFor("text");
/** Wiązanie atrybutu obrazowego — patrz {@link bindingSchemaFor}. */
export const imageBindingSchema = bindingSchemaFor("image");

/**
 * WIĄZANIE W KSZTAŁCIE DOMENOWYM — suma obu wariantów schematu.
 *
 * `whenEmpty` jest tu WYMAGANE, bo schemat ma dla niego domyślkę: po sparsowaniu
 * pole zawsze istnieje, a typ, który by o tym nie mówił, zmuszałby każdego
 * czytelnika treści do własnego `?? "hide"`.
 */
export interface ElementBinding {
  record: BindingRecordRef;
  field: ProductBindingField;
  whenEmpty: BindingEmptyMode;
  fallback?: string;
}

// -----------------------------------------------------------------------
// Zamknięta lista wiązalnych atrybutów
// -----------------------------------------------------------------------

/**
 * CO WOLNO ZWIĄZAĆ — LISTA ZAMKNIĘTA, PRZYPIĘTA TESTEM.
 *
 * Klucz to rodzaj elementu płótna, wartość to mapa `atrybut → typ wartości`.
 * Rodzaj spoza tej mapy nie ma ani jednego wiązalnego atrybutu, i to jest
 * DEKLARACJA, a nie przeoczenie:
 *
 *   • `icon` i `shape` niosą WYBÓR ZE ZBIORU (nazwa ikony z allowlisty,
 *     wypełnienie kształtu). Wiązanie oddałoby ten wybór danym z katalogu,
 *     które nie mają skąd znać naszej allowlisty;
 *   • `catalog` JEST listą z bazy — wiązanie w nim byłoby wiązaniem wiązania;
 *   • `button.href` NIE JEST wiązalne, choć kusi. Adres steruje NAWIGACJĄ, więc
 *     wiązanie zrobiłoby z pola katalogu wejście do celu odnośnika — a cel
 *     odnośnika przechodzi dziś przez allowlistę schematów (`linkHrefSchema`)
 *     przy ZAPISIE. Wartość podstawiana przy RENDERZE weszłaby za tę bramkę.
 *     Adres pozostaje decyzją operatora; faza 5 doda mu adres pozycji jako
 *     osobny, nazwany cel, a nie jako dowolny napis z bazy;
 *   • `image.alt` nie ma własnego wpisu, bo opis alternatywny jedzie RAZEM ze
 *     zdjęciem (wiązanie `source` oddaje parę „adres + opis"). Zdjęcie z
 *     katalogu opisane napisem operatora sprzed dwóch podmian jest kłamstwem
 *     dla czytnika ekranu, a nie zgodnością wstecz.
 *
 * Test kontraktowy pilnuje tej mapy Z OBU STRON: porównuje ją z literałem
 * spisanym w teście ORAZ ze SCHEMATAMI elementów (co która treść naprawdę
 * przyjmuje). Zmiana po jednej stronie zapala się na czerwono.
 */
export const BINDABLE_ATTRIBUTES = {
  heading: { text: "text" },
  text: { text: "text" },
  button: { label: "text" },
  image: { source: "image" },
} as const satisfies Partial<Record<CanvasElementKind, Record<string, BindingValueKind>>>;

export type BindableElementKind = keyof typeof BINDABLE_ATTRIBUTES;

/** Rodzaje elementów, które w ogóle znają wiązania — lustro mapy wyżej. */
export const BINDABLE_ELEMENT_KINDS = [
  "heading",
  "text",
  "button",
  "image",
] as const satisfies readonly BindableElementKind[];

export function isBindableKind(kind: string): kind is BindableElementKind {
  return (BINDABLE_ELEMENT_KINDS as readonly string[]).includes(kind);
}

export interface BindableAttribute {
  attribute: string;
  value: BindingValueKind;
}

/** Wiązalne atrybuty rodzaju elementu — wejście kontrolek szuflady i testów. */
export function bindableAttributesOf(kind: string): readonly BindableAttribute[] {
  if (!isBindableKind(kind)) return [];
  return Object.entries(BINDABLE_ATTRIBUTES[kind]).map(([attribute, value]) => ({
    attribute,
    value: value as BindingValueKind,
  }));
}

/** Typ wartości, którego atrybut oczekuje — albo `undefined`, gdy niewiązalny. */
export function bindableAttributeKind(
  kind: string,
  attribute: string,
): BindingValueKind | undefined {
  return bindableAttributesOf(kind).find((entry) => entry.attribute === attribute)?.value;
}

// -----------------------------------------------------------------------
// Odczyt wiązań z elementu
// -----------------------------------------------------------------------

/**
 * Element w kształcie, którego potrzebuje silnik — sam rodzaj i mapa wiązań.
 * Węższy od `CanvasElement` świadomie: dzięki temu ten plik nie musi znać unii
 * elementów i nie domyka cyklu importów z `./elements`.
 */
export interface BindableElement {
  kind: string;
  /**
   * Mapa `atrybut → wiązanie`. Typ jest tu CELOWO nieokreślony: każdy rodzaj
   * elementu ma w schemacie własny, wąski kształt (`{ text? }`, `{ label? }`,
   * `{ source? }`), a te nie są przypisywalne do jednej sygnatury indeksowej.
   * Zawężenie robi {@link bindingOf} — po ZAMKNIĘTEJ liście atrybutów, więc
   * luźny typ nie poszerza tu niczego poza wygodą wołania.
   */
  bindings?: unknown;
}

/**
 * WIĄZANIE ATRYBUTU — z ZAWĘŻENIEM DO LISTY ZAMKNIĘTEJ.
 *
 * Pytanie o atrybut spoza listy oddaje `undefined`, nawet gdyby treść niosła
 * pod tym kluczem poprawnie zbudowane wiązanie. Treść w takim kształcie nie ma
 * jak przejść przez schemat (`bindings` jest `.strict()`), więc to jest drugi
 * zamek, a nie pierwszy — ale bez niego rozszerzenie listy w jednym miejscu
 * (schemat) po cichu rozszerzałoby ją w drugim (render).
 */
export function bindingOf(
  element: BindableElement,
  attribute: string,
): ElementBinding | undefined {
  if (!bindableAttributeKind(element.kind, attribute)) return undefined;
  const bindings = element.bindings;
  if (typeof bindings !== "object" || bindings === null) return undefined;
  const binding = (bindings as Record<string, unknown>)[attribute];
  return typeof binding === "object" && binding !== null
    ? (binding as ElementBinding)
    : undefined;
}

/** Czy atrybut elementu jest związany — jedno pytanie na render i na szufladę. */
export function isBoundAttribute(element: BindableElement, attribute: string): boolean {
  return bindingOf(element, attribute) !== undefined;
}

/** Czy element ma choć jedno wiązanie (kontrolki „to pochodzi z katalogu"). */
export function hasBindings(element: BindableElement): boolean {
  return bindableAttributesOf(element.kind).some(({ attribute }) =>
    isBoundAttribute(element, attribute),
  );
}

// -----------------------------------------------------------------------
// Rozwiązanie wiązania
// -----------------------------------------------------------------------

/**
 * WARTOŚCI JEDNEJ POZYCJI W KSZTAŁCIE, KTÓRY ZNA SILNIK.
 *
 * Neutralny worek, a nie `StorefrontProduct`: rdzeń nie zna kontraktu
 * prezentacyjnego pakietu UI (i nie powinien — to on jest importowany, nie
 * odwrotnie). Warstwa renderu składa ten worek jedną funkcją, więc zbiór pól
 * jest lustrem {@link PRODUCT_BINDING_FIELDS} i typecheck pilnuje kompletu.
 */
export interface ProductBindingValues {
  name: string;
  price: string;
  description?: string | null;
  image?: { url: string; alt: string } | null;
}

export type BoundValue =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string; alt: string };

/**
 * WARTOŚĆ WIĄZANIA ALBO WYCIĘCIE WĘZŁA.
 *
 * `null` znaczy „NIE RYSUJ TEGO ELEMENTU" i jest odpowiedzią w trzech
 * przypadkach, które dla klienta wyglądają tak samo i tak samo mają wyglądać:
 *   • rekordu NIE MA (wskazana pozycja nie stoi w katalogu podanym do renderu —
 *     bo została usunięta, wyłączona ALBO nigdy nie należała do tego najemcy);
 *   • pole rekordu jest puste;
 *   • pole jest puste, a operator nie podał wartości zastępczej.
 *
 * Rozróżnianie ich na stronie klienta byłoby raportem z naszej bazy wystawionym
 * odwiedzającemu — dokładnie ta sama zasada, co przy stanie pustym sekcji
 * sprzętu (E7).
 */
export function resolveProductBinding(
  binding: ElementBinding,
  values: ProductBindingValues | undefined,
): BoundValue | null {
  const spec = PRODUCT_BINDING_FIELDS[binding.field] as ProductBindingFieldSpec | undefined;
  // Pole spoza zamkniętej listy nie ma jak przejść przez schemat treści; gdyby
  // przeszło inną drogą, render ma je POMINĄĆ, a nie zgadywać typ wartości.
  if (!spec) return null;

  if (values) {
    if (spec.value === "image") {
      const image = values.image;
      if (image && image.url.trim() !== "") {
        return { kind: "image", url: image.url, alt: image.alt };
      }
    } else {
      const text = textValueOf(values, binding.field);
      if (text !== undefined && text.trim() !== "") return { kind: "text", text };
    }
  }

  if (binding.whenEmpty === "fallback" && binding.fallback) {
    return { kind: "text", text: binding.fallback };
  }
  return null;
}

/**
 * Pole tekstowe worka wartości. Przełącznik jest wyczerpujący po ZAMKNIĘTEJ
 * liście, więc dopisanie pola bez gałęzi zapali się w typecheck — a nie
 * objawi pustym napisem na stronie klienta.
 */
function textValueOf(
  values: ProductBindingValues,
  field: ProductBindingField,
): string | undefined {
  switch (field) {
    case "name":
      return values.name;
    case "price":
      return values.price;
    case "description":
      return values.description ?? undefined;
    case "image":
      // Pole obrazowe nie ma reprezentacji tekstowej — pytanie o nią znaczy, że
      // atrybut i pole rozjechały się typem, czyli że coś ominęło schemat.
      return undefined;
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}
