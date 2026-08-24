/**
 * Rozbicie/złożenie adresu firmy (uwaga właściciela #1) — kanonem w bazie
 * zostaje pojedynczy `address` (CHECK 0026 niezmieniony), więc round-trip
 * pola → łańcuch → pola musi być STABILNY, także dla adresów spoza wzorca
 * „ulica, kod miasto". Ten plik broni tej własności — bez niego parsowanie
 * mogłoby po cichu gubić znaki przy każdym wejściu na ekran.
 */
import { describe, expect, it } from "vitest";

import {
  composeAddress,
  parseAddress,
} from "@/app/[locale]/(panel)/ustawienia-umow/address-fields";

describe("composeAddress", () => {
  it("składa trzy pola w kanoniczną linię „ulica, kod miasto”", () => {
    expect(composeAddress({ street: "Chemików 7", zip: "09-411", city: "Płock" })).toBe(
      "Chemików 7, 09-411 Płock",
    );
  });

  it("pomija puste segmenty zamiast zostawiać wiszące przecinki", () => {
    expect(composeAddress({ street: "ul. Portowa 4", zip: "", city: "" })).toBe("ul. Portowa 4");
    expect(composeAddress({ street: "", zip: "", city: "" })).toBe("");
    expect(composeAddress({ street: "ul. Portowa 4", zip: "80-001", city: "" })).toBe(
      "ul. Portowa 4, 80-001",
    );
  });

  it("przycina białe znaki w każdym polu", () => {
    expect(composeAddress({ street: "  A 1 ", zip: " 00-950 ", city: " Warszawa " })).toBe(
      "A 1, 00-950 Warszawa",
    );
  });
});

describe("parseAddress", () => {
  it("rozbija kanoniczny adres na trzy pola", () => {
    expect(parseAddress("Chemików 7, 09-411 Płock")).toEqual({
      street: "Chemików 7",
      zip: "09-411",
      city: "Płock",
    });
  });

  it("dzieli po OSTATNIM przecinku — numer lokalu zostaje przy ulicy", () => {
    expect(parseAddress("ul. Kwiatowa 5, m. 3, 00-950 Warszawa")).toEqual({
      street: "ul. Kwiatowa 5, m. 3",
      zip: "00-950",
      city: "Warszawa",
    });
  });

  it("adres bez rozpoznawalnego kodu ląduje w całości w polu ulicy (nic nie ginie)", () => {
    expect(parseAddress("ul. Przykładowa 10")).toEqual({ street: "ul. Przykładowa 10", zip: "", city: "" });
    expect(parseAddress("Główna 1, Warszawa")).toEqual({
      street: "Główna 1, Warszawa",
      zip: "",
      city: "",
    });
  });

  it("pusty łańcuch daje trzy puste pola", () => {
    expect(parseAddress("")).toEqual({ street: "", zip: "", city: "" });
    expect(parseAddress(null)).toEqual({ street: "", zip: "", city: "" });
    expect(parseAddress("   ")).toEqual({ street: "", zip: "", city: "" });
  });
});

describe("round-trip parse ∘ compose", () => {
  const cases = [
    "Chemików 7, 09-411 Płock",
    "ul. Kwiatowa 5, m. 3, 00-950 Warszawa",
    "ul. Przykładowa 10",
    "",
  ];

  it("skan obejmuje przypadki brzegowe (kontrola po niepustym zbiorze)", () => {
    expect(cases).toHaveLength(4);
  });

  it.each(cases)("adres „%s” przetrwa złożenie z rozbitych pól", (address) => {
    expect(composeAddress(parseAddress(address))).toBe(address);
  });
});
