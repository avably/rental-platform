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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  WORDPRESS_PLUGIN_ENTRIES,
  WORDPRESS_PLUGIN_FILENAME,
  WORDPRESS_PLUGIN_VERSION,
  wordpressPluginZip,
} from "@/lib/wordpress/plugin-package";

const repositoryRoot = resolve(process.cwd(), "../..");

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
    const names: string[] = [];
    let offset = 0;
    while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
      const compressedSize = zip.readUInt32LE(offset + 18);
      const nameLength = zip.readUInt16LE(offset + 26);
      const extraLength = zip.readUInt16LE(offset + 28);
      names.push(zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
      offset += 30 + nameLength + extraLength + compressedSize;
    }
    expect([...names].sort()).toEqual([...WORDPRESS_PLUGIN_ENTRIES].sort());
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
