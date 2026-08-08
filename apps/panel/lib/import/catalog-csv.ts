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
import { CATALOG_CSV_HEADER } from "../export/catalog";
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
  | "duplicateTierDays";

export interface CatalogImportIssue {
  /** Numer rekordu: nagłówek = 1, pierwszy wiersz danych = 2. */
  row: number;
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
  /** Numery rekordów źródłowych (do komunikatów podglądu). */
  rows: number[];
}

export interface CatalogImportParseResult {
  products: CatalogImportProduct[];
  issues: CatalogImportIssue[];
  /** Liczba rekordów danych w pliku (przed grupowaniem). */
  rowCount: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^[0-9]+$/;
const DECIMAL_RE = /^[0-9]+(\.[0-9]+)?$/;

/**
 * Zdejmuje DOKŁADNIE jeden wiodący apostrof neutralizacji formuł.
 * Lustrzane do neutralizeFormula() eksportu; nic poza tym nie zmienia.
 */
function stripFormulaApostrophe(value: string): string {
  return value.length > 1 && value[0] === "'" && FORMULA_TRIGGERS.has(value[1])
    ? value.slice(1)
    : value;
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
}

export function parseCatalogCsv(text: string): CatalogImportParseResult {
  const body = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text;
  const separator = detectSeparator(body);
  const records = readRecords(body, separator);

  const issues: CatalogImportIssue[] = [];
  if (records.length === 0) {
    for (const column of CATALOG_CSV_HEADER) issues.push({ row: 1, code: "missingColumn", column });
    return { products: [], issues, rowCount: 0 };
  }

  const header = records[0].map((name) => stripFormulaApostrophe(name).trim());
  const columnIndex = new Map<string, number>();
  header.forEach((name, index) => {
    if (!columnIndex.has(name)) columnIndex.set(name, index);
  });
  for (const column of CATALOG_CSV_HEADER) {
    if (!columnIndex.has(column)) issues.push({ row: 1, code: "missingColumn", column });
  }
  if (issues.length > 0) return { products: [], issues, rowCount: 0 };

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

    if (rowIssues.length > 0) {
      issues.push(...rowIssues);
      continue;
    }

    rows.push({
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
      const adjacent =
        lastNewProduct !== null && row.row === lastRowNumber + 1 && lastNewProduct.name === row.name;
      const product = adjacent ? lastNewProduct! : startGroup(row);
      appendRow(product, row);
      lastNewProduct = product;
    }
    lastRowNumber = row.row;
  }

  if (issues.length > 0) return { products: [], issues, rowCount: dataRecords.length };
  return { products, issues, rowCount: dataRecords.length };
}
