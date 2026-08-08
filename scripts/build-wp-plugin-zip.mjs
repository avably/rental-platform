#!/usr/bin/env node
/**
 * Buduje paczkę instalacyjną wtyczki WordPress (M2, ADR-110) ZE ŹRÓDEŁ REPO.
 *
 * Wynik: moduł TypeScript `apps/panel/lib/wordpress/plugin-package.ts` z
 * archiwum w base64 + metadanymi (wersja, nazwa pliku, lista wpisów). Panel
 * serwuje go trasą pobierania.
 *
 * DLACZEGO MODUŁ, A NIE PLIK NA DYSKU: hosting serwerless pakuje wyłącznie to,
 * co widzi bundler — plik binarny leżący poza `apps/panel` wymagałby ręcznego
 * dokładania do śladu plików przy każdym deployu i cicho znikał przy zmianie
 * układu katalogów. Moduł jest importem, więc jedzie z kodem zawsze.
 *
 * DLACZEGO ARTEFAKT SIEDZI W REPO: build produkcyjny nie może zależeć od tego,
 * czy ktoś pamiętał uruchomić skrypt — więc wynik jest commitowany, a bramka
 * CI (`apps/panel/test/wordpress-plugin-package.test.ts`) regeneruje go i
 * porównuje BAJT W BAJT ze stanem w repo. Rozjazd = czerwony test, nie cicha
 * paczka sprzed trzech wersji. Determinizm zapewnia stały znacznik czasu i
 * sortowanie wpisów.
 *
 * Użycie: node scripts/build-wp-plugin-zip.mjs [--check]
 *   --check  nie zapisuje, tylko zwraca kod 1 przy rozjeździe z repo.
 */
import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const pluginDir = resolve(repoRoot, "integrations/wordpress/avably-booking");
const outputFile = resolve(repoRoot, "apps/panel/lib/wordpress/plugin-package.ts");

/** Katalog wewnątrz archiwum — instalator WP wymaga jednego katalogu na wtyczkę. */
const ARCHIVE_ROOT = "avably-booking";

/**
 * Do paczki idzie WYŁĄCZNIE runtime. Rusztowanie deweloperskie (testy,
 * konfiguracja phpunit, docker-compose, zrzuty dowodowe) nie ma prawa
 * wylądować na serwerze najemcy: to i zbędny bagaż, i powierzchnia ataku.
 */
const EXCLUDED_DIRS = new Set(["dev", "tests", "node_modules", ".git"]);
const EXCLUDED_FILES = new Set([
  "phpunit.xml.dist",
  ".gitignore",
  ".phpunit.result.cache",
  ".DS_Store",
]);

function collectFiles(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const absolute = join(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue;
      out.push(...collectFiles(absolute, relativePath));
      continue;
    }
    if (EXCLUDED_FILES.has(entry)) continue;
    out.push({ path: relativePath, absolute });
  }
  return out;
}

// --- Minimalny, deterministyczny writer ZIP (deflate) ---

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

// Stały znacznik czasu (1980-01-01 00:00) — bez niego archiwum zmieniałoby
// się przy każdym uruchomieniu i bramka porównująca bajty byłaby bezużyteczna.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(`${ARCHIVE_ROOT}/${file.path}`, "utf8");
    const content = readFileSync(file.absolute);
    const compressed = deflateRawSync(content, { level: 9 });
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // wersja wymagana
    local.writeUInt16LE(0, 6); // flagi
    local.writeUInt16LE(8, 8); // metoda: deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // wersja twórcy
    entry.writeUInt16LE(20, 6); // wersja wymagana
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(content.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30); // extra
    entry.writeUInt16LE(0, 32); // komentarz
    entry.writeUInt16LE(0, 34); // dysk
    entry.writeUInt16LE(0, 36); // atrybuty wewnętrzne
    // Atrybuty zewnętrzne: zwykły plik 0644 (WP rozpakowuje własnymi prawami,
    // ale archiwum ma być poprawne także dla `unzip`).
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([entry, name]));

    offset += local.length + name.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

// --- Budowa ---

const pluginHeader = readFileSync(join(pluginDir, "avably-booking.php"), "utf8");
const version = pluginHeader.match(/^\s*\*\s*Version:\s*(.+)$/m)?.[1].trim();
if (!version) throw new Error("Nie znaleziono wersji w nagłówku wtyczki");

const files = collectFiles(pluginDir);
if (files.length === 0) throw new Error("Zero plików do spakowania");

const zip = buildZip(files);
const base64 = zip.toString("base64");
const filename = `avably-booking-${version}.zip`;
const entries = files.map((file) => `${ARCHIVE_ROOT}/${file.path}`);

// Base64 łamany na linie, żeby plik dało się czytać i różnicować w code review.
const wrapped = (base64.match(/.{1,120}/g) ?? []).map((line) => `  "${line}",`).join("\n");

const module = `/**
 * PLIK GENEROWANY — nie edytuj ręcznie.
 * Źródło: integrations/wordpress/avably-booking (recepta: scripts/build-wp-plugin-zip.mjs).
 *
 * Paczka instalacyjna wtyczki WordPress (M2, ADR-110) jako base64: archiwum
 * rozpakowuje się do katalogu \`${ARCHIVE_ROOT}/\` (wymóg instalatora WP) i
 * zawiera wyłącznie pliki runtime — bez testów, konfiguracji phpunit i
 * środowiska deweloperskiego.
 *
 * Zgodność z repo pilnuje bramka apps/panel/test/wordpress-plugin-package.test.ts
 * (regeneruje archiwum i porównuje bajt w bajt).
 */

/** Wersja z nagłówka wtyczki (\`Version:\`). */
export const WORDPRESS_PLUGIN_VERSION = ${JSON.stringify(version)};

/** Nazwa pliku proponowana przeglądarce (Content-Disposition). */
export const WORDPRESS_PLUGIN_FILENAME = ${JSON.stringify(filename)};

/** Ścieżki wpisów archiwum — kontrakt zawartości (bramka „bez plików dev"). */
export const WORDPRESS_PLUGIN_ENTRIES: readonly string[] = ${JSON.stringify(entries, null, 2)
  .split("\n")
  .map((line, index) => (index === 0 ? line : `  ${line}`))
  .join("\n")};

const BASE64_LINES: readonly string[] = [
${wrapped}
];

/** Archiwum ZIP wtyczki gotowe do odesłania w odpowiedzi HTTP. */
export function wordpressPluginZip(): Buffer {
  return Buffer.from(BASE64_LINES.join(""), "base64");
}
`;

/**
 * Rozpakowuje archiwum z zapisanego modułu i zwraca mapę ścieżka → sha256
 * ZAWARTOŚCI.
 *
 * Bramka porównuje TREŚĆ, nie bajty pliku .ts: strumień deflate zależy od
 * wersji zlib w danym środowisku, więc porównanie bajt w bajt czerwieniłoby
 * CI na maszynie z inną biblioteką, mimo że paczka niesie dokładnie te same
 * pliki. Dowodzimy tego, co ma znaczenie — że najemca dostaje bieżące źródła.
 */
function digestsFromModule(source) {
  const base64 = [...source.matchAll(/^\s*"([A-Za-z0-9+/=]+)",$/gm)].map((m) => m[1]).join("");
  if (base64 === "") throw new Error("Nie znaleziono danych archiwum w module");
  const archive = Buffer.from(base64, "base64");

  const digests = new Map();
  let cursor = 0;
  while (cursor < archive.length && archive.readUInt32LE(cursor) === 0x04034b50) {
    const compressedSize = archive.readUInt32LE(cursor + 18);
    const nameLength = archive.readUInt16LE(cursor + 26);
    const extraLength = archive.readUInt16LE(cursor + 28);
    const name = archive.subarray(cursor + 30, cursor + 30 + nameLength).toString("utf8");
    const dataStart = cursor + 30 + nameLength + extraLength;
    const content = inflateRawSync(archive.subarray(dataStart, dataStart + compressedSize));
    digests.set(name, createHash("sha256").update(content).digest("hex"));
    cursor = dataStart + compressedSize;
  }
  return digests;
}

if (process.argv.includes("--check")) {
  const current = readFileSync(outputFile, "utf8");
  const problems = [];

  if (!current.includes(JSON.stringify(version))) {
    problems.push(`wersja w module nie odpowiada nagłówkowi wtyczki (${version})`);
  }

  const stored = digestsFromModule(current);
  const expected = new Map(
    files.map((file) => [
      `${ARCHIVE_ROOT}/${file.path}`,
      createHash("sha256").update(readFileSync(file.absolute)).digest("hex"),
    ]),
  );

  for (const [name, digest] of expected) {
    if (!stored.has(name)) problems.push(`brak w paczce: ${name}`);
    else if (stored.get(name) !== digest) problems.push(`nieaktualna treść: ${name}`);
  }
  for (const name of stored.keys()) {
    if (!expected.has(name)) problems.push(`nadmiarowy plik w paczce: ${name}`);
  }

  if (problems.length > 0) {
    console.error(
      `ROZJAZD: ${relative(repoRoot, outputFile)} nie odpowiada źródłom wtyczki:\n` +
        problems.map((line) => `  - ${line}`).join("\n") +
        "\nUruchom: node scripts/build-wp-plugin-zip.mjs",
    );
    process.exit(1);
  }
  console.log(`OK: paczka zgodna ze źródłami (${files.length} plików, ${zip.length} B)`);
} else {
  writeFileSync(outputFile, module);
  console.log(
    `Zapisano ${relative(repoRoot, outputFile)}: ${filename}, ${files.length} plików, ${zip.length} B`,
  );
}
