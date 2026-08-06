/**
 * KONTRAKT SZABLONÓW STARTOWYCH (K5, ADR-090; treść 2.0 w E9).
 *
 * Sześć gotowych stron to sześć okazji do cichego regresu: literówka w polu,
 * pozycja listy dopisana tylko po polsku, sekcja, która po konwersji wychodzi
 * poza płótno. Żadna z tych rzeczy nie wywala kreatora — objawia się dopiero na
 * stronie tenanta, który zaufał przyciskowi „zacznij od szablonu".
 *
 * Testy stoją na PIĘCIU osiach, z których dwie ostatnie są tu ważniejsze niż
 * zwykle:
 *
 *   1. POPRAWNOŚĆ TREŚCI — każda sekcja spełnia schemat SWOJEJ GENERACJI:
 *      typ z rejestru strukturalnego → schemat v3, typ bez silnika → v1;
 *   2. PARYTET PL↔EN — te same typy, te same pasma, te same pola i długości
 *      tablic (jak przy presetach, ADR-082);
 *   3. POPRAWNOŚĆ PO EMISJI — sekcja strukturalna wychodzi jako v3 (a nie jako
 *      spłaszczone płótno), sekcja bez silnika przechodzi `sectionCanvasSchema`,
 *      a układ mobilny wyprowadzony z niej mieści się w pasie treści;
 *   4. KOMPLETNOŚĆ TREŚCI (E9). Schemat typu wymaga JEDNEGO wpisu, bo tyle
 *      wystarczy sekcji składanej ręcznie. Szablon startowy ma pokazać sekcję
 *      PEŁNĄ — galeria z jednym kadrem i FAQ z jednym pytaniem spełniają
 *      schemat i nie spełniają obietnicy „gotowa strona";
 *   5. PORÓWNANIE SZABLONÓW ZE SOBĄ. Sześć testów „szablon X jest poprawny"
 *      przepuściłoby sześć IDENTYCZNYCH stron, stronę bez wezwania do
 *      działania i stronę bez pierwszego ekranu, bo każdy z nich patrzyłby
 *      wyłącznie na siebie. Właściwości niżej są liczone na CAŁYM zbiorze
 *      i biorą go z {@link STARTER_TEMPLATES}, więc siódmy szablon dopisany
 *      bez otwarcia, bez CTA albo w kształcie kopii jednego z sześciu zapala
 *      ten plik sam z siebie.
 */
import { describe, expect, it } from "vitest";

import {
  CANVAS_CONTENT_COLUMNS,
  CANVAS_PAD_COLUMNS,
  MAX_ELEMENTS_PER_SECTION,
  SECTION_MAX_ROWS_MOBILE,
  SECTION_MIN_ROWS,
  isSectionCanvas,
  sectionCanvasSchema,
} from "./elements";
import {
  PRESET_LOCALES,
  SECTION_CONTENT_SCHEMAS,
  SECTION_TYPES,
  SITE_THEMES,
  imageSourceSchema,
  isPinnedLastType,
  themeTokens,
} from "./index";
import { STARTER_PHOTOS, STARTER_PHOTO_QUERIES, STARTER_PHOTO_SLOTS } from "./starter-photos";
import { geometryAt, mobileLayoutOf } from "./mobile-layout";
import {
  isStructuredSection,
  isStructuredType,
  structuredSchemaFor,
  STRUCTURED_SECTION_TYPES,
  type StructuredSectionType,
} from "./structured";
import {
  STARTER_CONTENT_MINIMUMS,
  STARTER_SECTION_BOUNDS,
  STARTER_TEMPLATES,
  starterTemplateContents,
  starterTemplateSections,
  type StarterSection,
  type StarterTemplate,
  STARTER_LAYOUTS,
  starterTemplatePhotoSlots,
  starterTemplateTheme,
} from "./starter-templates";

/**
 * Zbiera ścieżki (klucze obiektów + indeksy tablic) w kształcie wartości,
 * IGNORUJĄC wartości-liście — helper przeniesiony z `presets.test.ts`, bo pyta
 * dokładnie o to samo: dwie wartości o identycznym zestawie ścieżek mają te
 * same pola i te same długości tablic, czyli są w parytecie.
 */
function collectPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectPaths(item, `${prefix}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .flatMap((key) =>
        collectPaths((value as Record<string, unknown>)[key], `${prefix}.${key}`),
      );
  }
  return [prefix];
}

/** Każdy szablon w każdym języku — wejście wszystkich testów „per sekcja". */
const CASES: [StarterTemplate, (typeof PRESET_LOCALES)[number]][] = STARTER_TEMPLATES.flatMap(
  (id) => PRESET_LOCALES.map((locale) => [id, locale] as [StarterTemplate, typeof locale]),
);

/**
 * Czy sekcja jest WEZWANIEM DO DZIAŁANIA. Nie wystarczy szukać typu `cta`:
 * hero z przyciskiem też prowadzi do rezerwacji, a strona bez żadnego z nich
 * jest ulotką, nie stroną sprzedażową — i to jest ten stan, którego szuka
 * kontrakt niżej.
 */
function isCallToAction(section: StarterSection): boolean {
  if (section.type === "cta") return true;
  return section.type === "hero" && Boolean(section.content.ctaText && section.content.ctaHref);
}

/** Liczba wpisów listy w sekcji strukturalnej — 0 dla typu bez listy (sprzęt). */
function itemCountOf(section: StarterSection): number {
  const items = (section.content as { items?: unknown }).items;
  return Array.isArray(items) ? items.length : 0;
}

describe("szablony startowe: zbiór i identyfikatory", () => {
  it("zbiór wejść nie jest pusty (kontrola po pustym zbiorze)", () => {
    // Bez tego wszystkie `it.each` niżej przelatywałyby po zerowej liście.
    expect(STARTER_TEMPLATES.length).toBe(6);
    expect(PRESET_LOCALES.length).toBe(2);
    expect(CASES.length).toBe(12);
  });

  it("identyfikatory są stabilne w kształcie: ASCII, kebab-case, bez duplikatów", () => {
    // Identyfikator trafia do bazy jako wybór tenanta — polska litera albo
    // spacja w nim to problem na zawsze, a nie tylko dziś.
    for (const id of STARTER_TEMPLATES) {
      expect(id, `identyfikator „${id}" nie jest kebab-case ASCII`).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    }
    expect(new Set(STARTER_TEMPLATES).size).toBe(STARTER_TEMPLATES.length);
  });
});

describe("szablony startowe: treść sekcji jest poprawna", () => {
  it.each(CASES)("%s/%s: każda sekcja spełnia schemat SWOJEJ generacji", (id, locale) => {
    const declared = starterTemplateSections(id, locale);
    const emitted = starterTemplateContents(id, locale);
    expect(declared.length, `${id}/${locale}: szablon bez sekcji`).toBeGreaterThan(0);
    expect(emitted.length).toBe(declared.length);

    for (const [index, section] of emitted.entries()) {
      const schema = isStructuredType(section.type)
        ? structuredSchemaFor(section.type)!
        : SECTION_CONTENT_SCHEMAS[section.type];
      // Typ bez silnika strukturalnego wychodzi jako PŁÓTNO, więc mierzymy go
      // schematem płótna; jego treść v1 sprawdza osobny test niżej.
      const target = isStructuredType(section.type) ? section.content : declared[index]!.content;
      const result = schema.safeParse(target);
      expect(
        result.success ? null : result.error.issues,
        `${id}/${locale}: sekcja ${index + 1} (${section.type}) nie spełnia schematu`,
      ).toBeNull();
    }
  });

  it.each(CASES)("%s/%s: typ strukturalny wychodzi jako v3, a nie jako spłaszczone płótno", (id, locale) => {
    // Regres, którego ten test broni, jest cichy: szablon przepuszczony przez
    // starą konwersję renderuje się poprawnie, tyle że FAQ nie ma accordionu,
    // cennik nie zna ceny, a kontakt formularza. Strona wygląda jak strona.
    const rozjazdy: string[] = [];
    for (const section of starterTemplateContents(id, locale)) {
      const strukturalna = isStructuredSection(section.content);
      const płótno = isSectionCanvas(section.content);
      if (isStructuredType(section.type) && !strukturalna) {
        rozjazdy.push(`${section.type}: typ strukturalny, a treść nie jest v3`);
      }
      if (!isStructuredType(section.type) && !płótno) {
        rozjazdy.push(`${section.type}: typ bez silnika, a treść nie jest płótnem v2`);
      }
    }
    expect(rozjazdy, `${id}/${locale}:\n${rozjazdy.join("\n")}`).toEqual([]);
  });

  it.each(CASES)("%s/%s: układ sekcji strukturalnej jest wariantem Z REJESTRU tego typu", (id, locale) => {
    // Nazwa układu spoza rejestru przechodzi schemat tylko wtedy, gdy schemat
    // ma ją w enumie — ale wpisana literówka w szablonie zostałaby cicho
    // zamieniona na układ domyślny przez `withStructuredLayout`. Tu pytamy
    // wprost, bo szablon jest jedynym miejscem, w którym układ WYBIERAMY.
    for (const section of starterTemplateContents(id, locale)) {
      if (!isStructuredSection(section.content)) continue;
      expect(
        typeof section.content.layout,
        `${id}/${locale}/${section.type}: sekcja strukturalna bez układu`,
      ).toBe("string");
    }
  });
});

describe("szablony startowe: parytet PL↔EN", () => {
  it.each(STARTER_TEMPLATES)("%s: te same typy sekcji w tej samej kolejności", (id) => {
    const types = (locale: string) => starterTemplateSections(id, locale).map((s) => s.type);
    expect(types("en"), `${id}: skład strony rozjeżdża się między językami`).toEqual(types("pl"));
  });

  it.each(STARTER_TEMPLATES)("%s: ten sam rytm pasm tła", (id) => {
    // Pasmo jest decyzją kompozycji, więc nie ma prawa zależeć od języka —
    // inaczej ta sama strona miałaby inny rytm po przełączeniu treści.
    const bands = (locale: string) => starterTemplateSections(id, locale).map((s) => s.background);
    expect(bands("en"), `${id}: rytm pasm rozjeżdża się między językami`).toEqual(bands("pl"));
  });

  it.each(STARTER_TEMPLATES)("%s: ten sam KSZTAŁT treści (pola + długości tablic)", (id) => {
    // Bramka z briefu: szablon, który gubi pole albo pozycję listy w jednym
    // języku, jest czerwony — a nie „prawie taki sam".
    const paths = (locale: string) =>
      starterTemplateSections(id, locale).map((section) => collectPaths(section.content));
    expect(paths("en"), `${id}: treść rozjeżdża się strukturą PL↔EN`).toEqual(paths("pl"));
  });

  it.each(STARTER_TEMPLATES)("%s: galeria wskazuje TE SAME kadry w obu językach", (id) => {
    // Slot jest własnością kompozycji, a nie języka. Rozjazd byłby podwójnie
    // kosztowny: inna strona po angielsku ORAZ kadr, którego wyzwalacz pobrania
    // nigdy się nie odpali (`starterTemplatePhotoSlots` czyta wersję „pl").
    const slots = (locale: string) =>
      starterTemplateSections(id, locale).flatMap((section) =>
        section.type === "gallery" ? section.content.items.map((item) => item.slot) : [],
      );
    expect(slots("en"), `${id}: galeria pokazuje inne kadry po angielsku`).toEqual(slots("pl"));
  });
});

describe("szablony startowe: emisja treści", () => {
  it.each(CASES)("%s/%s: sekcja bez silnika daje POPRAWNE płótno", (id, locale) => {
    for (const [index, section] of starterTemplateContents(id, locale).entries()) {
      if (isStructuredType(section.type)) continue;
      const parsed = sectionCanvasSchema.safeParse(section.content);
      expect(
        parsed.success ? null : parsed.error.issues,
        `${id}/${locale}: sekcja ${index + 1} (${section.type}) nie spełnia schematu płótna`,
      ).toBeNull();
      const canvas = section.content as { elements: unknown[] };
      expect(canvas.elements.length, `${id}/${locale}: pusta sekcja ${section.type}`).toBeGreaterThan(0);
      expect(canvas.elements.length).toBeLessThanOrEqual(MAX_ELEMENTS_PER_SECTION);
    }
  });

  it.each(CASES)("%s/%s: pasmo tła z deklaracji PRZEŻYWA emisję w OBU generacjach", (id, locale) => {
    // Konwersja zna tylko sekcję i zwraca pasmo domyślne, a treść strukturalna
    // ma własne pole `background` z wartością domyślną — gdyby wynik nie był
    // nadpisywany deklaracją, cała strona wyszłaby jednolita, a akcent nigdy
    // nie stanąłby na paśmie odwróconym (kontrast palety, ADR-090).
    const declared = starterTemplateSections(id, locale).map((s) => s.background);
    const applied = starterTemplateContents(id, locale).map(
      (s) => (s.content as { background?: string }).background,
    );
    expect(applied).toEqual(declared);
  });

  it.each(CASES)("%s/%s: emisja jest POWTARZALNA co do bajtu", (id, locale) => {
    expect(starterTemplateContents(id, locale)).toEqual(starterTemplateContents(id, locale));
  });

  it("emisja nie skaża stałej modułu — druga strona dostaje kadry, nie pustkę", () => {
    // `galleryItemsOf` buduje nową listę wpisów; gdyby mutowała deklarację,
    // pierwszy tenant dostałby galerię, a drugi tablicę wpisów bez slotów.
    const first = starterTemplateContents("event-party", "pl");
    const galeria = first.find((section) => section.type === "gallery")!;
    (galeria.content as { items: unknown[] }).items.length = 1;

    const second = starterTemplateContents("event-party", "pl");
    const znowu = second.find((section) => section.type === "gallery")!;
    expect((znowu.content as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(
      STARTER_CONTENT_MINIMUMS.gallery,
    );
  });
});

describe("szablony startowe: kompletność treści (E9)", () => {
  it("progi kompletności pokrywają KOMPLET typów strukturalnych", () => {
    // Kontrola po pustym zbiorze i po niepełnej mapie naraz: typ dopisany do
    // rejestru bez progu przechodziłby niżej jako `undefined >= undefined`.
    const braki = STRUCTURED_SECTION_TYPES.filter(
      (type) => typeof STARTER_CONTENT_MINIMUMS[type] !== "number",
    );
    expect(braki, `typy strukturalne bez progu kompletności: ${braki.join(", ")}`).toEqual([]);
    expect(STRUCTURED_SECTION_TYPES.length).toBeGreaterThan(5);
  });

  it.each(CASES)("%s/%s: każda sekcja strukturalna niesie PEŁNĄ treść, nie jeden wpis", (id, locale) => {
    const braki: string[] = [];
    for (const section of starterTemplateSections(id, locale)) {
      if (!isStructuredType(section.type)) continue;
      const próg = STARTER_CONTENT_MINIMUMS[section.type as StructuredSectionType];
      const ile = itemCountOf(section);
      if (ile < próg) braki.push(`${section.type}: ${ile} wpisów, próg ${próg}`);
    }
    expect(braki, `${id}/${locale}: sekcje poniżej progu kompletności:\n${braki.join("\n")}`).toEqual([]);
  });

  it("galeria szablonu ma 6–8 kadrów — tyle, ile pokazuje, CZYM galeria jest", () => {
    // Górna granica jest tu tak samo świadoma jak dolna: dwanaście kadrów
    // w szablonie startowym to nie galeria, tylko praca do przycięcia.
    const galerie = STARTER_TEMPLATES.flatMap((id) =>
      starterTemplateSections(id, "pl")
        .filter((section) => section.type === "gallery")
        .map((section) => ({ id, ile: itemCountOf(section) })),
    );
    expect(galerie.length, "żaden szablon nie ma galerii — test straciłby sens").toBeGreaterThan(0);
    for (const { id, ile } of galerie) {
      expect(ile, `${id}: galeria ma ${ile} kadrów`).toBeGreaterThanOrEqual(6);
      expect(ile, `${id}: galeria ma ${ile} kadrów`).toBeLessThanOrEqual(8);
    }
  });

  it("FAQ szablonu ma 4–6 realnych par, a każda odpowiedź jest zdaniem, nie hasłem", () => {
    const faq = STARTER_TEMPLATES.flatMap((id) =>
      starterTemplateSections(id, "pl")
        .filter((section) => section.type === "faq")
        .map((section) => ({ id, section })),
    );
    expect(faq.length, "żaden szablon nie ma FAQ — test straciłby sens").toBeGreaterThan(0);
    for (const { id, section } of faq) {
      if (section.type !== "faq") continue;
      expect(section.content.items.length, `${id}: FAQ ma ${section.content.items.length} pytań`).toBeGreaterThanOrEqual(4);
      expect(section.content.items.length).toBeLessThanOrEqual(6);
      for (const [index, pair] of section.content.items.entries()) {
        expect(pair.a.length, `${id}: odpowiedź ${index + 1} jest hasłem, nie odpowiedzią`).toBeGreaterThan(40);
      }
    }
  });

  it("cennik szablonu liczy w GROSZACH całkowitych i dodatnich", () => {
    // Kwota zmiennoprzecinkowa przechodzi przez JSON i pada dopiero na
    // schemacie — a schemat sprawdzamy wyżej. Tu chodzi o coś innego: cennik
    // szablonu ma być PRZYKŁADEM, a `0 zł` za dobę najmu przykładem nie jest.
    const braki: string[] = [];
    for (const id of STARTER_TEMPLATES) {
      for (const section of starterTemplateSections(id, "pl")) {
        if (section.type !== "pricing") continue;
        for (const item of section.content.items) {
          if (!Number.isInteger(item.price_grosze)) braki.push(`${id}/${item.name}: nie grosze int`);
          if (item.price_grosze <= 0) braki.push(`${id}/${item.name}: pozycja cennika za darmo`);
        }
      }
    }
    expect(braki, braki.join("\n")).toEqual([]);
  });

  it("sekcja sprzętu bierze KATALOG i pokazuje go do sufitu 8 pozycji", () => {
    // Wskazania (`picked`) w szablonie startowym byłyby martwe od pierwszej
    // sekundy: identyfikatory produktów należą do tenanta, którego jeszcze nie
    // ma. Źródło „katalog" jest jedynym, które u nowego najemcy coś pokazuje.
    const sekcje = STARTER_TEMPLATES.flatMap((id) =>
      starterTemplateSections(id, "pl")
        .filter((section) => section.type === "products")
        .map((section) => ({ id, section })),
    );
    expect(sekcje.length, "żaden szablon nie pokazuje sprzętu").toBeGreaterThan(0);
    for (const { id, section } of sekcje) {
      if (section.type !== "products") continue;
      expect(section.content.source, `${id}: sekcja sprzętu nie czyta katalogu`).toBe("catalog");
      expect(section.content.limit, `${id}: sufit pozycji`).toBe(8);
      expect(section.content.items, `${id}: martwe wskazania w szablonie`).toEqual([]);
    }
  });

  it("kontakt szablonu ma FORMULARZ, a dojazd — adres do karty mapy", () => {
    const kontakty = STARTER_TEMPLATES.flatMap((id) =>
      starterTemplateSections(id, "pl").filter((s) => s.type === "contact").map((s) => ({ id, s })),
    );
    const dojazdy = STARTER_TEMPLATES.flatMap((id) =>
      starterTemplateSections(id, "pl").filter((s) => s.type === "directions").map((s) => ({ id, s })),
    );
    expect(kontakty.length, "żaden szablon nie ma kontaktu").toBeGreaterThan(0);
    expect(dojazdy.length, "żaden szablon nie ma dojazdu").toBeGreaterThan(0);

    for (const { id, s } of kontakty) {
      if (s.type !== "contact") continue;
      expect(s.content.showForm, `${id}: kontakt bez formularza`).toBe(true);
      expect(
        s.content.privacyHref,
        `${id}: formularz bez odnośnika do polityki prywatności`,
      ).toBeTruthy();
    }
    for (const { id, s } of dojazdy) {
      if (s.type !== "directions") continue;
      for (const item of s.content.items) {
        expect(item.address.trim().length, `${id}: punkt dojazdu bez adresu`).toBeGreaterThan(5);
      }
    }
  });
});

describe("szablony startowe: kontrakt porównujący je ZE SOBĄ", () => {
  /**
   * Otwarcie strony. Zbiór jest zamknięty i jednoelementowy nie bez powodu:
   * pierwszy ekran ma nieść obietnicę i przycisk, a nie cennik albo mapę
   * dojazdu. Rozszerzenie tej listy to decyzja projektowa, nie skutek uboczny
   * dopisania szablonu.
   */
  const OPENING_TYPES = new Set(["hero"]);

  it.each(STARTER_TEMPLATES)("%s: strona OTWIERA się pierwszym ekranem", (id) => {
    for (const locale of PRESET_LOCALES) {
      const first = starterTemplateSections(id, locale)[0];
      expect(first, `${id}/${locale}: szablon bez sekcji`).toBeDefined();
      expect(
        OPENING_TYPES.has(first!.type),
        `${id}/${locale}: strona zaczyna się od „${first!.type}", nie od pierwszego ekranu`,
      ).toBe(true);
    }
  });

  it.each(STARTER_TEMPLATES)("%s: strona ma co najmniej jedno wezwanie do działania", (id) => {
    for (const locale of PRESET_LOCALES) {
      const sections = starterTemplateSections(id, locale);
      expect(
        sections.some(isCallToAction),
        `${id}/${locale}: strona bez wezwania do działania — to ulotka, nie strona sprzedażowa`,
      ).toBe(true);
    }
  });

  it.each(STARTER_TEMPLATES)("%s: liczba sekcji mieści się w granicach szablonu", (id) => {
    for (const locale of PRESET_LOCALES) {
      // Granice liczą sekcje, które operator WYBIERA. Stopka jest przypięta i
      // jedyna (K6, ADR-092) — wliczanie jej do budżetu treści znaczyłoby, że
      // strona z danymi kontaktowymi w stopce ma prawo do jednego atutu mniej.
      const count = starterTemplateSections(id, locale).filter(
        (section) => !isPinnedLastType(section.type),
      ).length;
      expect(count, `${id}/${locale}: za mało sekcji`).toBeGreaterThanOrEqual(STARTER_SECTION_BOUNDS.min);
      expect(count, `${id}/${locale}: za dużo sekcji`).toBeLessThanOrEqual(STARTER_SECTION_BOUNDS.max);
    }
  });

  it.each(STARTER_TEMPLATES)("%s: strona kończy się DOKŁADNIE jedną stopką", (id) => {
    // Szablon startowy jest jedyną stroną, której operator nie składał sam —
    // ma więc być kompletna, a strona bez stopki nie ma gdzie postawić noty
    // o prawach ani godzin otwarcia. Dwie stopki są niereprezentowalne w
    // bazie (unikat częściowy w 0047); tu bronimy drugiej połowy tej samej
    // reguły: że w ogóle JEST i że stoi na końcu.
    for (const locale of PRESET_LOCALES) {
      const sections = starterTemplateSections(id, locale);
      const footers = sections.filter((section) => section.type === "footer");
      expect(footers.length, `${id}/${locale}: stopek na stronie`).toBe(1);
      expect(sections.at(-1)?.type, `${id}/${locale}: stopka nie jest ostatnia`).toBe("footer");
    }
  });

  it("żaden szablon nie odstaje objętością od pozostałych", () => {
    // Sedno porównania: szablon dwa razy dłuższy od reszty nie jest wariantem
    // tej samej propozycji, tylko inną obietnicą złożoną w tym samym miejscu.
    const counts = STARTER_TEMPLATES.map((id) => starterTemplateSections(id, "pl").length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(
      STARTER_SECTION_BOUNDS.max - STARTER_SECTION_BOUNDS.min,
    );
  });

  it.each(STARTER_TEMPLATES)("%s: strona wystawia akcent na WIĘCEJ niż jednym paśmie", (id) => {
    // Kontrast palety (ADR-090) jest obietnicą złożoną STRONIE, a nie
    // pojedynczej sekcji: szablon jednolicie jasny nigdy nie sprawdziłby
    // wariantu „ink" na żywej treści.
    const bands = new Set(starterTemplateSections(id, "pl").map((section) => section.background));
    expect(bands.size, `${id}: cała strona na jednym paśmie tła`).toBeGreaterThanOrEqual(2);
  });

  it("sześć szablonów RAZEM pokazuje cały słownik typów sekcji", () => {
    // Szablony są jedyną wystawą typów, którą operator zobaczy zanim zacznie
    // dodawać sekcje ręcznie. Typ, którego nie pokazuje żaden z sześciu,
    // istnieje wyłącznie dla tych, którzy wiedzą, że go szukać.
    const used = new Set(
      STARTER_TEMPLATES.flatMap((id) => starterTemplateSections(id, "pl").map((s) => s.type)),
    );
    const missing = SECTION_TYPES.filter((type) => !used.has(type));
    expect(missing, "typy sekcji nieobecne w żadnym szablonie startowym").toEqual([]);
  });

  it("sześć szablonów RAZEM pokazuje KAŻDY układ każdego typu strukturalnego", () => {
    // Wariant układu jest obietnicą rejestru (E1–E7). Układ, którego nie
    // pokazuje żaden szablon, jest funkcją bez wystawy: operator dowiaduje się
    // o nim dopiero wtedy, gdy sam otworzy szufladę i zacznie przełączać.
    const użyte = new Set(
      STARTER_TEMPLATES.flatMap((id) =>
        starterTemplateSections(id, "pl")
          .filter((section) => isStructuredType(section.type))
          .map((section) => `${section.type}:${(section.content as { layout: string }).layout}`),
      ),
    );
    // Sufit świadomy: sześć stron nie ma miejsca na wszystkie 21 par, więc
    // pytamy o POKRYCIE TYPÓW o więcej niż jednym układzie, nie o komplet par.
    const typyZWyborem = STRUCTURED_SECTION_TYPES.filter((type) =>
      STARTER_TEMPLATES.some((id) =>
        starterTemplateSections(id, "pl").some((section) => section.type === type),
      ),
    );
    const bezPokrycia = typyZWyborem.filter(
      (type) => ![...użyte].some((para) => para.startsWith(`${type}:`)),
    );
    expect(bezPokrycia, `typy obecne w szablonach, ale bez zadeklarowanego układu`).toEqual([]);
  });

  it("żadne dwa szablony nie są tą samą stroną", () => {
    // Sześć wariantów tego samego składu daje galerię, w której wybór niczego
    // nie zmienia — a to gorsze niż brak galerii, bo kosztuje decyzję.
    const shapes = STARTER_TEMPLATES.map((id) =>
      starterTemplateSections(id, "pl")
        .map((section) => `${section.type}:${section.background}`)
        .join(" > "),
    );
    expect(new Set(shapes).size, `powtórzony skład strony: ${shapes.join(" | ")}`).toBe(shapes.length);
  });
});

describe("szablony startowe: układ mobilny wyprowadzony z konwersji", () => {
  /** Sekcje, które NAPRAWDĘ są płótnem — sekcja v3 nie ma geometrii do liczenia. */
  const canvasesOf = (id: StarterTemplate, locale: string) =>
    starterTemplateContents(id, locale)
      .filter((section) => !isStructuredType(section.type))
      .map((section) => ({ type: section.type, content: section.content as never }));

  it("kontrola po pustym zbiorze: każdy szablon ma co najmniej jedno płótno", () => {
    for (const id of STARTER_TEMPLATES) {
      expect(canvasesOf(id, "pl").length, `${id}: same sekcje v3 — testy niżej badałyby pustkę`).toBeGreaterThan(0);
    }
  });

  it.each(CASES)("%s/%s: każdy element ma miejsce na telefonie", (id, locale) => {
    for (const section of canvasesOf(id, locale)) {
      const canvas = section.content as { elements: { id: string }[] };
      const layout = mobileLayoutOf(section.content);
      const missing = canvas.elements.filter((element) => !layout.boxes[element.id]);
      expect(missing.map((element) => element.id), `${id}/${locale}/${section.type}`).toEqual([]);
      expect(layout.rows).toBeGreaterThanOrEqual(SECTION_MIN_ROWS);
      expect(layout.rows).toBeLessThanOrEqual(SECTION_MAX_ROWS_MOBILE);
    }
  });

  it.each(CASES)("%s/%s: nic nie wychodzi poza pas treści telefonu", (id, locale) => {
    for (const section of canvasesOf(id, locale)) {
      const canvas = section.content as { elements: { id: string }[] };
      const layout = mobileLayoutOf(section.content);
      for (const element of canvas.elements) {
        const box = geometryAt(element as never, "mobile", layout);
        const where = `${id}/${locale}/${section.type}/${element.id}`;
        expect(box.x, `${where}: przed pasem treści`).toBeGreaterThanOrEqual(CANVAS_PAD_COLUMNS);
        expect(box.x + box.w, `${where}: za pasem treści`).toBeLessThanOrEqual(
          CANVAS_PAD_COLUMNS + CANVAS_CONTENT_COLUMNS,
        );
        expect(box.y + box.h, `${where}: poza dolną krawędzią`).toBeLessThanOrEqual(layout.rows);
      }
    }
  });

  it.each(CASES)("%s/%s: treść nie skleja się w kolumnie mobilnej", (id, locale) => {
    /*
     * Kształty są wyłączone celowo: kształt-podkład LEŻY POD swoją kartą i tak
     * ma być (ten sam wyjątek, co w kontrakcie auto-układu). Zakaz obejmuje
     * treść — dwa akapity w tym samym miejscu to strona nie do przeczytania.
     */
    for (const section of canvasesOf(id, locale)) {
      const canvas = section.content as { elements: { id: string; kind: string }[] };
      const layout = mobileLayoutOf(section.content);
      const boxes = canvas.elements
        .filter((element) => element.kind !== "shape")
        .map((element) => ({ id: element.id, ...geometryAt(element as never, "mobile", layout) }))
        .sort((a, b) => a.y - b.y || a.x - b.x);

      const kolizje: string[] = [];
      for (let index = 1; index < boxes.length; index += 1) {
        const above = boxes[index - 1]!;
        const below = boxes[index]!;
        if (below.y < above.y + above.h) kolizje.push(`${above.id} × ${below.id}`);
      }
      expect(kolizje, `${id}/${locale}/${section.type}: elementy zachodzą na siebie`).toEqual([]);
    }
  });
});

describe("szablony startowe: kopia i degradacja języka", () => {
  it("starterTemplateSections zwraca GŁĘBOKĄ kopię — mutacja nie skaża stałej", () => {
    // Edytor mutuje tę treść w stanie formularza. Współdzielona referencja
    // znaczyłaby, że pierwszy tenant, który poprawi nagłówek, zmienia szablon
    // kolejnemu w tym samym procesie — objaw nie do odtworzenia lokalnie.
    const first = starterTemplateSections("construction-tools", "pl");
    first.length = 1;
    const section = first[0]!;
    section.background = "inverted";
    if (section.type === "hero") section.content.heading = "ZMIENIONE";

    const second = starterTemplateSections("construction-tools", "pl");
    expect(second.length).toBeGreaterThan(1);
    expect(second[0]!.background).toBe("default");
    expect(second[0]!.type === "hero" && second[0]!.content.heading).not.toBe("ZMIENIONE");
  });

  it("kopia sięga TABLIC W ŚRODKU treści, nie tylko pierwszego poziomu", () => {
    const first = starterTemplateSections("event-party", "pl");
    const usp = first.find((section) => section.type === "usp");
    expect(usp, "szablon stracił sekcję atutów — test straciłby sens").toBeDefined();
    if (usp?.type === "usp") usp.content.items.pop();

    const second = starterTemplateSections("event-party", "pl");
    const again = second.find((section) => section.type === "usp");
    expect(again?.type === "usp" && again.content.items.length).toBe(3);
  });

  it("locale spoza allowlisty degraduje do PL", () => {
    expect(starterTemplateSections("bike-sport", "de")).toEqual(
      starterTemplateSections("bike-sport", "pl"),
    );
  });
});

// -----------------------------------------------------------------------
// ŚWIAT WIZUALNY SZABLONU (K5 v2, ADR-090)
// -----------------------------------------------------------------------
//
// Właściciel zamówił SZEŚĆ RÓŻNYCH ŚWIATÓW, a nie sześć wariantów tej samej
// strony. Te kontrakty pilnują trzech rzeczy, których nie widać w treści:
// motyw jest różny i prawdziwy, kadry stoją tam, gdzie sekcja naprawdę
// istnieje, a każde zdjęcie niesie KOMPLET atrybucji wymagany licencją.

describe("szablony startowe: każdy jest osobnym światem", () => {
  it("każdy szablon wskazuje motyw z rejestru i NIE jest to motyw zastany", () => {
    for (const id of STARTER_TEMPLATES) {
      const theme = starterTemplateTheme(id);
      expect(SITE_THEMES as readonly string[], `szablon ${id}: motyw spoza rejestru`).toContain(theme);
      expect(
        themeTokens(theme).legacy,
        `szablon ${id} wskazuje motyw ZASTANY — te istnieją wyłącznie dla stron sprzed ADR-090`,
      ).toBeUndefined();
    }
  });

  it("żadne dwa szablony nie dzielą motywu — sześć kafli to sześć światów", () => {
    const motywy = STARTER_TEMPLATES.map(starterTemplateTheme);
    expect(new Set(motywy).size, `powtórzony motyw: ${motywy.join(", ")}`).toBe(STARTER_TEMPLATES.length);
  });

  it("archetyp kadru i slot zdjęcia wskazują typ sekcji, który szablon NAPRAWDĘ ma", () => {
    // Wpis wskazujący na nieistniejącą sekcję jest cichy: szablon renderuje się
    // poprawnie, tyle że bez kadru, na który ktoś liczył.
    for (const id of STARTER_TEMPLATES) {
      const typy = new Set(starterTemplateSections(id, "pl").map((section) => section.type));
      const layout = STARTER_LAYOUTS[id];
      for (const type of Object.keys(layout.compositions ?? {})) {
        expect(typy, `szablon ${id}: archetyp dla sekcji "${type}", której nie ma`).toContain(type);
      }
      for (const type of Object.keys(layout.media ?? {})) {
        expect(typy, `szablon ${id}: kadr dla sekcji "${type}", której nie ma`).toContain(type);
      }
    }
  });

  it("tabela układu opisuje WYŁĄCZNIE typy bez silnika strukturalnego", () => {
    // Kompozycja i pas zdjęciowy działają na konwersji do płótna. Wpis dla typu
    // strukturalnego byłby martwy: sekcja v3 nie przechodzi przez konwersję,
    // więc kadr, na który ktoś liczył, nigdy by się nie pojawił — i to bez
    // jednego czerwonego testu.
    for (const id of STARTER_TEMPLATES) {
      const layout = STARTER_LAYOUTS[id];
      for (const type of [
        ...Object.keys(layout.compositions ?? {}),
        ...Object.keys(layout.media ?? {}),
      ]) {
        expect(
          isStructuredType(type),
          `szablon ${id}: tabela układu opisuje typ strukturalny „${type}" — wpis jest martwy`,
        ).toBe(false);
      }
    }
  });

  it("każdy slot z szablonu jest w rejestrze slotów i ma zapytanie kuracyjne", () => {
    for (const id of STARTER_TEMPLATES) {
      for (const slot of starterTemplatePhotoSlots(id)) {
        expect(STARTER_PHOTO_SLOTS as readonly string[], `nieznany slot ${slot}`).toContain(slot);
        expect(
          STARTER_PHOTO_QUERIES[slot]?.length ?? 0,
          `slot ${slot} bez zapytania kuracyjnego — wymiana kadru zaczynałaby się od zgadywania`,
        ).toBeGreaterThan(5);
      }
    }
  });

  it("sloty do wyzwalacza pobrania obejmują TAKŻE kadry galerii", () => {
    // Wyzwalacz jedzie po `starterTemplatePhotoSlots`. Gdyby ta funkcja czytała
    // wyłącznie tabelę układu (jak do E8), większość kadrów szablonu jechałaby
    // na stronę najemcy BEZ wywołania `download_location` — czyli ze złamanym
    // warunkiem regulaminu dostawcy, którego nie widać na żadnym zrzucie.
    for (const id of STARTER_TEMPLATES) {
      const zGalerii = starterTemplateSections(id, "pl").flatMap((section) =>
        section.type === "gallery" ? section.content.items.map((item) => item.slot) : [],
      );
      const zgłoszone = new Set(starterTemplatePhotoSlots(id));
      const pominięte = zGalerii.filter((slot) => !zgłoszone.has(slot));
      expect(pominięte, `${id}: kadry galerii bez wyzwalacza pobrania`).toEqual([]);
    }
  });

  it("KAŻDE zdjęcie szablonu niesie komplet atrybucji wymagany licencją", () => {
    // To jest warunek licencyjny zapisany jako test: kadr bez nazwiska autora,
    // bez linku do profilu albo bez adresu wyzwalacza pobrania nie jest
    // „gorszym zdjęciem", tylko zdjęciem, którego nie wolno pokazać. Pętla idzie
    // po slotach UŻYTYCH PRZEZ SZABLONY, więc slot dopisany do szablonu bez
    // kuracji zapala ten test, a nie znika po cichu w kaflu zastępczym.
    const braki: string[] = [];
    for (const id of STARTER_TEMPLATES) {
      for (const slot of starterTemplatePhotoSlots(id)) {
        const photo = STARTER_PHOTOS[slot];
        if (!photo) {
          braki.push(`${id}/${slot}: brak kadru w rejestrze`);
          continue;
        }
        const parsed = imageSourceSchema.safeParse(photo);
        if (!parsed.success || parsed.data.kind !== "unsplash") {
          braki.push(`${id}/${slot}: kadr bez kompletu atrybucji`);
        }
      }
    }
    expect(braki, `zdjęcia bez kompletu:\n${braki.join("\n")}`).toEqual([]);
  });

  it("galeria szablonu ma KOMPLET kadrów — filtr braku kuracji nie ma czego odsiać", () => {
    // `galleryItemsOf` odsiewa slot bez kadru, żeby nie wypuścić treści, której
    // nie da się zapisać. Odsiew jest siatką bezpieczeństwa, nie planem: gdyby
    // działał, galeria po cichu traciłaby kafle. Tu porównujemy deklarację
    // z emisją, więc brak kuracji jest CZERWONY, a nie niewidoczny.
    for (const id of STARTER_TEMPLATES) {
      for (const locale of PRESET_LOCALES) {
        const zadeklarowane = starterTemplateSections(id, locale)
          .filter((section) => section.type === "gallery")
          .map((section) => itemCountOf(section));
        const wyemitowane = starterTemplateContents(id, locale)
          .filter((section) => section.type === "gallery")
          .map((section) => (section.content as { items: unknown[] }).items.length);
        expect(wyemitowane, `${id}/${locale}: galeria straciła kadry przy emisji`).toEqual(zadeklarowane);
      }
    }
  });

  it("każde zdjęcie w treści szablonu ma opis alternatywny w OBU językach", () => {
    // Dwa źródła zdjęć od E9: elementy `image` w płótnie (hero, pasy) i wpisy
    // galerii w sekcji v3. Pusty opis alternatywny znaczy „zdjęcie dekoracyjne"
    // — a kadr wesela w galerii realizacji dekoracyjny nie jest.
    for (const id of STARTER_TEMPLATES) {
      for (const locale of PRESET_LOCALES) {
        for (const section of starterTemplateContents(id, locale)) {
          if (isStructuredSection(section.content)) {
            if (section.content.type !== "gallery") continue;
            for (const [index, item] of section.content.items.entries()) {
              expect(
                item.alt.trim().length,
                `${id}/${locale}/galeria: kadr ${index + 1} bez opisu alternatywnego`,
              ).toBeGreaterThan(3);
            }
            continue;
          }
          for (const element of (section.content as { elements: { kind: string; alt?: string }[] }).elements) {
            if (element.kind !== "image") continue;
            expect(
              element.alt!.trim().length,
              `${id}/${locale}/${section.type}: zdjęcie bez opisu alternatywnego`,
            ).toBeGreaterThan(3);
          }
        }
      }
    }
  });

  it("kadr wchodzi POD treść, a welon między nie — inaczej tekst zniknąłby pod zdjęciem", () => {
    // Kolejność warstw jest jedyną rzeczą, która czyni hero na pełnym kadrze
    // czytelnym. Test idzie po WSZYSTKICH szablonach z archetypem `overlay`.
    for (const id of STARTER_TEMPLATES) {
      if (STARTER_LAYOUTS[id].compositions?.hero !== "overlay") continue;
      const hero = starterTemplateContents(id, "pl").find((section) => section.type === "hero")!;
      const elements = (hero.content as unknown as {
        elements: { kind: string; fill?: string; layout: { desktop: { z: number } } }[];
      }).elements;
      const image = elements.find((element) => element.kind === "image")!;
      const scrim = elements.find((element) => element.kind === "shape" && element.fill === "scrim")!;
      const tekst = elements.filter(
        (element) => element.kind === "heading" || element.kind === "text",
      );
      expect(image, `${id}: hero bez kadru`).toBeDefined();
      expect(scrim, `${id}: hero na zdjęciu BEZ welonu — kontrast nie do policzenia`).toBeDefined();
      expect(image.layout.desktop.z).toBeLessThan(scrim.layout.desktop.z);
      for (const element of tekst) {
        expect(
          element.layout.desktop.z,
          `${id}: tekst nie leży nad welonem`,
        ).toBeGreaterThan(scrim.layout.desktop.z);
      }
    }
  });
});
