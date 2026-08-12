/**
 * Parser importu katalogu z CSV (C3, ADR-112) — moduł CZYSTY, bez Next
 * i bez Supabase, lustrzany do lib/export/catalog.ts (ADR-111).
 *
 * WEJŚCIE TOLERANCYJNE, WYJŚCIE ŚCISŁE:
 *   * BOM opcjonalny; separator `;` ALBO `,` rozpoznany z linii nagłówka
 *     (Excel w locale EN zapisuje przecinkiem); końce linii CRLF i LF,
 *   * kolumny mapowane po NAZWIE (kolejność dowolna), nadmiarowe kolumny
 *     IGNOROWANE — w szczególności podrzucone `tenant_id` nie jest czytane
 *     pod ŻADNĄ nazwą: najemca pochodzi wyłącznie z sesji,
 *   * cudzysłowy wg RFC 4180 (podwajanie, separator i nowa linia w polu),
 *   * neutralizacja formuł W DRUGĄ STRONĘ: eksport dopisuje apostrof przed
 *     `= + - @ TAB CR` — import zdejmuje DOKŁADNIE jeden wiodący apostrof
 *     z takich wartości (round-trip bajt w bajt) i NICZEGO nie interpretuje.
 *
 * LICZBY: kolumny `*_grosze` i `*_days` są CAŁKOWITE — kropka albo przecinek
 * to błąd wiersza, nie zaokrąglenie. Mnożniki (`auto_increment_multiplier`,
 * `tier_multiplier`) są dziesiętne: przyjmujemy kropkę i przecinek (Excel PL),
 * normalizujemy do kropki i trzymamy jako STRING aż do rzutu ::numeric w
 * bazie — zero arytmetyki zmiennoprzecinkowej na pieniądzach.
 *
 * GRUPOWANIE (kształt płaski long, ADR-111): wiersz = produkt × próg.
 * Wiersze o tym samym niepustym `product_id` tworzą jeden produkt (pola
 * produktu z PIERWSZEGO wiersza grupy, progi z wierszy o niepustym
 * `tier_days`). Pusty `product_id` = NOWY produkt; sąsiadujące wiersze
 * z pustym id i IDENTYCZNĄ nazwą to jeden nowy produkt z wieloma progami.
 *
 * NUMERACJA BŁĘDÓW: rekord nagłówka = wiersz 1, pierwszy rekord danych = 2
 * (w plikach bez nowych linii w polach pokrywa się z numerem linii arkusza).
 */
import {
  CATEGORY_SLUG_MAX_LENGTH,
  CATEGORY_SLUG_PATTERN,
  CUSTOM_FIELD_LIMITS,
  parseCustomFieldInput,
  validateCustomFieldValues,
  type CustomFieldDefinition,
  type CustomFieldValues,
} from "@avably/core";

import {
  CATALOG_CSV_CATEGORIES_COLUMN,
  CATALOG_CSV_CATEGORIES_SEPARATOR,
  CATALOG_CSV_HEADER,
} from "../export/catalog";
import { CSV_CUSTOM_FIELD_PREFIX } from "../export/custom-fields";
import { CSV_BOM } from "../export/csv";

/** Limit wierszy DANYCH — siostra EXPORT_ROW_LIMIT (ADR-111/112). */
export const IMPORT_ROW_LIMIT = 10_000;

/** Plik przekracza limit wierszy — jawny sygnał, nigdy cichy obcinek. */
export class ImportLimitError extends Error {
  constructor() {
    super(`Import przekracza limit ${IMPORT_ROW_LIMIT} wierszy.`);
    this.name = "ImportLimitError";
  }
}

/** Maksimum int4 Postgresa — wartość wyżej ma płonąć w wierszu, nie w bazie. */
const INT4_MAX = 2_147_483_647;

/** Znaki otwierające formułę (lustrzane do FORMULA_TRIGGERS eksportu). */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

export type CatalogImportIssueCode =
  | "missingColumn"
  | "columnCount"
  | "badInteger"
  | "notPositive"
  | "badDecimal"
  | "badBoolean"
  | "badUuid"
  | "emptyName"
  | "nameTooLong"
  | "tierIncomplete"
  | "duplicateTierDays"
  /** Warstwa planu (import-catalog.ts): id spoza katalogu najemcy z sesji. */
  | "unknownProduct"
  /**
   * Kolumna `cf_<id>` bez odpowiadającej ŻYWEJ definicji produktu tego
   * najemcy: cudza, zmyślona albo zarchiwizowana. Odrzuca CAŁY plik
   * (spójnie z ADR-112 i z traktowaniem cudzego `product_id`) — patrz
   * komentarz przy rozpoznawaniu nagłówka.
   */
  | "unknownCustomField"
  /** Wartość pola własnego niezgodna z definicją (typ, opcja, długość). */
  | "badCustomField"
  /** Slug w kolumnie `categories` o kształcie, którego adres nie uniesie. */
  | "badCategorySlug"
  /**
   * Warstwa planu (import-catalog.ts): slug spoza katalogu kategorii najemcy.
   * Import NIE zakłada kategorii z pliku — literówka w arkuszu tworzyłaby
   * kategorię-widmo z własnym adresem w sklepie (ADR-155).
   */
  | "unknownCategory";

export interface CatalogImportIssue {
  /**
   * Numer rekordu: nagłówek = 1, pierwszy wiersz danych = 2. NIEOBECNY dla
   * problemów PLIKOWYCH bez konkretnego wiersza (np. odmowa bazy PO SCALENIU
   * mapy pól własnych — `import-catalog.ts`, 23514) — wizard wtedy pokazuje
   * etykietę "cały plik" zamiast zmyślonego numeru (round-3, #B).
   */
  row?: number;
  code: CatalogImportIssueCode;
  column?: string;
  value?: string;
}

export interface CatalogImportTier {
  tierDays: number;
  /** Dziesiętny STRING z kropką — rzut ::numeric dopiero w bazie. */
  multiplier: string;
  label: string | null;
  sortOrder: number;
}

export interface CatalogImportProduct {
  /** UUID istniejącego produktu albo null = nowy produkt. */
  productId: string | null;
  name: string;
  description: string | null;
  basePriceDayGrosze: number;
  depositGrosze: number;
  /** Dziesiętny STRING z kropką — patrz CatalogImportTier.multiplier. */
  autoIncrementMultiplier: string;
  bufferBeforeDays: number;
  bufferAfterDays: number;
  active: boolean;
  tiers: CatalogImportTier[];
  /** Wartości pól własnych z PIERWSZEGO wiersza grupy (pole własne jest polem produktu). */
  customFields: CustomFieldValues;
  /**
   * Slugi kategorii z PIERWSZEGO wiersza grupy albo `null`, gdy pliku w ogóle
   * nie ma kolumny `categories`.
   *
   * NULL ≠ PUSTA TABLICA i to jest cała semantyka tego pola: brak kolumny
   * znaczy „ten plik nic nie mówi o kategoriach" (zostaw przypisania w spokoju),
   * pusta komórka znaczy „ten produkt ma być bez kategorii".
   */
  categories: string[] | null;
  /** Numery rekordów źródłowych (do komunikatów podglądu). */
  rows: number[];
}

export interface CatalogImportParseResult {
  products: CatalogImportProduct[];
  issues: CatalogImportIssue[];
  /** Liczba rekordów danych w pliku (przed grupowaniem). */
  rowCount: number;
  /**
   * ID definicji, które plik OBEJMUJE swoimi kolumnami — czyli te, dla których
   * plik jest autorytatywny (także pustką: pusta komórka = wartość usunięta).
   *
   * Bez tej listy zapis nie umiałby odróżnić „operator wyczyścił pole" od
   * „tej kolumny w ogóle nie było w pliku", a to są dwie różne intencje.
   * Klucze POZA tą listą (np. pod definicją zarchiwizowaną, której eksport
   * katalogu nie niesie) zostają na wierszu nietknięte.
   */
  customFieldColumns: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^[0-9]+$/;
const DECIMAL_RE = /^[0-9]+(\.[0-9]+)?$/;

/**
 * Czy wartość to CIĄG apostrofów (≥1) zakończony znakiem formuły — `'=x`,
 * `''=x`, … Lustrzane do hasFormulaPrefix() eksportu, ale z wymogiem ≥1
 * apostrofa: goły trigger bez apostrofa (plik spoza eksportu) NIE jest
 * neutralizacją i nie wolno mu niczego zdejmować.
 */
function hasNeutralizedFormulaPrefix(value: string): boolean {
  if (value.length < 2 || value[0] !== "'") return false;
  let i = 0;
  while (i < value.length && value[i] === "'") i += 1;
  return i < value.length && FORMULA_TRIGGERS.has(value[i]!);
}

/**
 * Zdejmuje DOKŁADNIE jeden wiodący apostrof neutralizacji formuł.
 * Lustrzane do neutralizeFormula() eksportu; nic poza tym nie zmienia.
 *
 * Zdejmujemy tylko apostrof z CIĄGU apostrofów przed triggerem — więc `''=x`
 * (eksport wartości `'=x`) wraca do `'=x`, a `'zwykły apostrof` zostaje
 * nietknięty (po apostrofie nie ma triggera).
 */
function stripFormulaApostrophe(value: string): string {
  return hasNeutralizedFormulaPrefix(value) ? value.slice(1) : value;
}

/**
 * Rekordy CSV wg RFC 4180 — tolerancyjnie: EOL to CRLF, LF albo samotny CR
 * (poza cudzysłowem); wewnątrz cudzysłowu wszystko jest treścią pola.
 * Pusty rekord końcowy (plik zakończony EOL-em) jest pomijany.
 */
function readRecords(body: string, separator: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let sawQuote = false; // pole było cytowane — puste `""` to nadal pole

  const endField = () => {
    record.push(field);
    field = "";
    sawQuote = false;
  };
  const endRecord = () => {
    endField();
    // Rekord z jednym pustym niecytowanym polem = pusta linia — pomijamy.
    if (!(record.length === 1 && record[0] === "")) records.push(record);
    record = [];
  };

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.length === 0 && !sawQuote) {
      inQuotes = true;
      sawQuote = true;
    } else if (ch === separator) {
      endField();
    } else if (ch === "\r") {
      if (body[i + 1] === "\n") i += 1;
      endRecord();
    } else if (ch === "\n") {
      endRecord();
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0 || sawQuote) endRecord();
  return records;
}

/** Separator z LINII nagłówka: średnik wygrywa, przecinek jest zapasem. */
function detectSeparator(body: string): string {
  const firstLineEnd = body.search(/\r|\n/);
  const headerLine = firstLineEnd === -1 ? body : body.slice(0, firstLineEnd);
  return headerLine.includes(";") ? ";" : ",";
}

interface ParsedRow {
  row: number;
  productId: string | null;
  name: string;
  description: string | null;
  basePriceDayGrosze: number;
  depositGrosze: number;
  autoIncrementMultiplier: string;
  bufferBeforeDays: number;
  bufferAfterDays: number;
  active: boolean;
  tier: CatalogImportTier | null;
  customFields: CustomFieldValues;
  categories: string[] | null;
}

/**
 * @param definitions ŻYWE definicje pól własnych PRODUKTU tego najemcy —
 *   dokładnie ten zbiór, który wystawia eksport katalogu. Argument jest
 *   WYMAGANY: pusta lista znaczy „najemca nie ma pól własnych", a wtedy każda
 *   kolumna `cf_*` w pliku jest kolumną nieznaną i plik leci w całości.
 *   Wartości domyślnej nie ma świadomie — cichy `[]` zamieniałby błąd
 *   podłączenia w ignorowanie danych operatora.
 */
/**
 * Same NAZWY KOLUMN z linii nagłówka — bez parsowania danych.
 *
 * Istnieje po to, żeby warstwa planu mogła odpowiedzieć na jedno pytanie
 * PRZED dotknięciem bazy: „czy ten plik w ogóle mówi coś o polach własnych".
 * Plik bez kolumn `cf_*` nie wymaga odczytu definicji — a to nie jest
 * oszczędność, tylko SEMANTYKA: taki plik (np. eksport sprzed dodania pola)
 * niczego o polach własnych nie twierdzi, więc nie ma prawa niczego skasować.
 */
export function catalogCsvHeaderColumns(text: string): string[] {
  const body = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text;
  const end = body.search(/\r|\n/);
  const headerLine = end === -1 ? body : body.slice(0, end);
  const records = readRecords(headerLine, detectSeparator(body));
  return (records[0] ?? []).map((name) => stripFormulaApostrophe(name).trim());
}

export function parseCatalogCsv(
  text: string,
  definitions: readonly CustomFieldDefinition[],
): CatalogImportParseResult {
  const body = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text;
  const separator = detectSeparator(body);
  const records = readRecords(body, separator);

  const issues: CatalogImportIssue[] = [];
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  if (records.length === 0) {
    for (const column of CATALOG_CSV_HEADER) issues.push({ row: 1, code: "missingColumn", column });
    return { products: [], issues, rowCount: 0, customFieldColumns: [] };
  }

  const header = records[0].map((name) => stripFormulaApostrophe(name).trim());
  const columnIndex = new Map<string, number>();
  header.forEach((name, index) => {
    if (!columnIndex.has(name)) columnIndex.set(name, index);
  });
  for (const column of CATALOG_CSV_HEADER) {
    if (!columnIndex.has(column)) issues.push({ row: 1, code: "missingColumn", column });
  }
  // Kolumna kategorii jest OPCJONALNA — jej brak nie jest błędem pliku (patrz
  // CATALOG_CSV_CATEGORIES_COLUMN w lib/export/catalog.ts).
  const carriesCategories = columnIndex.has(CATALOG_CSV_CATEGORIES_COLUMN);

  // --- Kolumny dynamiczne `cf_<id>` (C6-A3, ADR-121) ---
  //
  // Kolumny nadmiarowe są w tym formacie IGNOROWANE (ADR-112) — ale prefiks
  // `cf_` jest ZAREZERWOWANY, więc kolumna z tym prefiksem bez żywej definicji
  // tego najemcy nie jest „nadmiarowa", tylko BŁĘDNA. Ignorowanie jej byłoby
  // najgorszym z wyjść: operator, który wkleił arkusz z cudzego konta albo
  // z pliku sprzed archiwizacji pola, dostałby import „udany" i po cichu
  // pozbawiony jednej kolumny danych. Cudza, zmyślona i zarchiwizowana
  // definicja dają JEDNĄ odmowę — rozróżnienie zdradzałoby konfigurację
  // sąsiada.
  const customFieldColumns: { column: string; definition: CustomFieldDefinition }[] = [];
  for (const column of header) {
    if (!column.startsWith(CSV_CUSTOM_FIELD_PREFIX)) continue;
    const definition = definitionById.get(column.slice(CSV_CUSTOM_FIELD_PREFIX.length));
    if (!definition) {
      issues.push({ row: 1, code: "unknownCustomField", column });
      continue;
    }
    customFieldColumns.push({ column, definition });
  }

  const coveredIds = customFieldColumns.map((entry) => entry.definition.id);
  if (issues.length > 0) return { products: [], issues, rowCount: 0, customFieldColumns: [] };

  const dataRecords = records.slice(1);
  if (dataRecords.length > IMPORT_ROW_LIMIT) throw new ImportLimitError();

  const rows: ParsedRow[] = [];

  for (let i = 0; i < dataRecords.length; i += 1) {
    const rowNumber = i + 2;
    const record = dataRecords[i];
    if (record.length < header.length) {
      issues.push({ row: rowNumber, code: "columnCount" });
      continue;
    }

    const rowIssues: CatalogImportIssue[] = [];
    const raw = (column: string): string =>
      stripFormulaApostrophe(record[columnIndex.get(column)!] ?? "");

    const readInt = (column: string, minimum: 0 | 1): number | null => {
      const value = raw(column).trim();
      if (!INT_RE.test(value) || Number(value) > INT4_MAX) {
        rowIssues.push({ row: rowNumber, code: "badInteger", column, value });
        return null;
      }
      const parsed = Number(value);
      if (minimum === 1 && parsed === 0) {
        rowIssues.push({ row: rowNumber, code: "notPositive", column, value });
        return null;
      }
      return parsed;
    };

    /** Dziesiętna > 0: przecinek → kropka, wynik zostaje stringiem. */
    const readDecimal = (column: string): string | null => {
      const value = raw(column).trim();
      const normalized = value.replace(",", ".");
      if (!DECIMAL_RE.test(normalized)) {
        rowIssues.push({ row: rowNumber, code: "badDecimal", column, value });
        return null;
      }
      if (/^0+(\.0+)?$/.test(normalized)) {
        rowIssues.push({ row: rowNumber, code: "notPositive", column, value });
        return null;
      }
      return normalized;
    };

    const productIdRaw = raw("product_id").trim();
    let productId: string | null = null;
    if (productIdRaw !== "") {
      if (!UUID_RE.test(productIdRaw)) {
        rowIssues.push({ row: rowNumber, code: "badUuid", column: "product_id", value: productIdRaw });
      } else {
        productId = productIdRaw.toLowerCase();
      }
    }

    const name = raw("name");
    const trimmedNameLength = name.trim().length;
    if (trimmedNameLength === 0) {
      rowIssues.push({ row: rowNumber, code: "emptyName", column: "name" });
    } else if (trimmedNameLength > 200) {
      rowIssues.push({ row: rowNumber, code: "nameTooLong", column: "name" });
    }

    const descriptionRaw = raw("description");
    const basePrice = readInt("base_price_day_grosze", 1);
    const deposit = readInt("deposit_grosze", 0);
    const autoMultiplier = readDecimal("auto_increment_multiplier");
    const bufferBefore = readInt("buffer_before_days", 0);
    const bufferAfter = readInt("buffer_after_days", 0);

    const activeRaw = raw("active").trim().toLowerCase();
    let active: boolean | null = null;
    if (activeRaw === "true" || activeRaw === "1") active = true;
    else if (activeRaw === "false" || activeRaw === "0") active = false;
    else rowIssues.push({ row: rowNumber, code: "badBoolean", column: "active", value: raw("active").trim() });

    // Próg: kompletny (tier_days + tier_multiplier) albo CAŁKIEM pusty.
    const tierDaysRaw = raw("tier_days").trim();
    const tierMultiplierRaw = raw("tier_multiplier").trim();
    const tierLabelRaw = raw("tier_label");
    const tierSortRaw = raw("tier_sort_order").trim();
    let tier: CatalogImportTier | null = null;
    const tierPresent =
      tierDaysRaw !== "" || tierMultiplierRaw !== "" || tierLabelRaw !== "" || tierSortRaw !== "";
    if (tierPresent) {
      if (tierDaysRaw === "") {
        rowIssues.push({ row: rowNumber, code: "tierIncomplete", column: "tier_days" });
      } else if (tierMultiplierRaw === "") {
        rowIssues.push({ row: rowNumber, code: "tierIncomplete", column: "tier_multiplier" });
      } else {
        const tierDays = readInt("tier_days", 1);
        const multiplier = readDecimal("tier_multiplier");
        const sortOrder = tierSortRaw === "" ? 0 : readInt("tier_sort_order", 0);
        if (tierDays !== null && multiplier !== null && sortOrder !== null) {
          tier = {
            tierDays,
            multiplier,
            label: tierLabelRaw === "" ? null : tierLabelRaw,
            sortOrder,
          };
        }
      }
    }

    // KATEGORIE (ADR-155): kolumna OPCJONALNA — jej brak zostawia przypisania
    // nietknięte, więc pliki sprzed tej zmiany wczytują się bez skutków
    // ubocznych. Kształt sluga sprawdzamy TU, bo błąd wiersza z numerem jest
    // dla operatora czymś innym niż zbiorcza odmowa bazy; istnienie kategorii
    // sprawdza warstwa planu, która ma dostęp do katalogu najemcy.
    let categories: string[] | null = null;
    if (carriesCategories) {
      const cell = raw(CATALOG_CSV_CATEGORIES_COLUMN).trim();
      const slugs: string[] = [];
      for (const part of cell.split(CATALOG_CSV_CATEGORIES_SEPARATOR)) {
        const slug = part.trim().toLowerCase();
        // Pusta komórka i nadmiarowy rozdzielnik („a||b", „a|") to pomyłka
        // arkusza, nie treść — pomijamy zamiast wywracać wiersz.
        if (slug === "") continue;
        if (!CATEGORY_SLUG_PATTERN.test(slug) || slug.length > CATEGORY_SLUG_MAX_LENGTH) {
          rowIssues.push({
            row: rowNumber,
            code: "badCategorySlug",
            column: CATALOG_CSV_CATEGORIES_COLUMN,
            value: part.trim(),
          });
          continue;
        }
        if (!slugs.includes(slug)) slugs.push(slug);
      }
      categories = slugs;
    }

    // Wartości pól własnych: ten sam parser, którym czyta je formularz panelu
    // i checkout sklepu (`parseCustomFieldInput` z rdzenia) — arkusz nie jest
    // furtką do wartości, których nie przyjęłaby żadna inna powierzchnia.
    //
    // Checkbox w trybie LITERAL: komórka jest jawnym napisem, więc `TRUE`
    // z Excela EN daje `true`, a śmieć — błąd wiersza (badCustomField), zamiast
    // cichego `false` na round-tripie eksport→import.
    const customFields: CustomFieldValues = {};
    for (const { column, definition } of customFieldColumns) {
      const parsed = parseCustomFieldInput(definition, raw(column), { checkbox: "literal" });
      if (parsed.issue) {
        rowIssues.push({ row: rowNumber, code: "badCustomField", column, value: raw(column).trim() });
        continue;
      }
      if (parsed.value !== undefined) customFields[definition.id] = parsed.value;
    }
    // Granica ROZMIARU CAŁEJ MAPY (8 kB kolumny) — pojedyncze wartości mogą się
    // mieścić, a ich suma nie. Bez tego odmowa przyszłaby dopiero z bazy,
    // surowym błędem i bez numeru wiersza.
    if (
      rowIssues.length === 0 &&
      validateCustomFieldValues(definitions, customFields, {
        mode: "create",
        entity: "product",
        requireRequired: false,
      }).issues["*"] !== undefined
    ) {
      rowIssues.push({
        row: rowNumber,
        code: "badCustomField",
        value: `>${CUSTOM_FIELD_LIMITS.valuesBytesMax}B`,
      });
    }

    if (rowIssues.length > 0) {
      issues.push(...rowIssues);
      continue;
    }

    rows.push({
      customFields,
      row: rowNumber,
      productId,
      name,
      description: descriptionRaw === "" ? null : descriptionRaw,
      basePriceDayGrosze: basePrice!,
      depositGrosze: deposit!,
      autoIncrementMultiplier: autoMultiplier!,
      bufferBeforeDays: bufferBefore!,
      bufferAfterDays: bufferAfter!,
      active: active!,
      tier,
      categories,
    });
  }

  // --- Grupowanie ---
  const products: CatalogImportProduct[] = [];
  const byId = new Map<string, CatalogImportProduct>();
  let lastNewProduct: CatalogImportProduct | null = null;
  let lastRowNumber = 0;

  const startGroup = (row: ParsedRow): CatalogImportProduct => {
    const product: CatalogImportProduct = {
      productId: row.productId,
      name: row.name,
      description: row.description,
      basePriceDayGrosze: row.basePriceDayGrosze,
      depositGrosze: row.depositGrosze,
      autoIncrementMultiplier: row.autoIncrementMultiplier,
      bufferBeforeDays: row.bufferBeforeDays,
      bufferAfterDays: row.bufferAfterDays,
      active: row.active,
      tiers: [],
      // Pola produktu bierzemy z PIERWSZEGO wiersza grupy — pole własne jest
      // polem produktu, więc obowiązuje ta sama reguła co dla nazwy i ceny.
      customFields: row.customFields,
      // Kategorie tak samo: przynależność opisuje PRODUKT, a nie jego próg
      // cenowy, więc powtórzone komórki w kolejnych wierszach grupy nie mają
      // prawa niczego dokładać ani zdejmować.
      categories: row.categories,
      rows: [],
    };
    products.push(product);
    return product;
  };

  const appendRow = (product: CatalogImportProduct, row: ParsedRow) => {
    product.rows.push(row.row);
    if (row.tier) {
      if (product.tiers.some((existing) => existing.tierDays === row.tier!.tierDays)) {
        issues.push({
          row: row.row,
          code: "duplicateTierDays",
          column: "tier_days",
          value: String(row.tier.tierDays),
        });
        return;
      }
      product.tiers.push(row.tier);
    }
  };

  for (const row of rows) {
    if (row.productId !== null) {
      let product = byId.get(row.productId);
      if (!product) {
        product = startGroup(row);
        byId.set(row.productId, product);
      }
      appendRow(product, row);
      lastNewProduct = null;
    } else {
      // Nowy produkt: sąsiedni wiersz (bez dziury) z identyczną nazwą dokleja
      // próg do poprzedniej grupy; wszystko inne otwiera nową.
      const adjacent: boolean =
        lastNewProduct !== null && row.row === lastRowNumber + 1 && lastNewProduct.name === row.name;
      const product: CatalogImportProduct = adjacent ? lastNewProduct! : startGroup(row);
      appendRow(product, row);
      lastNewProduct = product;
    }
    lastRowNumber = row.row;
  }

  if (issues.length > 0) {
    return { products: [], issues, rowCount: dataRecords.length, customFieldColumns: [] };
  }
  return { products, issues, rowCount: dataRecords.length, customFieldColumns: coveredIds };
}
