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
  SECTION_DRAFT_SCHEMAS,
  SECTION_TYPES,
  STRUCTURED_SECTIONS,
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
  type StructuredSectionContent,
  type StructuredSectionType,
} from "./index";

const LOCALES = ["pl", "en"] as const;

/** Wpisy treści strukturalnej — każdy typ z rejestru jest listowy. */
function itemsOf(content: StructuredSectionContent): unknown[] {
  return (content as unknown as { items: unknown[] }).items;
}

/** Preset z podmienioną listą wpisów o zadanej długości (do testów granic). */
function withItemCount(
  type: StructuredSectionType,
  count: number,
): Record<string, unknown> {
  const preset = structuredPresetFor(type, "pl") as unknown as Record<string, unknown>;
  const sample = structuredNewItemFor(type, "pl");
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
    for (const field of structuredSpecOf(type).itemFields) {
      for (const [index, item] of itemsOf(en as unknown as StructuredSectionContent).entries()) {
        expect(
          (item as Record<string, unknown>)[field.key],
          `wpis ${index} presetu EN/${type} nie ma pola "${field.key}"`,
        ).toBeTypeOf("string");
      }
    }
  });

  it.each(STRUCTURED_SECTION_TYPES)("%s: świeży wpis „dodaj” przechodzi schemat w OBU językach", (type) => {
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
    const item = structuredNewItemFor(type, "pl");

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
    const field = spec.itemFields[0]!;
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
