/**
 * KONTRAKTY FUNDAMENTU SEKCJI STRUKTURALNYCH (E1, ADR-094).
 *
 * Plik jest napisany tak, żeby NIE DAŁO SIĘ go przejść przez pominięcie —
 * ta sama zasada, co w kontrakcie kontrastu (ADR-090): pętle chodzą po
 * REJESTRZE (`STRUCTURED_SECTIONS`), a nie po liście przypadków spisanej obok.
 * Dopisanie typu strukturalnego (galeria, cennik, opinie…) to automatycznie
 * kilkadziesiąt nowych sprawdzeń, o których nikt nie musiał pamiętać.
 *
 * Osłona anty-pusty-zbiór stoi na początku: pętla po pustym rejestrze przechodzi
 * na zielono i nie broni NICZEGO, więc rozmiar zbioru jest tu osobnym zdaniem.
 *
 * Cztery kontrakty fundamentu:
 *   1. BEZSTRATNOŚĆ UKŁADU — przełączenie wariantu nie dotyka danych;
 *   2. ROZŁĄCZNOŚĆ GENERACJI — v1/v2/v3 nie mylą się w żadną stronę;
 *   3. KOMPLETNOŚĆ OKABLOWANIA — treść v3 przechodzi WSZYSTKIMI czterema
 *      drogami modelu (zapis, odczyt szkicu, wejście upsertu, odczyt publiczny);
 *   4. ZGODA REJESTRU ZE SCHEMATEM — granice listy wpisów deklarowane w
 *      rejestrze są tymi, których naprawdę pilnuje Zod.
 */
import { describe, expect, it } from "vitest";

import {
  GALLERY_COLUMNS,
  GALLERY_GAPS,
  GALLERY_LAYOUTS,
  SECTION_DRAFT_SCHEMAS,
  SECTION_TYPES,
  STRUCTURED_SECTIONS,
  galleryItemsFromLegacy,
  structuredFromLegacy,
  STRUCTURED_SECTION_TYPES,
  STRUCTURED_SECTION_VERSION,
  STRUCTURED_THEME_ROLES,
  appendStructuredItem,
  faqPageJsonLd,
  isStructuredSection,
  isStructuredType,
  moveStructuredItem,
  patchStructuredItem,
  publishedSectionSchema,
  removeStructuredItem,
  sectionInputSchema,
  structuredNewItemFor,
  structuredPresetFor,
  structuredSpecOf,
  withStructuredLayout,
  type StructuredChoiceSpec,
  type StructuredSectionContent,
  type StructuredSectionType,
} from "./index";

const LOCALES = ["pl", "en"] as const;

/** Wpisy treści strukturalnej — każdy typ z rejestru jest listowy. */
function itemsOf(content: StructuredSectionContent): unknown[] {
  return (content as unknown as { items: unknown[] }).items;
}

/**
 * Wpis, którym wolno wypełnić listę w testach granic. Typ z przyciskiem „dodaj"
 * daje go wprost; typ, w którym wpis rodzi się z WGRANIA PLIKU (galeria), nie
 * ma czego dać — bierzemy wtedy pierwszy wpis presetu, bo to jedyny wpis tego
 * typu, o którym rejestr twierdzi wprost, że jest poprawny.
 */
function sampleItemFor(type: StructuredSectionType): unknown {
  const fresh = structuredNewItemFor(type, "pl");
  if (fresh !== undefined) return fresh;
  return structuredClone(itemsOf(structuredPresetFor(type, "pl"))[0]);
}

/**
 * Pola wpisu, w które operator WPISUJE dowolny napis. Odpada zdjęcie (wartością
 * jest źródło, nie tekst) i odpada lista o zamkniętym zbiorze wartości (E4:
 * rodzaj danych kontaktowych — napis spoza zbioru nie jest „inną treścią",
 * tylko treścią, której schemat nie przyjmie). Zbiory wartości list mają własny
 * kontrakt niżej.
 */
function textFieldsOf(type: StructuredSectionType) {
  return structuredSpecOf(type).itemFields.filter(
    (field) => field.kind === "text" || field.kind === "multiline",
  );
}

/** Pola wpisu o ZAMKNIĘTYM zbiorze wartości (E4). */
function choiceFieldsOf(type: StructuredSectionType) {
  return structuredSpecOf(type).itemFields.filter((field) => field.kind === "choice");
}

/** Preset z podmienioną listą wpisów o zadanej długości (do testów granic). */
function withItemCount(
  type: StructuredSectionType,
  count: number,
): Record<string, unknown> {
  const preset = structuredPresetFor(type, "pl") as unknown as Record<string, unknown>;
  const sample = sampleItemFor(type);
  return {
    ...preset,
    items: Array.from({ length: count }, () => structuredClone(sample)),
  };
}

/**
 * Preset z KAŻDYM przełącznikiem odwróconym względem wartości domyślnej i ze
 * zmienionym nagłówkiem — wejście dla kontraktów, które mają dowieść „nic nie
 * zostało ruszone". Na presecie takie kontrakty są ślepe na przekształcenia
 * ustawiające wartości domyślne.
 */
function flipAllToggles(type: StructuredSectionType): StructuredSectionContent {
  const content = structuredPresetFor(type, "pl") as unknown as Record<string, unknown>;
  content.heading = "Nagłówek zmieniony przez operatora";
  for (const toggle of structuredSpecOf(type).toggles) {
    content[toggle.key] = !content[toggle.key];
  }
  return content as unknown as StructuredSectionContent;
}

describe("rejestr typów strukturalnych — osłona anty-pusty-zbiór", () => {
  it("rejestr NIE jest pusty i każdy wpis ma komplet opisu", () => {
    expect(STRUCTURED_SECTION_TYPES.length, "pusty rejestr = bramki niżej nic nie bronią").toBeGreaterThan(0);
    for (const type of STRUCTURED_SECTION_TYPES) {
      const spec = structuredSpecOf(type);
      expect(spec.layouts.length, `typ "${type}" bez wariantów układu`).toBeGreaterThan(0);
      expect(spec.itemFields.length, `typ "${type}" bez pól wpisu — mini-CMS nie ma czego pokazać`).toBeGreaterThan(0);
      expect(spec.themeRoles.length, `typ "${type}" bez ról motywu — wypada z macierzy kontrastu`).toBeGreaterThan(0);
      expect(spec.minItems, `typ "${type}": podłoga listy poniżej jednego wpisu`).toBeGreaterThanOrEqual(1);
      expect(spec.maxItems, `typ "${type}": sufit listy nie jest większy od podłogi`).toBeGreaterThan(spec.minItems);
    }
  });

  it("każdy typ strukturalny jest ZNANYM typem sekcji (lustro CHECK-a w bazie)", () => {
    for (const type of STRUCTURED_SECTION_TYPES) {
      expect(SECTION_TYPES as readonly string[], `typ "${type}" spoza SECTION_TYPES`).toContain(type);
      expect(isStructuredType(type)).toBe(true);
    }
    expect(isStructuredType("hero"), "hero jest płótnowy — nie może udawać strukturalnego").toBe(false);
  });

  it("domyślny układ i role motywu pochodzą z własnych allowlist", () => {
    for (const type of STRUCTURED_SECTION_TYPES) {
      const spec = structuredSpecOf(type);
      expect(spec.layouts, `domyślny układ typu "${type}" spoza jego rejestru wariantów`).toContain(
        spec.defaultLayout,
      );
      for (const role of spec.themeRoles) {
        expect(
          STRUCTURED_THEME_ROLES as readonly string[],
          `typ "${type}" deklaruje rolę "${role}" spoza allowlisty ról motywu`,
        ).toContain(role);
      }
    }
  });
});

describe("presety strukturalne: poprawność i parytet PL/EN", () => {
  it.each(STRUCTURED_SECTION_TYPES)("%s: preset spełnia schemat w OBU językach", (type) => {
    for (const locale of LOCALES) {
      const result = structuredSpecOf(type).schema.safeParse(structuredPresetFor(type, locale));
      expect(result.success, `preset ${locale}/${type}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it.each(STRUCTURED_SECTION_TYPES)("%s: PL i EN mają ten sam KSZTAŁT (różni je tylko tekst)", (type) => {
    const pl = structuredPresetFor(type, "pl") as unknown as Record<string, unknown>;
    const en = structuredPresetFor(type, "en") as unknown as Record<string, unknown>;
    expect(Object.keys(en).sort(), `parytet kluczy presetu ${type}`).toEqual(Object.keys(pl).sort());
    expect(itemsOf(en as unknown as StructuredSectionContent).length, `parytet liczby wpisów ${type}`).toBe(
      itemsOf(pl as unknown as StructuredSectionContent).length,
    );
    expect(en.layout, `parytet układu ${type}`).toBe(pl.layout);
    expect(en.background, `parytet pasa ${type}`).toBe(pl.background);
    /*
     * PARYTET WPISU liczymy po ZBIORZE KLUCZY pary PL/EN, a nie po liście pól
     * z rejestru. Powód (E3): pola bywają OPCJONALNE — kafel galerii ma podpis,
     * ale nie musi mieć odnośnika. Wymaganie „każde pole rejestru jest w każdym
     * wpisie" kazałoby więc presetowi wypełniać pola, których operator wcale
     * nie musi używać. Porównanie kluczy w parze łapie za to prawdziwą wadę:
     * wpis EN z innym kompletem pól niż PL.
     */
    const klucze = (content: Record<string, unknown>, index: number) =>
      Object.keys(
        itemsOf(content as unknown as StructuredSectionContent)[index] as Record<string, unknown>,
      ).sort();
    const dozwolone = new Set(structuredSpecOf(type).itemFields.map((field) => field.key));
    for (const [index] of itemsOf(en as unknown as StructuredSectionContent).entries()) {
      expect(klucze(en, index), `wpis ${index} presetu ${type}: PL i EN mają inne pola`).toEqual(
        klucze(pl, index),
      );
      for (const key of klucze(en, index)) {
        expect(dozwolone, `wpis ${index} presetu ${type}: pole "${key}" spoza rejestru`).toContain(key);
      }
    }
    for (const field of textFieldsOf(type)) {
      for (const [index, item] of itemsOf(en as unknown as StructuredSectionContent).entries()) {
        const value = (item as Record<string, unknown>)[field.key];
        if (value === undefined) continue;
        expect(value, `wpis ${index} presetu EN/${type}: pole "${field.key}" nie jest tekstem`).toBeTypeOf(
          "string",
        );
      }
    }
  });

  it.each(STRUCTURED_SECTION_TYPES)("%s: świeży wpis „dodaj” przechodzi schemat w OBU językach", (type) => {
    const fresh = structuredNewItemFor(type, "pl");
    if (fresh === undefined) {
      /*
       * BRAK świeżego wpisu jest DEKLARACJĄ, nie przeoczeniem: wpis tego typu
       * rodzi się z wgrania pliku (galeria), więc pusty kafel bez zdjęcia i tak
       * nie przeszedłby schematu, a przycisk „dodaj" obiecywałby operację
       * kończącą się błędem. Żeby ta deklaracja miała pokrycie, wymagamy, by
       * typ NAPRAWDĘ miał pole obrazowe — inaczej byłoby to po prostu
       * zapomniane `newItem`.
       */
      expect(
        structuredSpecOf(type).itemFields.some((field) => field.kind === "image"),
        `typ "${type}" nie ma świeżego wpisu ANI pola obrazowego — nie ma czym dodać pozycji`,
      ).toBe(true);
      expect(structuredNewItemFor(type, "en"), "brak świeżego wpisu musi być taki sam w obu językach").toBeUndefined();
      return;
    }
    for (const locale of LOCALES) {
      const content = appendStructuredItem(
        structuredPresetFor(type, locale),
        structuredNewItemFor(type, locale),
      );
      const result = structuredSpecOf(type).schema.safeParse(content);
      expect(result.success, `nowy wpis ${locale}/${type} nie przechodzi schematu`).toBe(true);
    }
  });

  it("nieznany język degraduje do PL, a nie do pustki", () => {
    for (const type of STRUCTURED_SECTION_TYPES) {
      expect(structuredPresetFor(type, "de")).toEqual(structuredPresetFor(type, "pl"));
    }
  });

  it("preset jest KOPIĄ — mutacja nie sięga stałej modułu", () => {
    for (const type of STRUCTURED_SECTION_TYPES) {
      const first = structuredPresetFor(type, "pl");
      itemsOf(first).length = 0;
      expect(itemsOf(structuredPresetFor(type, "pl")).length).toBeGreaterThan(0);
    }
  });
});

describe("KONTRAKT 1: przełączenie układu jest BEZSTRATNE", () => {
  it.each(STRUCTURED_SECTION_TYPES)(
    "%s: A → B → A daje treść identyczną, a A → B rusza WYŁĄCZNIE pole `layout`",
    (type) => {
      const spec = structuredSpecOf(type);
      /*
       * Baza celowo NIE JEST presetem. Preset ma wszystkie przełączniki
       * w wartościach domyślnych, więc przekształcenie, które je RESETUJE,
       * przechodziłoby ten test niezauważone (złapane dowodem mutacyjnym:
       * `withStructuredLayout` dopisujące `allowMultiple: false` przeżyło).
       * Odwracamy więc każdy przełącznik z rejestru i ruszamy nagłówek —
       * wtedy „nie dotyka danych” znaczy naprawdę „żadnych danych”.
       */
      const base = flipAllToggles(type);
      for (const from of spec.layouts) {
        const a = withStructuredLayout(base, from);
        for (const to of spec.layouts) {
          const b = withStructuredLayout(a, to);

          // (1) Powrót do wyjścia jest bajtowo tym samym.
          expect(withStructuredLayout(b, from), `${type}: ${from} → ${to} → ${from} zgubiło treść`).toEqual(a);

          // (2) Różnica między układami to DOKŁADNIE jedno pole. Porównanie
          //     „wszystko poza layout” łapie także pola, których ten test nie
          //     zna z nazwy — w tym te dodane przy kolejnym typie.
          const strip = (content: StructuredSectionContent) => {
            const { layout: _layout, ...rest } = content as unknown as Record<string, unknown>;
            return rest;
          };
          expect(strip(b), `${type}: przełączenie ${from} → ${to} dotknęło danych`).toEqual(strip(a));
          expect((b as unknown as Record<string, unknown>).layout).toBe(to);
        }
      }
    },
  );

  it.each(STRUCTURED_SECTION_TYPES)("%s: układ SPOZA rejestru jest ignorowany, nie zapisywany", (type) => {
    const base = structuredPresetFor(type, "pl");
    expect(withStructuredLayout(base, "układ-którego-nie-ma")).toBe(base);
  });

  it.each(STRUCTURED_SECTION_TYPES)("%s: KAŻDY wariant układu przechodzi schemat", (type) => {
    const spec = structuredSpecOf(type);
    for (const layout of spec.layouts) {
      const result = spec.schema.safeParse(withStructuredLayout(structuredPresetFor(type, "pl"), layout));
      expect(result.success, `${type}/${layout} odpada na walidacji`).toBe(true);
    }
  });
});

describe("KONTRAKT 2: generacje treści są ROZŁĄCZNE", () => {
  const canvas = {
    version: 2,
    rows: 20,
    background: "default",
    elements: [],
  };
  const legacyFaq = { heading: "FAQ", items: [{ q: "Pytanie?", a: "Odpowiedź." }] };

  it("rozpoznanie v3 działa w obie strony", () => {
    for (const type of STRUCTURED_SECTION_TYPES) {
      expect(isStructuredSection(structuredPresetFor(type, "pl"))).toBe(true);
    }
    expect(isStructuredSection(canvas), "płótno v2 rozpoznane jako v3").toBe(false);
    expect(isStructuredSection(legacyFaq), "treść v1 rozpoznana jako v3").toBe(false);
    expect(isStructuredSection(null)).toBe(false);
    expect(isStructuredSection({ v: "3" }), "wersja jako napis to nie wersja").toBe(false);
  });

  it.each(STRUCTURED_SECTION_TYPES)("%s: schemat strukturalny odrzuca v1 i v2", (type) => {
    const schema = structuredSpecOf(type).schema;
    expect(schema.safeParse(canvas).success, "płótno v2 przeszło jako v3").toBe(false);
    expect(schema.safeParse(legacyFaq).success, "treść v1 przeszła jako v3").toBe(false);
  });

  it("znacznik wersji jest LICZBĄ 3 — inna wartość nie jest sekcją strukturalną", () => {
    for (const type of STRUCTURED_SECTION_TYPES) {
      const content = structuredPresetFor(type, "pl") as unknown as Record<string, unknown>;
      expect(content.v).toBe(STRUCTURED_SECTION_VERSION);
      expect(structuredSpecOf(type).schema.safeParse({ ...content, v: 2 }).success).toBe(false);
    }
  });
});

describe("KONTRAKT 3: treść v3 przechodzi WSZYSTKIMI drogami modelu", () => {
  it.each(STRUCTURED_SECTION_TYPES)(
    "%s: odczyt szkicu, wejście upsertu i odczyt publiczny przyjmują v3",
    (type) => {
      const content = structuredPresetFor(type, "pl");

      const draft = SECTION_DRAFT_SCHEMAS[type].safeParse(content);
      expect(draft.success, `SECTION_DRAFT_SCHEMAS[${type}] odrzuca v3`).toBe(true);

      const input = sectionInputSchema.safeParse({ type, content });
      expect(input.success, `sectionInputSchema odrzuca v3 dla ${type}`).toBe(true);

      const published = publishedSectionSchema.safeParse({
        id: "0f6a2f4a-6a4f-4f6a-8f6a-2f4a6a4f4f6a",
        position: 0,
        type,
        content,
      });
      expect(published.success, `publishedSectionSchema odrzuca v3 dla ${type}`).toBe(true);
    },
  );

  it.each(STRUCTURED_SECTION_TYPES)("%s: treść v3 wraca ze schematu CO DO POLA", (type) => {
    // Publikacja przenosi treść bez tłumaczenia (ADR-091), ale przechodzi ona
    // przez parser po stronie sklepu — a parser z `default()` potrafi po cichu
    // dołożyć pole. Tu sprawdzamy, że wynik parsowania jest tym, co weszło.
    const content = structuredPresetFor(type, "pl");
    const parsed = SECTION_DRAFT_SCHEMAS[type].parse(content);
    expect(parsed).toEqual(content);
  });
});

describe("KONTRAKT 4: rejestr i schemat mówią to samo o granicach listy", () => {
  it.each(STRUCTURED_SECTION_TYPES)("%s: podłoga i sufit z rejestru są tymi, których pilnuje Zod", (type) => {
    const spec = structuredSpecOf(type);
    expect(
      spec.schema.safeParse(withItemCount(type, spec.minItems - 1)).success,
      `${type}: lista krótsza niż podłoga rejestru przeszła walidację`,
    ).toBe(false);
    expect(spec.schema.safeParse(withItemCount(type, spec.minItems)).success).toBe(true);
    expect(spec.schema.safeParse(withItemCount(type, spec.maxItems)).success).toBe(true);
    expect(
      spec.schema.safeParse(withItemCount(type, spec.maxItems + 1)).success,
      `${type}: lista dłuższa niż sufit rejestru przeszła walidację`,
    ).toBe(false);
  });

  it.each(STRUCTURED_SECTION_TYPES)("%s: operacje listy trzymają się granic rejestru", (type) => {
    const spec = structuredSpecOf(type);
    const item = sampleItemFor(type);

    // Sufit: dopisanie do pełnej listy zwraca WEJŚCIE (bez cichego przycięcia).
    const full = spec.schema.parse(withItemCount(type, spec.maxItems)) as StructuredSectionContent;
    expect(appendStructuredItem(full, item)).toBe(full);

    // Podłoga: usunięcie ostatniego wpisu nie może zostawić pustej sekcji.
    const minimal = spec.schema.parse(withItemCount(type, spec.minItems)) as StructuredSectionContent;
    expect(removeStructuredItem(minimal, 0)).toBe(minimal);

    // Usunięcie ze środka listy dłuższej niż podłoga działa i skraca o jeden.
    const three = spec.schema.parse(withItemCount(type, spec.minItems + 2)) as StructuredSectionContent;
    expect(itemsOf(removeStructuredItem(three, 1)).length).toBe(spec.minItems + 1);
    expect(removeStructuredItem(three, 99), "indeks poza listą nie rusza treści").toBe(three);
  });

  it.each(STRUCTURED_SECTION_TYPES)("%s: kolejność i edycja pola wpisu", (type) => {
    const spec = structuredSpecOf(type);
    const field = textFieldsOf(type)[0]!;
    expect(field, `typ "${type}" nie ma ANI JEDNEGO pola tekstowego — nie ma czego edytować`).toBeTruthy();
    const base = structuredPresetFor(type, "pl");
    const items = itemsOf(base);
    expect(items.length, "preset za krótki, żeby przestawić wpisy").toBeGreaterThan(1);

    const moved = moveStructuredItem(base, 0, items.length - 1);
    expect(itemsOf(moved).at(-1)).toEqual(items[0]);
    expect(itemsOf(moved).length).toBe(items.length);
    expect(moveStructuredItem(base, 0, 0), "ruch w miejscu nie tworzy nowej treści").toBe(base);
    expect(moveStructuredItem(base, 0, 99)).toBe(base);

    const patched = patchStructuredItem(base, 0, field.key, "ZMIENIONE");
    expect((itemsOf(patched)[0] as Record<string, unknown>)[field.key]).toBe("ZMIENIONE");
    expect(itemsOf(base)[0], "edycja zmutowała wejście").not.toEqual(itemsOf(patched)[0]);
    expect(spec.schema.safeParse(patched).success).toBe(true);
  });

  /**
   * ZBIÓR WARTOŚCI LISTY = ZBIÓR ZE SCHEMATU (E4, ADR-095).
   *
   * Kontrolka o zamkniętym zbiorze bierze wartości z REJESTRU, a zapisuje je do
   * treści bronionej SCHEMATEM. Rozjazd tych dwóch zbiorów jest niewidoczny do
   * chwili, w której operator wybierze pozycję z listy i zapis wróci błędem —
   * albo, co gorsza, wybierze pozycję, której render nie zna. Test liczy w OBIE
   * strony: każda wartość z rejestru musi przejść schemat, a wartość spoza
   * zbioru musi zostać odrzucona (inaczej „zamknięty zbiór" jest deklaracją).
   */
  it.each(STRUCTURED_SECTION_TYPES)("%s: zamknięte zbiory wartości wpisu zgadzają się ze schematem", (type) => {
    const spec = structuredSpecOf(type);
    for (const field of choiceFieldsOf(type)) {
      const values = field.values;
      expect(values, `pole "${field.key}" typu "${type}" jest listą BEZ wartości`).toBeTruthy();
      expect(values!.length, `pole "${field.key}": pusta lista wartości`).toBeGreaterThan(0);

      const base = structuredPresetFor(type, "pl");
      for (const value of values!) {
        const patched = patchStructuredItem(base, 0, field.key, value);
        expect(
          spec.schema.safeParse(patched).success,
          `${type}/${field.key}: wartość "${value}" z rejestru NIE przechodzi schematu`,
        ).toBe(true);
      }
      expect(
        spec.schema.safeParse(patchStructuredItem(base, 0, field.key, "spoza-zbioru")).success,
        `${type}/${field.key}: schemat przyjął wartość spoza zbioru rejestru`,
      ).toBe(false);
    }
  });
});

describe("FAQPage (schema.org) — nieszkodliwy dodatek", () => {
  it("bez strukturalnego FAQ nie ma bloku", () => {
    expect(faqPageJsonLd([])).toBeNull();
    expect(
      faqPageJsonLd([
        { content: { heading: "FAQ", items: [{ q: "P?", a: "O." }] } },
        { content: { version: 2, rows: 20, background: "default", elements: [] } },
      ]),
      "treść v1/v2 nie może udawać danych FAQ",
    ).toBeNull();
  });

  it("blok opisuje WSZYSTKIE pary ze wszystkich strukturalnych sekcji FAQ", () => {
    const first = structuredPresetFor("faq", "pl");
    const second = structuredPresetFor("faq", "en");
    const data = faqPageJsonLd([{ content: first }, { content: second }]);
    expect(data?.["@type"]).toBe("FAQPage");
    const entities = data?.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
    expect(entities.length).toBe(itemsOf(first).length + itemsOf(second).length);
    expect(entities[0]?.name).toBe((itemsOf(first)[0] as { q: string }).q);
    expect(entities[0]?.acceptedAnswer.text).toBe((itemsOf(first)[0] as { a: string }).a);
  });
});

describe("rejestr FAQ — typ referencyjny E1", () => {
  it("ma oba warianty układu i przełącznik „wiele naraz”", () => {
    const spec = STRUCTURED_SECTIONS.faq;
    expect(spec.layouts).toEqual(["accordion", "open-list"]);
    expect(spec.toggles.map((toggle) => toggle.key)).toContain("allowMultiple");
    expect(spec.itemFields.map((field) => field.key)).toEqual(["q", "a"]);
  });

  it("preset niesie TRZY realne pary pytań wypożyczalni, nie atrapę", () => {
    for (const locale of LOCALES) {
      const items = itemsOf(structuredPresetFor("faq", locale)) as { q: string; a: string }[];
      expect(items.length).toBe(3);
      for (const item of items) {
        expect(item.q.length, "pytanie-atrapa").toBeGreaterThan(10);
        expect(item.a.length, "odpowiedź-atrapa").toBeGreaterThan(20);
      }
    }
  });
});

describe("KONTRAKT 5: deklaracja `empty` pola znaczy to, czego pilnuje Zod (E3)", () => {
  /*
   * Trzy zachowania pustki są DEKLARACJĄ rejestru (`StructuredFieldEmpty`),
   * a szuflada rozgałęzia się po niej zamiast po nazwie pola. Deklaracja bez
   * zestawienia ze schematem byłaby jednak dokładnie tą klasą wady, którą
   * złapała recenzja PM do PR #178: napis w rejestrze, którego nikt nie
   * porównał z prawdą. Tu każde z trzech znaczeń jest sprawdzane na REALNYM
   * schemacie typu.
   */
  const POLA = STRUCTURED_SECTION_TYPES.flatMap((type) =>
    textFieldsOf(type).map((field) => [`${type}.${field.key}`, type, field] as const),
  );

  it("skan ma co czytać (kontrola po pustym zbiorze)", () => {
    expect(POLA.length, "brak pól tekstowych — pętla niżej nic nie sprawdza").toBeGreaterThan(0);
    const znaczenia = new Set(POLA.map(([, , field]) => field.empty ?? "reject"));
    expect(
      [...znaczenia].sort(),
      "w rejestrze nie ma kompletu znaczeń pustki — kontrakt broniłby jednego przypadku",
    ).toEqual(["reject", "unset", "value"]);
  });

  it.each(POLA)("%s: pustka zachowuje się tak, jak deklaruje rejestr", (_etykieta, type, field) => {
    const spec = structuredSpecOf(type);
    const base = structuredPresetFor(type, "pl");

    const zPustka = patchStructuredItem(base, 0, field.key, "");
    const zdjete = patchStructuredItem(base, 0, field.key, undefined);
    const wpis = (content: StructuredSectionContent) =>
      itemsOf(content)[0] as Record<string, unknown>;

    if (field.empty === "value") {
      expect(spec.schema.safeParse(zPustka).success, "pustka ZNACZĄCA odrzucona przez schemat").toBe(true);
      expect(wpis(zPustka)[field.key], "pustka znacząca nie została zapisana").toBe("");
      return;
    }
    if (field.empty === "unset") {
      expect(spec.schema.safeParse(zdjete).success, "zdjęcie pola opcjonalnego odrzucone").toBe(true);
      expect(Object.hasOwn(wpis(zdjete), field.key), "pole miało zniknąć, a zostało").toBe(false);
      expect(
        spec.schema.safeParse(zPustka).success,
        "pole „unset” przyjęło PUSTY NAPIS — wtedy zdejmowanie byłoby zbędne",
      ).toBe(false);
      return;
    }
    expect(
      spec.schema.safeParse(zPustka).success,
      "pole bez deklaracji pustki przyjęło pustkę — szuflada odrzuca ją bez powodu",
    ).toBe(false);
  });
});

describe("rejestr GALERII — pierwszy typ medialny (E3)", () => {
  const spec = STRUCTURED_SECTIONS.gallery;

  it("ma trzy układy, wybory wyglądu i szufladę dwudzielną", () => {
    expect(spec.layouts).toEqual(["grid", "masonry", "carousel"]);
    expect(spec.layouts, "rejestr i allowlista układów się rozjechały").toEqual([...GALLERY_LAYOUTS]);
    expect(spec.defaultLayout).toBe("grid");
    expect(spec.editor, "typ medialny w jednej ścianie pól").toBe("split");
    expect(spec.toggles.map((toggle) => toggle.key)).toEqual(["lightbox"]);
    expect(spec.itemFields.map((field) => field.key)).toEqual(["image", "alt", "caption", "link"]);
    expect(spec.itemFields[0]!.kind, "pierwsze pole kafla nie jest zdjęciem").toBe("image");

    const wybory: Record<string, StructuredChoiceSpec> = Object.fromEntries(
      spec.choices.map((choice) => [choice.key, choice]),
    );
    expect(Object.keys(wybory).sort()).toEqual(["columns", "gap"]);
    expect(wybory.columns!.values).toEqual([...GALLERY_COLUMNS]);
    expect(wybory.gap!.values).toEqual([...GALLERY_GAPS]);
    expect(
      wybory.columns!.layouts,
      "liczba kafli w rzędzie pokazana przy karuzeli byłaby kontrolką bez skutku",
    ).toEqual(["grid", "masonry"]);
    expect(wybory.gap!.layouts, "odstęp działa w KAŻDYM układzie").toBeUndefined();
  });

  it("wybory wyglądu są tymi, które PRZYJMUJE schemat (i tylko one)", () => {
    const preset = structuredPresetFor("gallery", "pl") as unknown as Record<string, unknown>;
    for (const choice of spec.choices) {
      for (const value of choice.values) {
        expect(
          spec.schema.safeParse({ ...preset, [choice.key]: value }).success,
          `wartość ${String(value)} z rejestru nie przechodzi schematu pola "${choice.key}"`,
        ).toBe(true);
      }
      expect(
        spec.schema.safeParse({ ...preset, [choice.key]: "wartość-z-przyszłości" }).success,
        `pole "${choice.key}" przyjęło wartość spoza rejestru`,
      ).toBe(false);
    }
    expect(spec.schema.safeParse({ ...preset, columns: 5 }).success, "piąta kolumna").toBe(false);
  });

  it("preset niesie TRZY realne kadry z KOMPLETNĄ atrybucją, nie szare kafle", () => {
    for (const locale of LOCALES) {
      const items = itemsOf(structuredPresetFor("gallery", locale)) as {
        image: { kind: string; authorName?: string; authorUrl?: string; downloadLocation?: string };
        alt: string;
        caption?: string;
      }[];
      expect(items.length, "kuracja kadrów presetu zniknęła").toBe(3);
      for (const item of items) {
        expect(item.image.kind, "kadr presetu nie pochodzi z kuracji").toBe("unsplash");
        // Atrybucja jest warunkiem licencji — sprawdzamy komplet, a nie obecność
        // samego adresu zdjęcia.
        expect(item.image.authorName!.length).toBeGreaterThan(0);
        expect(item.image.authorUrl!.length).toBeGreaterThan(0);
        expect(item.image.downloadLocation!.length).toBeGreaterThan(0);
        expect(item.alt.length, "kafel presetu bez opisu alternatywnego").toBeGreaterThan(10);
        expect(item.caption!.length, "kafel presetu bez podpisu").toBeGreaterThan(10);
      }
    }
  });

  it("BEZSTRATNOŚĆ UKŁADU na REALNEJ treści: odnośniki, podpisy i puste alty przeżywają", () => {
    /*
     * Kontrakt 1 wyżej chodzi po PRESECIE. To za mało dla galerii: preset nie
     * ma ani jednego odnośnika i ani jednego pustego opisu alternatywnego,
     * więc przekształcenie gubiące dokładnie te pola przeszłoby na zielono.
     * Tu treść jest taka, jaką składa operator.
     */
    const preset = structuredPresetFor("gallery", "pl") as unknown as Record<string, unknown>;
    const realna = spec.schema.parse({
      ...preset,
      columns: 4,
      gap: "roomy",
      lightbox: false,
      items: [
        { ...(itemsOf(preset as never)[0] as object), link: "https://partner.przyklad.test/realizacja" },
        { ...(itemsOf(preset as never)[1] as object), alt: "", link: "/kontakt" },
        itemsOf(preset as never)[2],
      ],
    });

    for (const layout of GALLERY_LAYOUTS) {
      const przelaczona = withStructuredLayout(realna, layout);
      expect(przelaczona.layout, `układ ${layout} nie został ustawiony`).toBe(layout);
      expect(
        { ...przelaczona, layout: realna.layout },
        `układ ${layout} ruszył coś poza polem "layout"`,
      ).toEqual(realna);
      expect(spec.schema.safeParse(przelaczona).success).toBe(true);
    }
    // Pusty opis alternatywny to DECYZJA, nie brak — musi przeżyć zapis i odczyt.
    const powrot = spec.schema.parse(withStructuredLayout(withStructuredLayout(realna, "carousel"), "grid"));
    expect((itemsOf(powrot)[1] as { alt: string }).alt).toBe("");
    expect((itemsOf(powrot)[0] as { link: string }).link).toBe("https://partner.przyklad.test/realizacja");
  });
});

describe("konwersja galerii ze STAREJ treści (E3)", () => {
  const KADR = { kind: "unsplash" as const, ...(STRUCTURED_SECTIONS.gallery.preset.pl as { items: { image: Record<string, unknown> }[] }).items[0]!.image };

  /** Płótno v2 z trzema zdjęciami rozstawionymi NIE w kolejności dodania. */
  const plotno = {
    version: 2,
    rows: 40,
    background: "default",
    elements: [
      {
        id: "trzecie",
        kind: "image",
        alt: "Trzeci kadr",
        fit: "cover",
        source: { kind: "storage", path: "tenant-a/site/trzeci.jpg" },
        layout: { desktop: { x: 0, y: 20, w: 40, h: 12, z: 0 } },
      },
      {
        id: "pierwsze",
        kind: "image",
        alt: "Pierwszy kadr",
        fit: "cover",
        source: KADR,
        layout: { desktop: { x: 12, y: 4, w: 40, h: 12, z: 1 } },
      },
      {
        id: "naglowek",
        kind: "heading",
        text: "Realizacje",
        level: 2,
        align: "left",
        layout: { desktop: { x: 12, y: 0, w: 60, h: 4, z: 2 } },
      },
      {
        id: "drugie",
        kind: "image",
        alt: "Drugi kadr",
        fit: "cover",
        source: { kind: "storage", path: "tenant-a/site/drugi.jpg" },
        layout: { desktop: { x: 60, y: 4, w: 40, h: 12, z: 3 } },
      },
    ],
  };

  it("płótno v2: zdjęcia wchodzą w kolejności CZYTANIA, opisy jadą razem z nimi", () => {
    const items = galleryItemsFromLegacy(plotno);
    expect(items.map((item) => item.alt)).toEqual(["Pierwszy kadr", "Drugi kadr", "Trzeci kadr"]);
    // Oba światy źródeł przechodzą bez tłumaczenia na siebie nawzajem.
    expect(items[0]!.image.kind).toBe("unsplash");
    expect(items[2]!.image).toEqual({ kind: "storage", path: "tenant-a/site/trzeci.jpg" });
    expect(items.length, "nagłówek płótna wszedł do galerii jako kafel").toBe(3);
  });

  it("sekcja v1: `items[].imagePath` staje się źródłem `storage`", () => {
    const items = galleryItemsFromLegacy({
      heading: "Realizacje",
      items: [
        { imagePath: "tenant-a/site/a.jpg", alt: "Kadr A" },
        { imagePath: "tenant-a/site/b.jpg", alt: "Kadr B" },
      ],
    });
    expect(items).toEqual([
      { image: { kind: "storage", path: "tenant-a/site/a.jpg" }, alt: "Kadr A" },
      { image: { kind: "storage", path: "tenant-a/site/b.jpg" }, alt: "Kadr B" },
    ]);
  });

  it("konwersja daje treść v3, która PRZECHODZI schemat i zachowuje nagłówek", () => {
    const converted = structuredFromLegacy("gallery", plotno, "pl");
    expect(STRUCTURED_SECTIONS.gallery.schema.safeParse(converted).success).toBe(true);
    expect(converted.layout).toBe("grid");
    expect(isStructuredSection(converted)).toBe(true);

    /*
     * WYNIK MUSI POCHODZIĆ ZE STAREJ TREŚCI, nie z presetu (znalezisko własnego
     * dowodu mutacyjnego M5). Sama liczba wpisów tego NIE ODRÓŻNIA: preset też
     * ma trzy kafle, więc konwersja, która gubi wszystkie zdjęcia i degraduje do
     * presetu, przechodziła asercję „są trzy wpisy" na zielono. Porównujemy więc
     * KADRY — i zarazem żądamy, żeby różniły się od presetowych.
     */
    expect(
      itemsOf(converted).map((item) => (item as { alt: string }).alt),
      "konwersja oddała treść, która nie pochodzi z konwertowanej sekcji",
    ).toEqual(["Pierwszy kadr", "Drugi kadr", "Trzeci kadr"]);
    expect(
      itemsOf(converted),
      "wynik jest presetem — czyli zdjęcia operatora przepadły po cichu",
    ).not.toEqual(itemsOf(structuredPresetFor("gallery", "pl")));

    const zV1 = structuredFromLegacy(
      "gallery",
      { heading: "Nasze realizacje", items: [{ imagePath: "tenant-a/site/a.jpg", alt: "Kadr A" }] },
      "pl",
    );
    expect((zV1 as unknown as { heading?: string }).heading).toBe("Nasze realizacje");
  });

  it("treść BEZ zdjęć degraduje do presetu, a nie do pustej sekcji", () => {
    const pusta = structuredFromLegacy("gallery", { heading: "Realizacje", items: [] }, "pl");
    expect(itemsOf(pusta)).toEqual(itemsOf(structuredPresetFor("gallery", "pl")));
    expect(structuredFromLegacy("gallery", null, "pl")).toEqual(structuredPresetFor("gallery", "pl"));
  });

  it("typ BEZ konwersji dostaje preset — i to jest deklaracja, nie awaria", () => {
    // FAQ: treść spłaszczona do płótna nie mówi już, co było pytaniem (ADR-094).
    expect(STRUCTURED_SECTIONS.faq).not.toHaveProperty("fromLegacy");
    expect(structuredFromLegacy("faq", plotno, "pl")).toEqual(structuredPresetFor("faq", "pl"));
  });
});
