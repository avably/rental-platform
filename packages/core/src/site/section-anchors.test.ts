/**
 * KOTWICE SEKCJI — REJESTR I JEGO UMOWA Z TREŚCIĄ STARTOWĄ.
 *
 * ==================== CO TU JEST NAPRAWDĘ BRONIONE ====================
 *
 * Rejestr sam w sobie jest tabelą trzynastu napisów i testowanie go „czy ma
 * trzynaście wpisów" byłoby przepisywaniem kodu do testu. Wartość jest gdzie
 * indziej: między rejestrem a TREŚCIĄ STARTOWĄ istnieje umowa, której nie widać
 * w żadnym z tych dwóch plików. Preset hero mówi `ctaHref: "#produkty"`, stopka
 * — `href: "#kontakt"`, a to działa wyłącznie wtedy, gdy po drugiej stronie
 * ktoś wystawia dokładnie te nazwy. Do tej pory nie wystawiał ich NIKT i nikt
 * tego nie zauważył, bo martwy odnośnik nie zapala się na czerwono.
 *
 * Stąd noga główna: KAŻDY adres kotwicy występujący w presetach i w szablonach
 * startowych musi być nazwą z rejestru. Literówka w `#produky`, kotwica
 * wymyślona przy pisaniu nowego szablonu i nazwa zmieniona z jednej strony —
 * wszystkie trzy przypadki są tym samym błędem i wszystkie trzy zapalają ten
 * plik.
 *
 * ==================== I OSOBNO: CZY JEST DOKĄD SKAKAĆ ====================
 *
 * Adres poprawny to jeszcze nie adres żywy. Kotwica `#kontakt` w stopce
 * szablonu, który nie ma sekcji kontaktu, jest gramatycznie w porządku
 * i prowadzi donikąd. Druga noga liczy to per szablon i wymaga, żeby każdy
 * taki przypadek był WYMIENIONY Z NAZWY (patrz `MARTWE_KOTWICE_SZABLONU`) —
 * razem z drugą stroną tej samej reguły: wpis, który przestał być prawdą,
 * musi zejść z listy, a nie zostać na niej jako cicha zgoda.
 */
import { describe, expect, it } from "vitest";

import {
  PRESET_LOCALES,
  presetContentFor,
  SECTION_ANCHORS,
  SECTION_TYPES,
  sectionAnchorHref,
  sectionAnchorIds,
  STARTER_TEMPLATES,
  starterTemplateSections,
  STRUCTURED_SECTION_TYPES,
  structuredPresetFor,
  type SectionType,
} from "./index";

/**
 * Wszystkie adresy kotwic z dowolnie zagnieżdżonej treści sekcji.
 *
 * Chodzimy po WARTOŚCIACH, a nie po znanych polach (`ctaHref`, `buttonHref`,
 * `links[].href`): lista nazw pól rozjeżdża się z modelem przy pierwszym nowym
 * typie sekcji, i to po cichu — skan po trzech nazwach po prostu przestaje
 * cokolwiek widzieć w czwartej.
 */
function kotwiceW(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.startsWith("#")) found.push(value.slice(1));
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) kotwiceW(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) kotwiceW(item, found);
  }
  return found;
}

describe("rejestr kotwic", () => {
  it("zna KAŻDY typ sekcji — komplet, nie podzbiór", () => {
    // Typ bez kotwicy to sekcja, do której nie da się zrobić przycisku.
    // TypeScript pilnuje tego przy kompilacji (`Record<SectionType, string>`),
    // ale rejestr czytają też testy i dane, więc zdanie musi istnieć również
    // w czasie wykonania.
    expect(Object.keys(SECTION_ANCHORS).sort()).toEqual([...SECTION_TYPES].sort());
  });

  it("nazwy są UNIKALNE — dwa typy nie mogą walczyć o jeden adres", () => {
    const nazwy = Object.values(SECTION_ANCHORS);
    expect(new Set(nazwy).size, `powtórzona nazwa kotwicy w rejestrze: ${nazwy.join(", ")}`).toBe(
      nazwy.length,
    );
  });

  it("nazwy nadają się na identyfikator w dokumencie i na adres URL", () => {
    // Bez spacji, wielkich liter i znaków diakrytycznych: kotwica jedzie do
    // paska adresu i wraca stamtąd zakodowana procentowo, a `#o‑nas` wpisane
    // z półpauzą wygląda w kodzie jak `#o-nas` i nigdy nie trafia w cel.
    for (const [type, anchor] of Object.entries(SECTION_ANCHORS)) {
      expect(anchor, `kotwica typu ${type}`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("adres kotwicy niesie krzyżyk dokładnie raz", () => {
    expect(sectionAnchorHref("products")).toBe("#produkty");
    expect(sectionAnchorHref("contact")).toBe("#kontakt");
  });
});

describe("kotwice konkretnej strony", () => {
  const sekcja = (id: string, type: SectionType) => ({ id, type });

  it("każda sekcja dostaje kotwicę swojego typu", () => {
    const anchors = sectionAnchorIds([sekcja("a", "hero"), sekcja("b", "products")]);
    expect(anchors.get("a")).toBe(SECTION_ANCHORS.hero);
    expect(anchors.get("b")).toBe(SECTION_ANCHORS.products);
  });

  it("przy DWÓCH sekcjach tego samego typu kotwicę bierze PIERWSZA", () => {
    // Duplikat `id` to niepoprawny dokument, a przeglądarka i tak skacze do
    // pierwszego wystąpienia — reguła nazywa więc to, co i tak się stanie.
    const anchors = sectionAnchorIds([
      sekcja("a", "usp"),
      sekcja("b", "products"),
      sekcja("c", "usp"),
    ]);
    expect(anchors.get("a")).toBe(SECTION_ANCHORS.usp);
    expect(anchors.has("c")).toBe(false);
    expect(anchors.size).toBe(2);
  });

  it("pierwsza znaczy pierwsza W PODANEJ KOLEJNOŚCI, nie po nazwie typu", () => {
    const anchors = sectionAnchorIds([sekcja("druga", "usp"), sekcja("pierwsza", "usp")]);
    expect(anchors.has("druga")).toBe(true);
    expect(anchors.has("pierwsza")).toBe(false);
  });

  it("strona bez sekcji nie ma kotwic", () => {
    expect(sectionAnchorIds([]).size).toBe(0);
  });
});

describe("treść startowa kieruje WYŁĄCZNIE na kotwice z rejestru", () => {
  const znane = new Set(Object.values(SECTION_ANCHORS));

  /** Wszystkie pary (skąd, kotwica) z presetów sekcji i szablonów startowych. */
  const uzycia: { skad: string; anchor: string }[] = [];

  for (const locale of PRESET_LOCALES) {
    for (const type of SECTION_TYPES) {
      for (const anchor of kotwiceW(presetContentFor(type, locale))) {
        uzycia.push({ skad: `preset ${type}/${locale}`, anchor });
      }
    }
    for (const type of STRUCTURED_SECTION_TYPES) {
      for (const anchor of kotwiceW(structuredPresetFor(type, locale))) {
        uzycia.push({ skad: `preset v3 ${type}/${locale}`, anchor });
      }
    }
    for (const id of STARTER_TEMPLATES) {
      for (const anchor of kotwiceW(starterTemplateSections(id, locale))) {
        uzycia.push({ skad: `szablon ${id}/${locale}`, anchor });
      }
    }
  }

  it("skan naprawdę coś znalazł (kontrola po pustym zbiorze)", () => {
    // Bez tego zdania cała reszta tego bloku przechodzi dla zera adresów —
    // a to jest najbardziej prawdopodobna awaria skanu chodzącego po danych.
    expect(uzycia.length, "nie znaleziono ANI JEDNEGO adresu kotwicy w treści startowej").toBeGreaterThan(
      20,
    );
    expect(uzycia.map((u) => u.anchor)).toContain("produkty");
  });

  it("KAŻDY użyty adres jest nazwą z rejestru", () => {
    const nieznane = uzycia
      .filter((u) => !znane.has(u.anchor))
      .map((u) => `#${u.anchor} (${u.skad})`);
    expect(
      [...new Set(nieznane)],
      "adres kotwicy, któremu nie odpowiada żaden typ sekcji — przycisk z takim adresem " +
        "nie zrobi na opublikowanej stronie NIC. Popraw treść albo dopisz typ do SECTION_ANCHORS.",
    ).toEqual([]);
  });
});

/**
 * ==================== ŻADNA KOTWICA SZABLONU NIE PROWADZI DONIKĄD ====================
 *
 * Adres poprawny to jeszcze nie adres żywy: `#kontakt` w stopce szablonu, który
 * nie ma sekcji kontaktu, jest gramatycznie w porządku i prowadzi w pustkę.
 *
 * Pierwsza wersja tego bloku (napisana przed E9) mierzyła stan zastany LISTĄ
 * wyjątków: cztery szablony z martwą kotwicą wymienione z nazwy, z regułą, że
 * wpis nieprawdziwy pali tak samo jak brakujący. Lista zrobiła dokładnie to, po
 * co była — po przepisaniu szablonów w E9 zapaliła się na `bike-sport`
 * i `event-party` (ich martwe adresy zniknęły razem ze zmianą treści), a dwa
 * pozostałe (`construction-tools`, `catalog-first`) doczekały poprawki adresu
 * w stopce. Zbiór wyjątków jest odtąd PUSTY, więc lista zniknęła: pusty rejestr
 * wyjątków to nie „mechanizm na przyszłość", tylko furtka, przez którą następny
 * martwy odnośnik wszedłby jako wpis zamiast jako czerwony test.
 *
 * Zdanie brzmi więc twardo: KAŻDY adres kotwicy w KAŻDYM szablonie ma w tym
 * szablonie sekcję docelową.
 */
describe("kotwice szablonu startowego mają dokąd prowadzić", () => {
  /** Kotwice używane w treści, których skład tej strony nie wystawia. */
  function martweKotwice(sections: readonly { type: SectionType; content: unknown }[]): string[] {
    const wystawione = new Set(sections.map((section) => SECTION_ANCHORS[section.type]));
    const martwe = new Set(kotwiceW(sections).filter((anchor) => !wystawione.has(anchor)));
    return [...martwe].sort();
  }

  function martweW(id: (typeof STARTER_TEMPLATES)[number]): string[] {
    const martwe = new Set<string>();
    for (const locale of PRESET_LOCALES) {
      for (const anchor of martweKotwice(starterTemplateSections(id, locale))) martwe.add(anchor);
    }
    return [...martwe].sort();
  }

  it.each([...STARTER_TEMPLATES])("%s: żadna kotwica nie prowadzi donikąd", (id) => {
    expect(
      martweW(id),
      "przycisk kieruje na sekcję, której ten szablon nie ma w składzie — na opublikowanej " +
        "stronie nie zrobi NIC. Skieruj adres na sekcję obecną w składzie (skład szablonu " +
        "jest decyzją designową, nie skutkiem ubocznym kotwic).",
    ).toEqual([]);
  });

  it("detektor martwej kotwicy naprawdę ją widzi (kontrola pozytywna)", () => {
    /*
     * Bez tego zdania cała noga wyżej przechodzi także wtedy, gdy `martweKotwice`
     * przestanie cokolwiek znajdować — a to jest najbardziej prawdopodobna
     * awaria detektora chodzącego po danych, i awaria CICHA: sześć zielonych
     * testów wyglądałoby wtedy jak sześć naprawionych szablonów.
     */
    const stopkaZKotwica = {
      type: "footer" as SectionType,
      content: { links: [{ label: "Kontakt", href: sectionAnchorHref("contact") }] },
    };
    expect(martweKotwice([stopkaZKotwica])).toEqual([SECTION_ANCHORS.contact]);
    expect(
      martweKotwice([stopkaZKotwica, { type: "contact" as SectionType, content: {} }]),
      "kotwica przestaje być martwa, gdy sekcja docelowa STOI na stronie",
    ).toEqual([]);
  });
});
