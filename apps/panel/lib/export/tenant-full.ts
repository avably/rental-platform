/**
 * Backup-grade eksport JEDNEGO najemcy (I5.6, ADR-258) — RODO art. 20
 * (przenośność danych) + fundament Disaster Recovery (I5.7).
 *
 * TEN MODUŁ ROZSZERZA istniejący tor eksportu (ADR-111, per-domenowe CSV
 * orders/customers/catalog). Tamten oddaje wybraną domenę zalogowanemu
 * ownerowi w oknie handlowym. TEN buduje STRUKTURALNY zrzut CAŁEGO najemcy:
 * wszystkie tabele per-tenant + korzeń `tenants`, w formacie nadającym się do
 * ODTWORZENIA przez planer DR (scripts/dr/restore-tenant.mjs). Manifest jest
 * dopięty do kształtu, jakiego ten planer oczekuje (patrz `// TODO(I5.6)` tam
 * oraz `exampleManifest()` — te same pola: manifestVersion, tenant, source,
 * tables[{name,file,rowCount}], secrets{...}, storage[{bucket,prefix,...}]).
 *
 * KTO WOŁA: job operatorski rolą `service_role` (bypass RLS). Odczyt idzie
 * przez RPC `app.export_tenant_full(uuid)` (migracja 0104), która na KAŻDYM
 * odczycie ma jawny filtr `tenant_id` — to jest granica izolacji. Warstwa TS
 * DODATKOWO (defense-in-depth) weryfikuje, że ani jeden zwrócony wiersz nie
 * niesie cudzego `tenant_id`, i że sekrety wychodzą wyłącznie jako koperty.
 *
 * SEKRETY: `tenant_secrets` niosą wyłącznie kolumnę `ciphertext` w postaci
 * koperty `v1:<wersja>:<iv>:<tag>:<ct>` (AES-256-GCM, ADR-052). Zrzut NIGDY nie
 * odszyfrowuje — klucz mieszka poza bazą (AVABLY_SECRETS_KEY_*, patrz
 * docs/operacje/spis-env-avably.md). Odtworzenie sekretów wymaga depozytu klucza
 * (owner-pending, I5.4); manifest oznacza je jako koperty i wymienia wymagane
 * zmienne środowiskowe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Wersja KSZTAŁTU manifestu. Celowo równa `EXPECTED_MANIFEST_VERSION`
 * ze scripts/dr/restore-tenant.mjs, żeby planer DR konsumował zrzut bez
 * ostrzeżenia o rozjeździe. Finalizacja (zdjęcie `-draft`) to skoordynowana
 * zmiana OBU artefaktów naraz — poza pasem tego zadania (restore w I5.7).
 */
export const TENANT_EXPORT_MANIFEST_VERSION = "0.1-draft";

/**
 * Najwyższa migracja, względem której ten eksport jest autorstwa. Job DR może
 * ją nadpisać, gdy zrzut robiony jest na nowszym schemacie (planer używa jej
 * do „odtwórz schemat do migracji X PRZED danymi").
 */
export const TENANT_EXPORT_SCHEMA_MIGRATION = "0104";

/** Nazwa RPC pełnego zrzutu (schemat `app`, migracja 0104). */
const EXPORT_RPC = "export_tenant_full";

/** Tabela sekretów — traktowana osobno (koperty, nie zwykłe dane). */
const SECRETS_TABLE = "tenant_secrets";

/** Korzeń zrzutu — izolowany po `id`, nie po kolumnie `tenant_id`. */
const ROOT_TABLE = "tenants";

/**
 * Format koperty sekretu (lustro CHECK-a `tenant_secrets.ciphertext` z 0024
 * i wzorca w packages/core/src/secrets/envelope.ts). Trzymamy tu WŁASNĄ kopię
 * — pakiety nie współdzielą regexów, a ten sam wzorzec broni obu stron:
 * `v1:<wersja>:<iv>:<tag>:<ct>` (człony base64url).
 */
const SECRET_ENVELOPE_PATTERN =
  /^v1:[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;

/** Opis formatu koperty w manifeście (dla planera DR). */
const SECRET_ENVELOPE_FORMAT = "v1:<wersja>:<iv>:<tag>:<ct>";

/**
 * Allowlista kolumn tabeli `tenant_secrets` (u źródła: migracja 0024) — JEDYNE
 * kolumny, które mają prawo opuścić bazę w zrzucie. Fail-closed (lustro
 * assertKnownStorageColumns dla ścieżek plików): kolumna spoza tej listy — np.
 * przyszła kolumna dołożona migracją — ZATRZYMUJE eksport, zamiast wyjść
 * nieopatrzona. `ciphertext` niesie kopertę (kształt waliduje buildSecretsEntry);
 * reszta to metadane rotacji (key_version), klucz wiersza (tenant_id, key) oraz
 * znaczniki czasu. Żadna nie jest dziś plaintextem, ale nowa kolumna mogłaby nim
 * być — dlatego lista jest ZAMKNIĘTA, a jej rozszerzenie to świadoma decyzja
 * (przejrzyj, czy wartość jest bezpieczna w zrzucie, i dopiero wtedy dopisz).
 */
export const SECRET_COLUMNS: ReadonlySet<string> = new Set([
  "tenant_id",
  "key",
  "ciphertext",
  "key_version",
  "created_at",
  "updated_at",
]);

/**
 * Zmienne środowiskowe wymagane do ODSZYFROWANIA sekretów przy odtworzeniu
 * (resolveSecretsKeyring, packages/core/src/secrets/keyring.ts). `_CURRENT`
 * wskazuje wersję szyfrującą; `_V<n>` niesie materiał każdej wersji obecnej
 * w kopertach. Bez nich koperty są nieodwracalnie nieczytelne (ADR-052).
 */
const SECRETS_KEY_CURRENT_ENV = "AVABLY_SECRETS_KEY_CURRENT";
const SECRETS_KEY_ENV_PREFIX = "AVABLY_SECRETS_KEY_V";

/**
 * Rejestr kolumn niosących ścieżki plików w Storage: (tabela, kolumna) →
 * bucket. Manifest MUSI wymienić te pliki, by planer DR wiedział, co pobrać
 * (pliki są POZA bazą, na osobnym nośniku). Bucket ustalony u źródła:
 *   - product-images:  zdjęcia sprzętu (0018) i bilety uploadu (0038),
 *   - site-images:     obrazy sklepu — hero/sekcje/logo (0043) ORAZ baner
 *                      kategorii (0101, categoryBannerUrl → bucket site-images),
 *   - rental-contracts: PDF umów najmu (0026).
 * NOWA tabela per-tenant z kolumną ścieżki, której tu nie ma, jest wykrywana
 * jako naruszenie (patrz assertKnownStorageColumns) — backup nie może po cichu
 * pominąć plików nowej tabeli.
 */
interface StoragePathColumn {
  table: string;
  column: string;
  bucket: string;
}
const STORAGE_PATH_COLUMNS: readonly StoragePathColumn[] = [
  { table: "product_images", column: "storage_path", bucket: "product-images" },
  { table: "product_image_uploads", column: "storage_path", bucket: "product-images" },
  { table: "site_image_uploads", column: "storage_path", bucket: "site-images" },
  { table: "catalog_categories", column: "image_path", bucket: "site-images" },
  { table: "contract_documents", column: "storage_path", bucket: "rental-contracts" },
] as const;

/** Kolumny wyglądające na ścieżkę pliku — sonda „nowa tabela storage bez wpisu". */
const STORAGE_COLUMN_SUFFIX = /(?:storage_path|image_path)$/;

// ---------------------------------------------------------------------------
// Kształt manifestu (zgodny z restore-tenant.mjs / exampleManifest)
// ---------------------------------------------------------------------------

export interface TenantExportTableEntry {
  name: string;
  /** Ścieżka pliku danych w paczce (JSONL, jeden wiersz JSON na linię). */
  file: string;
  rowCount: number;
}

export interface TenantExportSecretsEntry {
  file: string;
  rowCount: number;
  /** ZAWSZE true — sekrety wychodzą jako koperty, nigdy jawne. */
  encrypted: true;
  envelopeFormat: string;
  /** Wersje kluczy obecne w kopertach (z członu `v1:<wersja>:…`). */
  keyVersions: number[];
  /** Zmienne środowiskowe wymagane do odszyfrowania przy odtworzeniu. */
  requiresEnv: string[];
}

export interface TenantExportStorageEntry {
  bucket: string;
  /** Wspólny prefiks ścieżek najemcy (`<tenantId>/`). */
  prefix: string;
  objectCount: number;
  /** Pełna lista ścieżek WEWNĄTRZ bucketa — planer DR pobiera dokładnie te. */
  paths: string[];
}

export interface TenantExportManifest {
  manifestVersion: string;
  exportedAt: string;
  tenant: { id: string; slug: string | null; name: string | null };
  source: { supabaseProject: string | null; schemaMigration: string };
  tables: TenantExportTableEntry[];
  secrets: TenantExportSecretsEntry | null;
  storage: TenantExportStorageEntry[];
}

/** Plik danych paczki — ścieżka + zawartość (JSONL). */
export interface TenantExportFile {
  path: string;
  contents: string;
}

/** Pełna paczka zrzutu: manifest + pliki danych (data/*.jsonl). */
export interface TenantExportBundle {
  manifest: TenantExportManifest;
  files: TenantExportFile[];
}

export interface TenantExportOptions {
  /** Znacznik `exportedAt` — wstrzykiwany dla testów (jak exportFilename). */
  now?: Date;
  /** Referencja projektu Supabase (job DR podaje; domyślnie null). */
  supabaseProject?: string | null;
  /** Nadpisanie wersji schematu (job na nowszym schemacie). */
  schemaMigration?: string;
}

/** Zrzut najemcy zawierał wiersz spoza `tenant_id` — twarda odmowa (fail-closed). */
export class TenantExportIsolationError extends Error {
  constructor(message: string) {
    super(`Naruszenie izolacji eksportu najemcy: ${message}`);
    this.name = "TenantExportIsolationError";
  }
}

/** Sekret wyszedł w postaci innej niż koperta — twarda odmowa (nigdy plaintext). */
export class TenantSecretLeakError extends Error {
  constructor(message: string) {
    super(`Sekret najemcy nie jest kopertą: ${message}`);
    this.name = "TenantSecretLeakError";
  }
}

type Row = Record<string, unknown>;
type ExportPayload = Record<string, Row[]>;

/** JSONL: jeden wiersz JSON na linię (pusta tablica → pusty plik). */
function toJsonl(rows: Row[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

function dataFilePath(table: string): string {
  return `data/${table}.jsonl`;
}

/**
 * Weryfikacja izolacji W WARSTWIE APLIKACJI (obok jawnego filtra w RPC):
 * każdy wiersz tabeli per-tenant MUSI nieść `tenant_id === tenantId`, a korzeń
 * `tenants` — `id === tenantId` i co najwyżej jeden wiersz. Cokolwiek innego to
 * TenantExportIsolationError — zrzut się NIE buduje, zamiast wypuścić cudzy wiersz.
 */
function assertRowsBelongToTenant(table: string, rows: Row[], tenantId: string): void {
  if (table === ROOT_TABLE) {
    if (rows.length > 1) {
      throw new TenantExportIsolationError(
        `korzeń ${ROOT_TABLE} ma ${rows.length} wierszy dla jednego najemcy`,
      );
    }
    for (const row of rows) {
      if (row.id !== tenantId) {
        throw new TenantExportIsolationError(`${ROOT_TABLE}.id=${String(row.id)} ≠ ${tenantId}`);
      }
    }
    return;
  }
  for (const row of rows) {
    if (row.tenant_id !== tenantId) {
      throw new TenantExportIsolationError(
        `${table}.tenant_id=${String(row.tenant_id)} ≠ ${tenantId}`,
      );
    }
  }
}

/**
 * Sonda „nowa tabela storage bez wpisu w rejestrze". Każda kolumna wyglądająca
 * na ścieżkę pliku (`*storage_path` / `*image_path`) MUSI mieć wpis w
 * STORAGE_PATH_COLUMNS — inaczej backup po cichu pominąłby pliki nowej tabeli.
 * Głośny błąd zamiast cichej luki (wzorzec buildSampleRow/mutationPatch).
 */
function assertKnownStorageColumns(payload: ExportPayload): void {
  const known = new Set(STORAGE_PATH_COLUMNS.map((c) => `${c.table}.${c.column}`));
  for (const [table, rows] of Object.entries(payload)) {
    const sample = rows[0];
    if (!sample) continue;
    for (const column of Object.keys(sample)) {
      if (STORAGE_COLUMN_SUFFIX.test(column) && !known.has(`${table}.${column}`)) {
        throw new TenantExportIsolationError(
          `kolumna ścieżki ${table}.${column} bez wpisu w STORAGE_PATH_COLUMNS — ` +
            `dodaj mapowanie bucketa, aby backup wymienił jej pliki`,
        );
      }
    }
  }
}

/**
 * Strażnik „nieoczekiwana kolumna w tenant_secrets" (fail-closed) — lustro
 * assertKnownStorageColumns. Każdy klucz KAŻDEGO wiersza sekretów MUSI należeć
 * do SECRET_COLUMNS; kolumna spoza allowlisty (przyszła kolumna dołożona
 * migracją, być może niosąca materiał wrażliwy) ZATRZYMUJE eksport, zamiast
 * wyjść nieopatrzona. Głośna odmowa zamiast cichej luki. Sprawdzamy WSZYSTKIE
 * wiersze, nie sam pierwszy: kolumna dołożona z defaultem NULL potrafi być
 * pusta w jednym wierszu, a niepusta w innym.
 *
 * @throws TenantExportIsolationError gdy pojawi się kolumna spoza SECRET_COLUMNS.
 */
export function assertKnownSecretColumns(rows: ReadonlyArray<Record<string, unknown>>): void {
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (!SECRET_COLUMNS.has(column)) {
        throw new TenantExportIsolationError(
          `nieoczekiwana kolumna ${SECRETS_TABLE}.${column} spoza allowlisty ` +
            `SECRET_COLUMNS — oceń, czy jest bezpieczna w zrzucie, i dopiero wtedy ` +
            `dodaj ją do listy (albo wyklucz z RPC ${EXPORT_RPC})`,
        );
      }
    }
  }
}

/**
 * Buduje wpis sekretów: fail-closed na nieoczekiwaną kolumnę (allowlista
 * SECRET_COLUMNS), potem waliduje kształt koperty KAŻDEGO wiersza (fail-closed),
 * zbiera wersje kluczy i wymagane zmienne środowiskowe. Wołający dostaje też
 * plik JSONL z kopertami verbatim (bez odszyfrowania).
 */
function buildSecretsEntry(rows: Row[]): TenantExportSecretsEntry {
  // Zanim cokolwiek zbudujemy: żadna kolumna spoza allowlisty nie ma prawa
  // przejść (drift schematu tenant_secrets nie wycieka po cichu).
  assertKnownSecretColumns(rows);
  const keyVersions = new Set<number>();
  for (const row of rows) {
    const ciphertext = row.ciphertext;
    if (typeof ciphertext !== "string" || !SECRET_ENVELOPE_PATTERN.test(ciphertext)) {
      throw new TenantSecretLeakError(
        `wiersz klucza "${String(row.key)}" nie pasuje do formatu ${SECRET_ENVELOPE_FORMAT}`,
      );
    }
    // Wersja z drugiego członu koperty (`v1:<wersja>:…`) — źródło prawdy o tym,
    // którym kluczem trzeba odszyfrować przy odtworzeniu.
    const version = Number.parseInt(ciphertext.split(":")[1] ?? "", 10);
    if (Number.isFinite(version)) keyVersions.add(version);
  }
  const sortedVersions = [...keyVersions].sort((a, b) => a - b);
  return {
    file: dataFilePath(SECRETS_TABLE),
    rowCount: rows.length,
    encrypted: true,
    envelopeFormat: SECRET_ENVELOPE_FORMAT,
    keyVersions: sortedVersions,
    requiresEnv: [
      SECRETS_KEY_CURRENT_ENV,
      ...sortedVersions.map((v) => `${SECRETS_KEY_ENV_PREFIX}${v}`),
    ],
  };
}

/** Buduje manifest Storage: grupuje ścieżki plików per bucket (z rejestru). */
function buildStorageEntries(payload: ExportPayload, tenantId: string): TenantExportStorageEntry[] {
  const byBucket = new Map<string, string[]>();
  for (const { table, column, bucket } of STORAGE_PATH_COLUMNS) {
    const rows = payload[table];
    if (!rows) continue;
    for (const row of rows) {
      const path = row[column];
      if (typeof path !== "string" || path.length === 0) continue;
      const list = byBucket.get(bucket) ?? [];
      list.push(path);
      byBucket.set(bucket, list);
    }
  }
  return [...byBucket.entries()]
    .map(([bucket, paths]) => ({
      bucket,
      prefix: `${tenantId}/`,
      objectCount: paths.length,
      paths: [...paths].sort(),
    }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/**
 * Buduje pełną paczkę zrzutu JEDNEGO najemcy. Woła RPC 0104 rolą wołającego
 * (job service_role), po czym weryfikuje izolację i sekrety w warstwie TS.
 *
 * @throws TenantExportIsolationError  gdy zwrócono wiersz spoza `tenant_id`
 *   albo najemca nie istnieje (pusty korzeń), albo nowa tabela storage bez wpisu.
 * @throws TenantSecretLeakError       gdy sekret wyszedł w postaci innej niż koperta.
 */
export async function exportTenantFull(
  client: SupabaseClient,
  tenantId: string,
  options: TenantExportOptions = {},
): Promise<TenantExportBundle> {
  if (!tenantId) {
    throw new TenantExportIsolationError("brak tenantId — job nie ma prawa zrzucać bez wskazania najemcy");
  }

  const { data, error } = await client
    .schema("app")
    .rpc(EXPORT_RPC, { p_tenant_id: tenantId });
  if (error) {
    throw new Error(`Pełny eksport najemcy: RPC ${EXPORT_RPC} nie powiodło się (${error.code ?? error.message}).`);
  }

  const payload = (data ?? {}) as ExportPayload;

  // Korzeń MUSI istnieć — pusty znaczy „nie ma takiego najemcy", a nie „udany
  // pusty backup" (analogicznie do twardego wymogu p_tenant_id w RPC).
  const rootRows = payload[ROOT_TABLE] ?? [];
  if (rootRows.length === 0) {
    throw new TenantExportIsolationError(`najemca ${tenantId} nie istnieje (pusty korzeń ${ROOT_TABLE})`);
  }

  // Izolacja: żaden wiersz spoza tenanta. Sonda storage: żadna nowa tabela
  // z plikami bez mapowania bucketa.
  for (const [table, rows] of Object.entries(payload)) {
    assertRowsBelongToTenant(table, rows, tenantId);
  }
  assertKnownStorageColumns(payload);

  const root = rootRows[0] as Row;

  // Pliki danych: każda tabela per-tenant osobnym JSONL. `tenants` i
  // `tenant_secrets` traktowane osobno (korzeń idzie do pliku, sekrety mają
  // własny wpis manifestu). Kolejność stabilna (alfabetyczna) — diff dwóch
  // zrzutów pokazuje zmiany danych, nie kolejność kluczy jsonb.
  const tableNames = Object.keys(payload)
    .filter((name) => name !== ROOT_TABLE && name !== SECRETS_TABLE)
    .sort();

  const files: TenantExportFile[] = [];
  const tables: TenantExportTableEntry[] = [];

  // Korzeń jako pierwszy plik danych (tier 1 w kolejności odtwarzania).
  files.push({ path: dataFilePath(ROOT_TABLE), contents: toJsonl(rootRows) });
  tables.push({ name: ROOT_TABLE, file: dataFilePath(ROOT_TABLE), rowCount: rootRows.length });

  for (const name of tableNames) {
    const rows = payload[name] ?? [];
    files.push({ path: dataFilePath(name), contents: toJsonl(rows) });
    tables.push({ name, file: dataFilePath(name), rowCount: rows.length });
  }

  // Sekrety: własny plik (koperty verbatim) + wpis manifestu.
  const secretRows = payload[SECRETS_TABLE] ?? [];
  const secrets = buildSecretsEntry(secretRows);
  files.push({ path: dataFilePath(SECRETS_TABLE), contents: toJsonl(secretRows) });

  const storage = buildStorageEntries(payload, tenantId);

  const manifest: TenantExportManifest = {
    manifestVersion: TENANT_EXPORT_MANIFEST_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    tenant: {
      id: tenantId,
      slug: typeof root.slug === "string" ? root.slug : null,
      name: typeof root.name === "string" ? root.name : null,
    },
    source: {
      supabaseProject: options.supabaseProject ?? null,
      schemaMigration: options.schemaMigration ?? TENANT_EXPORT_SCHEMA_MIGRATION,
    },
    tables,
    secrets,
    storage,
  };

  return { manifest, files };
}

/**
 * Spłaszcza paczkę do listy plików gotowej do spakowania (manifest.json +
 * data/*.jsonl). Osobno od `exportTenantFull`, bo pakowanie (zip/tar/upload)
 * to decyzja wołającego — moduł oddaje drzewo plików, nie nośnik.
 */
export function tenantExportFileList(bundle: TenantExportBundle): TenantExportFile[] {
  return [
    { path: "manifest.json", contents: JSON.stringify(bundle.manifest, null, 2) },
    ...bundle.files,
  ];
}
