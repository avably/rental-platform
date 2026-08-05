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
  CTA_VARIANTS,
  ctaFromLegacy,
  deliveryFromLegacy,
  fullRowCount,
  productsCatalogLinkVisible,
  sectionCanvasFrom,
  uspItemsFromLegacy,
  GALLERY_COLUMNS,
  GALLERY_GAPS,
  GALLERY_LAYOUTS,
  MAP_PROVIDER_ORIGIN,
  SECTION_DRAFT_SCHEMAS,
  SECTION_TYPES,
  STRUCTURED_SECTIONS,
  directionsLocationsFromLegacy,
  directionsMapEmbedSrc,
  directionsRouteHref,
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
  const reference = referenceFieldOf(type);
  /*
   * Typ, którego wpis WSKAZUJE encję panelu (E7), nie ma ani świeżego wpisu,
   * ani wpisu w presecie: w chwili powstania sekcji nie ma jeszcze czego
   * wskazać. Wpis jest wtedy samym identyfikatorem, więc test składa go sam —
   * `reference` w rejestrze znaczy „identyfikator encji", a identyfikatory
   * w tym systemie są uuid-ami.
   */
  if (reference) return { [reference.key]: sampleReferenceId(0) };
  return structuredClone(itemsOf(structuredPresetFor(type, "pl"))[0]);
}

/** Pole wpisu wskazujące encję panelu (E7) — najwyżej jedno na typ. */
function referenceFieldOf(type: StructuredSectionType) {
  return structuredSpecOf(type).itemFields.find((field) => field.kind === "reference");
}

/** Identyfikator testowy o kształcie uuid, RÓŻNY dla każdego indeksu wpisu. */
function sampleReferenceId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

/**
 * PIERWSZE POLE WPISU, W KTÓRE OPERATOR COKOLWIEK WSTAWIA — napis albo
 * wskazanie encji. Kontrakty kolejności i edycji potrzebują pola, po którym da
 * się ODRÓŻNIĆ wpisy od siebie; rodzaj tego pola zależy od typu, a to, że
 * jakieś jest, jest wymogiem rejestru (mini-CMS bez pola nie ma czego pokazać).
 */
function editableFieldOf(type: StructuredSectionType) {
  return structuredSpecOf(type).itemFields.find(
    (field) => field.kind === "text" || field.kind === "multiline" || field.kind === "reference",
  );
}

/**
 * WARTOŚĆ, KTÓRĄ WOLNO WPISAĆ W POLE WPISU — zależy od RODZAJU pola, a nie od
 * typu sekcji. Napis „Wpis nr 3" w polu wskazującym encję nie jest inną
 * treścią, tylko treścią, której schemat nie przyjmie.
 */
function sampleValueFor(field: { kind: string }, index: number): string {
  return field.kind === "reference" ? sampleReferenceId(index) : `Wpis nr ${index + 1}`;
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

/**
 * Preset z podmienioną listą wpisów o zadanej długości (do testów granic).
 *
 * WPISY SĄ ROZRÓŻNIALNE (E7), a nie `count` kopiami tego samego obiektu:
 * kontrakt kolejności na liście identycznych wpisów przechodzi także wtedy, gdy
 * przestawienie nic nie robi — a to jest dokładnie ta wada, którą w E6 złapała
 * fikstura czterech różnych opinii. Różnicujemy PIERWSZYM polem, w które
 * operator cokolwiek wstawia, wartością pasującą do RODZAJU tego pola.
 */
function withItemCount(
  type: StructuredSectionType,
  count: number,
): Record<string, unknown> {
  const preset = structuredPresetFor(type, "pl") as unknown as Record<string, unknown>;
  const sample = sampleItemFor(type);
  const field = editableFieldOf(type);
  return {
    ...preset,
    items: Array.from({ length: count }, (_, index) => {
      const item = structuredClone(sample) as Record<string, unknown>;
      if (field) item[field.key] = sampleValueFor(field, index);
      return item;
    }),
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
      /*
       * PODŁOGA LISTY ZALEŻY OD TEGO, CZYM JEST LISTA (E7).
       *
       * Dla typu, którego TREŚCIĄ jest lista (pytania FAQ, kafle galerii,
       * pozycje cennika), podłoga poniżej jednego wpisu znaczy sekcję będącą
       * pustym nagłówkiem — klasę atrap, którą ADR-094 usuwa z produktu.
       *
       * Typ z `itemsPick` jest inny z konstrukcji: jego lista jest WYBOREM
       * z kolekcji mieszkającej poza stroną (katalog sprzętu), a treścią sekcji
       * jest ta kolekcja. Pusty wybór znaczy „pokaż wycinek katalogu", a nie
       * „nie napisano ani jednego wpisu" — i nie ma jak być inaczej, bo w chwili
       * powstania sekcji nie ma jeszcze czego wskazać (preset i konwersja nie
       * mają skąd wziąć identyfikatorów sprzętu, który dopiero powstanie).
       *
       * Rozgałęzienie idzie po DEKLARACJI w rejestrze, a nie po nazwie typu:
       * wyjątek jest własnością rodzaju listy, więc drugi taki typ dostanie go
       * bez dopisywania czegokolwiek tutaj — a typ BEZ tej deklaracji nie ma
       * jak się pod niego podszyć.
       */
      if (spec.itemsPick) {
        expect(
          spec.minItems,
          `typ "${type}" wskazuje encje (itemsPick), więc pusty wybór jest STANEM — podłoga musi być zerowa`,
        ).toBe(0);
        expect(
          spec.itemsWhen,
          `typ "${type}" z pustym wyborem musi powiedzieć szufladzie, KIEDY lista coś znaczy`,
        ).toBeTruthy();
      } else {
        expect(spec.minItems, `typ "${type}": podłoga listy poniżej jednego wpisu`).toBeGreaterThanOrEqual(1);
      }
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
      const spec = structuredSpecOf(type);
      expect(
        spec.itemFields.some((field) => field.kind === "image") || spec.itemsPick !== undefined,
        `typ "${type}" nie ma świeżego wpisu, pola obrazowego ANI wyboru z modułu panelu — ` +
          `nie ma czym dodać pozycji`,
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
      const items = itemsOf(first).length;
      itemsOf(first).length = 0;
      /*
       * MUTUJEMY TEŻ POLE SEKCJI (E7). Typ z pustym wyborem startowym nie ma
       * czego skrócić, więc sam dowód „lista wróciła" byłby dla niego pusty —
       * a pusty kontrakt nie broni niczego. Nagłówek mutujemy przy KAŻDYM
       * typie, żeby kontrakt był jeden, a nie dwa, z których jeden bywa słabszy.
       */
      (first as unknown as Record<string, unknown>).heading = "ZMIENIONE PRZEZ TEST";
      const second = structuredPresetFor(type, "pl");
      expect(itemsOf(second).length, `preset "${type}" współdzieli listę ze stałą modułu`).toBe(items);
      expect(
        (second as unknown as Record<string, unknown>).heading,
        `preset "${type}" współdzieli nagłówek ze stałą modułu`,
      ).not.toBe("ZMIENIONE PRZEZ TEST");
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
    if (spec.minItems > 0) {
      expect(
        spec.schema.safeParse(withItemCount(type, spec.minItems - 1)).success,
        `${type}: lista krótsza niż podłoga rejestru przeszła walidację`,
      ).toBe(false);
    } else {
      // Podłoga zerowa (E7) nie ma „poniżej" — zdaniem do udowodnienia jest
      // wtedy, że pusta lista NAPRAWDĘ przechodzi, a nie że nikt jej nie sprawdził.
      expect(
        spec.schema.safeParse(withItemCount(type, 0)).success,
        `${type}: rejestr deklaruje zerową podłogę, a schemat pustej listy nie przyjmuje`,
      ).toBe(true);
    }
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
    // Sufit bywa niski (CTA ma dwa przyciski), więc długość bierzemy z OBU
    // granic rejestru — lista dłuższa od sufitu nie przeszłaby schematu.
    const many = Math.min(spec.minItems + 2, spec.maxItems);
    const three = spec.schema.parse(withItemCount(type, many)) as StructuredSectionContent;
    expect(itemsOf(removeStructuredItem(three, 1)).length).toBe(many - 1);
    expect(removeStructuredItem(three, 99), "indeks poza listą nie rusza treści").toBe(three);
  });

  it.each(STRUCTURED_SECTION_TYPES)("%s: kolejność i edycja pola wpisu", (type) => {
    const spec = structuredSpecOf(type);
    const field = editableFieldOf(type)!;
    expect(
      field,
      `typ "${type}" nie ma ANI JEDNEGO pola, które operator ustawia — nie ma czego edytować`,
    ).toBeTruthy();
    /*
     * Baza z REJESTRU, a nie z presetu (E7). Preset bywa jednowpisowy (CTA ma
     * jeden przycisk) albo pusty (sprzęt zaczyna bez wyboru), a wtedy kontrakt
     * kolejności nie miałby czego przestawiać i przechodziłby pusty. Lista
     * z `withItemCount` jest za to zawsze co najmniej dwuwpisowa i — co
     * ważniejsze — jej wpisy są ROZRÓŻNIALNE, więc „przestawiono" znaczy tu
     * naprawdę „inna kolejność", a nie „ta sama lista kopii".
     */
    const length = Math.max(2, Math.min(spec.minItems + 1, spec.maxItems));
    const base = spec.schema.parse(withItemCount(type, length)) as StructuredSectionContent;
    const items = itemsOf(base);
    expect(items.length, "lista za krótka, żeby przestawić wpisy").toBeGreaterThan(1);
    expect(items[0], "wpisy fikstury są nierozróżnialne — kontrakt kolejności byłby ślepy").not.toEqual(
      items[1],
    );

    const moved = moveStructuredItem(base, 0, items.length - 1);
    expect(itemsOf(moved).at(-1)).toEqual(items[0]);
    expect(itemsOf(moved).length).toBe(items.length);
    expect(moveStructuredItem(base, 0, 0), "ruch w miejscu nie tworzy nowej treści").toBe(base);
    expect(moveStructuredItem(base, 0, 99)).toBe(base);

    const wpisana = sampleValueFor(field, 99);
    const patched = patchStructuredItem(base, 0, field.key, wpisana);
    expect((itemsOf(patched)[0] as Record<string, unknown>)[field.key]).toBe(wpisana);
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

describe("rejestr DOJAZDU — pierwszy typ z OSADZENIEM (E5, ADR-096)", () => {
  const spec = STRUCTURED_SECTIONS.directions;

  it("ma dwa układy, listę bez ustawień wyglądu i ŹRÓDŁO wpisów w panelu", () => {
    expect([...spec.layouts]).toEqual(["stacked", "split"]);
    expect(spec.defaultLayout).toBe("stacked");
    expect(spec.editor).toBe("single");
    /*
     * ZERO PRZEŁĄCZNIKÓW to DEKLARACJA, nie brak: gdyby dało się włączyć mapę
     * na stałe, cała gwarancja „zero żądań do dostawcy przed kliknięciem"
     * zależałaby od tego, czego operator nie odznaczył.
     */
    expect(spec.toggles).toEqual([]);
    expect(spec.choices).toEqual([]);
    // Źródło kopiowania jest DANĄ rejestru — po niej szuflada rysuje przycisk
    // i po niej kontrakt i18n żąda kompletu etykiet.
    expect(spec.itemsImport).toBe("pickupLocations");
  });

  it("adres jest JEDYNYM polem wymaganym — nazwa i godziny są opcjonalne", () => {
    const bazowa = { v: 3, type: "directions", layout: "stacked", background: "default" };
    expect(spec.schema.safeParse({ ...bazowa, items: [{ address: "ul. Polna 12" }] }).success).toBe(
      true,
    );
    // Punkt bez adresu nie ma z czego zbudować ani mapy, ani nawigacji.
    expect(spec.schema.safeParse({ ...bazowa, items: [{ label: "Magazyn" }] }).success).toBe(false);
    // Sekcja bez ANI JEDNEGO punktu to pusty nagłówek (klasa atrap, ADR-094).
    expect(spec.schema.safeParse({ ...bazowa, items: [] }).success).toBe(false);
  });

  it("preset niesie DWA realne punkty — czyli sekcję, w której widać przełącznik", () => {
    for (const locale of LOCALES) {
      const preset = structuredPresetFor("directions", locale) as unknown as {
        items: { label?: string; address: string }[];
      };
      expect(preset.items.length, `${locale}: preset z jednym punktem nie pokazuje przełącznika`).toBe(2);
      const adresy = preset.items.map((item) => item.address);
      expect(new Set(adresy).size, `${locale}: oba punkty pod tym samym adresem`).toBe(2);
      for (const item of preset.items) {
        expect(item.label?.trim().length ?? 0).toBeGreaterThan(0);
        expect(item.address.trim().length).toBeGreaterThan(10);
      }
    }
  });
});

describe("adresy mapy i nawigacji (E5) — jeden origin, zakodowane zapytanie", () => {
  const ADRES = "ul. Polna 12/3, 30-001 Kraków";

  it("oba adresy wychodzą z origin dostawcy — lustro źródła ramki w CSP", () => {
    expect(new URL(directionsMapEmbedSrc(ADRES)).origin).toBe(MAP_PROVIDER_ORIGIN);
    expect(new URL(directionsRouteHref(ADRES)).origin).toBe(MAP_PROVIDER_ORIGIN);
    // Stała jest tym, co polityka CSP wpuszcza do `frame-src` (@avably/security).
    expect(MAP_PROVIDER_ORIGIN).toBe("https://www.google.com");
  });

  it("mapa jest OSADZENIEM bez klucza API, a adres jedzie zakodowany", () => {
    const src = directionsMapEmbedSrc(ADRES);
    const url = new URL(src);
    expect(url.pathname).toBe("/maps");
    expect(url.searchParams.get("q"), "adres nie doszedł w całości").toBe(ADRES);
    expect(url.searchParams.get("output")).toBe("embed");
    // Spacje i ukośnik nie mogą rozsadzić zapytania — inaczej mapa pokazuje
    // pierwszy człon adresu i wygląda na działającą.
    expect(src).toContain(encodeURIComponent(ADRES));
    expect(src).not.toContain("key=");
  });

  it("nawigacja idzie udokumentowaną postacią odnośnika", () => {
    const url = new URL(directionsRouteHref(ADRES));
    expect(url.pathname).toBe("/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("destination")).toBe(ADRES);
  });
});

describe("konwersja DOJAZDU ze starej treści (E5)", () => {
  it("sekcja v1: adres i godziny jadą wprost, bez nazwy punktu", () => {
    const items = directionsLocationsFromLegacy({
      address: "ul. Polna 12, 30-001 Kraków",
      mapsUrl: "https://maps.example/pin/12345",
      hours: "pon.–pt. 9–17",
    });
    expect(items).toEqual([
      { address: "ul. Polna 12, 30-001 Kraków", hours: "pon.–pt. 9–17" },
    ]);
    // Nazwy punktu v1 nie ma, więc konwersja jej NIE WYMYŚLA.
    expect(items[0]).not.toHaveProperty("label");
  });

  it("sekcja v1 bez godzin: pole opcjonalne nie powstaje jako pusty napis", () => {
    expect(directionsLocationsFromLegacy({ address: "ul. Polna 12" })).toEqual([
      { address: "ul. Polna 12" },
    ]);
    expect(directionsLocationsFromLegacy({ address: "   " })).toEqual([]);
  });

  it("płótno v2: adresem zostaje PIERWSZY napis w kolejności czytania", () => {
    const plotnoDojazdu = {
      version: 2,
      rows: 24,
      background: "default",
      elements: [
        {
          id: "godziny",
          kind: "text",
          text: "pon.–pt. 9–17",
          variant: "body",
          align: "left",
          layout: { desktop: { x: 12, y: 12, w: 60, h: 4, z: 1 } },
        },
        {
          id: "adres",
          kind: "text",
          text: "ul. Polna 12, 30-001 Kraków",
          variant: "body",
          align: "left",
          layout: { desktop: { x: 12, y: 6, w: 60, h: 4, z: 0 } },
        },
        {
          id: "naglowek",
          kind: "heading",
          text: "Jak dojechać",
          level: 2,
          align: "left",
          layout: { desktop: { x: 12, y: 0, w: 60, h: 4, z: 2 } },
        },
      ],
    };

    const items = directionsLocationsFromLegacy(plotnoDojazdu);
    // Kolejność bierzemy z CZYTANIA płótna, a nie z tablicy elementów (ta jest
    // kolejnością DODAWANIA — tu celowo odwrócona).
    expect(items).toEqual([{ address: "ul. Polna 12, 30-001 Kraków" }]);
    /*
     * Drugi napis BYWA godzinami, ale bywa też czymkolwiek, co operator dopisał
     * — a etykieta „Godziny otwarcia" przy dowolnym zdaniu to informacja
     * ZMYŚLONA, nie przeniesiona. Ta asercja pilnuje granicy, a nie braku.
     */
    expect(items[0]).not.toHaveProperty("hours");

    const converted = structuredFromLegacy("directions", plotnoDojazdu, "pl");
    expect(STRUCTURED_SECTIONS.directions.schema.safeParse(converted).success).toBe(true);
    expect((converted as unknown as { heading?: string }).heading).toBe("Jak dojechać");
    expect(
      itemsOf(converted),
      "wynik jest presetem — czyli adres operatora przepadł po cichu",
    ).not.toEqual(itemsOf(structuredPresetFor("directions", "pl")));
  });

  it("treść BEZ adresu degraduje do presetu, a nie do sekcji, której nie da się wyświetlić", () => {
    expect(structuredFromLegacy("directions", { mapsUrl: "https://maps.example" }, "pl")).toEqual(
      structuredPresetFor("directions", "pl"),
    );
    expect(structuredFromLegacy("directions", null, "pl")).toEqual(
      structuredPresetFor("directions", "pl"),
    );
  });
});

// -----------------------------------------------------------------------
// E7 — sprzęt, atuty, dostawa, CTA
// -----------------------------------------------------------------------

describe("E7 sprzęt: pełne rzędy i odnośnik do katalogu", () => {
  /**
   * REGUŁA PEŁNYCH RZĘDÓW na licznościach z briefu (2/3/5/8) i na KAŻDEJ
   * liczbie kolumn, którą siatka naprawdę przyjmuje. Tabela jest wypisana
   * wprost — bo dowód „funkcja zgadza się sama ze sobą" (przeliczenie tego
   * samego wzoru w teście) nie jest dowodem na nic.
   */
  const OCZEKIWANE: { count: number; columns: number; visible: number }[] = [
    // Jeden niepełny rząd zostaje w całości — nie ma czego uciąć.
    { count: 2, columns: 2, visible: 2 },
    { count: 2, columns: 3, visible: 2 },
    { count: 2, columns: 4, visible: 2 },
    { count: 3, columns: 2, visible: 2 },
    { count: 3, columns: 3, visible: 3 },
    { count: 3, columns: 4, visible: 3 },
    { count: 5, columns: 2, visible: 4 },
    { count: 5, columns: 3, visible: 3 },
    { count: 5, columns: 4, visible: 4 },
    { count: 8, columns: 2, visible: 8 },
    { count: 8, columns: 3, visible: 6 },
    { count: 8, columns: 4, visible: 8 },
  ];

  it.each(OCZEKIWANE)(
    "$count kafli w $columns kolumnach → widocznych $visible (zero wiszących)",
    ({ count, columns, visible }) => {
      expect(fullRowCount(count, columns)).toBe(visible);
      // Zdanie właściwe: to, co zostaje, JEST pełnymi rzędami — chyba że mamy
      // jeden rząd niepełny z konstrukcji (pozycji mniej niż kolumn).
      const zostalo = fullRowCount(count, columns);
      if (count > columns) expect(zostalo % columns).toBe(0);
      expect(zostalo, "ucięcie w GÓRĘ pokazałoby sprzęt, którego operator nie wybrał").toBeLessThanOrEqual(count);
      expect(zostalo, "ucięcie do zera zrobiłoby z sekcji pusty nagłówek").toBeGreaterThan(0);
    },
  );

  it("siatka jednokolumnowa nie ma czego uciąć — każdy rząd jest pełny", () => {
    for (const count of [1, 2, 5, 8]) expect(fullRowCount(count, 1)).toBe(count);
  });

  it("odnośnik do katalogu pojawia się DOKŁADNIE wtedy, gdy katalog ma więcej, niż sekcja pokazuje", () => {
    // Próg z briefu, zmierzony po OBU stronach: równość to jeszcze nie „więcej".
    expect(productsCatalogLinkVisible(8, 8), "katalog równy temu, co widać → link zbędny").toBe(false);
    expect(productsCatalogLinkVisible(8, 9), "katalog większy o jeden → link musi być").toBe(true);
    expect(productsCatalogLinkVisible(6, 8), "ucięcie do pełnych rzędów też odsłania resztę").toBe(true);
    expect(productsCatalogLinkVisible(8, 3), "katalog mniejszy niż limit → link zbędny").toBe(false);
  });

  it("konwersja przenosi NAGŁÓWEK i zostaje przy katalogu — z obu starych generacji", () => {
    const zV1 = structuredFromLegacy("products", { heading: "Sprzęt na wesela" }, "pl");
    expect(STRUCTURED_SECTIONS.products.schema.safeParse(zV1).success).toBe(true);
    expect((zV1 as unknown as Record<string, unknown>).heading).toBe("Sprzęt na wesela");
    expect((zV1 as unknown as Record<string, unknown>).source).toBe("catalog");
    expect(itemsOf(zV1), "konwersja WYMYŚLIŁA wybór pozycji").toEqual([]);

    const plotno = sectionCanvasFrom("products", { heading: "Sprzęt na wesela" });
    const zPlotna = structuredFromLegacy("products", plotno, "pl");
    expect((zPlotna as unknown as Record<string, unknown>).heading).toBe("Sprzęt na wesela");
    expect((zPlotna as unknown as Record<string, unknown>).source).toBe("catalog");
  });

  it("treść bez nagłówka degraduje do presetu, a nie do sekcji bez ustawień", () => {
    expect(structuredFromLegacy("products", {}, "pl")).toEqual(structuredPresetFor("products", "pl"));
  });
});

describe("E7 atuty: konwersja wiąże trójkę GEOMETRIĄ kolumny", () => {
  /**
   * FIKSTURA RÓŻNICUJĄCA: cztery atuty, czyli DWA RZĘDY po trzy kolumny —
   * dokładnie ta sytuacja, w której kolejność czytania płótna daje
   * ikona 1, ikona 2, ikona 3, tytuł 1, tytuł 2, tytuł 3, zdanie 1…
   * Heurystyka „następny element" składałaby tu atuty z części należących do
   * trzech różnych kafli (lekcja E6 o podpisach pod opiniami).
   */
  const ATUTY = {
    heading: "Dlaczego my",
    items: [
      { icon: "truck" as const, title: "Dowóz", text: "Podstawiamy sprzęt pod adres." },
      { icon: "clock" as const, title: "Szybko", text: "Potwierdzenie tego samego dnia." },
      { icon: "wrench" as const, title: "Serwis", text: "Przegląd po każdym najmie." },
      { icon: "headphones" as const, title: "Wsparcie", text: "Telefon czynny w weekendy." },
    ],
  };

  it("z płótna wracają CAŁE kafle, w kolejności rzędów i bez pomieszania części", () => {
    const plotno = sectionCanvasFrom("usp", ATUTY);
    expect(uspItemsFromLegacy(plotno)).toEqual(ATUTY.items);
  });

  it("czwarty atut (drugi rząd, pierwsza kolumna) NIE dostaje tytułu z pierwszego rzędu", () => {
    const plotno = sectionCanvasFrom("usp", ATUTY);
    const items = uspItemsFromLegacy(plotno);
    expect(items).toHaveLength(4);
    // Zdanie właściwe dla tej lekcji: każdy tytuł stoi przy SWOIM zdaniu.
    for (const [index, item] of items.entries()) {
      expect(item.title, `atut ${index + 1} dostał cudzy tytuł`).toBe(ATUTY.items[index]!.title);
      expect(item.text, `atut ${index + 1} dostał cudze zdanie`).toBe(ATUTY.items[index]!.text);
      expect(item.icon, `atut ${index + 1} dostał cudzą ikonę`).toBe(ATUTY.items[index]!.icon);
    }
  });

  it("z v1 jadą wszystkie trójki, a wpis niepełny odpada zamiast wejść z dziurą", () => {
    expect(uspItemsFromLegacy(ATUTY)).toEqual(ATUTY.items);
    expect(
      uspItemsFromLegacy({ items: [{ icon: "truck", title: "Bez zdania" }] }),
      "atut bez zdania przeszedł — schemat i tak by go nie przyjął",
    ).toEqual([]);
    expect(
      uspItemsFromLegacy({ items: [{ icon: "nie-ma-takiej", title: "A", text: "B" }] }),
      "ikona spoza allowlisty weszła do treści",
    ).toEqual([]);
  });

  it("cała konwersja przechodzi schemat i nie jest presetem", () => {
    const converted = structuredFromLegacy("usp", sectionCanvasFrom("usp", ATUTY), "pl");
    expect(STRUCTURED_SECTIONS.usp.schema.safeParse(converted).success).toBe(true);
    expect(itemsOf(converted)).toEqual(ATUTY.items);
    expect(itemsOf(converted), "wynik jest presetem — atuty operatora przepadły").not.toEqual(
      itemsOf(structuredPresetFor("usp", "pl")),
    );
  });
});

describe("E7 dostawa: karty z ceną i bez", () => {
  const DOSTAWA = {
    heading: "Dostawa i odbiór",
    text: "Sprzęt można odebrać albo zamówić z dowozem.",
    items: [
      { title: "Odbiór osobisty", text: "Wydajemy w magazynie." },
      { title: "Dowóz w mieście", text: "Podstawiamy pod adres." },
      { title: "Dowóz poza miasto", text: "Do 50 km od magazynu." },
    ],
  };

  it("z v1 jadą nagłówek, zdanie wprowadzające i karty — BEZ wymyślonych cen", () => {
    const { intro, items } = deliveryFromLegacy(DOSTAWA);
    expect(intro).toBe(DOSTAWA.text);
    expect(items).toEqual(DOSTAWA.items);
    for (const item of items) {
      expect(item, "konwersja dopisała cenę, której w starej treści nie było").not.toHaveProperty(
        "price_grosze",
      );
    }
  });

  it("z płótna karty wracają po KOLUMNIE, a zdanie wprowadzające po wariancie tekstu", () => {
    const plotno = sectionCanvasFrom("delivery", DOSTAWA);
    const { intro, items } = deliveryFromLegacy(plotno);
    expect(intro).toBe(DOSTAWA.text);
    expect(items).toEqual(DOSTAWA.items);
  });

  it("pusta cena jest STANEM treści, a nie ceną zerową", () => {
    const zCena = STRUCTURED_SECTIONS.delivery.schema.parse({
      ...structuredPresetFor("delivery", "pl"),
      items: [{ title: "Dowóz", text: "Pod adres.", price_grosze: 12_000 }],
    }) as unknown as { items: { price_grosze?: number }[] };
    expect(zCena.items[0]!.price_grosze).toBe(12_000);

    const bezCeny = STRUCTURED_SECTIONS.delivery.schema.parse({
      ...structuredPresetFor("delivery", "pl"),
      items: [{ title: "Odbiór", text: "W magazynie." }],
    }) as unknown as { items: Record<string, unknown>[] };
    expect(bezCeny.items[0]).not.toHaveProperty("price_grosze");
    // Zero jest legalne i ZNACZY co innego niż brak: „0,00 zł" przy dowozie
    // do 10 km jest informacją handlową, a nie brakiem ceny (jak w cenniku E6).
    expect(
      STRUCTURED_SECTIONS.delivery.schema.safeParse({
        ...structuredPresetFor("delivery", "pl"),
        items: [{ title: "Dowóz do 10 km", text: "Gratis.", price_grosze: 0 }],
      }).success,
    ).toBe(true);
    expect(
      STRUCTURED_SECTIONS.delivery.schema.safeParse({
        ...structuredPresetFor("delivery", "pl"),
        items: [{ title: "Dowóz", text: "Pod adres.", price_grosze: 1250.5 }],
      }).success,
      "cena ułamkowa w groszach przeszła — grosz jest niepodzielny",
    ).toBe(false);
  });
});

describe("E7 CTA: wariant powierzchni i konwersja", () => {
  const WEZWANIE = {
    heading: "Zarezerwuj termin",
    text: "Sprawdź dostępność i zarezerwuj online.",
    buttonLabel: "Zobacz katalog",
    buttonHref: "/store",
  };

  it("z v1 jadą nagłówek, zdanie i przycisk; wariant zostaje DOMYŚLNY", () => {
    const converted = structuredFromLegacy("cta", WEZWANIE, "pl") as unknown as Record<string, unknown>;
    expect(STRUCTURED_SECTIONS.cta.schema.safeParse(converted).success).toBe(true);
    expect(converted.heading).toBe(WEZWANIE.heading);
    expect(converted.text).toBe(WEZWANIE.text);
    expect(converted.items).toEqual([{ label: "Zobacz katalog", href: "/store" }]);
    /*
     * PINEZKA „złe kolory w każdym szablonie": stary baner był ZAWSZE odwrócony,
     * niezależnie od motywu. Przeniesienie tej decyzji powielałoby wadę zamiast
     * ją zamknąć — po konwersji CTA stoi na pasie sekcji i to operator decyduje,
     * czy ma krzyczeć.
     */
    expect(converted.variant).toBe("plain");
  });

  it("z płótna wraca komplet, a przycisków najwyżej tyle, ile mieści sufit", () => {
    const plotno = sectionCanvasFrom("cta", WEZWANIE);
    const { heading: naglowek, text, items } = ctaFromLegacy(plotno);
    expect(naglowek).toBe(WEZWANIE.heading);
    expect(text).toBe(WEZWANIE.text);
    expect(items).toEqual([{ label: "Zobacz katalog", href: "/store" }]);
  });

  it("treść BEZ przycisku degraduje do presetu — wezwania nie da się wymyślić", () => {
    expect(structuredFromLegacy("cta", { heading: "Sam nagłówek" }, "pl")).toEqual(
      structuredPresetFor("cta", "pl"),
    );
  });

  it("wariant powierzchni jest ZAMKNIĘTYM zbiorem i nie wpuszcza własnego heksa", () => {
    const base = structuredPresetFor("cta", "pl") as unknown as Record<string, unknown>;
    for (const variant of CTA_VARIANTS) {
      expect(
        STRUCTURED_SECTIONS.cta.schema.safeParse({ ...base, variant }).success,
        `wariant "${variant}" z rejestru odpadł na schemacie`,
      ).toBe(true);
    }
    expect(STRUCTURED_SECTIONS.cta.schema.safeParse({ ...base, variant: "#ff0000" }).success).toBe(false);
    expect(STRUCTURED_SECTIONS.cta.schema.safeParse({ ...base, variant: "inverted" }).success).toBe(false);
  });

  it("adres przycisku przechodzi TĘ SAMĄ allowlistę, co przycisk płótna", () => {
    const base = structuredPresetFor("cta", "pl") as unknown as Record<string, unknown>;
    for (const href of ["/store", "https://example.com", "#kotwica"]) {
      expect(
        STRUCTURED_SECTIONS.cta.schema.safeParse({ ...base, items: [{ label: "Idź", href }] }).success,
        `adres "${href}" odpadł, choć allowlista go wpuszcza`,
      ).toBe(true);
    }
    for (const href of ["javascript:alert(1)", "data:text/html,<b>x</b>"]) {
      expect(
        STRUCTURED_SECTIONS.cta.schema.safeParse({ ...base, items: [{ label: "Idź", href }] }).success,
        `adres "${href}" przeszedł — allowlista przycisku jest dziurawa`,
      ).toBe(false);
    }
  });
});
