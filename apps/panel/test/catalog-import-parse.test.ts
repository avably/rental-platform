/**
 * Parser importu katalogu z CSV (C3, ADR-112) — kontrakt WEJŚCIA.
 *
 * Zasada nadrzędna (ADR-112): wejście TOLERANCYJNE, wyjście ścisłe.
 * Import czyta DOKŁADNIE to, co pisze eksport (ADR-111, lib/export/catalog.ts)
 * — plus warianty, które produkuje Excel po drodze: brak BOM, separator
 * przecinkowy (locale EN), końce linii LF, przecinek dziesiętny w mnożnikach.
 *
 * Rozstrzygnięcia przypięte tymi testami:
 *  1. nagłówek = CATALOG_CSV_HEADER (kolumny po NAZWIE, kolejność dowolna,
 *     nadmiarowe kolumny IGNOROWANE — w tym podrzucone `tenant_id`),
 *  2. separator `;` albo `,` rozpoznany z LINII NAGŁÓWKA,
 *  3. cudzysłowy RFC 4180 (podwajanie, separatory i nowe linie w polu),
 *  4. zdjęcie DOKŁADNIE jednego apostrofu neutralizacji formuł (round-trip
 *     bajt w bajt z eksportem; nic nie jest interpretowane),
 *  5. grosze = liczby CAŁKOWITE (kropka/przecinek = błąd wiersza, nie
 *     zaokrąglenie); mnożniki dziesiętne z kropką LUB przecinkiem,
 *     normalizowane do kropki i trzymane jako STRING (zero floatów),
 *  6. grupowanie po product_id; nowe produkty (pusty product_id) grupują się
 *     po SĄSIEDZTWIE i identycznej nazwie,
 *  7. limit 10 000 wierszy danych z JAWNYM błędem (ImportLimitError),
 *  8. błędy niosą NUMERY WIERSZY (nagłówek = 1, pierwszy wiersz danych = 2).
 */
import { describe, expect, it } from "vitest";

import { buildCsv, CSV_BOM } from "@/lib/export/csv";
import { CATALOG_CSV_HEADER } from "@/lib/export/catalog";
import {
  IMPORT_ROW_LIMIT,
  ImportLimitError,
  parseCatalogCsv,
} from "@/lib/import/catalog-csv";

const HEADER = CATALOG_CSV_HEADER.join(";");

/** Wiersz produktu bez progów w formacie eksportu (13 kolumn). */
function row(fields: Partial<Record<(typeof CATALOG_CSV_HEADER)[number], string>>): string {
  return CATALOG_CSV_HEADER.map((name) => fields[name] ?? "").join(";");
}

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

const BASE_FIELDS = {
  name: "Agregat",
  base_price_day_grosze: "10000",
  deposit_grosze: "5000",
  auto_increment_multiplier: "1.0",
  buffer_before_days: "1",
  buffer_after_days: "1",
  active: "true",
} as const;

function csvOf(...lines: string[]): string {
  return `${CSV_BOM}${[HEADER, ...lines].join("\r\n")}\r\n`;
}

describe("parser importu katalogu (C3, ADR-112)", () => {
  describe("tolerancja transportu: BOM, separator, końce linii", () => {
    it("czyta plik eksportu 1:1 (BOM, średnik, CRLF)", () => {
      const result = parseCatalogCsv(csvOf(row({ ...BASE_FIELDS, product_id: UUID_A })));
      expect(result.issues).toEqual([]);
      expect(result.products).toHaveLength(1);
      expect(result.products[0]).toMatchObject({
        productId: UUID_A,
        name: "Agregat",
        basePriceDayGrosze: 10000,
        depositGrosze: 5000,
        autoIncrementMultiplier: "1.0",
        bufferBeforeDays: 1,
        bufferAfterDays: 1,
        active: true,
        tiers: [],
      });
    });

    it("czyta plik BEZ BOM i z końcami linii LF", () => {
      const text = [HEADER, row({ ...BASE_FIELDS, product_id: UUID_A })].join("\n");
      const result = parseCatalogCsv(text);
      expect(result.issues).toEqual([]);
      expect(result.products).toHaveLength(1);
    });

    it("rozpoznaje separator PRZECINKOWY z linii nagłówka (Excel w locale EN)", () => {
      const text = [
        CATALOG_CSV_HEADER.join(","),
        `${UUID_A},Agregat,,10000,5000,1.0,1,1,true,,,,`,
      ].join("\r\n");
      const result = parseCatalogCsv(text);
      expect(result.issues).toEqual([]);
      expect(result.products[0]).toMatchObject({ productId: UUID_A, name: "Agregat" });
    });

    it("brak ostatniego CRLF nie gubi ostatniego wiersza", () => {
      const text = `${HEADER}\r\n${row({ ...BASE_FIELDS, product_id: UUID_A })}`;
      expect(parseCatalogCsv(text).products).toHaveLength(1);
    });
  });

  describe("nagłówek: kolumny po nazwie", () => {
    it("odrzuca plik bez wymaganej kolumny — jawny błąd z jej nazwą", () => {
      const withoutName = CATALOG_CSV_HEADER.filter((c) => c !== "name").join(";");
      const result = parseCatalogCsv(`${withoutName}\r\n`);
      expect(result.products).toEqual([]);
      expect(result.issues).toEqual([
        { row: 1, code: "missingColumn", column: "name" },
      ]);
    });

    it("akceptuje przestawioną kolejność kolumn (mapowanie po nazwie)", () => {
      const shuffled = [...CATALOG_CSV_HEADER].reverse();
      const line = shuffled
        .map((name) =>
          name === "product_id" ? UUID_A : (BASE_FIELDS as Record<string, string>)[name] ?? "",
        )
        .join(";");
      const result = parseCatalogCsv(`${shuffled.join(";")}\r\n${line}\r\n`);
      expect(result.issues).toEqual([]);
      expect(result.products[0]).toMatchObject({ productId: UUID_A, name: "Agregat" });
    });

    it("IGNORUJE kolumny nadmiarowe — w tym podrzucone tenant_id (izolacja: najemca TYLKO z sesji)", () => {
      const header = [...CATALOG_CSV_HEADER, "tenant_id"].join(";");
      const line = `${row({ ...BASE_FIELDS, product_id: UUID_A })};99999999-9999-4999-8999-999999999999`;
      const result = parseCatalogCsv(`${header}\r\n${line}\r\n`);
      expect(result.issues).toEqual([]);
      expect(result.products).toHaveLength(1);
      // Podrzucona wartość nie przecieka do żadnego pola wyniku.
      expect(JSON.stringify(result.products)).not.toContain("9999-4999");
    });
  });

  describe("cudzysłowy RFC 4180", () => {
    it("separator, cudzysłów i nowa linia w polu nie rozjeżdżają kolumn", () => {
      const name = 'Kolumna; z "cudzysłowem"\ni nową linią';
      const csv = buildCsv(CATALOG_CSV_HEADER, [
        [UUID_A, name, null, 10000, 5000, 1, 1, 1, true, null, null, null, null],
      ]);
      const result = parseCatalogCsv(csv);
      expect(result.issues).toEqual([]);
      expect(result.products[0].name).toBe(name);
    });
  });

  describe("neutralizacja formuł w drugą stronę (round-trip)", () => {
    it.each(["=", "+", "-", "@", "\t"])(
      "zdejmuje DOKŁADNIE jeden apostrof przed %j — wartość wraca bajt w bajt",
      (trigger) => {
        const name = `${trigger}HYPERLINK("http://zly.example")`;
        const csv = buildCsv(CATALOG_CSV_HEADER, [
          [UUID_A, name, null, 10000, 5000, 1, 1, 1, true, null, null, null, null],
        ]);
        // Eksport dopisał apostrof…
        expect(csv).toContain(`'${trigger}HYPERLINK`);
        // …a import go zdjął — i NICZEGO nie interpretuje.
        const result = parseCatalogCsv(csv);
        expect(result.issues).toEqual([]);
        expect(result.products[0].name).toBe(name);
      },
    );

    it("apostrof NIE-neutralizujący (zwykły tekst) zostaje nietknięty", () => {
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, name: "'zwykły apostrof", product_id: UUID_A })),
      );
      expect(result.products[0].name).toBe("'zwykły apostrof");
    });

    it("podwójny apostrof zostaje nietknięty — zdejmujemy TYLKO apostrof stojący bezpośrednio przed znakiem formuły (odwrotność eksportu)", () => {
      // Eksport wartości `''=formuła` niczego nie dokleja (pierwszy znak to
      // apostrof, nie trigger) — więc import też nie ma czego zdejmować.
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, name: "''=formuła", product_id: UUID_A })),
      );
      expect(result.products[0].name).toBe("''=formuła");
    });
  });

  describe("liczby: grosze całkowite, mnożniki dziesiętne", () => {
    it("grosze z kropką to BŁĄD WIERSZA, nie zaokrąglenie", () => {
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, base_price_day_grosze: "100.50", product_id: UUID_A })),
      );
      expect(result.products).toEqual([]);
      expect(result.issues).toEqual([
        { row: 2, code: "badInteger", column: "base_price_day_grosze", value: "100.50" },
      ]);
    });

    it("grosze z przecinkiem również płoną błędem wiersza", () => {
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, deposit_grosze: "100,50", product_id: UUID_A })),
      );
      expect(result.issues).toEqual([
        { row: 2, code: "badInteger", column: "deposit_grosze", value: "100,50" },
      ]);
    });

    it("mnożnik przyjmuje przecinek dziesiętny (Excel PL) i normalizuje do kropki", () => {
      const result = parseCatalogCsv(
        csvOf(
          row({
            ...BASE_FIELDS,
            product_id: UUID_A,
            tier_days: "7",
            tier_multiplier: "6,5",
            tier_sort_order: "1",
          }),
        ),
      );
      expect(result.issues).toEqual([]);
      expect(result.products[0].tiers).toEqual([
        { tierDays: 7, multiplier: "6.5", label: null, sortOrder: 1 },
      ]);
    });

    it("mnożnik zostaje STRINGIEM — zero arytmetyki zmiennoprzecinkowej", () => {
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, auto_increment_multiplier: "1.1000000000000001", product_id: UUID_A })),
      );
      expect(result.products[0].autoIncrementMultiplier).toBe("1.1000000000000001");
    });

    it("cena bazowa 0 odpada (CHECK > 0 w schemacie — darmowa pozycja to pomyłka importu)", () => {
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, base_price_day_grosze: "0", product_id: UUID_A })),
      );
      expect(result.issues).toEqual([
        { row: 2, code: "notPositive", column: "base_price_day_grosze", value: "0" },
      ]);
    });

    it("wartość spoza zakresu int4 to błąd wiersza, nie błąd bazy", () => {
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, deposit_grosze: "2147483648", product_id: UUID_A })),
      );
      expect(result.issues).toEqual([
        { row: 2, code: "badInteger", column: "deposit_grosze", value: "2147483648" },
      ]);
    });
  });

  describe("active", () => {
    it.each([
      ["true", true],
      ["false", false],
      ["1", true],
      ["0", false],
    ])("przyjmuje %j → %j", (raw, expected) => {
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, active: raw, product_id: UUID_A })),
      );
      expect(result.issues).toEqual([]);
      expect(result.products[0].active).toBe(expected);
    });

    it("inna wartość to błąd wiersza", () => {
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, active: "tak", product_id: UUID_A })),
      );
      expect(result.issues).toEqual([
        { row: 2, code: "badBoolean", column: "active", value: "tak" },
      ]);
    });
  });

  describe("identyfikatory i grupowanie", () => {
    it("product_id nie-UUID to błąd wiersza (nigdy „nowy produkt z dziwnym id')", () => {
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, product_id: "abc-123" })),
      );
      expect(result.products).toEqual([]);
      expect(result.issues).toEqual([
        { row: 2, code: "badUuid", column: "product_id", value: "abc-123" },
      ]);
    });

    it("wiersze z tym samym product_id skleja w jeden produkt: pola z PIERWSZEGO wiersza, progi z wierszy o niepustym tier_days", () => {
      const result = parseCatalogCsv(
        csvOf(
          row({
            ...BASE_FIELDS,
            product_id: UUID_A,
            tier_days: "3",
            tier_multiplier: "2.8",
            tier_sort_order: "0",
          }),
          row({
            ...BASE_FIELDS,
            name: "Inna nazwa w drugim wierszu — ignorowana",
            product_id: UUID_A,
            tier_days: "7",
            tier_multiplier: "6.5",
            tier_label: "Tydzień",
            tier_sort_order: "1",
          }),
          row({ ...BASE_FIELDS, name: "Drugi produkt", product_id: UUID_B }),
        ),
      );
      expect(result.issues).toEqual([]);
      expect(result.products).toHaveLength(2);
      expect(result.products[0].name).toBe("Agregat");
      expect(result.products[0].tiers).toEqual([
        { tierDays: 3, multiplier: "2.8", label: null, sortOrder: 0 },
        { tierDays: 7, multiplier: "6.5", label: "Tydzień", sortOrder: 1 },
      ]);
      expect(result.products[1]).toMatchObject({ productId: UUID_B, name: "Drugi produkt", tiers: [] });
    });

    it("pusty product_id = NOWY produkt; sąsiednie wiersze z tą samą nazwą to jeden nowy produkt z progami", () => {
      const result = parseCatalogCsv(
        csvOf(
          row({ ...BASE_FIELDS, name: "Nowy A", tier_days: "3", tier_multiplier: "2.8" }),
          row({ ...BASE_FIELDS, name: "Nowy A", tier_days: "7", tier_multiplier: "6.5" }),
          row({ ...BASE_FIELDS, name: "Nowy B" }),
        ),
      );
      expect(result.issues).toEqual([]);
      expect(result.products).toHaveLength(2);
      expect(result.products[0]).toMatchObject({ productId: null, name: "Nowy A" });
      expect(result.products[0].tiers.map((t) => t.tierDays)).toEqual([3, 7]);
      expect(result.products[1]).toMatchObject({ productId: null, name: "Nowy B", tiers: [] });
    });

    it("dwa progi o tym samym tier_days w jednym produkcie to błąd wiersza (unikat schematu)", () => {
      const result = parseCatalogCsv(
        csvOf(
          row({ ...BASE_FIELDS, product_id: UUID_A, tier_days: "7", tier_multiplier: "6.5" }),
          row({ ...BASE_FIELDS, product_id: UUID_A, tier_days: "7", tier_multiplier: "6.0" }),
        ),
      );
      expect(result.issues).toEqual([
        { row: 3, code: "duplicateTierDays", column: "tier_days", value: "7" },
      ]);
    });

    it("tier_multiplier bez tier_days (i odwrotnie) to błąd wiersza — próg jest kompletny albo go nie ma", () => {
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, product_id: UUID_A, tier_multiplier: "2.8" })),
      );
      expect(result.issues).toEqual([
        { row: 2, code: "tierIncomplete", column: "tier_days" },
      ]);
      const result2 = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, product_id: UUID_A, tier_days: "7" })),
      );
      expect(result2.issues).toEqual([
        { row: 2, code: "tierIncomplete", column: "tier_multiplier" },
      ]);
    });

    it("pusta nazwa to błąd wiersza (CHECK 1..200 po btrim)", () => {
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, name: "   ", product_id: UUID_A })),
      );
      expect(result.issues).toEqual([{ row: 2, code: "emptyName", column: "name" }]);
    });

    it("puste tier_sort_order dostaje domyślne 0 (wiersz dopisany ręcznie w arkuszu)", () => {
      const result = parseCatalogCsv(
        csvOf(row({ ...BASE_FIELDS, product_id: UUID_A, tier_days: "3", tier_multiplier: "2.8" })),
      );
      expect(result.issues).toEqual([]);
      expect(result.products[0].tiers[0].sortOrder).toBe(0);
    });
  });

  describe("granice pliku", () => {
    it("plik z samym nagłówkiem = zero produktów, zero błędów", () => {
      const result = parseCatalogCsv(`${HEADER}\r\n`);
      expect(result.products).toEqual([]);
      expect(result.issues).toEqual([]);
    });

    it("wiersz o złej liczbie pól to błąd z numerem wiersza", () => {
      const result = parseCatalogCsv(`${HEADER}\r\nAgregat;10000\r\n`);
      expect(result.issues).toEqual([{ row: 2, code: "columnCount" }]);
    });

    it(`ponad ${IMPORT_ROW_LIMIT} wierszy danych rzuca ImportLimitError — nigdy cichy obcinek`, () => {
      const line = row({ ...BASE_FIELDS, product_id: UUID_A, tier_days: "7", tier_multiplier: "6.5" });
      const lines = Array.from({ length: IMPORT_ROW_LIMIT + 1 }, () => line);
      expect(() => parseCatalogCsv(csvOf(...lines))).toThrow(ImportLimitError);
    });

    it("błędy z wielu wierszy wracają WSZYSTKIE naraz, z numerami wierszy", () => {
      const result = parseCatalogCsv(
        csvOf(
          row({ ...BASE_FIELDS, base_price_day_grosze: "1.5", product_id: UUID_A }),
          row({ ...BASE_FIELDS, product_id: UUID_B }),
          row({ ...BASE_FIELDS, active: "yes", product_id: UUID_B }),
        ),
      );
      expect(result.issues.map((i) => i.row)).toEqual([2, 4]);
    });
  });

  describe("round-trip: eksport → import → eksport", () => {
    it("plik zbudowany buildCsv wraca z parsera bez żadnej zmiany wartości", () => {
      const name = '=SUMA(A1:A9); "cudzysłów"\n@drugi wiersz';
      const description = "+48 600 100 200\ttab";
      const csv = buildCsv(CATALOG_CSV_HEADER, [
        [UUID_A, name, description, 10000, 5000, 1.5, 2, 3, false, 7, 6.5, "-Tydzień", 1],
      ]);
      const result = parseCatalogCsv(csv);
      expect(result.issues).toEqual([]);
      const product = result.products[0];
      expect(product.name).toBe(name);
      expect(product.description).toBe(description);
      expect(product.autoIncrementMultiplier).toBe("1.5");
      expect(product.active).toBe(false);
      expect(product.tiers).toEqual([
        { tierDays: 7, multiplier: "6.5", label: "-Tydzień", sortOrder: 1 },
      ]);
    });
  });
});
