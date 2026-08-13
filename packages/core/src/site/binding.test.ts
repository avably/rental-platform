/**
 * KONTRAKT SILNIKA PODPIĘCIA DANYCH (faza 3, ADR-163).
 *
 * ==================== DLACZEGO TEN PLIK JEST DWUKIERUNKOWY ====================
 *
 * Test, który tylko ODCZYTUJE listę wiązalnych atrybutów z rdzenia i sprawdza,
 * że render ją respektuje, nie broni niczego: poszerzenie listy przechodzi na
 * zielono razem z zachowaniem. Ten plik przypina ją Z TRZECH STRON naraz:
 *
 *   1. LITERAŁEM spisanym niżej — zmiana `BINDABLE_ATTRIBUTES` bez zmiany
 *      tego literału jest czerwona;
 *   2. SCHEMATEM ELEMENTU — dla każdego rodzaju sprawdzamy PARSOWANIEM, jakie
 *      klucze `bindings` treść naprawdę przyjmuje. Dopisanie klucza w rejestrze
 *      bez dopisania go w schemacie (i odwrotnie) jest czerwone;
 *   3. ZGODNOŚCIĄ TYPÓW — pole oddające obraz nie ma jak wejść w atrybut
 *      tekstowy i odwrotnie.
 *
 * Ta sama lekcja, którą repo zapisało w `structured-i18n-contract`: kontrakt
 * porównujący artefakt sam ze sobą jest zielony zawsze.
 */
import { describe, expect, it } from "vitest";

import {
  BINDABLE_ATTRIBUTES,
  BINDABLE_ELEMENT_KINDS,
  PRODUCT_BINDING_FIELDS,
  PRODUCT_BINDING_FIELD_KEYS,
  bindableAttributeKind,
  bindableAttributesOf,
  bindingOf,
  hasBindings,
  isBoundAttribute,
  productBindingFieldsOf,
  resolveProductBinding,
  type ElementBinding,
  type ProductBindingValues,
} from "./binding";
import {
  buttonElementSchema,
  canvasElementSchema,
  headingElementSchema,
  iconElementSchema,
  imageElementSchema,
  shapeElementSchema,
  textElementSchema,
} from "./elements";

// -----------------------------------------------------------------------
// Fikstury
// -----------------------------------------------------------------------

const LAYOUT = { desktop: { x: 0, y: 0, w: 24, h: 8, z: 0 } };

function heading(bindings?: unknown) {
  return { id: "h1", kind: "heading", text: "Napis projektowy", level: 2, layout: LAYOUT, ...(bindings ? { bindings } : {}) };
}
function image(bindings?: unknown) {
  return { id: "i1", kind: "image", alt: "Opis", layout: LAYOUT, ...(bindings ? { bindings } : {}) };
}
function button(bindings?: unknown) {
  return { id: "b1", kind: "button", label: "Napisz", href: "/store", layout: LAYOUT, ...(bindings ? { bindings } : {}) };
}

const POZYCJA = "11111111-1111-4111-8111-111111111111";
const CUDZA_POZYCJA = "22222222-2222-4222-8222-222222222222";

function wiazanie(field: string, extra: Record<string, unknown> = {}) {
  return { record: { kind: "product", productId: POZYCJA }, field, ...extra };
}

const WARTOSCI: ProductBindingValues = {
  name: "Terminal satelitarny",
  price: "od 120,00 zł / doba",
  description: "Internet tam, gdzie nie ma zasięgu.",
  image: { url: "https://przyklad/zdjecie.jpg", alt: "Terminal na statywie" },
};

// -----------------------------------------------------------------------
// 1. Lista zamknięta — literał
// -----------------------------------------------------------------------

describe("zamknięta lista wiązalnych atrybutów", () => {
  /**
   * LITERAŁ, NIE ODCZYT. Ten obiekt jest spisany z ręki i jego jedynym zadaniem
   * jest zapalić się, gdy ktoś doda (albo zabierze) wiązalny atrybut. Jeśli
   * zmiana jest zamierzona, poprawia się DWA miejsca — i to jest cena, o którą
   * chodzi: powierzchnia publiczna nie ma rosnąć przy okazji refaktoru.
   */
  const OCZEKIWANE = {
    heading: { text: "text" },
    text: { text: "text" },
    button: { label: "text" },
    image: { source: "image" },
  } as const;

  it("rejestr rdzenia zgadza się co do jednego wpisu z literałem kontraktu", () => {
    expect(BINDABLE_ATTRIBUTES).toEqual(OCZEKIWANE);
    expect([...BINDABLE_ELEMENT_KINDS].sort()).toEqual(Object.keys(OCZEKIWANE).sort());
  });

  it("rodzaje spoza listy nie mają ani jednego wiązalnego atrybutu", () => {
    for (const kind of ["icon", "shape", "catalog"]) {
      expect(bindableAttributesOf(kind)).toEqual([]);
    }
  });

  /**
   * ADRES PRZYCISKU jest wymieniony z imienia, bo to jest atrybut, którego
   * dopisanie byłoby najłatwiejsze i najgorsze: cel odnośnika przechodzi przez
   * allowlistę schematów przy ZAPISIE, a wartość podstawiana przy RENDERZE
   * weszłaby za tę bramkę.
   */
  it("adres przycisku, opis zdjęcia i nazwa ikony są POZA listą", () => {
    expect(bindableAttributeKind("button", "href")).toBeUndefined();
    expect(bindableAttributeKind("image", "alt")).toBeUndefined();
    expect(bindableAttributeKind("icon", "name")).toBeUndefined();
    expect(bindableAttributeKind("heading", "level")).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// 2. Lista zamknięta — schematy elementów (drugi kierunek)
// -----------------------------------------------------------------------

describe("schemat treści przyjmuje DOKŁADNIE to, co mówi rejestr", () => {
  const SCHEMATY = {
    heading: headingElementSchema,
    text: textElementSchema,
    button: buttonElementSchema,
    image: imageElementSchema,
  } as const;

  /** Wiązanie poprawne dla danego typu wartości — do sondowania schematu. */
  function probka(value: string) {
    return value === "image" ? wiazanie("image") : wiazanie("name");
  }

  it("każdy atrybut z rejestru PARSUJE SIĘ w schemacie swojego rodzaju", () => {
    for (const kind of BINDABLE_ELEMENT_KINDS) {
      for (const { attribute, value } of bindableAttributesOf(kind)) {
        const bindings = { [attribute]: probka(value) };
        const element =
          kind === "image"
            ? image(bindings)
            : kind === "button"
              ? button(bindings)
              : kind === "text"
                ? { id: "t1", kind: "text", text: "Akapit projektowy", layout: LAYOUT, bindings }
                : heading(bindings);
        const parsed = SCHEMATY[kind].safeParse(element);
        expect(parsed.success, `${kind}.${attribute}`).toBe(true);
      }
    }
  });

  /**
   * SONDA 2 Z BRIEFU: atrybut SPOZA listy ma być ODRZUCONY, a nie „po prostu
   * nierysowany". Cicha tolerancja jest przyszłą dziurą — treść, która przeszła,
   * zostaje w bazie i czeka na moment, w którym render zacznie ją czytać.
   */
  it("atrybut spoza listy WYWRACA parsowanie elementu, a nie jest ignorowany", () => {
    const zNadmiarem = headingElementSchema.safeParse(
      heading({ text: wiazanie("name"), level: wiazanie("name") }),
    );
    expect(zNadmiarem.success).toBe(false);
    expect(JSON.stringify(zNadmiarem.error?.issues)).toContain("level");

    // Ten sam nadmiar wchodzi też przez unię elementów płótna — czyli tą samą
    // drogą, którą jedzie treść zapisywana przez panel i czytana przez sklep.
    expect(canvasElementSchema.safeParse(heading({ href: wiazanie("name") })).success).toBe(false);
  });

  /**
   * DRUGI KIERUNEK TEGO SAMEGO KONTRAKTU. Test wyżej idzie REJESTR → SCHEMAT
   * („co deklarujemy, to się parsuje"). Ten idzie SCHEMAT → REJESTR: dla
   * KAŻDEGO rodzaju sondujemy komplet nazw atrybutów występujących gdziekolwiek
   * w systemie i wymagamy, żeby schemat przyjął WYŁĄCZNIE te z jego wpisu.
   * Bez tego poszerzenie schematu (bez ruszania rejestru) przechodziłoby cicho.
   */
  it("schemat NIE przyjmuje ani jednego atrybutu spoza wpisu swojego rodzaju", () => {
    const wszystkie = new Set<string>([
      ...Object.values(BINDABLE_ATTRIBUTES).flatMap((wpis) => Object.keys(wpis)),
      "href",
      "alt",
      "level",
      "variant",
      "fit",
      "name",
      "runs",
    ]);

    for (const kind of BINDABLE_ELEMENT_KINDS) {
      const wlasne = new Set(bindableAttributesOf(kind).map((entry) => entry.attribute));
      for (const attribute of wszystkie) {
        if (wlasne.has(attribute)) continue;
        const bindings = { [attribute]: wiazanie("name") };
        const element =
          kind === "image"
            ? image(bindings)
            : kind === "button"
              ? button(bindings)
              : kind === "text"
                ? { id: "t1", kind: "text", text: "Akapit projektowy", layout: LAYOUT, bindings }
                : heading(bindings);
        expect(SCHEMATY[kind].safeParse(element).success, `${kind}.${attribute}`).toBe(false);
      }
    }
  });

  it("rodzaje bez wiązań nie przyjmują klucza `bindings` w ogóle", () => {
    const ikona = { id: "ic", kind: "icon", name: "truck", layout: LAYOUT, bindings: { name: wiazanie("name") } };
    const ksztalt = { id: "sh", kind: "shape", layout: LAYOUT, bindings: { fill: wiazanie("name") } };
    expect(iconElementSchema.safeParse(ikona).success).toBe(false);
    expect(shapeElementSchema.safeParse(ksztalt).success).toBe(false);
  });

  it("element bez wiązań parsuje się dokładnie tak, jak przed fazą 3", () => {
    const parsed = headingElementSchema.safeParse(heading());
    expect(parsed.success).toBe(true);
    expect(parsed.success && "bindings" in parsed.data).toBe(false);
  });
});

// -----------------------------------------------------------------------
// 3. Zgodność typów
// -----------------------------------------------------------------------

describe("zgodność typów jest w schemacie, nie w uprzejmości interfejsu", () => {
  it("lista wiązalnych pól rozkłada się po typie wartości", () => {
    expect(productBindingFieldsOf("text")).toEqual(["name", "price", "description"]);
    expect(productBindingFieldsOf("image")).toEqual(["image"]);
    expect([...PRODUCT_BINDING_FIELD_KEYS].sort()).toEqual(
      Object.keys(PRODUCT_BINDING_FIELDS).sort(),
    );
  });

  it("CENA nie wchodzi w źródło zdjęcia", () => {
    expect(imageElementSchema.safeParse(image({ source: wiazanie("price") })).success).toBe(false);
  });

  it("ZDJĘCIE nie wchodzi w napis nagłówka ani w etykietę przycisku", () => {
    expect(headingElementSchema.safeParse(heading({ text: wiazanie("image") })).success).toBe(false);
    expect(buttonElementSchema.safeParse(button({ label: wiazanie("image") })).success).toBe(false);
  });

  it("pole spoza zamkniętej listy nie przechodzi", () => {
    expect(headingElementSchema.safeParse(heading({ text: wiazanie("deposit") })).success).toBe(false);
    expect(headingElementSchema.safeParse(heading({ text: wiazanie("availability") })).success).toBe(false);
  });
});

// -----------------------------------------------------------------------
// 4. Wartość zastępcza — bramka „nie ma gdzie wpisać ceny"
// -----------------------------------------------------------------------

describe("wartość zastępcza istnieje tylko tam, gdzie pole bywa puste", () => {
  it("opis (bywa pusty) przyjmuje wartość zastępczą", () => {
    const parsed = headingElementSchema.safeParse(
      heading({ text: wiazanie("description", { whenEmpty: "fallback", fallback: "Brak opisu" }) }),
    );
    expect(parsed.success).toBe(true);
  });

  /**
   * TO JEST TA BRAMKA. Cena w katalogu jest zawsze wypełniona, więc „wartość
   * zastępcza ceny" byłaby napisem, którego nikt nigdy nie zobaczy — czyli
   * miejscem, w które operator wpisuje 45 zł „na wszelki wypadek", i drugim
   * źródłem prawdy o cenie. Schemat nie ma dla niej miejsca.
   */
  it("CENA nie ma jak nieść napisu — ani przez tryb, ani przez samo pole", () => {
    expect(
      headingElementSchema.safeParse(
        heading({ text: wiazanie("price", { whenEmpty: "fallback", fallback: "45 zł / doba" }) }),
      ).success,
    ).toBe(false);
    expect(
      headingElementSchema.safeParse(heading({ text: wiazanie("price", { fallback: "45 zł / doba" }) }))
        .success,
    ).toBe(false);
    expect(
      headingElementSchema.safeParse(heading({ text: wiazanie("name", { whenEmpty: "fallback" }) })).success,
    ).toBe(false);
  });

  it("ZDJĘCIE nie zna wartości zastępczej — klucza nie ma w kształcie", () => {
    expect(
      imageElementSchema.safeParse(
        image({ source: wiazanie("image", { whenEmpty: "fallback", fallback: "Brak zdjęcia" }) }),
      ).success,
    ).toBe(false);
    expect(
      imageElementSchema.safeParse(image({ source: wiazanie("image", { fallback: "cokolwiek" }) })).success,
    ).toBe(false);
  });

  it("domyślnym zachowaniem przy pustce jest WYCIĘCIE węzła", () => {
    const parsed = headingElementSchema.safeParse(heading({ text: wiazanie("description") }));
    expect(parsed.success && parsed.data.bindings?.text?.whenEmpty).toBe("hide");
  });
});

// -----------------------------------------------------------------------
// 5. Rozwiązanie wiązania
// -----------------------------------------------------------------------

describe("rozwiązanie wiązania", () => {
  const binding = (field: string, extra: Record<string, unknown> = {}) =>
    ({ record: { kind: "product", productId: POZYCJA }, field, whenEmpty: "hide", ...extra }) as ElementBinding;

  it("oddaje wartość TEGO rekordu, nigdy napisu z treści", () => {
    expect(resolveProductBinding(binding("name"), WARTOSCI)).toEqual({
      kind: "text",
      text: "Terminal satelitarny",
    });
    expect(resolveProductBinding(binding("price"), WARTOSCI)).toEqual({
      kind: "text",
      text: "od 120,00 zł / doba",
    });
    expect(resolveProductBinding(binding("image"), WARTOSCI)).toEqual({
      kind: "image",
      url: "https://przyklad/zdjecie.jpg",
      alt: "Terminal na statywie",
    });
  });

  it("BRAK REKORDU wycina węzeł — nie oddaje pustego napisu", () => {
    expect(resolveProductBinding(binding("name"), undefined)).toBeNull();
    expect(resolveProductBinding(binding("image"), undefined)).toBeNull();
  });

  it("puste pole wycina węzeł, a z wartością zastępczą oddaje ją", () => {
    const puste: ProductBindingValues = { ...WARTOSCI, description: null };
    expect(resolveProductBinding(binding("description"), puste)).toBeNull();
    expect(
      resolveProductBinding(
        binding("description", { whenEmpty: "fallback", fallback: "Opis w przygotowaniu" }),
        puste,
      ),
    ).toEqual({ kind: "text", text: "Opis w przygotowaniu" });
  });

  it("napis z samych spacji liczy się jako pustka", () => {
    expect(resolveProductBinding(binding("description"), { ...WARTOSCI, description: "   " })).toBeNull();
  });

  it("pole spoza zamkniętej listy nie ma jak oddać wartości", () => {
    const przemycone = { record: { kind: "product", productId: POZYCJA }, field: "deposit", whenEmpty: "hide" };
    expect(resolveProductBinding(przemycone as unknown as ElementBinding, WARTOSCI)).toBeNull();
  });
});

// -----------------------------------------------------------------------
// 6. Odczyt wiązań z elementu
// -----------------------------------------------------------------------

describe("odczyt wiązań z elementu idzie po liście zamkniętej", () => {
  it("wskazuje wiązanie atrybutu z listy", () => {
    const element = { kind: "heading", bindings: { text: wiazanie("name") } };
    expect(bindingOf(element, "text")).toBeDefined();
    expect(isBoundAttribute(element, "text")).toBe(true);
    expect(hasBindings(element)).toBe(true);
  });

  /**
   * DRUGI ZAMEK. Treść z atrybutem spoza listy nie przechodzi przez schemat,
   * ale gdyby weszła inną drogą (ręcznie sklecony obiekt w kodzie, starsza
   * treść po zmianie listy), render nie ma prawa jej przeczytać.
   */
  it("atrybut spoza listy jest niewidzialny dla renderu, choćby stał w treści", () => {
    const element = { kind: "heading", bindings: { href: wiazanie("name") } };
    expect(bindingOf(element, "href")).toBeUndefined();
    expect(hasBindings(element)).toBe(false);
  });

  it("rodzaj spoza listy nie ma wiązań, nawet gdy treść coś niesie", () => {
    expect(bindingOf({ kind: "icon", bindings: { name: wiazanie("name") } }, "name")).toBeUndefined();
  });

  it("cudza pozycja jest w treści zwykłym identyfikatorem — rozstrzyga render", () => {
    // Sam model nie zna katalogu; zawężenie do katalogu najemcy stoi w warstwie
    // renderu (patrz `binding-render.test.tsx` w @avably/ui). Tu pilnujemy tylko,
    // że treść nie niesie ŻADNEJ kopii wartości, którą dałoby się pokazać bez
    // rekordu.
    const element = { kind: "heading", bindings: { text: wiazanie("price") } };
    expect(JSON.stringify(element)).not.toContain("zł");
    expect(bindingOf(element, "text")?.record).toEqual({ kind: "product", productId: POZYCJA });
    expect(CUDZA_POZYCJA).not.toEqual(POZYCJA);
  });
});
