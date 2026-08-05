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

import { pickupLocationEntries, type PickupLocationRow } from "@/lib/site-import-sources";

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
