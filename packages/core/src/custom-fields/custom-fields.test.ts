import { describe, expect, it } from "vitest";

import {
  CUSTOM_FIELD_LIMITS,
  CUSTOM_FIELD_TYPES,
  customFieldDefinitionFromRow,
  nextCustomFieldPosition,
  optionsForType,
  parseCustomFieldInput,
  parseSelectOptions,
  readCustomFieldValues,
  validateCustomFieldValues,
  visibleCustomFields,
  type CustomFieldDefinition,
  type CustomFieldType,
} from "./index";
import { CUSTOM_FIELD_PARITY_VECTORS } from "./vectors";

const ID = {
  text: "11111111-1111-4111-8111-111111111111",
  textarea: "22222222-2222-4222-8222-222222222222",
  number: "33333333-3333-4333-8333-333333333333",
  date: "44444444-4444-4444-8444-444444444444",
  select: "55555555-5555-4555-8555-555555555555",
  checkbox: "66666666-6666-4666-8666-666666666666",
  phone: "77777777-7777-4777-8777-777777777777",
} as const;

function def(
  type: CustomFieldType,
  overrides: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition {
  return {
    id: ID[type],
    entity: "customer",
    type,
    label: `Pole ${type}`,
    helpText: null,
    required: false,
    options: type === "select" ? ["Alfa", "Beta"] : [],
    position: 0,
    showInPanel: true,
    showInCheckout: false,
    showInContract: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const ALL = CUSTOM_FIELD_TYPES.map((type) => def(type));

describe("zamknięta lista typów", () => {
  it("nie zawiera typu plikowego (ADR-118 / ADR-113)", () => {
    // Bramka intencji, nie stylu: gdyby ktoś dołożył „file", ten test ma
    // zmusić do przeczytania decyzji, a nie do dopisania stringa.
    expect(CUSTOM_FIELD_TYPES).not.toContain("file");
    expect(CUSTOM_FIELD_TYPES).toHaveLength(7);
  });

  it("każdy zadeklarowany typ ma gałąź walidacji (fail-closed)", () => {
    for (const definition of ALL) {
      const rubbish = validateCustomFieldValues([definition], {
        [definition.id]: { nie: "wartość" } as never,
      });
      expect(rubbish.issues[definition.id], `typ ${definition.type} bez gałęzi`).toBe("type");
    }
  });
});

describe("walidacja wartości względem definicji", () => {
  it("przyjmuje wartość poprawną dla każdego typu", () => {
    const values = {
      [ID.text]: "Numer uprawnień 123",
      [ID.textarea]: "Linia 1\nLinia 2\tz tabulatorem",
      [ID.number]: 1234.5,
      [ID.date]: "2026-08-09",
      [ID.select]: "Beta",
      [ID.checkbox]: true,
      [ID.phone]: "+48 501 234 567",
    };
    const result = validateCustomFieldValues(ALL, values);
    expect(result.issues).toEqual({});
    expect(result.values).toEqual(values);
  });

  it("odrzuca wartość pod nieznanym identyfikatorem (lustro odmowy 22023)", () => {
    const result = validateCustomFieldValues(ALL, {
      "99999999-9999-4999-8999-999999999999": "cokolwiek",
    });
    expect(result.issues["99999999-9999-4999-8999-999999999999"]).toBe("unknownDefinition");
    expect(result.values).toEqual({});
  });

  it("odrzuca klucz, który nie jest identyfikatorem definicji", () => {
    const result = validateCustomFieldValues(ALL, { "numer uprawnien": "X" });
    expect(result.issues["numer uprawnien"]).toBe("unknownDefinition");
  });

  it("odrzuca wartość pod definicją zarchiwizowaną", () => {
    const archived = def("text", { archivedAt: "2026-08-01T00:00:00Z" });
    const result = validateCustomFieldValues([archived], { [archived.id]: "nowa" });
    expect(result.issues[archived.id]).toBe("archived");
  });

  it("odrzuca stringa tam, gdzie definicja mówi liczba (a nie zamienia go po cichu)", () => {
    const result = validateCustomFieldValues(ALL, { [ID.number]: "1234" as never });
    expect(result.issues[ID.number]).toBe("type");
    expect(result.values[ID.number]).toBeUndefined();
  });

  it("odrzuca wartość spoza listy opcji", () => {
    expect(validateCustomFieldValues(ALL, { [ID.select]: "Gamma" }).issues[ID.select]).toBe("option");
  });

  it("odrzuca datę o poprawnym kształcie, ale nieistniejącą", () => {
    expect(validateCustomFieldValues(ALL, { [ID.date]: "2026-02-31" }).issues[ID.date]).toBe("date");
    expect(validateCustomFieldValues(ALL, { [ID.date]: "09.08.2026" }).issues[ID.date]).toBe("date");
  });

  it("odrzuca znaki sterujące w tekście, ale nie łamanie wiersza w tekście długim", () => {
    expect(validateCustomFieldValues(ALL, { [ID.text]: "a\u0001b" }).issues[ID.text]).toBe(
      "controlChars",
    );
    expect(validateCustomFieldValues(ALL, { [ID.text]: "a\nb" }).issues[ID.text]).toBe(
      "controlChars",
    );
    expect(validateCustomFieldValues(ALL, { [ID.textarea]: "a\nb" }).issues[ID.textarea]).toBeUndefined();
    expect(validateCustomFieldValues(ALL, { [ID.textarea]: "a\u0001b" }).issues[ID.textarea]).toBe(
      "controlChars",
    );
  });

  it("pilnuje długości i zakresu", () => {
    expect(
      validateCustomFieldValues(ALL, { [ID.text]: "x".repeat(CUSTOM_FIELD_LIMITS.textMax + 1) })
        .issues[ID.text],
    ).toBe("tooLong");
    expect(validateCustomFieldValues(ALL, { [ID.number]: 1e13 }).issues[ID.number]).toBe("range");
    expect(validateCustomFieldValues(ALL, { [ID.number]: 1.1234567 }).issues[ID.number]).toBe("range");
  });

  it("odrzuca telefon bez sensownej liczby cyfr", () => {
    expect(validateCustomFieldValues(ALL, { [ID.phone]: "12345" }).issues[ID.phone]).toBe("phone");
    expect(validateCustomFieldValues(ALL, { [ID.phone]: "nie-telefon" }).issues[ID.phone]).toBe(
      "phone",
    );
  });

  it("pilnuje sumarycznego rozmiaru mapy, nie tylko pojedynczego pola", () => {
    // Każde pole z osobna mieści się w limicie; dopiero SUMA przekracza
    // granicę kolumny. Limit per pole nie zastępuje limitu całości.
    const ids = [
      "a1111111-1111-4111-8111-111111111111",
      "a2222222-2222-4222-8222-222222222222",
      "a3333333-3333-4333-8333-333333333333",
    ] as const;
    const long = "ą".repeat(CUSTOM_FIELD_LIMITS.textareaMax);
    const definitions = ids.map((id) => def("textarea", { id }));
    const values = Object.fromEntries(ids.map((id) => [id, long]));
    expect(validateCustomFieldValues(definitions, values).issues["*"]).toBe("tooLarge");
    expect(
      validateCustomFieldValues([def("textarea", { id: ids[0] })], { [ids[0]]: long }).issues,
    ).toEqual({});
  });
});

describe("wymagalność — reguła WYŁĄCZNIE formularza", () => {
  it("zgłasza brak wartości pola wymaganego", () => {
    const required = def("text", { required: true });
    expect(validateCustomFieldValues([required], {}).issues[required.id]).toBe("required");
  });

  it("niezaznaczony checkbox nie spełnia wymogu", () => {
    const required = def("checkbox", { required: true });
    expect(validateCustomFieldValues([required], { [required.id]: false }).issues[required.id]).toBe(
      "required",
    );
  });

  it("nie zgłasza braku, gdy wymagalności nie egzekwujemy (zapis częściowy)", () => {
    const required = def("text", { required: true });
    expect(
      validateCustomFieldValues([required], {}, { requireRequired: false }).issues,
    ).toEqual({});
  });

  it("pole zarchiwizowane nie jest już wymagane", () => {
    const required = def("text", { required: true, archivedAt: "2026-08-01T00:00:00Z" });
    expect(validateCustomFieldValues([required], {}).issues).toEqual({});
  });

  it("wymagalność liczy się tylko na powierzchni, na której pole jest widoczne", () => {
    const required = def("text", { required: true, showInCheckout: false });
    expect(validateCustomFieldValues([required], {}, { surface: "checkout" }).issues).toEqual({});
    expect(validateCustomFieldValues([required], {}, { surface: "panel" }).issues[required.id]).toBe(
      "required",
    );
  });
});

describe("widoczność i kolejność", () => {
  it("zarchiwizowane znika z formularza, choć wartości zostają w danych", () => {
    const live = def("text");
    const archived = def("number", { archivedAt: "2026-08-01T00:00:00Z" });
    expect(visibleCustomFields([live, archived], "panel").map((d) => d.id)).toEqual([live.id]);
  });

  it("sortuje po pozycji, a remis rozstrzyga czas utworzenia — jak indeks w bazie", () => {
    // Remis MUSI iść tak samo jak `(tenant_id, entity, position, created_at)`
    // i jak zapytanie ekranu ustawień. Rozstrzyganie po `id` dawałoby inną
    // kolejność na ekranie, a inną na formularzu i na umowie.
    const a = def("text", {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      position: 5,
      createdAt: "2026-01-01T00:00:00Z",
    });
    const b = def("number", {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      position: 5,
      createdAt: "2026-02-01T00:00:00Z",
    });
    const c = def("date", { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", position: 1 });
    expect(visibleCustomFields([b, a, c], "panel").map((d) => d.id)).toEqual([c.id, a.id, b.id]);
  });

  it("filtruje po powierzchni i po encji", () => {
    const contract = def("text", { showInContract: true });
    const order = def("number", { entity: "order", showInContract: true });
    expect(visibleCustomFields([contract, order], "contract", "order").map((d) => d.id)).toEqual([
      order.id,
    ]);
    expect(visibleCustomFields([contract, order], "checkout")).toEqual([]);
  });
});

describe("odczyt z formularza", () => {
  const form = new Map<string, string>([
    [`cf_${ID.text}`, "  Numer 7  "],
    [`cf_${ID.number}`, "1 234,50"],
    [`cf_${ID.date}`, "2026-08-09"],
    [`cf_${ID.select}`, "Alfa"],
    [`cf_${ID.checkbox}`, "on"],
    [`cf_${ID.phone}`, "501 234 567"],
    [`cf_${ID.textarea}`, "   "],
  ]);

  it("typuje wartości i przycina tekst", () => {
    const result = readCustomFieldValues(ALL, (name) => form.get(name) ?? null);
    expect(result.issues).toEqual({});
    expect(result.values[ID.text]).toBe("Numer 7");
    expect(result.values[ID.number]).toBe(1234.5);
    expect(result.values[ID.checkbox]).toBe(true);
    // Pusty wpis nie tworzy klucza — pustka ma JEDNĄ reprezentację.
    expect(Object.hasOwn(result.values, ID.textarea)).toBe(false);
  });

  it("nie wpuszcza wartości pola zarchiwizowanego, nawet gdy przyszła w formularzu", () => {
    const archived = def("text", { archivedAt: "2026-08-01T00:00:00Z" });
    const result = readCustomFieldValues([archived], () => "podrzucone");
    expect(result.values).toEqual({});
    expect(result.issues).toEqual({});
  });

  it("zgłasza liczbę, która liczbą nie jest", () => {
    const result = readCustomFieldValues([def("number")], () => "dwa i pół");
    expect(result.issues[ID.number]).toBe("number");
  });

  it("niezaznaczony checkbox to false, nie brak pola", () => {
    expect(parseCustomFieldInput(def("checkbox"), null)).toEqual({ value: false });
  });
});

describe("mapowanie wiersza bazy", () => {
  const row = {
    id: ID.select,
    entity: "product",
    field_type: "select",
    label: "Rozmiar",
    help_text: null,
    required: true,
    options: ["S", "M"],
    position: 3,
    show_in_panel: true,
    show_in_checkout: true,
    show_in_contract: false,
    archived_at: null,
  };

  it("mapuje na kształt domenowy", () => {
    const definition = customFieldDefinitionFromRow(row);
    expect(definition).toMatchObject({ entity: "product", type: "select", options: ["S", "M"] });
  });

  it("rzuca na typie spoza zamkniętej listy zamiast podstawić domyślny", () => {
    expect(() => customFieldDefinitionFromRow({ ...row, field_type: "file" })).toThrow(/file/);
    expect(() => customFieldDefinitionFromRow({ ...row, entity: "invoice" })).toThrow(/invoice/);
  });
});

describe("opcje listy wyboru", () => {
  it("rozbija po wierszach i przycina", () => {
    expect(parseSelectOptions("Alfa\n  Beta  \n\nGamma\n").options).toEqual([
      "Alfa",
      "Beta",
      "Gamma",
    ]);
  });

  it("odrzuca pustą listę, duplikat i opcję za długą", () => {
    expect(parseSelectOptions("").issue).toBe("empty");
    expect(parseSelectOptions("Alfa\nalfa").issue).toBe("duplicate");
    expect(parseSelectOptions("x".repeat(CUSTOM_FIELD_LIMITS.optionMax + 1)).issue).toBe("tooLong");
    expect(
      parseSelectOptions(
        Array.from({ length: CUSTOM_FIELD_LIMITS.optionsMax + 1 }, (_, i) => `o${i}`).join("\n"),
      ).issue,
    ).toBe("tooMany");
  });

  it("dla typu innego niż select zwraca pustą tablicę, choćby operator coś wpisał", () => {
    expect(optionsForType("text", "Alfa\nBeta")).toEqual({ options: [] });
    expect(optionsForType("select", "Alfa").options).toEqual(["Alfa"]);
  });
});

describe("pozycja nowego pola", () => {
  it("nowe pole ląduje na końcu", () => {
    expect(nextCustomFieldPosition([])).toBe(0);
    expect(nextCustomFieldPosition([0, 3, 1])).toBe(4);
  });

  it("nie przekracza granicy kolumny", () => {
    expect(nextCustomFieldPosition([CUSTOM_FIELD_LIMITS.positionMax])).toBe(
      CUSTOM_FIELD_LIMITS.positionMax,
    );
  });
});

describe("parytet ze wspólnymi wektorami (te same przechodzą przez trigger 0057)", () => {
  // Zestaw jest JEDEN i mieszka w @avably/core/custom-fields/vectors — ta sama
  // tablica jedzie przez PRAWDZIWY trigger w packages/db/test/custom-fields.test.ts.
  // Dwie kopie wektorów byłyby tą samą pułapką co dwie kopie reguły.
  it("zestaw nie jest pusty (asercja anty-pustkowa)", () => {
    expect(CUSTOM_FIELD_PARITY_VECTORS.length).toBeGreaterThanOrEqual(30);
    expect(CUSTOM_FIELD_PARITY_VECTORS.some((v) => v.valid)).toBe(true);
    expect(CUSTOM_FIELD_PARITY_VECTORS.some((v) => !v.valid)).toBe(true);
  });

  for (const vector of CUSTOM_FIELD_PARITY_VECTORS) {
    it(`${vector.name} → ${vector.valid ? "przyjęta" : "odrzucona"}`, () => {
      const definition = def(vector.type, {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        options: vector.options ? [...vector.options] : [],
      });
      const result = validateCustomFieldValues([definition], {
        [definition.id]: vector.value as never,
      });
      const rejected = Boolean(result.issues[definition.id]);
      expect(rejected, `${vector.name}: rdzeń rozstrzygnął inaczej niż kontrakt`).toBe(!vector.valid);
    });
  }
});
