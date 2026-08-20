import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ROBOTO_BOLD_TTF_BASE64,
  ROBOTO_ITALIC_TTF_BASE64,
  ROBOTO_REGULAR_TTF_BASE64,
} from "../src/fonts-data";

/**
 * Kontrakt: wygenerowany `fonts-data.ts` (base64 osadzony w bundlu) jest ZGODNY
 * co do bajtu ze źródłem prawdy `assets/fonts/*.ttf`. Ten test broni przed
 * cichym dryfem — podmiana `.ttf` bez regeneracji modułu (albo ręczna edycja
 * base64) zapala go od razu. Regeneracja: `node scripts/generate-pdf-fonts-data.mjs`.
 */
const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");

const CASES: Array<[string, string]> = [
  ["Roboto-Regular.ttf", ROBOTO_REGULAR_TTF_BASE64],
  ["Roboto-Bold.ttf", ROBOTO_BOLD_TTF_BASE64],
  ["Roboto-Italic.ttf", ROBOTO_ITALIC_TTF_BASE64],
];

describe("fonts-data.ts jest zgodny ze źródłowymi .ttf", () => {
  it.each(CASES)("%s: stała base64 === base64(pliku na dysku)", (file, constant) => {
    const expected = readFileSync(join(fontsDir, file)).toString("base64");
    expect(constant).toBe(expected);
  });

  it("każda stała dekoduje się do niepustego bufora TTF (sygnatura 0x00010000)", () => {
    for (const [, constant] of CASES) {
      const bytes = Buffer.from(constant, "base64");
      expect(bytes.length).toBeGreaterThan(1000);
      // Nagłówek sfnt czcionek TrueType: 0x00 0x01 0x00 0x00.
      expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x00, 0x01, 0x00, 0x00]);
    }
  });
});
