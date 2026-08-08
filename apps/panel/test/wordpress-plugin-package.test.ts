/**
 * Paczka instalacyjna wtyczki WordPress (M2, ADR-110).
 *
 * Trzy bramki, każda pilnuje innej klasy regresji:
 *   1. ZAWARTOŚĆ — do paczki nie mogą wejść pliki deweloperskie (testy,
 *      phpunit, docker-compose, zrzuty). To i bagaż, i powierzchnia ataku
 *      na serwerze najemcy.
 *   2. ZGODNOŚĆ ZE ŹRÓDŁAMI — artefakt jest commitowany (build produkcyjny
 *      ma go dostać bez ręcznego kroku), więc musi istnieć dowód, że
 *      odpowiada bieżącym plikom wtyczki. Test regeneruje go skryptem i
 *      porównuje BAJT W BAJT; edycja wtyczki bez przebudowy pali suitę.
 *   3. ARCHIWUM JEST POPRAWNE — nagłówki ZIP i struktura katalogu
 *      `avably-booking/`, której wymaga instalator WP.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  WORDPRESS_PLUGIN_ENTRIES,
  WORDPRESS_PLUGIN_FILENAME,
  WORDPRESS_PLUGIN_VERSION,
  wordpressPluginZip,
} from "@/lib/wordpress/plugin-package";

// Manifest doboru plików — TO SAMO źródło, którego używa recepta budowy.
// Test kompletności niżej odtwarza inwariant niezależnie od recepty.
import {
  DEV_EXCLUSIONS,
  matchesAny,
} from "../../../scripts/wp-plugin-manifest.mjs";

const repositoryRoot = resolve(process.cwd(), "../..");
const pluginDirectory = resolve(repositoryRoot, "integrations/wordpress/avably-booking");

/** Nazwy wpisów czytane wprost z nagłówków lokalnych archiwum (nie ze stałej). */
function zipEntryNames(zip: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    names.push(zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}

/** Wszystkie pliki katalogu wtyczki jako ścieżki względne (posortowane). */
function walkPluginFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const absolute = join(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(absolute).isDirectory()) out.push(...walkPluginFiles(absolute, relativePath));
    else out.push(relativePath);
  }
  return out;
}

describe("paczka wtyczki WordPress — zawartość", () => {
  it("wszystkie wpisy leżą w katalogu avably-booking/ (wymóg instalatora WP)", () => {
    expect(WORDPRESS_PLUGIN_ENTRIES.length).toBeGreaterThan(0);
    for (const entry of WORDPRESS_PLUGIN_ENTRIES) {
      expect(entry.startsWith("avably-booking/"), entry).toBe(true);
    }
  });

  it("NIE zawiera plików deweloperskich ani testowych", () => {
    const forbidden = WORDPRESS_PLUGIN_ENTRIES.filter(
      (entry) =>
        entry.includes("/dev/") ||
        entry.includes("/tests/") ||
        entry.includes("phpunit") ||
        entry.includes(".cache") ||
        entry.endsWith(".gitignore"),
    );
    expect(forbidden).toEqual([]);
  });

  it("zawiera pliki, bez których wtyczka nie działa", () => {
    for (const required of [
      "avably-booking/avably-booking.php",
      "avably-booking/uninstall.php",
      "avably-booking/includes/class-avably-booking-ajax.php",
      "avably-booking/assets/booking.js",
      "avably-booking/blocks/booking/block.json",
      "avably-booking/languages/avably-booking-pl_PL.mo",
    ]) {
      expect(WORDPRESS_PLUGIN_ENTRIES).toContain(required);
    }
  });

  it("nazwa pliku niesie wersję z nagłówka wtyczki", () => {
    expect(WORDPRESS_PLUGIN_FILENAME).toBe(`avably-booking-${WORDPRESS_PLUGIN_VERSION}.zip`);
    const header = readFileSync(
      resolve(repositoryRoot, "integrations/wordpress/avably-booking/avably-booking.php"),
      "utf8",
    );
    expect(header).toContain(`Version:           ${WORDPRESS_PLUGIN_VERSION}`);
  });
});

describe("paczka wtyczki WordPress — poprawność archiwum", () => {
  const zip = wordpressPluginZip();

  it("ma sygnaturę ZIP i stopkę centralnego katalogu", () => {
    expect(zip.length).toBeGreaterThan(1000);
    // Local file header pierwszego wpisu.
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    // End of central directory na końcu pliku (bez komentarza).
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    // Liczba wpisów w stopce zgadza się z deklarowaną listą.
    expect(zip.readUInt16LE(eocd + 10)).toBe(WORDPRESS_PLUGIN_ENTRIES.length);
  });

  it("nazwy wpisów w archiwum zgadzają się z deklarowaną listą", () => {
    // Odczyt nazw wprost z nagłówków lokalnych — dowód, że stała nie jest
    // ozdobą, tylko opisuje zawartość binarną.
    expect([...zipEntryNames(zip)].sort()).toEqual([...WORDPRESS_PLUGIN_ENTRIES].sort());
  });

  it("wpisy są STORED (metoda 0) — bajty archiwum nie zależą od zlib", () => {
    // Wyjście deflate różni się między implementacjami zlib (Homebrew vs
    // oficjalny build Node), więc archiwum kompresowane nie jest odtwarzalne
    // bajt w bajt między maszynami — bramka zgodności zapalałaby się na CI
    // przy zerowej zmianie w kodzie. STORED czyni bajty funkcją wyłącznie
    // treści plików i nagłówków (ADR-110).
    let offset = 0;
    let entries = 0;
    while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
      expect(zip.readUInt16LE(offset + 8), `metoda wpisu #${entries}`).toBe(0);
      // Przy STORED rozmiar „skompresowany" musi równać się oryginalnemu.
      expect(zip.readUInt32LE(offset + 18)).toBe(zip.readUInt32LE(offset + 22));
      const nameLength = zip.readUInt16LE(offset + 26);
      const extraLength = zip.readUInt16LE(offset + 28);
      offset += 30 + nameLength + extraLength + zip.readUInt32LE(offset + 18);
      entries += 1;
    }
    expect(entries).toBe(WORDPRESS_PLUGIN_ENTRIES.length);
  });
});

describe("paczka wtyczki WordPress — dobór plików LISTĄ DOZWOLONYCH", () => {
  it("plik nieznany recepcie NIE wjeżdża do paczki — budowa odmawia głośno", () => {
    // Blacklista przepuszczała wszystko, czego wzorzec nie znał: podłożony
    // `.env` z kluczem API wjeżdżał do archiwum przy zielonej suicie i jechał
    // na serwer WordPressa każdego najemcy (recenzja PM #212, dowiedzione
    // odczytem sekretów z rozpakowanych bajtów). Od tej pory dobór jest listą
    // dozwolonych, a plik spoza niej ma PALIĆ budowę, nie cicho wjechać.
    const planted = [
      { absolute: join(pluginDirectory, ".env"), content: "AVABLY_API_KEY=avbl_podlozony\n" },
      { absolute: join(pluginDirectory, "tajne-dane.xyz"), content: "haslo=podlozone\n" },
    ];
    const modulePath = resolve(repositoryRoot, "apps/panel/lib/wordpress/plugin-package.ts");
    const moduleBefore = readFileSync(modulePath);

    try {
      for (const file of planted) writeFileSync(file.absolute, file.content);

      // Budowa MUSI odmówić (kod != 0) — nie „pominąć po cichu”.
      expect(() =>
        execFileSync("node", ["scripts/build-wp-plugin-zip.mjs"], {
          cwd: repositoryRoot,
          stdio: "pipe",
        }),
      ).toThrow();

      // Moduł w repo pozostaje nietknięty…
      expect(readFileSync(modulePath).equals(moduleBefore)).toBe(true);

      // …a dowód idzie z BAJTÓW archiwum (nagłówki lokalne), nie z samej stałej.
      const names = zipEntryNames(wordpressPluginZip());
      for (const suspicious of [".env", "tajne-dane.xyz"]) {
        expect(names.filter((name) => name.endsWith(suspicious))).toEqual([]);
        expect(WORDPRESS_PLUGIN_ENTRIES.filter((entry) => entry.endsWith(suspicious))).toEqual([]);
      }
    } finally {
      // Sprzątanie także przy błędzie: podłożone pliki i ewentualnie nadpisany moduł.
      for (const file of planted) rmSync(file.absolute, { force: true });
      writeFileSync(modulePath, moduleBefore);
    }
  });

  it("nic potrzebnego nie ginie po cichu: każdy plik wtyczki jest w paczce ALBO na jawnej liście wykluczeń", () => {
    // Druga strona kija: lista dozwolonych zbyt wąska zgubiłaby nowy plik
    // runtime (np. blocks/foo/render.php) bez śladu. Inwariant liczony
    // NIEZALEŻNIE od recepty: pełny spacer po katalogu wtyczki kontra wpisy
    // paczki i nazwana lista wykluczeń dev — trzeciej kategorii nie ma.
    const packaged = new Set(
      WORDPRESS_PLUGIN_ENTRIES.map((entry) => entry.replace(/^avably-booking\//, "")),
    );
    const orphans = walkPluginFiles(pluginDirectory).filter(
      (file) => !packaged.has(file) && !matchesAny(file, DEV_EXCLUSIONS),
    );
    expect(orphans).toEqual([]);
  });
});

describe("paczka wtyczki WordPress — zgodność ze źródłami", () => {
  it("artefakt w repo odpowiada bieżącym plikom wtyczki (recepta --check)", () => {
    // Skrypt kończy się kodem 1, gdy wynik regeneracji różni się od pliku
    // w repo — edycja wtyczki bez `node scripts/build-wp-plugin-zip.mjs`
    // zostaje złapana tutaj, a nie przez najemcę pobierającego starą paczkę.
    expect(() =>
      execFileSync("node", ["scripts/build-wp-plugin-zip.mjs", "--check"], {
        cwd: repositoryRoot,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
