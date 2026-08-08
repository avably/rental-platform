/**
 * Kontrakt formatu CSV eksportów (C2, ADR-111) — przypięcie decyzji:
 * separator `;` (Excel PL), UTF-8 z BOM (bajty EF BB BF), CRLF, cytowanie
 * RFC 4180 i neutralizacja formuł (CSV injection).
 *
 * Te testy są jednocześnie tarczą dowodu mutacyjnego M2: wyłączenie
 * neutralizacji pali blok „neutralizacja formuł".
 */
import { describe, expect, it } from "vitest";

import {
  buildCsv,
  CSV_BOM,
  CSV_SEPARATOR,
  neutralizeFormula,
} from "@/lib/export/csv";

describe("kontrakt formatu CSV (ADR-111)", () => {
  it("separator jest PRZYPIĘTY na średnik — Excel PL czyta bez kreatora importu", () => {
    expect(CSV_SEPARATOR).toBe(";");
    expect(buildCsv(["a", "b"], [["x", "y"]])).toContain("a;b");
  });

  it("plik zaczyna się od BOM UTF-8 (bajty EF BB BF) — inaczej Excel miele polskie znaki", () => {
    const csv = buildCsv(["kolumna"], [["zażółć"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const bytes = Buffer.from(csv, "utf-8");
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("wiersze kończy CRLF (RFC 4180), także ostatni", () => {
    const csv = buildCsv(["a"], [["1"], ["2"]]);
    expect(csv).toBe(`${CSV_BOM}a\r\n1\r\n2\r\n`);
  });

  describe("cytowanie pól (RFC 4180)", () => {
    it("pole ze średnikiem idzie w cudzysłowie — inaczej rozjechałoby kolumny", () => {
      expect(buildCsv(["a"], [["x;y"]])).toContain('"x;y"');
    });

    it("cudzysłów w polu jest podwajany", () => {
      expect(buildCsv(["a"], [['Namiot "Expo"']])).toContain('"Namiot ""Expo"""');
    });

    it("nowa linia w polu (notatki!) zostaje WEWNĄTRZ cudzysłowu, nie łamie wiersza", () => {
      const csv = buildCsv(["a", "b"], [["linia1\nlinia2", "obok"]]);
      expect(csv).toContain('"linia1\nlinia2";obok');
    });

    it("puste i null dają puste pole bez cudzysłowu", () => {
      expect(buildCsv(["a", "b", "c"], [[null, undefined, ""]])).toContain("\r\n;;");
    });
  });

  describe("neutralizacja formuł (CSV injection)", () => {
    it.each(["=", "+", "-", "@", "\t", "\r"])(
      "wartość zaczynająca się od %j dostaje prefiks apostrofu",
      (trigger) => {
        expect(neutralizeFormula(`${trigger}payload`)).toBe(`'${trigger}payload`);
      },
    );

    it("zwykły tekst przechodzi bez zmian", () => {
      expect(neutralizeFormula("Jan Kowalski")).toBe("Jan Kowalski");
      expect(neutralizeFormula("")).toBe("");
    });

    it("payload =HYPERLINK trafia do pliku z apostrofem — Excel pokaże tekst, nie wykona", () => {
      const csv = buildCsv(["name"], [['=HYPERLINK("http://x";"k")']]);
      expect(csv).toContain(`'=HYPERLINK`);
      // Kontrola negatywna: żadne POLE DANYCH nie zaczyna się gołym znakiem
      // formuły (po BOM, po separatorze lub po otwierającym cudzysłowie).
      const lines = csv.slice(CSV_BOM.length).split("\r\n").slice(1);
      for (const line of lines) {
        expect(line).not.toMatch(/^"?[=+\-@\t]/);
        expect(line).not.toMatch(/;"?[=+\-@\t]/);
      }
    });

    it("liczby (grosze int) NIE są neutralizowane — to dane, nie tekst", () => {
      expect(buildCsv(["kwota"], [[12_345]])).toContain("\r\n12345\r\n");
    });
  });
});
