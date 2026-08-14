/**
 * Bramki screenów LP. Obrazy są częścią dowodu produktu, więc sam poprawny
 * adres nie wystarcza: stary plik pod tą samą nazwą ma palić test.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

const root = path.resolve(__dirname, "..");

const UJECIA = {
  kalendarz: { ratio: 2 },
  kaucje: { ratio: 2 },
  kurier: { ratio: 2 },
  kreator: { ratio: 2 },
  koszyk: { ratio: 2 },
  pulpit: { ratio: 1.5 },
  rejestracja: { ratio: 4 / 3 },
  katalog: { ratio: 4 / 3 },
  zamowienia: { ratio: 4 / 3 },
} as const;

const STARE_SUMY = new Set([
  "5f1af0025b0cbf37131f6cbaf633c7642f2642aaefffe025b59cba73c5dc877a",
  "5fff7dbe1170420cbc0f6ee4041446690e4a2b25cedfb81ab1b7b958755de7cb",
  "dbaa08892a350fdedba2de07d5e83af826d89986dded4a9b256313bd400e8f5e",
  "b988650cb2c92db1efa50c92fe9692e0a7cc0b6e310c1723d226044731fc6a7f",
  "1630be91aad1e8b46666ed66c46aeb2676eaa906dbbfbb08407c7008463d7e37",
  "d590d46fbbe9aa66155f6b49fdf5d42827386e411155c6604eac2e1d66a17953",
  "2641fa78b23eda0ed0004d9bafa74fd72552895b0451305f26a14e900686f235",
  "b4c2c488868a1a0048628f75eab74b0acf96d58e3f62cd815f741655c7b5ca05",
  "2c305a33f0e79bf0f30dad54794219bc067d34d634bd1d6cfea899c05cc23f8f",
  "b16e05b9f6f86889b1462a875b76f33a4841334043e6648bea9da3aa4bf100fc",
  "4acee801e0cb2efae812903d9b9301d93c991d2b4a5da8a0c84dc7443fd6c151",
  "c067ca0638c28cb51f393a7fc27cf5de877f96cc519a1b053fc4485f499c983c",
  "ba42953b7efafef3b4475b9c44c72064a7abce2af045fdc6c8120cc8abec1186",
  "082c0a38c6ca758a04f90395650adb4233961a38b1c29dec32cec12f3052a717",
  "90302791388fc11907fd24abc38db08a928f1218670c775fb1d8a7ce0116aca3",
  "0200569e8649644a52c2d4c41dcd2515875b7ea00380e97db262e4c29b68a059",
  "e5e3c3d59c1b940f65496e989e000afee2bec2742bfc961afe1336e0df11eee4",
  "3b1e6be647b2079f5244aebf8f4425dc92fd819df9d05bad5c8d5dfe709f310a",
]);

function wymiaryWebp(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(buffer.subarray(8, 12).toString("ascii")).toBe("WEBP");
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8 ") {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  throw new Error(`Nieobsługiwany wariant WebP: ${chunk}`);
}

describe("aktualne screeny produktu na LP", () => {
  for (const [locale, messages] of [
    ["pl", pl],
    ["en", en],
  ] as const) {
    for (const [nazwa, kontrakt] of Object.entries(UJECIA)) {
      it(`${locale}/${nazwa}: świeży WebP o właściwej proporcji i z opisem`, () => {
        const src = messages.marketing.shots[nazwa as keyof typeof UJECIA];
        const alt = messages.marketing.shots[`${nazwa}Alt` as keyof typeof messages.marketing.shots];
        expect(src).toBe(`/produkt/${locale}/${nazwa}.webp`);
        expect(alt.length).toBeGreaterThanOrEqual(70);
        expect(alt).toMatch(/demonstr|demo/i);

        const buffer = readFileSync(path.join(root, "public", src));
        const suma = createHash("sha256").update(buffer).digest("hex");
        expect(STARE_SUMY.has(suma), `${locale}/${nazwa} nadal jest starym screenem`).toBe(false);

        const { width, height } = wymiaryWebp(buffer);
        expect(width, `${locale}/${nazwa}: szerokość`).toBeGreaterThanOrEqual(900);
        expect(height, `${locale}/${nazwa}: wysokość`).toBeGreaterThanOrEqual(600);
        expect(width / height, `${locale}/${nazwa}: proporcja`).toBeCloseTo(kontrakt.ratio, 1);
      });
    }
  }

  it("szablon zachowuje istniejące ramki i leniwe ładowanie dziewięciu ujęć", () => {
    const html = readFileSync(path.join(root, "marketing/home.html"), "utf8");
    expect(html.match(/class="zrzut-ui /g)).toHaveLength(9);
    expect(html.match(/loading="lazy"[^>]*class="zrzut-ui /g)).toHaveLength(9);
    expect(html.match(/class="tab-accordion-image"/g)).toHaveLength(5);
    expect(html.match(/class="momonetum-image zrzut-ramka-4-3"/g)).toHaveLength(3);
    expect(html.match(/class="cta-block-image zrzut-ramka-3-2"/g)).toHaveLength(1);
  });
});
