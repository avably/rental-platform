/**
 * KONTRAKT SZABLONÓW STARTOWYCH (K5, ADR-090).
 *
 * Sześć gotowych stron to sześć okazji do cichego regresu: literówka w polu,
 * pozycja listy dopisana tylko po polsku, sekcja, która po konwersji wychodzi
 * poza płótno. Żadna z tych rzeczy nie wywala kreatora — objawia się dopiero na
 * stronie tenanta, który zaufał przyciskowi „zacznij od szablonu".
 *
 * Testy stoją na CZTERECH osiach, z których dwie ostatnie są tu ważniejsze niż
 * zwykle:
 *
 *   1. POPRAWNOŚĆ TREŚCI — każda sekcja spełnia schemat swojego typu;
 *   2. PARYTET PL↔EN — te same typy, te same pasma, te same pola i długości
 *      tablic (jak przy presetach, ADR-082);
 *   3. POPRAWNOŚĆ PO KONWERSJI — płótno v2 z każdej sekcji przechodzi
 *      `sectionCanvasSchema`, a układ mobilny wyprowadzony z niego mieści się
 *      w pasie treści i nie skleja elementów;
 *   4. PORÓWNANIE SZABLONÓW ZE SOBĄ. Sześć testów „szablon X jest poprawny"
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
  STARTER_SECTION_BOUNDS,
  STARTER_TEMPLATES,
  starterTemplateCanvases,
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
  it.each(CASES)("%s/%s: każda sekcja spełnia schemat swojego typu", (id, locale) => {
    const sections = starterTemplateSections(id, locale);
    expect(sections.length, `${id}/${locale}: szablon bez sekcji`).toBeGreaterThan(0);
    for (const [index, section] of sections.entries()) {
      const result = SECTION_CONTENT_SCHEMAS[section.type].safeParse(section.content);
      expect(
        result.success ? null : result.error.issues,
        `${id}/${locale}: sekcja ${index + 1} (${section.type}) nie spełnia schematu`,
      ).toBeNull();
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
});

describe("szablony startowe: konwersja do płótna v2", () => {
  it.each(CASES)("%s/%s: każda sekcja daje POPRAWNE płótno", (id, locale) => {
    const canvases = starterTemplateCanvases(id, locale);
    expect(canvases.length).toBe(starterTemplateSections(id, locale).length);
    for (const [index, section] of canvases.entries()) {
      const parsed = sectionCanvasSchema.safeParse(section.content);
      expect(
        parsed.success ? null : parsed.error.issues,
        `${id}/${locale}: sekcja ${index + 1} (${section.type}) nie spełnia schematu płótna`,
      ).toBeNull();
      expect(section.content.elements.length, `${id}/${locale}: pusta sekcja ${section.type}`).toBeGreaterThan(0);
      expect(section.content.elements.length).toBeLessThanOrEqual(MAX_ELEMENTS_PER_SECTION);
    }
  });

  it.each(CASES)("%s/%s: pasmo tła z deklaracji PRZEŻYWA konwersję", (id, locale) => {
    // Konwersja zna tylko sekcję i zwraca pasmo domyślne — gdyby wynik nie był
    // nadpisywany, cała strona wyszłaby jednolita, a akcent nigdy nie stanąłby
    // na paśmie odwróconym (kontrast palety, ADR-090).
    const declared = starterTemplateSections(id, locale).map((s) => s.background);
    const applied = starterTemplateCanvases(id, locale).map((s) => s.content.background);
    expect(applied).toEqual(declared);
  });

  it.each(CASES)("%s/%s: konwersja jest POWTARZALNA co do bajtu", (id, locale) => {
    expect(starterTemplateCanvases(id, locale)).toEqual(starterTemplateCanvases(id, locale));
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
  it.each(CASES)("%s/%s: każdy element ma miejsce na telefonie", (id, locale) => {
    for (const section of starterTemplateCanvases(id, locale)) {
      const layout = mobileLayoutOf(section.content);
      const missing = section.content.elements.filter((element) => !layout.boxes[element.id]);
      expect(missing.map((element) => element.id), `${id}/${locale}/${section.type}`).toEqual([]);
      expect(layout.rows).toBeGreaterThanOrEqual(SECTION_MIN_ROWS);
      expect(layout.rows).toBeLessThanOrEqual(SECTION_MAX_ROWS_MOBILE);
    }
  });

  it.each(CASES)("%s/%s: nic nie wychodzi poza pas treści telefonu", (id, locale) => {
    for (const section of starterTemplateCanvases(id, locale)) {
      const layout = mobileLayoutOf(section.content);
      for (const element of section.content.elements) {
        const box = geometryAt(element, "mobile", layout);
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
    for (const section of starterTemplateCanvases(id, locale)) {
      const layout = mobileLayoutOf(section.content);
      const boxes = section.content.elements
        .filter((element) => element.kind !== "shape")
        .map((element) => ({ id: element.id, ...geometryAt(element, "mobile", layout) }))
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
    const first = starterTemplateSections("photo-video", "pl");
    const usp = first.find((section) => section.type === "usp");
    expect(usp, "szablon stracił sekcję atutów — test straciłby sens").toBeDefined();
    if (usp?.type === "usp") usp.content.items.pop();

    const second = starterTemplateSections("photo-video", "pl");
    const again = second.find((section) => section.type === "usp");
    expect(again?.type === "usp" && again.content.items.length).toBe(4);
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

  it("każdy element `image` w płótnie szablonu ma opis alternatywny w OBU językach", () => {
    for (const id of STARTER_TEMPLATES) {
      for (const locale of PRESET_LOCALES) {
        for (const section of starterTemplateCanvases(id, locale)) {
          for (const element of section.content.elements) {
            if (element.kind !== "image") continue;
            expect(
              element.alt.trim().length,
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
      const hero = starterTemplateCanvases(id, "pl").find((section) => section.type === "hero")!;
      const image = hero.content.elements.find((element) => element.kind === "image")!;
      const scrim = hero.content.elements.find(
        (element) => element.kind === "shape" && element.fill === "scrim",
      )!;
      const tekst = hero.content.elements.filter(
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
