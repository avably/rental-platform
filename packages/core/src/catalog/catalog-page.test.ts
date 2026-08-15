/**
 * ADRES I ARYTMETYKA STRONY KATALOGU (ADR-186).
 *
 * Cztery osi, każda o skutku, którego nie widać w typach:
 *
 *   1. ADRES STRONY PIERWSZEJ NIE NOSI PARAMETRU. `/katalog` i
 *      `/katalog?strona=1` to ta sama treść, więc jeden z nich musi być
 *      kanonem — a rozjazd między kanonem trasy a linkiem w nawigacji jest
 *      duplikatem, którego najemca nigdy nie zauważy sam.
 *
 *   2. NUMER SPOZA FORMY KANONICZNEJ TO `null`, A NIE CICHE 1. Tolerancja
 *      zamieniłaby każdy ciąg znaków w prawidłowy adres tej samej treści.
 *
 *   3. KATALOG PUSTY MA JEDNĄ STRONĘ. Zero stron znaczyłoby 404 na `/katalog`
 *      u najemcy, który dopiero wprowadza sprzęt.
 *
 *   4. PRZESUNIĘCIE ZGADZA SIĘ Z PODZIAŁEM. Rozjazd offsetu z rozmiarem strony
 *      daje pozycje pokazane dwa razy albo pominięte — awaria cicha, widoczna
 *      dopiero jako „nie mogę znaleźć sprzętu, który u was widziałem".
 */
import { describe, expect, it } from "vitest";

import {
  CATALOG_PAGE_MAX_SIZE,
  CATALOG_PAGE_PARAM,
  CATALOG_PAGE_SIZE,
  CATALOG_PATH_SEGMENT,
  catalogPageCount,
  catalogPageOffset,
  catalogPagePath,
  parseCatalogPageParam,
} from "./catalog-page";
import { RESERVED_CATEGORY_SLUGS } from "./categories";

describe("adres strony katalogu", () => {
  it("strona pierwsza nie nosi parametru, kolejne noszą", () => {
    expect(catalogPagePath()).toBe("/katalog");
    expect(catalogPagePath(1)).toBe("/katalog");
    expect(catalogPagePath(2)).toBe("/katalog?strona=2");
    expect(catalogPagePath(17)).toBe("/katalog?strona=17");
  });

  it("numer ≤ 1 nie produkuje adresu z parametrem-śmieciem", () => {
    // Wołający liczy `page - 1` przy odnośniku „poprzednia"; gdyby stąd wyszło
    // `?strona=0`, odnośnik prowadziłby pod adres, który trasa odrzuca (404).
    expect(catalogPagePath(0)).toBe("/katalog");
    expect(catalogPagePath(-3)).toBe("/katalog");
  });

  it("segment adresu JEST na liście zarezerwowanej", () => {
    // Bez tego wpisu strona treściowa najemcy o slugu `katalog` zapisałaby się
    // bez błędu i NIGDY nie wyświetliła — statyczna trasa Next wygrywa
    // z dynamiczną. Bramka w bazie to lustro tej listy (migracja 0085).
    expect(RESERVED_CATEGORY_SLUGS).toContain(CATALOG_PATH_SEGMENT);
  });

  it("adres składa się z zadeklarowanego segmentu i zadeklarowanego parametru", () => {
    // Kontrola po pustym zbiorze dla asercji wyżej: gdyby któraś ze stałych
    // była pusta, wszystkie porównania z literałami wciąż by przechodziły,
    // ale adres przestałby mieć cokolwiek wspólnego z rezerwacją.
    expect(CATALOG_PATH_SEGMENT).toBe("katalog");
    expect(CATALOG_PAGE_PARAM).toBe("strona");
    expect(catalogPagePath(2)).toContain(`/${CATALOG_PATH_SEGMENT}`);
    expect(catalogPagePath(2)).toContain(`${CATALOG_PAGE_PARAM}=2`);
  });
});

describe("numer strony z parametru adresu", () => {
  it("brak parametru znaczy stronę pierwszą", () => {
    expect(parseCatalogPageParam(undefined)).toBe(1);
  });

  it.each(["1", "2", "17", "1000"])("kanoniczny numer `%s` przechodzi", (raw) => {
    expect(parseCatalogPageParam(raw)).toBe(Number(raw));
  });

  it.each([
    ["", "pusty"],
    ["0", "zero"],
    ["-2", "ujemny"],
    ["01", "z zerem wiodącym"],
    ["1.5", "ułamkowy"],
    ["2e3", "wykładniczy"],
    [" 2", "ze spacją"],
    ["2 ", "ze spacją na końcu"],
    ["abc", "nieliczbowy"],
    ["9007199254740993", "poza zakresem liczb bezpiecznych"],
  ])("numer `%s` (%s) NIE jest adresem — null", (raw) => {
    expect(parseCatalogPageParam(raw)).toBeNull();
  });

  it("parametr POWTÓRZONY (tablica) też jest odrzucany", () => {
    // `?strona=2&strona=3` — zgadywanie, który wpis jest „ten prawdziwy",
    // jest zgadywaniem; adres bez jednoznacznego numeru strony nie istnieje.
    expect(parseCatalogPageParam(["2", "3"])).toBeNull();
    expect(parseCatalogPageParam([])).toBeNull();
  });
});

describe("podział katalogu na strony", () => {
  it("katalog pusty ma JEDNĄ stronę", () => {
    expect(catalogPageCount(0)).toBe(1);
    expect(catalogPageCount(-5)).toBe(1);
    expect(catalogPageCount(Number.NaN)).toBe(1);
  });

  it("liczba stron rośnie dokładnie na granicy rozmiaru strony", () => {
    expect(catalogPageCount(CATALOG_PAGE_SIZE)).toBe(1);
    expect(catalogPageCount(CATALOG_PAGE_SIZE + 1)).toBe(2);
    expect(catalogPageCount(2 * CATALOG_PAGE_SIZE)).toBe(2);
    expect(catalogPageCount(200)).toBe(Math.ceil(200 / CATALOG_PAGE_SIZE));
  });

  it("przesunięcie okna zgadza się z podziałem — bez powtórzeń i bez dziur", () => {
    const total = 200;
    const stron = catalogPageCount(total);
    const pokryte = new Set<number>();
    for (let strona = 1; strona <= stron; strona += 1) {
      const start = catalogPageOffset(strona);
      for (let i = start; i < Math.min(start + CATALOG_PAGE_SIZE, total); i += 1) pokryte.add(i);
    }
    expect(pokryte.size, "podział gubi albo dubluje pozycje").toBe(total);
  });

  it("przesunięcie nigdy nie jest ujemne — OFFSET < 0 to błąd 2201X w bazie", () => {
    expect(catalogPageOffset(1)).toBe(0);
    expect(catalogPageOffset(0)).toBe(0);
    expect(catalogPageOffset(-7)).toBe(0);
  });

  it("rozmiar strony mieści się pod sufitem odczytu", () => {
    // Odwrotnie byłoby cichą wadą: baza zacisnęłaby stronę do sufitu, a sklep
    // liczyłby strony według większej wartości — czyli nawigacja prowadziłaby
    // do pozycji, których strona nigdy nie pokaże.
    expect(CATALOG_PAGE_SIZE).toBeLessThanOrEqual(CATALOG_PAGE_MAX_SIZE);
  });

  it("rozmiar strony domyka OBIE szerokości siatki kafli (2 i 3 kolumny)", () => {
    // Inaczej każda strona poza ostatnią kończyłaby się niepełnym rzędem —
    // a katalog, w przeciwieństwie do sekcji sprzętu, nie może go uciąć.
    expect(CATALOG_PAGE_SIZE % 2).toBe(0);
    expect(CATALOG_PAGE_SIZE % 3).toBe(0);
  });
});
