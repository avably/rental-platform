/**
 * PUNKTY ODBIORU → WPISY SEKCJI DOJAZDU (E5, ADR-096 — delta recenzji PM
 * do PR #186).
 *
 * ==================== CO ZŁAPAŁA RECENZJA ====================
 *
 * Odsiew punktów NIEAKTYWNYCH siedział w warunku `.eq("active", true)` zapytania
 * w trasie RSC. Wycięcie go przechodziło CAŁĄ siatkę testów na zielono — bo
 * trasy serwerowej nie widzi żaden test jednostkowy, a szuflada dostaje już
 * gotowe wpisy. Reguła „strona ogłasza wyłącznie punkty, które naprawdę
 * przyjmują odbiory" nie miała ani jednego dowodu.
 *
 * ==================== CO ROBI TEN PLIK ====================
 *
 * Reguła stoi teraz w czystej `pickupLocationEntries` i jest tu mierzona
 * WPROST. Domknięcie od drugiej strony: kontrakt na końcu pilnuje, że trasa tę
 * funkcję WOŁA i nie filtruje sama — inaczej wystarczyłoby przenieść odsiew
 * z powrotem do zapytania, żeby wyjść spod tego pliku.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { CustomFieldDefinition } from "@avably/core";

import {
  catalogProductEntries,
  pickupLocationEntries,
  productFieldEntries,
  type PickupLocationRow,
} from "@/lib/site-import-sources";

function punkt(patch: Partial<PickupLocationRow> = {}): PickupLocationRow {
  return {
    name: "Magazyn Grochowska",
    address_street: "ul. Grochowska 128",
    address_zip: "04-301",
    address_city: "Warszawa",
    active: true,
    ...patch,
  };
}

describe("odsiew punktów NIEAKTYWNYCH (mutacja PM)", () => {
  it("punkt wyłączony w Dostawach NIE trafia na listę do skopiowania", () => {
    const wejscie = [
      punkt({ name: "Magazyn Grochowska" }),
      punkt({ name: "Punkt sezonowy", address_street: "ul. Zamknięta 1", active: false }),
      punkt({ name: "Punkt odbioru Wola", address_street: "ul. Kasprzaka 25", address_zip: "01-224" }),
    ];

    const wynik = pickupLocationEntries(wejscie);

    // Fikstura ma AKTYWNE i NIEAKTYWNE naraz: na liście samych aktywnych
    // przeszłaby też implementacja, która nie odsiewa niczego.
    expect(wynik.map((entry) => entry.label)).toEqual([
      "Magazyn Grochowska",
      "Punkt odbioru Wola",
    ]);
    expect(
      wynik.some((entry) => entry.address.includes("Zamknięta")),
      "punkt nieprzyjmujący odbiorów wszedł na stronę najemcy",
    ).toBe(false);
  });

  it("same nieaktywne dają pustą listę, a nie listę adresów pod zamkniętymi drzwiami", () => {
    expect(pickupLocationEntries([punkt({ active: false }), punkt({ active: false })])).toEqual([]);
  });

  it("kontrola pozytywna: same aktywne przechodzą co do jednego", () => {
    // Bez tego zdania test wyżej byłby zielony także dla funkcji, która odsiewa
    // WSZYSTKO — czyli dla przycisku, który nigdy nie ma czego wstawić.
    const wejscie = [punkt({ name: "A" }), punkt({ name: "B" }), punkt({ name: "C" })];
    expect(pickupLocationEntries(wejscie)).toHaveLength(3);
  });
});

describe("adres składa się z kolumn, a brak adresu wyklucza wpis", () => {
  it("ulica, kod i miasto w jednym napisie", () => {
    expect(pickupLocationEntries([punkt()])).toEqual([
      { label: "Magazyn Grochowska", address: "ul. Grochowska 128, 04-301 Warszawa" },
    ]);
  });

  it("puste człony wypadają, zamiast zostawiać przecinki po niczym", () => {
    expect(pickupLocationEntries([punkt({ address_zip: null })])[0]!.address).toBe(
      "ul. Grochowska 128, Warszawa",
    );
    expect(pickupLocationEntries([punkt({ address_street: null })])[0]!.address).toBe(
      "04-301 Warszawa",
    );
    expect(
      pickupLocationEntries([punkt({ address_street: "   ", address_zip: "  " })])[0]!.address,
      "same spacje udały adres",
    ).toBe("Warszawa");
  });

  it("punkt BEZ ani jednego członu adresu wypada — schemat sekcji by go nie przyjął", () => {
    const wynik = pickupLocationEntries([
      punkt({ name: "Bez adresu", address_street: null, address_zip: null, address_city: null }),
      punkt({ name: "Z adresem" }),
    ]);
    expect(wynik.map((entry) => entry.label)).toEqual(["Z adresem"]);
  });
});

describe("wynik jest KOPIĄ danych, nie odnośnikiem do nich (ADR-096)", () => {
  it("wpis niesie WYŁĄCZNIE etykietę i adres — zero identyfikatorów wiersza", () => {
    // Gdyby wpis niósł `id` punktu, „co widzi klient" przestałoby mieć
    // odpowiedź w treści sekcji, a zmiana w Dostawach przestawiałaby
    // opublikowaną stronę bez publikacji.
    for (const entry of pickupLocationEntries([punkt(), punkt({ name: "Drugi" })])) {
      expect(Object.keys(entry).sort()).toEqual(["address", "label"]);
    }
  });

  it("kolejność wejścia zostaje (trasa sortuje po nazwie, funkcja nie przestawia)", () => {
    const wynik = pickupLocationEntries([
      punkt({ name: "Zetka" }),
      punkt({ name: "Alfa" }),
      punkt({ name: "Beta" }),
    ]);
    expect(wynik.map((entry) => entry.label)).toEqual(["Zetka", "Alfa", "Beta"]);
  });
});

describe("trasa kreatora WOŁA tę funkcję i nie filtruje sama", () => {
  const TRASA = join(
    dirname(fileURLToPath(import.meta.url)),
    "../app/[locale]/(kreator)/strona/[siteId]/kreator/page.tsx",
  );
  const zrodlo = readFileSync(TRASA, "utf8");

  it("skan ma co czytać (kontrola po pustym pliku)", () => {
    expect(zrodlo.length).toBeGreaterThan(500);
    expect(zrodlo).toContain("pickup_locations");
  });

  it("wpisy powstają przez `pickupLocationEntries`, a nie mapowaniem w miejscu", () => {
    expect(
      zrodlo,
      "trasa przestała wołać czystą funkcję — reguły niżej znów nikt nie mierzy",
    ).toContain("pickupLocationEntries(");
  });

  it("odsiew aktywnych NIE wraca do zapytania — jedno miejsce decyzji", () => {
    /*
     * Dwa miejsca rozstrzygające to samo znaczą, że mutacja jednego z nich jest
     * niewidoczna: zapytanie odsiewałoby nieaktywne nawet wtedy, gdyby funkcja
     * przestała to robić — i testy wyżej świeciłyby fałszywą zielenią.
     */
    expect(
      zrodlo.includes('.eq("active"'),
      "warunek `active` wrócił do zapytania — mutacja czystej funkcji przestaje być widoczna",
    ).toBe(false);
    // Kolumna MUSI być czytana, inaczej funkcja dostaje `active: undefined`
    // i odsiew wycina wszystko po cichu.
    expect(zrodlo, "zapytanie nie czyta kolumny `active`").toMatch(/select\([^)]*active/);
  });
});

describe("pozycje katalogu do WSKAZANIA w sekcji sprzętu (E7)", () => {
  it("wynik niesie SAM identyfikator i nazwę — zero kopii ceny", () => {
    const wpisy = catalogProductEntries([
      { id: "aaaaaaaa-0001-4000-8000-000000000001", name: "Namiot 5 × 10 m" },
      { id: "aaaaaaaa-0002-4000-8000-000000000002", name: "Nagłośnienie" },
    ]);
    expect(wpisy).toEqual([
      { value: "aaaaaaaa-0001-4000-8000-000000000001", label: "Namiot 5 × 10 m" },
      { value: "aaaaaaaa-0002-4000-8000-000000000002", label: "Nagłośnienie" },
    ]);
    /*
     * Kształt jest wąski CELOWO: `label` żyje wyłącznie w szufladzie, a do
     * treści sekcji jedzie `value`. Dopisanie tu ceny albo zdjęcia zrobiłoby
     * z wpisu kopię oferty — i strona główna zostałaby przy cenie, której
     * najemca już nie ma w katalogu.
     */
    for (const wpis of wpisy) expect(Object.keys(wpis).sort()).toEqual(["label", "value"]);
  });

  it("KOLEJNOŚĆ zostaje z wejścia — trasa sortuje tak, jak operator widzi katalog", () => {
    expect(
      catalogProductEntries([
        { id: "aaaaaaaa-0003-4000-8000-000000000003", name: "Zestaw C" },
        { id: "aaaaaaaa-0001-4000-8000-000000000001", name: "Aparat A" },
      ]).map((wpis) => wpis.label),
    ).toEqual(["Zestaw C", "Aparat A"]);
  });

  it("pozycja bez nazwy WYPADA — bezimienny wiersz na liście wyboru nic nie mówi", () => {
    expect(
      catalogProductEntries([
        { id: "aaaaaaaa-0001-4000-8000-000000000001", name: "   " },
        { id: "", name: "Bez identyfikatora" },
        { id: "aaaaaaaa-0002-4000-8000-000000000002", name: " Nagłośnienie " },
      ]),
    ).toEqual([{ value: "aaaaaaaa-0002-4000-8000-000000000002", label: "Nagłośnienie" }]);
  });
});

/**
 * POLA WŁASNE SPRZĘTU DO WSKAZANIA NA KAFLU (faza 1b, ADR-154).
 *
 * ==================== TO JEST SONDA BEZPIECZEŃSTWA, NIE TEST WYGLĄDU ====================
 *
 * Kafel sprzętu czyta podtytuł i cechy z pól własnych pozycji, a do sklepu
 * docierają WYŁĄCZNIE pola oznaczone jako widoczne w zamawianiu (zawężenie
 * w `app.get_public_catalog`, migracja 0058). Lista wyboru w szufladzie musi
 * być tym samym zbiorem — inaczej interfejs proponowałby operatorowi wystawienie
 * klientowi pól LADY (koszt zakupu, numer w ewidencji), czyli operację, którą
 * baza i tak odrzuca, a której nikt nie powinien mu podsuwać.
 */
describe("pola własne sprzętu do WSKAZANIA na kaflu (faza 1b)", () => {
  function definicja(patch: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
    return {
      id: "bbbbbbbb-0001-4000-8000-000000000001",
      entity: "product",
      type: "text",
      label: "Zasięg",
      helpText: null,
      required: false,
      options: [],
      position: 0,
      showInPanel: true,
      showInCheckout: true,
      showInContract: false,
      archivedAt: null,
      createdAt: null,
      ...patch,
    };
  }

  it("pole sprzętu widoczne w zamawianiu wchodzi na listę wyboru", () => {
    expect(productFieldEntries([definicja()])).toEqual([
      { value: "bbbbbbbb-0001-4000-8000-000000000001", label: "Zasięg" },
    ]);
  });

  it("pole widoczne WYŁĄCZNIE w panelu NIE wchodzi na listę", () => {
    const wynik = productFieldEntries([
      definicja(),
      definicja({
        id: "bbbbbbbb-0002-4000-8000-000000000002",
        label: "Koszt zakupu",
        showInCheckout: false,
      }),
    ]);
    // Kontrola po pustym zbiorze: coś jednak wyszło, więc asercja niżej mierzy
    // odsiew, a nie martwą funkcję.
    expect(wynik).toHaveLength(1);
    expect(wynik.map((wpis) => wpis.label)).not.toContain("Koszt zakupu");
  });

  it("pole ZARCHIWIZOWANE nie wraca tylnymi drzwiami", () => {
    expect(
      productFieldEntries([definicja({ archivedAt: "2026-01-01T00:00:00Z" })]),
    ).toEqual([]);
  });

  it("pole INNEJ ENCJI nie jest polem sprzętu", () => {
    expect(
      productFieldEntries([
        definicja({ entity: "order", label: "Numer zlecenia" }),
        definicja({ id: "bbbbbbbb-0003-4000-8000-000000000003", entity: "customer", label: "Pesel" }),
      ]),
    ).toEqual([]);
  });

  it("pole bez etykiety WYPADA — bezimienny wiersz nic operatorowi nie mówi", () => {
    expect(productFieldEntries([definicja({ label: "   " })])).toEqual([]);
  });

  it("wynik niesie SAM identyfikator i etykietę — zero flag widoczności", () => {
    /*
     * Kształt wąski celowo: `label` żyje w szufladzie, a do treści sekcji jedzie
     * `value`. Flaga widoczności byłaby tu stałą (odsiew już ją zastosował),
     * a stała w kontrakcie zachęca do wysłania kiedyś tej drugiej wartości.
     */
    for (const wpis of productFieldEntries([definicja()])) {
      expect(Object.keys(wpis).sort()).toEqual(["label", "value"]);
    }
  });
});

describe("trasa kreatora podaje pola własne przez czystą funkcję", () => {
  const TRASA = join(
    dirname(fileURLToPath(import.meta.url)),
    "../app/[locale]/(kreator)/strona/[siteId]/kreator/page.tsx",
  );
  const zrodlo = readFileSync(TRASA, "utf8");

  it("wpisy powstają przez `productFieldEntries`", () => {
    expect(zrodlo).toContain("productFieldEntries(");
    expect(zrodlo, "źródło nie trafia do szuflady — kontrolka byłaby pusta").toMatch(
      /importSources=\{\{[\s\S]*productFields[\s\S]*\}\}/,
    );
  });

  it("odsiew widoczności NIE wraca do zapytania — jedno miejsce decyzji", () => {
    /*
     * Ta sama lekcja, co przy punktach odbioru wyżej: warunek w SQL byłby
     * niewidoczny dla testów jednostkowych, więc jego wycięcie przechodziłoby
     * całą siatkę na zielono — a tutaj wycięcie znaczy podsuwanie operatorowi
     * pól lady jako gotowych do pokazania klientowi.
     */
    expect(
      zrodlo.includes('.eq("show_in_checkout"'),
      "warunek widoczności wrócił do zapytania — mutacja czystej funkcji przestaje być widoczna",
    ).toBe(false);
  });
});
