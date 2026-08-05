/**
 * KONTRAKT PRZYPIĘTEJ STOPKI (K6, ADR-092) — arytmetyka, bez DOM-u i bez bazy.
 *
 * Reguła „stopka jest ostatnia” ma trzech niezależnych konsumentów (płótno,
 * akcja zapisu, render), więc testujemy ją tam, gdzie mieszka, a nie trzy razy
 * przez interfejs. Testy niżej są celowo napisane od strony NADUŻYĆ: kolejność
 * przychodząca „z zewnątrz” bywa niepełna, ma duplikaty albo stawia stopkę na
 * początku — i każda z tych postaci ma dać stronę ze stopką na końcu.
 */
import { describe, expect, it } from "vitest";

import {
  PINNED_LAST_TYPES,
  isPinnedLastType,
  normalizeSectionOrder,
  orderWithSectionBefore,
  type OrderedSection,
  type SectionType,
} from "./index";

const page: OrderedSection[] = [
  { id: "a", type: "hero" },
  { id: "b", type: "products" },
  { id: "c", type: "footer" },
  { id: "d", type: "cta" },
];

describe("typy przypięte", () => {
  it("rejestr nie jest pusty (kontrola po pustym zbiorze)", () => {
    // Bez tego wszystkie asercje niżej broniłyby reguły, której nie ma.
    expect(PINNED_LAST_TYPES.length).toBeGreaterThan(0);
  });

  it("stopka jest przypięta, zwykłe sekcje nie", () => {
    expect(isPinnedLastType("footer")).toBe(true);
    for (const type of ["hero", "products", "contact", "cta"] as SectionType[]) {
      expect(isPinnedLastType(type), `${type} nie powinien być przypięty`).toBe(false);
    }
  });
});

describe("normalizacja kolejności", () => {
  it("stopka ląduje na końcu, choćby przyszła pierwsza", () => {
    expect(normalizeSectionOrder(["c", "a", "b", "d"], page)).toEqual(["a", "b", "d", "c"]);
  });

  it("kolejność sekcji zwykłych zostaje NIETKNIĘTA", () => {
    // Przypięcie ma przesunąć jedną sekcję, a nie posortować stronę od nowa.
    expect(normalizeSectionOrder(["d", "b", "a", "c"], page)).toEqual(["d", "b", "a", "c"]);
  });

  it("strona bez stopki przechodzi bez zmian", () => {
    const plain = page.filter((section) => section.type !== "footer");
    expect(normalizeSectionOrder(["b", "d", "a"], plain)).toEqual(["b", "d", "a"]);
  });

  it("duplikat w żądaniu nie mnoży pozycji", () => {
    expect(normalizeSectionOrder(["a", "a", "b", "c", "d"], page)).toEqual(["a", "b", "d", "c"]);
  });

  it("id spoza kompletu jest pomijane, a sekcja pominięta w żądaniu dopisuje się", () => {
    // Wyścig: druga karta dodała sekcję „d” w chwili, gdy ta przeciągała „b”.
    expect(normalizeSectionOrder(["b", "a", "obcy"], page)).toEqual(["b", "a", "d", "c"]);
  });

  it("dwie stopki (nagrobek + nowa) obie schodzą na koniec, w swojej kolejności", () => {
    // Nagrobek sekcji usuniętej w szkicu wciąż jest wierszem (ADR-091), więc
    // komplet potrafi chwilowo mieć dwie stopki — unikat w bazie jest częściowy.
    const withTombstone: OrderedSection[] = [...page, { id: "e", type: "footer" }];
    expect(normalizeSectionOrder(["c", "e", "a", "b", "d"], withTombstone)).toEqual([
      "a",
      "b",
      "d",
      "c",
      "e",
    ]);
  });
});

describe("wstawienie przed wskazaną sekcją", () => {
  const ids = page.map((section) => section.id);

  it("nowa sekcja staje BEZPOŚREDNIO przed kotwicą", () => {
    expect(orderWithSectionBefore(ids, "n", "b")).toEqual(["a", "n", "b", "c", "d"]);
    expect(orderWithSectionBefore(ids, "n", "a")).toEqual(["n", "a", "b", "c", "d"]);
  });

  it("brak kotwicy znaczy KONIEC — tak samo jak „+” pod ostatnią sekcją", () => {
    expect(orderWithSectionBefore(ids, "n", undefined)).toEqual([...ids, "n"]);
  });

  it("kotwica, której już nie ma, degraduje do końca zamiast wywracać zapis", () => {
    // Sekcja skasowana w innej karcie między kliknięciem „+” a zapisem.
    expect(orderWithSectionBefore(ids, "n", "znikneła")).toEqual([...ids, "n"]);
  });

  it("nowe id nie duplikuje się, gdy przyszło już w komplecie", () => {
    // Komplet czytany ZE STANU BAZY zawiera świeżą sekcję (wstawka poszła przed
    // przenumerowaniem) — bez odsiania miałaby dwie pozycje.
    expect(orderWithSectionBefore(["a", "n", "b"], "n", "a")).toEqual(["n", "a", "b"]);
  });

  it("KOTWICĄ JEST IDENTYFIKATOR, nie miejsce na liście (odporność na wyścig)", () => {
    // Ta sama kotwica („przed b”) na dwóch RÓŻNYCH wersjach listy — raz przed
    // wstawką sąsiada, raz po niej. Wynik obu razy jest tym, co operator
    // wskazał: bezpośrednio nad „b”. Indeks policzony na pierwszej liście
    // (czyli 1) trafiłby na drugiej przed „x”, a nie przed „b”.
    expect(orderWithSectionBefore(["a", "b"], "n", "b")).toEqual(["a", "n", "b"]);
    expect(orderWithSectionBefore(["a", "x", "b"], "n", "b")).toEqual(["a", "x", "n", "b"]);
  });
});
